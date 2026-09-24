#!/usr/bin/env node
// Keeps the main-window lockdown in place (see src/main/security.ts). The
// renderer holds the API token, so these are the checks that stop a later
// change from quietly reopening a path to it.
import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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

// Internal BinaryLane references (see AGENTS.md, "Public API only"). The
// patterns are base64-encoded so this public file does not itself name them.
const INTERNAL_MARKERS = [
  'dnBzXC92cHM=', 'XGJ2cHMgI1xkKw==', 'cHJvZHVjdFwvd2Vic2l0ZQ==', 'UGFuZWxTaXRl', 'SG9zdERhZW1vbg==',
  'V2ViQXBpXC9TZXJ2aWNlcw==', 'W0EtWmEtel0rQXBpU2VydmljZVwuY3M=', 'aW1wbGVtZW50YXRpb24gc291cmNl', 'c291cmNlIGNoZWNrb3V0',
  'U2l6ZUhlbHBlcg==', 'Q29uZmlnU3RvcmVcLg==', 'W0EtWmEtel1BcGlTZXJ2aWNl', 'bnVtYmVyT2ZCYWNrdXBz', 'OWZjNDllZA==', 'cGFuZWwucyAob3duICk/c291cmNl', 'V2ViQVBJ'
].map((b64) => new RegExp(Buffer.from(b64, 'base64').toString('utf8'), 'i'))
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
  .filter((f) => !/(^|\/)(package-lock\.json|openapi\.json|schema\.d\.ts)$/.test(f) && !/\.(png|jpe?g|gif|ico|icns|webp|woff2?|ttf|jar|keystore|jks|apk|zip)$/i.test(f))
for (const file of tracked) {
  let text
  try { text = readFileSync(join(ROOT, file), 'utf8') } catch { continue }
  const hit = INTERNAL_MARKERS.find((re) => re.test(text))
  if (hit) failures.push(`${file}: references internal BinaryLane material; explain it from the public API reference instead (AGENTS.md, "Public API only")`)
}

if (failures.length) {
  console.error(`\nSecurity guard check failed:\n${failures.map(f => `  ✗ ${f}`).join('\n')}\n`)
  process.exitCode = 1
} else {
  console.log('Security guards ok')
}
