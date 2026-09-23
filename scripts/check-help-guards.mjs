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
// Quoted app text must exist (#49). Every “curly-quoted” string in a help page
// quotes something the app shows - a dialog title, summary, note, button or
// tooltip - so it must be a whole string in the renderer source. A placeholder
// (`${…}` in a template, `{…}` in JSX text) matches the page's example value,
// unless it only chooses between literals (`n === 1 ? '' : 's'`), in which case
// it must be one of them. Most of a quote must be the app's own fixed words, so
// a string like `Copy ${ip}` cannot vouch for any quote that starts with "Copy".
const MIN_FIXED_SHARE = 0.4
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const unescape = s => s.replace(/\\u\{?([0-9a-fA-F]{4,5})\}?|\\n|\\(.)/g, (_, hex, ch) => hex ? String.fromCodePoint(parseInt(hex, 16)) : ch ?? ' ')
const walk = dir => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(dir + '/' + e.name) : /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [dir + '/' + e.name] : [])
const texts = [] // regex sources, one per string the app can show
// A choice between two literals is those two branches (the last two literals;
// any before them are in the condition); anything else is a value.
const hole = ({ shape, lits }) => /^[^?:]+\?L:L$/.test(shape.replace(/\s+/g, '')) ? '(?:' + lits.slice(-2).join('|') + ')' : '(.*?)'
// Scan an expression from `at`, collecting every string and template literal
// (comments and regex literals skipped). Returns where it stopped, plus the
// top-level literals and the expression's shape with each literal as `L`.
function scan(code, at, close) {
  let i = at, prev = '', depth = 0, shape = ''
  const lits = []
  const literal = src => { texts.push(src); if (depth === 0) lits.push(src); shape += 'L' }
  for (; i < code.length; i++) {
    const c = code[i]
    if (c === '/' && code[i + 1] === '/') { i = code.indexOf('\n', i); if (i < 0) i = code.length; continue }
    if (c === '/' && code[i + 1] === '*') { i = code.indexOf('*/', i + 2) + 1; continue }
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < code.length && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
      literal(esc(unescape(code.slice(i + 1, j)))); i = j; prev = c; continue
    }
    if (c === '`') {
      let src = ''
      for (i++; i < code.length && code[i] !== '`'; i++) {
        if (code[i] === '\\') { src += esc(unescape(code.slice(i, i + 2))); i++ }
        else if (code[i] === '$' && code[i + 1] === '{') { const inner = scan(code, i + 2, '}'); i = inner.end; src += hole(inner) }
        else src += esc(code[i])
      }
      literal(src); prev = '`'; continue
    }
    // A regex literal can hold a quote; skip it where a value is expected.
    if (c === '/' && /^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(prev)) {
      let j = i + 1, klass = false
      while (j < code.length && code[j] !== '\n' && (klass || code[j] !== '/')) {
        if (code[j] === '\\') j++
        else if (code[j] === '[') klass = true
        else if (code[j] === ']') klass = false
        j++
      }
      i = j; prev = '/'; continue
    }
    if (c === '{') depth++
    if (c === '}' && close === '}' && depth-- === 0) break
    shape += c
    if (!/\s/.test(c)) prev = c
  }
  return { end: i, lits, shape }
}
for (const file of walk('src/renderer/src')) {
  const code = read(file)
  scan(code, 0, null)
  // JSX text between tags, with flat `{…}` expressions as holes.
  if (file.endsWith('.tsx')) for (const m of code.matchAll(/>([^<>]*?)</g)) {
    const raw = m[1].replace(/\s+/g, ' ').trim()
    if (!/[A-Za-z]{2}/.test(raw) || /[;=]|=>/.test(raw.replace(/\{[^{}]*\}/g, ''))) continue
    const parts = raw.split(/(\{[^{}]*\})/)
    if (parts.some((part, k) => k % 2 === 0 && /[{}]/.test(part))) continue
    texts.push(parts.map((part, k) => k % 2 ? hole(scan(part.slice(1, -1), 0, null)) : esc(part)).join(''))
  }
}
// Dialog titles for API actions are generated, not written: `describeActionType`
// in lib/actionLabels.ts title-cases the snake_case type with an acronym map.
// Apply the same rule to every action-type literal so those titles are checkable.
const labelsFile = 'src/renderer/src/lib/actionLabels.ts'
const acronymBlock = read(labelsFile).match(/const ACRONYMS[^{]*\{([^}]*)\}/)
if (!acronymBlock) fail(labelsFile, 'cannot read ACRONYMS; update the help guard')
const acronyms = Object.fromEntries([...(acronymBlock?.[1] ?? '').matchAll(/(\w+): '([^']+)'/g)].map(m => [m[1], m[2]]))
for (const type of new Set(texts.filter(s => /^[a-z0-9]+(_[a-z0-9]+)+$/.test(s))))
  texts.push(esc(type.split('_').map(w => acronyms[w] ?? w.charAt(0).toUpperCase() + w.slice(1)).join(' ')))
const squash = s => s.replace(/\s+/g, ' ').trim()
const patterns = [...new Set(texts)].filter(s => /[A-Za-z]/.test(s)).map(src => {
  try { return { src, re: new RegExp('^' + src.replace(/\s+/g, ' ').trim() + '$') } } catch { return null }
}).filter(Boolean)
// Share of the quote that is the app's fixed wording rather than a filled-in value.
const fixedShare = (re, quote) => {
  const m = re.exec(quote)
  return m ? 1 - m.slice(1).reduce((n, g) => n + (g?.length ?? 0), 0) / quote.length : 0
}
const readable = src => src.replace(/\(\.\*\?\)/g, '${…}').replace(/\(\?:/g, '{').replace(/(?<!\\)\)/g, '}').replace(/\\(.)/g, '$1')
const words = s => new Set(s.toLowerCase().match(/[a-z0-9']+/g) ?? [])
let quotes = 0
for (const [slug, body] of docs) for (const m of body.matchAll(/“([^”]+)”/g)) {
  quotes++
  const quote = squash(m[1])
  if (patterns.some(p => fixedShare(p.re, quote) >= MIN_FIXED_SHARE)) continue
  const want = words(quote)
  const nearest = patterns.map(p => ({ p, score: [...words(readable(p.src))].filter(w => want.has(w)).length })).sort((a, b) => b.score - a.score)[0]
  fail('docs/help/' + slug + '.md', `quoted text is not in the app: “${quote}”` +
    (nearest?.score ? `\n    nearest in source: "${readable(nearest.p.src)}"` : ''))
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
else console.log(`Help guards passed: ${docs.size} pages, ${tabs.length} tabs, ${subtabs.length} server tabs, ${verbs.length} verbs, ${quotes} quotes.`)
