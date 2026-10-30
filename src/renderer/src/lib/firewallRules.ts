// What a firewall rule written to BinaryLane must contain, and how a rule is placed in a list. Its imports are a type and the
// pure ./firewallMpanel.ts, so it can be tested on its own (scripts/test-firewall-rules.mjs).

import type { components } from '@shared/api/schema'
import { describeFirewallRule } from './diff.ts'
import { MPANEL_KEYS, readNetmask, splitMpanelList } from './firewallMpanel.ts'

type RuleAction = components['schemas']['AdvancedFirewallRuleAction']
type RuleProtocol = components['schemas']['AdvancedFirewallRuleProtocol']
type RuleRequest = components['schemas']['AdvancedFirewallRuleRequest']

export interface FirewallRuleLike {
  action?: string | null
  protocol?: string | null
  source_addresses?: string[] | null
  destination_addresses?: string[] | null
  destination_ports?: string[] | null
  description?: string | null
}

/** "1 rule", "3 rules". */
export function ruleCount(n: number): string {
  return `${n} rule${n === 1 ? '' : 's'}`
}

/**
 * The most rules BinaryLane gives one server. The reference (`ChangeAdvancedFirewallRules.firewall_rules`, from 0.46.0) states it, mPanel
 * says so beside its New Rule button, and the API refuses a longer list with "Firewall rules are limited to 100 per server; 101 were submitted."
 */
export const MAX_RULES = 100
export const RULE_LIMIT_NOTE = 'Firewall rules are limited to 100 per server.'

/**
 * The most rules a write may leave on a server that has `saved` rules now. The reference adds that a server that already exceeds the limit
 * "may keep, edit or remove its rules, but not exceed what it already has", so a list longer than 100 is allowed when it is no longer than
 * the list it replaces. (It states a second limit, on the combinations of address, protocol and port, that is left to the API.)
 */
export const rulesAllowed = (saved: number): number => Math.max(MAX_RULES, saved)

/** What to say when `saved` rules leave no room for another: the limit, or, for a server over it, that its rules can be kept and edited but not added to. */
export const ruleLimitNote = (saved: number): string =>
  saved > MAX_RULES ? `${RULE_LIMIT_NOTE} This server has ${saved}, so its rules can be kept, edited or removed but not added to.` : RULE_LIMIT_NOTE

/**
 * The destination sent for a rule that names none. The API reference requires at least one destination address on every
 * rule, and the firewall already belongs to one server, so "any" is the only value that adds no condition of its own.
 */
export const ANY_ADDRESS = '0.0.0.0/0'

/** A rule as it is built before it is written: the reference's rule, except that its destination may still be missing. */
export type RuleDraft = Omit<RuleRequest, 'destination_addresses'> & { destination_addresses?: string[] | null }

/**
 * The rule as it is written: with the destination the reference requires. A rule that already has one is returned as it is.
 * It takes the reference's own rule, not "any object with some of the fields", so a misspelled field in a literal is an error.
 */
export function toRuleRequest(rule: RuleDraft): RuleRequest {
  if (Array.isArray(rule.destination_addresses) && rule.destination_addresses.length > 0) return rule as RuleRequest
  return { ...rule, destination_addresses: [ANY_ADDRESS] }
}

const ACTIONS: readonly RuleAction[] = ['accept', 'drop']
const PROTOCOLS: readonly RuleProtocol[] = ['all', 'icmp', 'tcp', 'udp']
// Guards, not `includes` on a string list, so a rule that passes is typed as the reference's own enum.
const isAction = (v: unknown): v is RuleAction => typeof v === 'string' && (ACTIONS as readonly string[]).includes(v)
const isProtocol = (v: unknown): v is RuleProtocol => typeof v === 'string' && (PROTOCOLS as readonly string[]).includes(v)
/** The reference caps a rule's description at this many characters. */
export const MAX_DESCRIPTION = 250

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** An IPv4 address or a range in IPv4 CIDR notation, which is all the reference allows for a rule's addresses. */
export function isIpv4OrRange(value: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(value.trim())
  if (!m) return false
  return m.slice(1, 5).every((o) => Number(o) <= 255) && (m[5] === undefined || Number(m[5]) <= 32)
}

/**
 * The one address with a netmask that BLDesk keeps, and only as a destination address in a rule the server already has, unchanged: mPanel's
 * text uses it in its multicast rule, and a server that holds such a rule returns it, so Export can write it and Import can put it back. The
 * API reference documents only an IPv4 address or a range in CIDR notation, so BLDesk never adds a new rule that has it (see
 * `passedThroughNewRefusal`). It is kept exactly as written and BLDesk does not interpret it.
 */
export const PASSED_THROUGH_DESTINATION = '0.0.0.255/0.0.0.255'

/** Whether `value` may be a destination address of an imported rule: an IPv4 address or CIDR range, or exactly `PASSED_THROUGH_DESTINATION` (which `readImportedRules` then checks the server has). */
export const isDestinationAddress = (value: string): boolean => value === PASSED_THROUGH_DESTINATION || isIpv4OrRange(value)

/** The refusal for `PASSED_THROUGH_DESTINATION` in a rule the server does not already have, or has but not as it is in the file. */
const passedThroughNewRefusal = (at: string, key: string): string =>
  `${at}: "${key}" has ${PASSED_THROUGH_DESTINATION}, which BLDesk keeps only in a rule this server already has, as it is, and does not add to a new or changed rule. Nothing was imported: remove that address from "${key}" and import again.`

/** The refusal for `PASSED_THROUGH_DESTINATION` among the source addresses of a rule, in either format. */
const passedThroughSourceRefusal = (at: string, key: string): string =>
  `${at}: "${key}" has ${PASSED_THROUGH_DESTINATION}, which BLDesk accepts only as a destination address. Nothing was imported: remove that address from "${key}" and import again.`

/** The keys that tell the two formats apart; `action`, `protocol` and `description` are the same in both. */
const MPANEL_ONLY = ['sourceaddr', 'destaddr', 'destport'] as const
const BLDESK_ONLY = ['source_addresses', 'destination_addresses', 'destination_ports'] as const

const hasKey = (rule: object, key: string): boolean => Object.prototype.hasOwnProperty.call(rule, key)

/**
 * Whether the rules of a file are in one format. A rule is in mPanel's format when it has `sourceaddr`, `destaddr` or `destport`, and in
 * BLDesk's (the API's) when it has `source_addresses`, `destination_addresses` or `destination_ports`. A rule with both kinds, or a file
 * with a rule of each kind, could mean anything, so it is refused with the rule and the key named. Entries that are not objects are left
 * for the rule check, which names them.
 */
function mixedFormats(parsed: unknown[]): string | undefined {
  let first: { at: number; key: string; mpanel: boolean } | undefined
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i]
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue
    const mpanelKey = MPANEL_ONLY.find((k) => hasKey(r, k))
    const bldeskKey = BLDESK_ONLY.find((k) => hasKey(r, k))
    if (mpanelKey && bldeskKey) {
      return `Rule ${i + 1} has both "${mpanelKey}", which is mPanel's format, and "${bldeskKey}", which is BLDesk's and the API's. Use one format for every rule in the file.`
    }
    const here = mpanelKey ? { at: i + 1, key: mpanelKey, mpanel: true } : bldeskKey ? { at: i + 1, key: bldeskKey, mpanel: false } : undefined
    if (!here) continue
    if (!first) first = here
    else if (first.mpanel !== here.mpanel) {
      const [a, b] = first.mpanel ? ["mPanel's", "BLDesk's and the API's"] : ["BLDesk's and the API's", "mPanel's"]
      return `Rule ${here.at} has "${here.key}", which is ${b} format, but Rule ${first.at} has "${first.key}", which is ${a}. Use one format for every rule in the file.`
    }
  }
  return undefined
}

/**
 * The text of the refusal for an address with a netmask that is not a whole range (other than `PASSED_THROUGH_DESTINATION`). It names the
 * address and what to do, and says no more about the form than the reference does: that its addresses are an IPv4 address or a CIDR range.
 */
const netmaskRefusal = (at: string, key: string, address: string): string =>
  `${at}: "${key}" has ${address}, an address with a netmask that is not a whole CIDR range, so it cannot be written as one (a mask such as 255.255.255.0 can: 192.0.2.0/255.255.255.0 is 192.0.2.0/24). ` +
  `The API reference documents only an IPv4 address or a CIDR range, so BLDesk does not import this form (the one exception is ${PASSED_THROUGH_DESTINATION}, as a destination address in a rule this server already has). ` +
  `Nothing was imported: remove that address from the rule, or replace it with addresses or CIDR ranges, and import again.`

/**
 * Read one rule written the way mPanel's Import/Export dialog writes it (see ./firewallMpanel.ts) and return it as the reference defines it.
 *  - Every key must be one mPanel writes: a key BLDesk has no place for could change what the rule means, so it refuses the file instead of leaving it out.
 *  - `action` and `protocol` are read in either case; addresses and ports are text split at commas, each item trimmed (ranges such as 1000-2000 stay as written).
 *  - `sourceaddr` must name at least one address, as it must in BLDesk's format. An empty `destaddr` is read like a missing `destination_addresses` in BLDesk's format:
 *    the rule is written with 0.0.0.0/0, the one value that adds no condition (see ANY_ADDRESS). An empty `destport` is every port; an empty `description` is none.
 *  - An address with a netmask is written as CIDR when its mask is a whole range. `PASSED_THROUGH_DESTINATION` is kept as it is in `destaddr` (`readImportedRules` then checks the server has that rule) and refused in `sourceaddr`; any other netmask is refused.
 */
function readMpanelRule(r: Record<string, unknown>, at: string): { rule: RuleRequest; error?: undefined } | { rule?: undefined; error: string } {
  const extra = Object.keys(r).find((k) => !(MPANEL_KEYS as readonly string[]).includes(k))
  if (extra !== undefined) {
    return { error: `${at} has "${extra}", which BLDesk does not know. Nothing was imported, rather than drop a field that could change what the rule does. mPanel's format has ${MPANEL_KEYS.map((k) => `"${k}"`).join(', ')}.` }
  }
  const action = typeof r.action === 'string' ? r.action.toLowerCase() : r.action
  if (!isAction(action)) return { error: `${at}: "action" must be "ACCEPT" or "DROP".` }
  const protocol = typeof r.protocol === 'string' ? r.protocol.toLowerCase() : r.protocol
  if (!isProtocol(protocol)) return { error: `${at}: "protocol" must be "ALL", "ICMP", "TCP" or "UDP".` }

  const items = (key: string): { items: string[]; error?: undefined } | { items?: undefined; error: string } => {
    const text = r[key]
    if (text == null) return { items: [] }
    if (typeof text !== 'string') return { error: `${at}: "${key}" must be text, with the items separated by commas.` }
    const list = splitMpanelList(text)
    if (list.some((item) => item === '')) return { error: `${at}: "${key}" has an empty item between its commas.` }
    return { items: list }
  }
  const addresses = (key: 'sourceaddr' | 'destaddr'): { items: string[]; error?: undefined } | { items?: undefined; error: string } => {
    const read = items(key)
    if (read.error !== undefined) return read
    const valid = key === 'destaddr' ? isDestinationAddress : isIpv4OrRange
    const out: string[] = []
    for (const item of read.items) {
      if (item === PASSED_THROUGH_DESTINATION && key === 'sourceaddr') return { error: passedThroughSourceRefusal(at, key) }
      const mask = readNetmask(item)
      if (mask.kind === 'gap' && !isDestinationAddress(item)) return { error: netmaskRefusal(at, key, item) }
      const address = mask.kind === 'cidr' ? mask.cidr : item
      if (!valid(address)) return { error: `${at}: "${key}" has "${item}", which is not an IPv4 address or range, such as 192.0.2.1 or 192.0.2.0/24.` }
      out.push(address)
    }
    return { items: out }
  }

  const sources = addresses('sourceaddr')
  if (sources.error !== undefined) return sources
  if (sources.items.length === 0) return { error: `${at}: "sourceaddr" must list at least one address, or 0.0.0.0/0 for any.` }
  const destinations = addresses('destaddr')
  if (destinations.error !== undefined) return destinations
  const ports = items('destport')
  if (ports.error !== undefined) return ports
  if (r.description != null && typeof r.description !== 'string') return { error: `${at}: "description" must be text.` }
  if (typeof r.description === 'string' && r.description.length > MAX_DESCRIPTION) return { error: `${at}: "description" is ${r.description.length} characters; the most BinaryLane accepts is ${MAX_DESCRIPTION}.` }
  return {
    rule: toRuleRequest({
      action,
      protocol,
      source_addresses: sources.items,
      destination_addresses: destinations.items,
      ...(ports.items.length > 0 ? { destination_ports: ports.items } : {}),
      ...(r.description ? { description: r.description as string } : {})
    })
  }
}

/**
 * Check a pasted or uploaded rule list against the API reference (`AdvancedFirewallRuleRequest`) and return the rules
 * as they will be written: only the fields the reference defines, with a destination on every rule. The first rule that
 * cannot be written is named, so nothing is sent for a list the API would refuse. `saved` is how many rules the server has now:
 * the list may be as long as that, or 100, whichever is more (see `rulesAllowed`).
 *
 * The list may be in BLDesk's format, which is the API's, or in mPanel's (see `readMpanelRule`), told apart by the keys. Mixing them is refused.
 *
 * `kept` is the rules the server has now. A rule with `PASSED_THROUGH_DESTINATION` is accepted only if it is one of them, one for one (the same
 * test the confirmation's diff uses to call a rule unchanged); otherwise it would be a new rule that has it, and the file is refused.
 */
export function readImportedRules(
  parsed: unknown,
  saved = 0,
  kept: readonly FirewallRuleLike[] = []
): { rules: RuleRequest[]; error?: undefined } | { rules?: undefined; error: string } {
  if (!Array.isArray(parsed)) return { error: 'Firewall rules configuration must be a JSON array of rule objects.' }
  if (parsed.length > rulesAllowed(saved)) return { error: `The file has ${ruleCount(parsed.length)}. ${ruleLimitNote(saved)}` }
  const mixed = mixedFormats(parsed)
  if (mixed !== undefined) return { error: mixed }
  const mpanel = parsed.some((r) => r && typeof r === 'object' && !Array.isArray(r) && MPANEL_ONLY.some((k) => hasKey(r, k)))
  const rules: RuleRequest[] = []
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i] as Record<string, unknown> | null
    const at = `Rule ${i + 1}`
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: `${at} is not a rule object.` }
    if (mpanel) {
      const read = readMpanelRule(r, at)
      if (read.error !== undefined) return { error: read.error }
      rules.push(read.rule)
      continue
    }
    if (!isAction(r.action)) return { error: `${at}: "action" must be "accept" or "drop".` }
    if (!isProtocol(r.protocol)) return { error: `${at}: "protocol" must be "all", "icmp", "tcp" or "udp".` }
    if (!isStrings(r.source_addresses) || r.source_addresses.length === 0) return { error: `${at}: "source_addresses" must list at least one address.` }
    if (r.source_addresses.includes(PASSED_THROUGH_DESTINATION)) return { error: passedThroughSourceRefusal(at, 'source_addresses') }
    if (!r.source_addresses.every(isIpv4OrRange)) return { error: `${at}: "source_addresses" must be IPv4 addresses or ranges, such as 192.0.2.1 or 192.0.2.0/24.` }
    if (r.destination_addresses != null && !isStrings(r.destination_addresses)) return { error: `${at}: "destination_addresses" must be a list of addresses.` }
    if (isStrings(r.destination_addresses) && !r.destination_addresses.every(isDestinationAddress)) return { error: `${at}: "destination_addresses" must be IPv4 addresses or ranges, such as 192.0.2.1 or 192.0.2.0/24.` }
    if (r.destination_ports != null && (!isStrings(r.destination_ports) || r.destination_ports.some((p) => !p.trim()))) return { error: `${at}: "destination_ports" must be a list of ports, as text.` }
    if (r.description != null && typeof r.description !== 'string') return { error: `${at}: "description" must be text.` }
    if (typeof r.description === 'string' && r.description.length > MAX_DESCRIPTION) return { error: `${at}: "description" is ${r.description.length} characters; the most BinaryLane accepts is ${MAX_DESCRIPTION}.` }
    rules.push(
      toRuleRequest({
        action: r.action,
        protocol: r.protocol,
        source_addresses: r.source_addresses,
        destination_addresses: r.destination_addresses as string[] | null | undefined,
        ...(r.destination_ports != null ? { destination_ports: r.destination_ports } : {}),
        ...(r.description != null ? { description: r.description } : {})
      })
    )
  }
  // Each rule the server has covers one rule of the file, so a copy of it is a new rule.
  const unused = new Map<string, number>()
  for (const k of kept) unused.set(describeFirewallRule(k), (unused.get(describeFirewallRule(k)) ?? 0) + 1)
  for (let i = 0; i < rules.length; i++) {
    if (!rules[i].destination_addresses?.includes(PASSED_THROUGH_DESTINATION)) continue
    const key = describeFirewallRule(rules[i])
    const left = unused.get(key) ?? 0
    if (left === 0) return { error: passedThroughNewRefusal(`Rule ${i + 1}`, mpanel ? 'destaddr' : 'destination_addresses') }
    unused.set(key, left - 1)
  }
  return { rules }
}

/** Whether `wider` names every address in `narrower`: it lists the any-address, or lists each of them. `blankIsAny` reads an empty list as any. */
function coversAddresses(wider: string[] | null | undefined, narrower: string[] | null | undefined, blankIsAny: boolean): boolean {
  if (!wider || wider.length === 0) return blankIsAny
  if (wider.includes(ANY_ADDRESS)) return true
  return !!narrower && narrower.length > 0 && narrower.every((a) => wider.includes(a))
}

/**
 * Whether the drop rule `drop` would swallow `rule` if it came first: it drops the rule's protocol (or every protocol),
 * its ports (or all ports), its sources and its destinations, or more. Addresses and ports are compared as written, so
 * a range that only contains another is not recognised, and the rule is not moved ahead of it.
 */
export function swallows(drop: FirewallRuleLike, rule: FirewallRuleLike): boolean {
  if (drop.action !== 'drop') return false
  if (drop.protocol !== 'all' && drop.protocol !== rule.protocol) return false
  const dropPorts = drop.destination_ports ?? []
  const rulePorts = rule.destination_ports ?? []
  if (dropPorts.length > 0 && (rulePorts.length === 0 || !rulePorts.every((p) => dropPorts.includes(p)))) return false
  return coversAddresses(drop.source_addresses, rule.source_addresses, false) && coversAddresses(drop.destination_addresses, rule.destination_addresses, true)
}

/**
 * The list with `rule` placed where it can match. Rules are evaluated first to last, so it goes immediately ahead of the
 * first drop that would swallow it, and last when nothing would. A drop that covers only some sources, such as a block
 * on one address, is left in front of it, so the block still applies.
 */
export function insertRule<T extends FirewallRuleLike>(list: T[], rule: T): T[] {
  const at = list.findIndex((existing) => swallows(existing, rule))
  return at === -1 ? [...list, rule] : [...list.slice(0, at), rule, ...list.slice(at)]
}

/** A firewall rule as a template stores it. */
export interface TemplateRule {
  action: RuleAction
  protocol: RuleProtocol
  source_addresses: string[]
  destination_addresses: string[]
  destination_ports: string[] | null
  description: string | null
}

/**
 * Read the firewall rules of a saved template. Lenient where a rule is edited by hand: addresses and ports may carry
 * `{{variables}}` that are filled in when the template is applied, so they are not checked as addresses, and a missing
 * destination or port list reads as none. What it does insist on is the shape the rest of the app indexes into, so one
 * malformed rule makes the template invalid, with the rule named, instead of failing wherever the rules are shown.
 */
export function readTemplateRules(raw: unknown): { rules: TemplateRule[]; error?: undefined } | { rules?: undefined; error: string } {
  if (!Array.isArray(raw)) return { error: 'Firewall rules must be a list.' }
  const rules: TemplateRule[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown> | null
    const at = `Firewall rule ${i + 1}`
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: `${at} is not a rule.` }
    if (!isAction(r.action)) return { error: `${at}: action must be accept or drop.` }
    if (!isProtocol(r.protocol)) return { error: `${at}: protocol must be all, icmp, tcp or udp.` }
    if (!isStrings(r.source_addresses)) return { error: `${at}: source_addresses must be a list of addresses.` }
    if (r.destination_addresses != null && !isStrings(r.destination_addresses)) return { error: `${at}: destination_addresses must be a list of addresses.` }
    if (r.destination_ports != null && !isStrings(r.destination_ports)) return { error: `${at}: destination_ports must be a list of ports, as text.` }
    if (r.description != null && typeof r.description !== 'string') return { error: `${at}: description must be text.` }
    rules.push({
      action: r.action,
      protocol: r.protocol,
      source_addresses: r.source_addresses,
      destination_addresses: (r.destination_addresses as string[] | null | undefined) ?? [],
      destination_ports: (r.destination_ports as string[] | null | undefined) ?? null,
      description: (r.description as string | null | undefined) ?? null
    })
  }
  return { rules }
}

/**
 * BinaryLane's external firewall covers IPv4 only, and the API reference allows only IPv4 addresses in a rule, so an IPv6
 * address (anything with a colon) can neither match nor be written. Templates saved by earlier versions carry `::/0`.
 */
export const isIpv6 = (address: string): boolean => address.includes(':')

/**
 * A template rule as it is written: IPv6 addresses left out. A rule that is left with no source addresses was about IPv6
 * alone, which the firewall does not see, so it is dropped (null) rather than written with nothing to match.
 */
export function withoutIpv6<T extends { source_addresses: string[]; destination_addresses: string[] }>(rule: T): T | null {
  const source_addresses = rule.source_addresses.filter((a) => !isIpv6(a))
  if (source_addresses.length === 0 && rule.source_addresses.length > 0) return null
  return { ...rule, source_addresses, destination_addresses: rule.destination_addresses.filter((a) => !isIpv6(a)) }
}
