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

// The public API reference is the contract (AGENTS.md, "Public API only").
// Code must not build on BinaryLane API features kept only for existing
// customers, or on fields and endpoints the reference does not document.
// `allow` lists uses that predate this check; they are to be fixed, not added
// to, and the check fails once a listed file no longer needs its exception.
const API_RULES = [
  { pattern: /change_offsite_backup_location|change_manage_offsite_backup_copies/, why: 'custom offsite backup locations are kept only for existing customers; do not offer them' },
  { pattern: /nested-virt/, why: 'nested virtualisation is kept only for existing customers; offer only what available_advanced_features returns' },
  { pattern: /\/failover_ips/, why: 'IP failover management is not in the public API reference (showing a server\'s failover_ips is fine)' },
  { pattern: /ip_failover_enabled|offsite_backup_location_enabled|primary_disk_used_megabytes|x-csrf-token/i, why: 'not in the public API reference' },
  { pattern: /\berror_message\b/, why: 'documented only on Image, not on actions', allow: ['src/renderer/src/api/queries.ts'] },
  { pattern: /\bdownload_url\b/, why: 'not an Invoice field; the reference has invoice_download_url', allow: ['src/renderer/src/components/billing/BillingOverview.tsx'] },
  { pattern: /\b(entry_port|target_port|target_protocol)\b/, why: 'ForwardingRule documents only entry_protocol', allow: ['src/renderer/src/components/loadbalancers/LoadBalancerManager.tsx'] }
]
const sources = ['src/renderer/src', 'src/main', 'src/shared'].flatMap(walk).map((path) => ({ rel: relative(ROOT, path).replace(/\\/g, '/'), source: code(read(path)) }))
for (const { pattern, why, allow = [] } of API_RULES) {
  for (const { rel, source } of sources) {
    if (pattern.test(source) && !allow.includes(rel)) failures.push(`${rel}: ${why} (AGENTS.md, "Public API only")`)
  }
  for (const rel of allow) {
    const entry = sources.find((s) => s.rel === rel)
    if (!entry || !pattern.test(entry.source)) failures.push(`scripts/check-security-guards.mjs: ${rel} no longer matches ${pattern}; remove it from that rule's allow list`)
  }
}

// Internal BinaryLane references (see AGENTS.md, "Public API only"). The
// patterns are base64-encoded so this public file does not itself name them.
const INTERNAL_MARKERS = [
  'dnBzXC92cHM=', 'XGJ2cHMgI1xkKw==', 'cHJvZHVjdFwvd2Vic2l0ZQ==', 'UGFuZWxTaXRl', 'SG9zdERhZW1vbg==',
  'V2ViQXBpXC9TZXJ2aWNlcw==', 'W0EtWmEtel0rQXBpU2VydmljZVwuY3M=', 'aW1wbGVtZW50YXRpb24gc291cmNl', 'c291cmNlIGNoZWNrb3V0',
  'U2l6ZUhlbHBlcg==', 'Q29uZmlnU3RvcmVcLg==', 'W0EtWmEtel1BcGlTZXJ2aWNl', 'bnVtYmVyT2ZCYWNrdXBz', 'OWZjNDllZA==', 'cGFuZWwucyAob3duICk/c291cmNl', 'V2ViQVBJ', 'QmFja3VwSGVscGVy',
  'SGlkZUZyb21BUElEb2Nz', 'UmVxdWlyZXNGZWF0dXJl', 'QnJhbmRGZWF0dXJl', 'V2Vic2l0ZU9ubHk=',
  'Q3VzdG9tZXJEZXByZWNhdGVkRmVhdHVyZXM=', 'U2l0ZVNlcnZpY2Vz', 'c2l0ZS1zZXJ2aWNlcw==', 'T3BlbkFwaUNsaWVudFwudHM=',
  'QXBpTW9kZWxcLnRz', 'Q2xpZW50QXBw', 'WC1QYW5lbC1BdXRo', 'TU0tQ29ubmVjdGluZy1JUA==', 'dnBzIG1vbm9yZXBv'
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
