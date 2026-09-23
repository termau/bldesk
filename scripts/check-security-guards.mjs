#!/usr/bin/env node
// Keeps the main-window lockdown in place (see src/main/security.ts). The
// renderer holds the API token, so these are the checks that stop a later
// change from quietly reopening a path to it.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// CRLF normalised: a Windows checkout (core.autocrlf) must pass the same checks.
const read = path => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n')
const walk = dir => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(join(dir, e.name)) : /\.(tsx?|mts)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [join(dir, e.name)] : [])
// Strip comments so prose that names an API does not count as using it.
const code = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const failures = []

for (const path of walk('src/renderer/src')) {
  const source = code(read(path))
  for (const [pattern, why] of [
    [/dangerouslySetInnerHTML/, 'renders raw HTML; build React elements instead (see renderReleaseNotes in UpdateMenu.tsx)'],
    [/\.(inner|outer)HTML\s*=|insertAdjacentHTML\s*\(/, 'writes raw HTML into the page']
  ]) if (pattern.test(source)) failures.push(`${relative(ROOT, path)}: ${why}`)
}

for (const path of walk('src/main')) {
  const rel = relative(ROOT, path).replace(/\\/g, '/')
  if (rel !== 'src/main/security.ts' && /shell\.openExternal\s*\(/.test(code(read(path)))) {
    failures.push(`${rel}: call openExternalSafe from security.ts, which allows only http, https and mailto links`)
  }
}

const main = code(read('src/main/index.ts'))
const guard = main.indexOf('installIpcSenderGuard('), handlers = main.indexOf('registerIpcHandlers()\n')
if (guard < 0 || handlers < 0 || guard > handlers) failures.push('src/main/index.ts: call installIpcSenderGuard() before registerIpcHandlers(), so every IPC channel checks its caller')
if (!main.includes('installNavigationGuards(')) failures.push('src/main/index.ts: keep installNavigationGuards() wired into startup')
if (!/partition:\s*RESCUE_CONSOLE_PARTITION/.test(main)) failures.push('src/main/index.ts: the rescue console window must use its own session (RESCUE_CONSOLE_PARTITION)')

if (!/sandbox:\s*true/.test(main) || !/webSecurity:\s*true/.test(main) || /sandbox:\s*false|webSecurity:\s*false/.test(main)) {
  failures.push('src/main/index.ts: the main window keeps sandbox: true and webSecurity: true (API CORS is handled by installApiCorsHeaders in security.ts)')
}
if (!main.includes('installApiCorsHeaders(')) failures.push('src/main/index.ts: keep installApiCorsHeaders() wired into startup, or every API request fails with web security on')

const viteConfig = read('electron.vite.config.ts')
if (/connect-src[^"]*'self'/.test(viteConfig)) failures.push("electron.vite.config.ts: connect-src must not include 'self'; from file:// it would allow fetching local files")
// Android: CapacitorHttp sends fetch() through this proxy path. Without it the
// Android update check fails with "Failed to fetch" (1.0.62-beta.2 and .3).
if (!/connect-src[^"]*https:\/\/localhost\/_capacitor_http_interceptor_/.test(viteConfig)) failures.push('electron.vite.config.ts: connect-src must allow https://localhost/_capacitor_http_interceptor_, Capacitor\'s fetch proxy on Android')
if (!/plugins:\s*\[[^\]]*contentSecurityPolicyPlugin\(\)/.test(viteConfig)) {
  failures.push('electron.vite.config.ts: keep contentSecurityPolicyPlugin() in the renderer plugins')
}

if (failures.length) {
  console.error(`\nSecurity guard check failed:\n${failures.map(f => `  ✗ ${f}`).join('\n')}\n`)
  process.exitCode = 1
} else {
  console.log('Security guards ok')
}
