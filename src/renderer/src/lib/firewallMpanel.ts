// The text mPanel's Firewall "Import/Export" dialog shows, and BLDesk's reading and writing of it. mPanel writes one JSON array whose rules look like
//   { "sourceaddr": "0.0.0.0/0", "destaddr": "224.0.0.0/4", "destport": "22,80", "action": "DROP", "description": "...", "protocol": "ALL" }
// that is: addresses and ports as one comma-separated string each ("" for no ports), action and protocol in upper case. The public API uses
// lists and lower case (`AdvancedFirewallRule`). Pure, with no runtime import, so scripts/test-firewall-rules.mjs runs it as it is.

import type { FirewallRuleLike } from './firewallRules.ts'

/** The keys of a rule in mPanel's text, in the order mPanel writes them. */
export const MPANEL_KEYS = ['sourceaddr', 'destaddr', 'destport', 'action', 'description', 'protocol'] as const

/** One rule in mPanel's text. */
export type MpanelRule = Record<(typeof MPANEL_KEYS)[number], string>

/**
 * The rules as mPanel's dialog writes them: every field text, addresses and ports joined with commas (no spaces), the two enums in upper
 * case. A list the rule does not have (no ports, which means every port) and a missing description are "".
 */
export function toMpanelRules(rules: readonly FirewallRuleLike[]): MpanelRule[] {
  return rules.map((r) => ({
    sourceaddr: (r.source_addresses ?? []).join(','),
    destaddr: (r.destination_addresses ?? []).join(','),
    destport: (r.destination_ports ?? []).join(','),
    action: (r.action ?? '').toUpperCase(),
    description: r.description ?? '',
    protocol: (r.protocol ?? '').toUpperCase()
  }))
}

/** The text Export saves: `toMpanelRules` pretty-printed with two spaces, as mPanel's dialog shows it. */
export const mpanelText = (rules: readonly FirewallRuleLike[]): string => JSON.stringify(toMpanelRules(rules), null, 2)

/** The items of a comma-separated string, each trimmed. A string with nothing in it has none. */
export const splitMpanelList = (text: string): string[] => (text.trim() === '' ? [] : text.split(',').map((item) => item.trim()))

/**
 * An address written with a netmask, `a.b.c.d/e.f.g.h`. `cidr` when the mask is a run of ones and then zeros, which is the same range in
 * CIDR notation (`192.0.2.0/255.255.255.0` is `192.0.2.0/24`: a change of notation only). `gap` when it is not: that cannot be written as CIDR,
 * and the caller decides what to do with it (see `PASSED_THROUGH_DESTINATION` in ./firewallRules.ts). `none` for anything that is not an
 * address and a dotted mask (a plain address, a CIDR range, text), which the ordinary address check judges.
 */
export function readNetmask(value: string): { kind: 'none' } | { kind: 'cidr'; cidr: string } | { kind: 'gap' } {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value.trim())
  if (!m) return { kind: 'none' }
  const octets = [...m[1].split('.'), ...m[2].split('.')].map(Number)
  if (octets.some((o) => o > 255)) return { kind: 'none' }
  const bits = m[2]
    .split('.')
    .map((o) => Number(o).toString(2).padStart(8, '0'))
    .join('')
  if (!/^1*0*$/.test(bits)) return { kind: 'gap' }
  return { kind: 'cidr', cidr: `${m[1]}/${bits.replace(/0/g, '').length}` }
}
