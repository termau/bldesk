/**
 * Verb-first command grammar for the command palette (FEATURES.md #4).
 *
 *   restart jumpbox                 reboot one server
 *   shutdown wp-*                   graceful shutdown of every server matching a glob
 *   start wp-web-1-syd,wp-web-2-syd power on a comma-separated list
 *   backup wp-web-3-bne "pre-upgrade"
 *   ssh 43.224                      ssh to the server whose IPv4 starts with 43.224
 *   open jumpbox network            open a server on a sub-tab
 *   console #12345                  rescue console by id
 *   link jumpbox                    copy a bldesk:// link
 *   dns add A foo.example.com 203.0.113.9
 *   go dns                          jump to a top-level tab
 *   ?                               help
 *
 * Pure: no React, no network. The palette resolves targets against the server
 * list it already has and drives the existing mutation hooks. Nothing here is
 * allowed to touch a server — parsing and matching only — so the confirm step
 * in the UI is the last gate before anything is submitted.
 */

import type { components } from '@shared/api/schema'
import { SERVER_SUB_TABS, TOP_TABS, type DeepLinkServerSubTab, type DeepLinkTab } from '@shared/deeplink'

type Server = components['schemas']['Server']
type DomainRecordType = components['schemas']['DomainRecordType']

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

/** Server actions the palette may submit, keyed by canonical verb. */
export const POWER_VERBS = {
  reboot: { type: 'reboot', label: 'Reboot', requires: 'active' },
  shutdown: { type: 'shutdown', label: 'Shutdown (graceful)', requires: 'active' },
  poweroff: { type: 'power_off', label: 'Power off (hard)', requires: 'active' },
  start: { type: 'power_on', label: 'Power on', requires: 'off' },
  cycle: { type: 'power_cycle', label: 'Power cycle', requires: 'active' }
} as const

export type PowerVerb = keyof typeof POWER_VERBS

/** Every spelling the parser accepts, mapped to its canonical verb. */
const VERB_ALIASES: Record<string, Verb> = {
  create: 'create',
  new: 'create',
  deploy: 'create',
  reboot: 'reboot',
  restart: 'reboot',
  shutdown: 'shutdown',
  stop: 'shutdown',
  halt: 'shutdown',
  poweroff: 'poweroff',
  'power-off': 'poweroff',
  kill: 'poweroff',
  start: 'start',
  boot: 'start',
  poweron: 'start',
  'power-on': 'start',
  cycle: 'cycle',
  powercycle: 'cycle',
  'power-cycle': 'cycle',
  backup: 'backup',
  backups: 'backup',
  bak: 'backup',
  // Tolerated spellings from before the rename: the product has no snapshots,
  // but people's fingers and their recent-commands list still do.
  snapshot: 'backup',
  snap: 'backup',
  ssh: 'ssh',
  console: 'console',
  rescue: 'console',
  open: 'open',
  show: 'open',
  link: 'link',
  copy: 'link',
  dns: 'dns',
  tag: 'tag',
  tags: 'tag',
  group: 'tag',
  go: 'go',
  goto: 'go',
  tab: 'go',
  help: 'help',
  ask: 'ask',
  '??': 'ask',
  '?': 'help'
}

export type Verb = PowerVerb | 'backup' | 'ssh' | 'console' | 'open' | 'link' | 'dns' | 'tag' | 'create' | 'go' | 'help' | 'ask'

export interface VerbSpec {
  verb: Verb
  usage: string
  summary: string
  /** Whether running it changes something on BinaryLane (and so needs confirming). */
  mutates: boolean
}

export const VERB_SPECS: VerbSpec[] = [
  { verb: 'reboot', usage: 'restart <servers>', summary: 'Reboot running servers', mutates: true },
  { verb: 'shutdown', usage: 'shutdown <servers>', summary: 'Graceful shutdown (ACPI)', mutates: true },
  { verb: 'poweroff', usage: 'poweroff <servers>', summary: 'Hard power off', mutates: true },
  { verb: 'start', usage: 'start <servers>', summary: 'Power on stopped servers', mutates: true },
  { verb: 'cycle', usage: 'cycle <servers>', summary: 'Hard power cycle', mutates: true },
  { verb: 'backup', usage: 'backup <servers> ["label"]', summary: 'Take a temporary backup', mutates: true },
  { verb: 'dns', usage: 'dns add <TYPE> <fqdn> <value> [priority]', summary: 'Add a DNS record to a hosted zone', mutates: true },
  { verb: 'tag', usage: 'tag add|remove <name> <servers>', summary: 'Tag servers locally; @name then targets them anywhere', mutates: false },
  { verb: 'create', usage: 'create <hostname> from <template>', summary: 'New server from a template (opens the create form prefilled)', mutates: true },
  { verb: 'ssh', usage: 'ssh <server|ip> [--native]', summary: 'Open SSH as root; --native forces the OS terminal', mutates: false },
  { verb: 'console', usage: 'console <server>', summary: 'Open the rescue console', mutates: false },
  { verb: 'open', usage: 'open <server> [subtab]', summary: 'Open a server (overview, network, firewall…)', mutates: false },
  { verb: 'link', usage: 'link <server> [subtab]', summary: 'Copy a bldesk:// link', mutates: false },
  { verb: 'go', usage: 'go <tab>', summary: 'Jump to a tab (servers, dns, firewall…)', mutates: false },
  { verb: 'help', usage: 'help [words]', summary: 'Show commands or search BLDesk help', mutates: false },
  { verb: 'ask', usage: 'ask <question>', summary: 'Ask BinaryLane using published articles', mutates: false }
]

const SPEC_BY_VERB = new Map(VERB_SPECS.map((s) => [s.verb, s]))

/** `<servers>` may be one pattern or a comma-separated list: `wp-*`, `#123`, `43.224`, `a,b,c`. */
export const TARGET_HELP =
  'Targets: a name (or prefix), a glob like wp-*, #id, an IPv4 or its prefix, @group or @tag, or several separated by commas.'

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

/** Split on whitespace, honouring "double quotes" so a backup label can carry spaces. */
export function tokenise(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let sawAny = false
  for (const ch of input) {
    if (ch === '"') {
      quoted = !quoted
      sawAny = true
      continue
    }
    if (!quoted && /\s/.test(ch)) {
      if (cur || sawAny) out.push(cur)
      cur = ''
      sawAny = false
      continue
    }
    cur += ch
    sawAny = true
  }
  if (cur || sawAny) out.push(cur)
  return out
}

// ---------------------------------------------------------------------------
// Parsed commands
// ---------------------------------------------------------------------------

export type ParsedCommand =
  | { kind: 'power'; verb: PowerVerb; targets: string }
  | { kind: 'backup'; targets: string; label?: string }
  | { kind: 'ssh'; target: string; native?: boolean }
  | { kind: 'console'; target: string }
  | { kind: 'open'; target: string; subTab?: DeepLinkServerSubTab; console?: boolean }
  | { kind: 'link'; target: string; subTab?: DeepLinkServerSubTab }
  | { kind: 'go'; tab: DeepLinkTab }
  | { kind: 'dns-add'; type: DomainRecordType; fqdn: string; value: string; priority?: number }
  | { kind: 'tag'; op: 'add' | 'remove'; tag: string; targets: string }
  | { kind: 'create'; hostname: string; template: string }
  | { kind: 'help'; query?: string }
  | { kind: 'ask'; query: string }
  /** Verb recognised but arguments missing or wrong; `usage` says what it wanted. */
  | { kind: 'incomplete'; verb: Verb; usage: string; problem?: string }

const DNS_TYPES: DomainRecordType[] = ['A', 'AAAA', 'CAA', 'CNAME', 'MX', 'NS', 'SRV', 'TXT']

/** The canonical verb a query starts with, or null if it reads as a plain search. */
export function detectVerb(input: string): Verb | null {
  const head = tokenise(input.trimStart())[0]?.toLowerCase()
  if (!head) return null
  return VERB_ALIASES[head] ?? null
}

/** Verbs whose spelling starts with `prefix` — for suggesting as the user types. */
export function verbsMatching(prefix: string): VerbSpec[] {
  const p = prefix.trim().toLowerCase()
  if (!p) return VERB_SPECS
  const hits = new Set<Verb>()
  for (const [alias, verb] of Object.entries(VERB_ALIASES)) {
    if (alias.startsWith(p)) hits.add(verb)
  }
  return VERB_SPECS.filter((s) => hits.has(s.verb))
}

export function parseCommand(input: string): ParsedCommand | null {
  const tokens = tokenise(input.trim())
  if (tokens.length === 0) return null
  const verb = VERB_ALIASES[tokens[0].toLowerCase()]
  if (!verb) return null
  const args = tokens.slice(1)
  const usage = SPEC_BY_VERB.get(verb)!.usage
  const incomplete = (problem?: string): ParsedCommand => ({ kind: 'incomplete', verb, usage, problem })

  switch (verb) {
    case 'reboot':
    case 'shutdown':
    case 'poweroff':
    case 'start':
    case 'cycle':
      if (args.length === 0) return incomplete()
      return { kind: 'power', verb, targets: args.join(',') }

    case 'backup': {
      if (args.length === 0) return incomplete()
      // Everything after the first token is the label, so both
      // `backup web "before upgrade"` and `backup web before upgrade` work.
      const [targets, ...rest] = args
      const label = rest.join(' ').trim() || undefined
      return { kind: 'backup', targets, label }
    }

    case 'ssh':
      if (args.length === 0) return incomplete()
      if (args[0] === '--native' || args.length > 2 || (args[1] && args[1] !== '--native')) return incomplete('Use ssh <server> [--native]')
      return { kind: 'ssh', target: args[0], native: args[1] === '--native' }

    case 'console':
      if (args.length === 0) return incomplete()
      return { kind: 'console', target: args[0] }

    case 'open': {
      if (args.length === 0) return incomplete()
      // `open console <server>` is the natural phrasing; accept it.
      if (args[0].toLowerCase() === 'console') {
        if (!args[1]) return incomplete()
        return { kind: 'open', target: args[1], console: true }
      }
      const subTab = args[1] ? normaliseSubTab(args[1]) : undefined
      if (args[1] && !subTab) return incomplete(`Unknown sub-tab "${args[1]}". One of: ${SERVER_SUB_TABS.join(', ')}`)
      return { kind: 'open', target: args[0], subTab }
    }

    case 'link': {
      if (args.length === 0) return incomplete()
      const subTab = args[1] ? normaliseSubTab(args[1]) : undefined
      if (args[1] && !subTab) return incomplete(`Unknown sub-tab "${args[1]}". One of: ${SERVER_SUB_TABS.join(', ')}`)
      return { kind: 'link', target: args[0], subTab }
    }

    case 'go': {
      if (args.length === 0) return incomplete()
      const tab = normaliseTab(args[0])
      if (!tab) return incomplete(`Unknown tab "${args[0]}". One of: ${TOP_TABS.join(', ')}`)
      return { kind: 'go', tab }
    }

    case 'dns': {
      // Only `add` for now; deletion is a per-record decision better made in the DNS tab.
      if (args[0]?.toLowerCase() !== 'add') return incomplete()
      const [, rawType, fqdn, value, rawPriority] = args
      if (!rawType || !fqdn || !value) return incomplete()
      const type = rawType.toUpperCase() as DomainRecordType
      if (!DNS_TYPES.includes(type)) return incomplete(`Unknown record type "${rawType}". One of: ${DNS_TYPES.join(', ')}`)
      let priority: number | undefined
      if (rawPriority !== undefined) {
        priority = Number(rawPriority)
        if (!Number.isInteger(priority) || priority < 0) return incomplete(`Priority must be a whole number, got "${rawPriority}"`)
      }
      if ((type === 'MX' || type === 'SRV') && priority === undefined) {
        return incomplete(`${type} records need a priority: dns add ${type} ${fqdn} ${value} 10`)
      }
      return { kind: 'dns-add', type, fqdn: fqdn.toLowerCase().replace(/\.$/, ''), value, priority }
    }

    case 'tag': {
      const op = args[0]?.toLowerCase()
      if (op !== 'add' && op !== 'remove' && op !== 'rm') return incomplete()
      const [, tag, ...rest] = args
      if (!tag || rest.length === 0) return incomplete()
      return { kind: 'tag', op: op === 'rm' ? 'remove' : op, tag: tag.replace(/^@/, ''), targets: rest.join(',') }
    }

    case 'create': {
      // create web-01 from "CIS-hardened Ubuntu"   |   create web-01 from @starter-docker-host
      const [hostname, from, ...rest] = args
      if (!hostname) return incomplete()
      if (from?.toLowerCase() !== 'from' || rest.length === 0) return incomplete('Say which template: create <hostname> from <template name>')
      return { kind: 'create', hostname, template: rest.join(' ') }
    }

    case 'help':
      return { kind: 'help', query: args.join(' ') || undefined }
    case 'ask':
      return args.length ? { kind: 'ask', query: args.join(' ') } : incomplete()
  }
}

function normaliseSubTab(raw: string): DeepLinkServerSubTab | undefined {
  const s = raw.toLowerCase()
  const aliases: Record<string, DeepLinkServerSubTab> = {
    net: 'network',
    remote: 'remote-access',
    access: 'remote-access',
    console: 'remote-access',
    fw: 'firewall',
    metrics: 'usage',
    stats: 'usage',
    config: 'settings',
    rescue: 'recovery'
  }
  const tab = aliases[s] ?? s
  return (SERVER_SUB_TABS as readonly string[]).includes(tab) ? (tab as DeepLinkServerSubTab) : undefined
}

function normaliseTab(raw: string): DeepLinkTab | undefined {
  const s = raw.toLowerCase()
  const aliases: Record<string, DeepLinkTab> = {
    server: 'servers',
    vps: 'servers',
    vpc: 'vpcs',
    networks: 'vpcs',
    fw: 'firewall',
    firewalls: 'firewall',
    lb: 'loadbalancers',
    lbs: 'loadbalancers',
    loadbalancer: 'loadbalancers',
    'load-balancers': 'loadbalancers',
    domains: 'dns',
    backup: 'backups',
    ssh: 'keys',
    'ssh-keys': 'keys',
    invoices: 'billing',
    bill: 'billing',
    term: 'terminal',
    shell: 'terminal',
    network: 'map',
    topology: 'map',
    heatmap: 'heatmap',
    utilisation: 'heatmap',
    utilization: 'heatmap',
    docs: 'help',
    support: 'help'
  }
  const tab = aliases[s] ?? s
  return (TOP_TABS as readonly string[]).includes(tab) ? (tab as DeepLinkTab) : undefined
}

// ---------------------------------------------------------------------------
// Target matching
// ---------------------------------------------------------------------------

export interface TargetMatch {
  server: Server
  /** Which pattern in the list matched it, for the preview. */
  pattern: string
}

/**
 * Resolve a target expression to servers.
 *
 * Each comma-separated pattern is tried as, in order:
 *   `#123` / `123`   — server id
 *   `43.224.183.192` / `43.224` — a public IPv4 or a prefix of one (digits and dots only)
 *   `wp-*` / `web?`  — glob on the name, case-insensitive
 *   `jumpbox`        — exact name if one exists, otherwise a name prefix
 *
 * Returns matches in server-list order, de-duplicated, plus the patterns that
 * matched nothing so the UI can say so instead of quietly running on fewer
 * machines than the user meant.
 */
export function matchServers(servers: Server[], expression: string): { matches: TargetMatch[]; unmatched: string[] } {
  const seen = new Set<number>()
  const matches: TargetMatch[] = []
  const unmatched: string[] = []

  for (const raw of expression.split(',')) {
    const pattern = raw.trim()
    if (!pattern) continue
    const hits = matchOne(servers, pattern)
    if (hits.length === 0) unmatched.push(pattern)
    for (const s of hits) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      matches.push({ server: s, pattern })
    }
  }
  // Keep server-list order regardless of pattern order so a preview reads like the list.
  const order = new Map(servers.map((s, i) => [s.id, i]))
  matches.sort((a, b) => (order.get(a.server.id) ?? 0) - (order.get(b.server.id) ?? 0))
  return { matches, unmatched }
}

function matchOne(servers: Server[], pattern: string): Server[] {
  const p = pattern.toLowerCase()

  if (/^#?\d+$/.test(p)) {
    const id = Number(p.replace(/^#/, ''))
    return servers.filter((s) => s.id === id)
  }

  if (/^[\d.]+$/.test(p) && p.includes('.')) {
    return servers.filter((s) => (s.networks?.v4 ?? []).some((v) => v.ip_address?.startsWith(p)))
  }

  if (/[*?]/.test(p)) {
    const re = globToRegExp(p)
    return servers.filter((s) => re.test(s.name.toLowerCase()))
  }

  const exact = servers.filter((s) => s.name.toLowerCase() === p)
  if (exact.length > 0) return exact
  return servers.filter((s) => s.name.toLowerCase().startsWith(p))
}

export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

/**
 * Servers a power verb can act on, and the ones it must skip, with the reason.
 *
 * Only `new` and `archive` are skipped. `active` vs `off` is deliberately NOT
 * used as a gate: measured 2026-09-02, the API left a server at `active` after
 * a completed `power_off` (mPanel showed it down, `is_running` errored), so a
 * gate on `off` would refuse to `start` a server that is in fact off. Until
 * the platform writes that field reliably, BinaryLane itself is the judge of
 * whether an action makes sense — it errors on a no-op, and that error is
 * reported per target.
 */
export function partitionByStatus(
  matches: TargetMatch[],
  _requires: 'active' | 'off'
): { eligible: TargetMatch[]; skipped: Array<TargetMatch & { reason: string }> } {
  const eligible: TargetMatch[] = []
  const skipped: Array<TargetMatch & { reason: string }> = []
  for (const m of matches) {
    const status = m.server.status
    if (status === 'new') skipped.push({ ...m, reason: 'still being built' })
    else if (status === 'archive') skipped.push({ ...m, reason: 'archived (cancelled or unpaid)' })
    else eligible.push(m)
  }
  return { eligible, skipped }
}

// ---------------------------------------------------------------------------
// DNS target resolution
// ---------------------------------------------------------------------------

/**
 * Split an fqdn into the hosted zone it belongs to and the record name inside it,
 * using the longest zone that is a suffix of the name. `foo.example.com` against
 * zones [example.com, com.au] → { domain: 'example.com', name: 'foo' }; a bare
 * zone name yields `@`.
 */
export function resolveDnsTarget(
  zones: Array<{ name: string }>,
  fqdn: string
): { domain: string; name: string } | null {
  const host = fqdn.toLowerCase().replace(/\.$/, '')
  let best: string | null = null
  for (const z of zones) {
    const zone = z.name.toLowerCase().replace(/\.$/, '')
    if (host === zone || host.endsWith(`.${zone}`)) {
      if (!best || zone.length > best.length) best = zone
    }
  }
  if (!best) return null
  const name = host === best ? '@' : host.slice(0, host.length - best.length - 1)
  return { domain: best, name }
}

// ---------------------------------------------------------------------------
// Recent commands
// ---------------------------------------------------------------------------

const RECENT_KEY = 'bldesk_palette_recent_v1'
const RECENT_MAX = 8

export function loadRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function rememberCommand(command: string): void {
  const trimmed = command.trim()
  if (!trimmed) return
  try {
    const next = [trimmed, ...loadRecentCommands().filter((c) => c !== trimmed)].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable — recents are a convenience, not state
  }
}
