// The edits to a server's firewall rule list that are held on screen until they are saved: what a row says, what it
// writes, what is wrong with it and what has changed. It imports only other plain lib files, so Node runs it directly
// (scripts/test-firewall-draft.mjs). Nothing here talks to BinaryLane.

import type { components } from '@shared/api/schema'
import { ANY_ADDRESS, isIpv4OrRange, MAX_DESCRIPTION } from './firewallRules.ts'

type FwRule = components['schemas']['AdvancedFirewallRule']

/** One rule as it is shown and edited. The text fields are what the cells hold; the rule is only built from them on save. */
export interface DraftRow {
  /** Stable while the row is moved about: its place in the list the draft was started from. */
  key: number
  /** The rule as BinaryLane returned it. A row that was not edited writes this, exactly. */
  original: FwRule
  action: FwRule['action']
  protocol: FwRule['protocol']
  /** One address a line; commas and spaces separate them too. */
  sources: string
  destinations: string
  /** One port or range (`start:end`) a line. */
  ports: string
  description: string
  /** Taken out of the list when saved. It stays on screen until then, so it can be put back. */
  removed: boolean
}

export interface RowProblems {
  sources?: string
  destinations?: string
  ports?: string
  description?: string
}

/** What is waiting to be saved. */
export interface PendingChanges {
  edited: number
  removed: number
  reordered: boolean
}

/** Values typed one to a line. Commas and spaces separate values as well, and blanks are dropped. */
export function splitList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** A list of values as a cell shows it, one to a line. */
export function joinList(values: readonly string[] | null | undefined): string {
  return (values ?? []).join('\n')
}

/** The rows for a list of rules, in order, none edited. */
export function draftFromRules(rules: readonly FwRule[]): DraftRow[] {
  return rules.map((original, key) => ({
    key,
    original,
    action: original.action,
    protocol: original.protocol,
    sources: joinList(original.source_addresses),
    destinations: joinList(original.destination_addresses),
    ports: joinList(original.destination_ports),
    description: original.description ?? '',
    removed: false
  }))
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i])

/** Whether any cell now says something other than the rule it started as. Layout alone (line breaks, commas, spacing) is not an edit. */
export function isEdited(row: DraftRow): boolean {
  const o = row.original
  return (
    row.action !== o.action ||
    row.protocol !== o.protocol ||
    !sameList(splitList(row.sources), o.source_addresses ?? []) ||
    !sameList(splitList(row.destinations), o.destination_addresses ?? []) ||
    !sameList(splitList(row.ports), o.destination_ports ?? []) ||
    row.description.trim() !== (o.description ?? '').trim()
  )
}

/**
 * The rule a row writes. One that was not edited is written as BinaryLane returned it, so saving changes nothing it was not
 * asked to. An edited one is built from its cells, with only the fields the API reference defines, and a field left empty
 * is left out: no ports means every port, as the reference says.
 */
export function ruleOfRow(row: DraftRow): FwRule {
  if (!isEdited(row)) return row.original
  const ports = splitList(row.ports)
  const description = row.description.trim()
  const rule: FwRule = {
    action: row.action,
    protocol: row.protocol,
    source_addresses: splitList(row.sources),
    destination_addresses: splitList(row.destinations)
  }
  if (ports.length > 0) rule.destination_ports = ports
  if (description) rule.description = description
  return rule
}

/** The list to write: the rows that stay, in the order they are in. */
export function rulesToWrite(rows: readonly DraftRow[]): FwRule[] {
  return rows.filter((r) => !r.removed).map(ruleOfRow)
}

const addressProblem = (what: 'source' | 'destination', values: string[]): string | undefined => {
  if (values.length === 0) return `Enter at least one ${what} address, or ${ANY_ADDRESS} for any.`
  const bad = values.find((a) => !isIpv4OrRange(a))
  if (bad !== undefined) return `"${bad}" is not an IPv4 address or range, such as 192.0.2.1 or 192.0.2.0/24.`
  return undefined
}

/**
 * What stops an edited row being saved. Only a row that was edited and is staying is checked: one that was not touched is
 * written as it came, and a removed one is not written. A cleared cell is a problem rather than a quiet "any", because an
 * address emptied by accident would open the rule to everyone.
 */
export function problemsOf(row: DraftRow): RowProblems {
  if (row.removed || !isEdited(row)) return {}
  const problems: RowProblems = {}
  const sources = addressProblem('source', splitList(row.sources))
  if (sources) problems.sources = sources
  const destinations = addressProblem('destination', splitList(row.destinations))
  if (destinations) problems.destinations = destinations
  const ports = splitList(row.ports)
  const o = row.original
  // A rule that matched every port stays one when only something else is edited; clearing ports that were there, or
  // switching to TCP or UDP without naming any, is asked about.
  const needsPorts = (row.protocol === 'tcp' || row.protocol === 'udp') && (row.protocol !== o.protocol || (o.destination_ports ?? []).length > 0)
  if (row.protocol === 'icmp' && ports.length > 0) problems.ports = 'ICMP rules have no ports.'
  else if (needsPorts && ports.length === 0) problems.ports = 'Destination port(s) are required for TCP and UDP rules.'
  if (row.description.trim().length > MAX_DESCRIPTION) {
    problems.description = `The description is ${row.description.trim().length} characters; the most BinaryLane accepts is ${MAX_DESCRIPTION}.`
  }
  return problems
}

/**
 * The problems a row shows. One in the field being typed in waits until the field is left, so "10.0." is not called wrong
 * halfway through an address. Only what is shown waits: saving is still stopped by every problem (`rowsWithProblems`).
 */
export function shownProblems(problems: RowProblems, typing?: keyof RowProblems): RowProblems {
  if (!typing || !problems[typing]) return problems
  const { [typing]: _waiting, ...rest } = problems
  return rest
}

/** The number of rows that cannot be saved as they are. */
export function rowsWithProblems(rows: readonly DraftRow[]): number {
  return rows.filter((r) => Object.keys(problemsOf(r)).length > 0).length
}

/** What is waiting to be saved: rows edited, rows removed, and whether the rows that stay are in a different order. */
export function pendingChanges(rows: readonly DraftRow[]): PendingChanges {
  const kept = rows.filter((r) => !r.removed)
  return {
    edited: kept.filter(isEdited).length,
    removed: rows.length - kept.length,
    // A key is the row's place in the list the draft started from, so the rows that stay are in their own order when the keys rise.
    reordered: kept.some((r, i) => i > 0 && r.key < kept[i - 1].key)
  }
}

export function hasPendingChanges(rows: readonly DraftRow[]): boolean {
  const c = pendingChanges(rows)
  return c.edited > 0 || c.removed > 0 || c.reordered
}

/**
 * Whether a draft still says anything about `rules`, the server's rules as last read. A draft with changes waiting does, and is
 * judged against them elsewhere (`sameRules`). One with none is only the text of the cells, which may differ from the rules in layout
 * alone: a line break just typed, a space before the next word. That text is kept while it was typed against these rules, so that the
 * cell does not take it back, and let go once the rules have moved on, because the cells then show the new rules.
 */
export function draftApplies(draft: { base: readonly FwRule[]; rows: readonly DraftRow[] }, rules: readonly FwRule[]): boolean {
  return hasPendingChanges(draft.rows) || sameRules(draft.base, rules)
}

/** "2 rules edited, 1 removed, order changed". */
export function describePending(c: PendingChanges): string {
  const parts: string[] = []
  if (c.edited > 0) parts.push(`${c.edited} rule${c.edited === 1 ? '' : 's'} edited`)
  if (c.removed > 0) parts.push(`${c.removed} removed`)
  if (c.reordered) parts.push('order changed')
  return parts.join(', ')
}

/** The list with the item at `from` moved to `to`. Out-of-range or unmoved gives the list back as it was. */
export function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = [...rows]
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** How long a finger stays still on a rule's handle before the rule lifts. Moving first is a scroll, not a lift. */
export const ROW_HOLD_MS = 400

/**
 * Where a rule held at `from` lands if it is let go with the finger at height `y`, given the height of the middle of every
 * row in order. The rule goes after each row whose middle is above the finger, so letting go below the last row puts it last
 * and above the first puts it first, and a rule let go where it is stays where it is.
 */
export function dropIndexAt(y: number, middles: readonly number[], from: number): number {
  if (middles.length === 0) return 0
  const above = middles.filter((m) => m < y).length
  // The held rule is counted among the rows above if its own middle is, and it is about to leave that place.
  const to = above - (middles[from] < y ? 1 : 0)
  return Math.max(0, Math.min(middles.length - 1, to))
}

/**
 * The space between rules that a rule held at `from` goes into when it is let go to end at index `to`: the number of the row it goes
 * in front of, among the rows as they stand now, or the row count for the space after the last. A rule that stays where it is goes
 * into no new space (null).
 */
export function dropGapAt(to: number, from: number): number | null {
  if (to === from) return null
  return to < from ? to : to + 1
}

/** How fast the list scrolls, in pixels a second, when a carried rule has only just reached an edge, and the most it will ever do. */
export const EDGE_SCROLL_START_PX_S = 260
export const EDGE_SCROLL_MAX_PX_S = 6000

/** The height of the zone at each end of the visible part of the list where a carried rule scrolls it. */
export function edgeZone(visibleHeight: number): number {
  return Math.max(72, Math.min(140, visibleHeight * 0.14))
}

/**
 * Which way a carried rule asks the list to scroll, and how far into that end's zone it is (0 at the zone's inner edge, 1 at the
 * edge of the visible part, a little more beyond it), for a finger at height `y` over the visible part from `top` to `bottom`.
 */
export function edgePull(y: number, top: number, bottom: number): { dir: -1 | 0 | 1; depth: number } {
  const zone = edgeZone(bottom - top)
  if (y < top + zone) return { dir: -1, depth: Math.min(1.5, (top + zone - y) / zone) }
  if (y > bottom - zone) return { dir: 1, depth: Math.min(1.5, (y - (bottom - zone)) / zone) }
  return { dir: 0, depth: 0 }
}

/**
 * The scroll speed, in pixels a second, after a carried rule has been held in an edge zone for `heldSeconds`: slow at first so a
 * short list can be steered, faster the longer it is held there, for a list of a hundred rules, and faster the nearer the edge. It
 * is in seconds, not frames, so a phone that redraws 120 times a second is no quicker than one that does it 60 times.
 */
export function edgeScrollSpeed(heldSeconds: number, depth: number): number {
  const nearer = Math.max(0.35, Math.min(1, depth))
  const ramp = EDGE_SCROLL_START_PX_S + 900 * Math.pow(Math.max(0, heldSeconds), 1.3)
  return Math.min(EDGE_SCROLL_MAX_PX_S, ramp * nearer)
}

/** Whether two rule lists say the same, rule for rule and in the same order. Used to tell that a server's rules changed under a draft. */
export function sameRules(a: readonly FwRule[], b: readonly FwRule[]): boolean {
  return JSON.stringify(a.map(canonicalRule)) === JSON.stringify(b.map(canonicalRule))
}

// A rule with its fields in a fixed order and a missing list the same as an empty one, so a read that spells it differently is not a change.
function canonicalRule(r: FwRule) {
  return [r.action, r.protocol, r.source_addresses ?? [], r.destination_addresses ?? [], r.destination_ports ?? [], (r.description ?? '').trim()]
}
