import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = path => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')
const errors = []
const fail = (file, message) => errors.push(`${file}: ${message}`)
const navigation = read('src/shared/deeplink.ts')
const extract = name => {
  const match = navigation.match(new RegExp('export const ' + name + ' = \\[([^\\]]+)\\]'))
  if (!match) throw new Error('Cannot read ' + name + '; update the help guard when changing its declaration.')
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1])
}
const views = {
  "servers": "servers/ServerList",
  "templates": "templates/TemplatesView",
  "vpcs": "vpcs/VpcManager",
  "firewall": "firewall/FirewallManager",
  "loadbalancers": "loadbalancers/LoadBalancerManager",
  "dns": "dns/DnsManager",
  "backups": "backups/BackupManager",
  "keys": "keys/SshKeysManager",
  "billing": "billing/BillingOverview",
  "account": "account/AccountOverview",
  "history": "history/HistoryView",
  "map": "map/NetworkMap",
  "heatmap": "heatmap/FleetHeatmap",
  "terminal": "terminal/TerminalView",
  "help": "help/HelpView"
}
const tabs = extract('TOP_TABS'), subtabs = extract('SERVER_SUB_TABS')
const required = [...tabs, ...subtabs.map(s => 'server-' + s), 'getting-started', 'palette', 'shortcuts', 'confirm-and-history', 'tray', 'deep-links', 'troubleshooting']
const docs = new Map()
for (const file of readdirSync(resolve(root, 'docs/help')).filter(f => f.endsWith('.md'))) {
  const path = 'docs/help/' + file, raw = read(path)
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw)
  if (!match) { fail(path, 'missing YAML front matter'); continue }
  try {
    const data = parse(match[1])
    for (const key of ['title', 'summary']) if (typeof data?.[key] !== 'string' || !data[key].trim()) fail(path, 'missing non-empty ' + key)
    if (!Array.isArray(data?.keywords) || !data.keywords.length || !data.keywords.every(v => typeof v === 'string' && v.trim())) fail(path, 'keywords must be a non-empty string list')
    if (!/^# /m.test(match[2])) fail(path, 'missing page heading')
    docs.set(file.slice(0, -3), match[2])
  } catch (error) { fail(path, 'invalid front matter: ' + error.message) }
}
for (const slug of required) if (!docs.has(slug)) fail('docs/help/' + slug + '.md', 'missing required help page')
for (const tab of tabs) {
  const file = views[tab] && 'src/renderer/src/components/' + views[tab] + '.tsx'
  if (!file || !existsSync(resolve(root, file))) fail('scripts/check-help-guards.mjs', 'add the top-level view mapping for ' + tab)
  else if (!read(file).includes('<HelpLink slug="' + tab + '"')) fail(file, 'missing <HelpLink slug="' + tab + '" />')
  if (file && existsSync(resolve(root, file))) {
    const source = read(file)
    for (const link of source.matchAll(/<HelpLink\b/g)) {
      if (source.lastIndexOf('<button', link.index) > source.lastIndexOf('</button>', link.index)) fail(file, 'HelpLink must not be nested inside an action button')
    }
  }
}
const detail = 'src/renderer/src/components/servers/ServerDetails.tsx'
const manifest = 'android/app/src/main/AndroidManifest.xml'
if (!read(manifest).includes('android.permission.ACCESS_NETWORK_STATE')) fail(manifest, 'WebView needs ACCESS_NETWORK_STATE for offline help detection')
if (!read(detail).includes('server-${activeSubTab}')) fail(detail, 'missing contextual help for active server sub-tab')
const commandFile = 'src/renderer/src/lib/commands.ts'
const commandSource = read(commandFile)
const spec = commandSource.match(/export const VERB_SPECS[^=]*= \[([\s\S]*?)\n\]/)
if (!spec) fail(commandFile, 'cannot read VERB_SPECS; update the guard')
const verbs = [...(spec?.[1] ?? '').matchAll(/verb: '([^']+)'/g)].map(m => m[1])
const examples = [...(docs.get('palette') ?? '').matchAll(/```[^\n]*\n([\s\S]*?)\n```/g)].flatMap(m => m[1].split('\n'))
for (const verb of verbs) if (!examples.some(line => line === verb || line.startsWith(verb + ' '))) fail('docs/help/palette.md', 'missing fenced example starting with ' + verb)
// A moved heading must not silently break contextual links or other help pages.
const headingIds = body => {
  const ids = new Set(), counts = new Map()
  let fenced = false
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) { fenced = !fenced; continue }
    const m = !fenced && /^(#{1,3})\s+(.+)$/.exec(line)
    if (!m) continue
    const base = m[2].toLowerCase().replace(/[`*]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const n = (counts.get(base) ?? 0) + 1
    counts.set(base, n); ids.add(n > 1 ? base + '-' + n : base)
  }
  return ids
}
for (const [slug, body] of docs) for (const m of body.matchAll(/\]\(help:([^\s)]+)\)/g)) {
  const [target, heading] = m[1].split('#')
  if (!docs.has(target)) fail('docs/help/' + slug + '.md', 'unknown help target ' + target)
  else if (heading && !headingIds(docs.get(target)).has(heading)) fail('docs/help/' + slug + '.md', 'unknown heading ' + m[1])
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
else console.log(`Help guards passed: ${docs.size} pages, ${tabs.length} tabs, ${subtabs.length} server tabs, ${verbs.length} verbs.`)
