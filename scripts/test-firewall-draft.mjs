// Tests for the firewall rule edits held on screen until they are saved. The module imports only other plain lib files, so Node
// runs the TypeScript directly: node --test scripts/test-firewall-draft.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describePending,
  draftApplies,
  draftFromRules,
  dropGapAt,
  edgePull,
  edgeScrollSpeed,
  edgeZone,
  dropIndexAt,
  hasPendingChanges,
  isEdited,
  joinList,
  moveRow,
  pendingChanges,
  problemsOf,
  problemToSay,
  ruleOfRow,
  rulesToWrite,
  rowsWithProblems,
  sameRules,
  shownProblems,
  splitList
} from '../src/renderer/src/lib/firewallDraft.ts'

const rule = (action, protocol, ports, extra = {}) => ({
  action,
  protocol,
  source_addresses: ['0.0.0.0/0'],
  destination_addresses: ['0.0.0.0/0'],
  ...(ports ? { destination_ports: ports } : {}),
  ...extra
})
const list = () => [
  rule('accept', 'tcp', ['22'], { description: 'SSH' }),
  rule('accept', 'tcp', ['80', '443'], { description: 'Web' }),
  rule('accept', 'icmp', null, { description: 'Ping' }),
  rule('drop', 'all', null, { description: 'Drop all' })
]
const rowsOf = (rules = list()) => draftFromRules(rules)

test('a list is read from lines, commas or spaces, and shown one to a line', () => {
  assert.deepEqual(splitList('80\n443'), ['80', '443'])
  assert.deepEqual(splitList(' 80, 443  8000:9000 \n\n'), ['80', '443', '8000:9000'])
  assert.deepEqual(splitList(''), [])
  assert.deepEqual(splitList(' , \n '), [])
  assert.equal(joinList(['203.0.113.1', '203.0.113.2']), '203.0.113.1\n203.0.113.2')
  assert.equal(joinList(null), '')
  assert.equal(joinList(undefined), '')
})

test('rows made from a list change nothing, and write the very same rules back', () => {
  const rules = list()
  const rows = rowsOf(rules)
  assert.equal(rows.length, 4)
  assert.equal(hasPendingChanges(rows), false)
  assert.deepEqual(pendingChanges(rows), { edited: 0, removed: 0, reordered: false })
  const out = rulesToWrite(rows)
  out.forEach((r, i) => assert.equal(r, rules[i], 'an untouched rule must be written as it came, not rebuilt'))
})

test('a rule BinaryLane returned with odd fields is written as it came while it is not edited, and its row has no problems', () => {
  // e.g. a rule made in another tool: ports on "all", no description, an empty ports list
  const odd = [rule('accept', 'all', ['53'], { description: undefined }), rule('accept', 'tcp', [], {})]
  const rows = rowsOf(odd)
  assert.equal(rowsWithProblems(rows), 0)
  assert.equal(rulesToWrite(rows)[0], odd[0])
  assert.equal(rulesToWrite(rows)[1], odd[1])
})

test('line breaks, commas and spacing alone are not an edit', () => {
  const rows = rowsOf([rule('accept', 'tcp', ['80', '443'], { source_addresses: ['192.0.2.1', '192.0.2.2'], description: 'Web' })])
  rows[0].ports = '80, 443'
  rows[0].sources = '192.0.2.1\n\n192.0.2.2 '
  rows[0].description = '  Web '
  assert.equal(isEdited(rows[0]), false)
  assert.equal(hasPendingChanges(rows), false)
})

test('changing a cell is an edit, and only that row is rebuilt', () => {
  const rules = list()
  const rows = rowsOf(rules)
  rows[1].ports = '80\n443\n8080'
  rows[1].description = ' Web and alt '
  assert.equal(isEdited(rows[1]), true)
  assert.equal(isEdited(rows[0]), false)
  const out = rulesToWrite(rows)
  assert.equal(out[0], rules[0])
  assert.deepEqual(out[1], {
    action: 'accept',
    protocol: 'tcp',
    source_addresses: ['0.0.0.0/0'],
    destination_addresses: ['0.0.0.0/0'],
    destination_ports: ['80', '443', '8080'],
    description: 'Web and alt'
  })
  assert.equal(out[2], rules[2])
  assert.deepEqual(pendingChanges(rows), { edited: 1, removed: 0, reordered: false })
})

test('each cell on its own is enough to make a row edited', () => {
  const cases = {
    action: (r) => { r.action = 'drop' },
    protocol: (r) => { r.protocol = 'udp' },
    sources: (r) => { r.sources = '192.0.2.1' },
    destinations: (r) => { r.destinations = '203.0.113.5' },
    ports: (r) => { r.ports = '23' },
    description: (r) => { r.description = 'Something else' }
  }
  for (const [name, change] of Object.entries(cases)) {
    const rows = rowsOf([rule('accept', 'tcp', ['22'], { description: 'SSH' })])
    assert.equal(isEdited(rows[0]), false, `${name}: not edited to begin with`)
    change(rows[0])
    assert.equal(isEdited(rows[0]), true, `${name}: changing it alone must count as an edit`)
    assert.equal(hasPendingChanges(rows), true, name)
  }
})

test('every field of a row can be edited, and an emptied optional field is left out of the rule', () => {
  const rows = rowsOf([rule('accept', 'tcp', ['22'], { description: 'SSH' })])
  rows[0].action = 'drop'
  rows[0].protocol = 'udp'
  rows[0].sources = '192.0.2.0/24'
  rows[0].destinations = '203.0.113.10'
  rows[0].ports = ''
  rows[0].description = ''
  assert.deepEqual(ruleOfRow(rows[0]), { action: 'drop', protocol: 'udp', source_addresses: ['192.0.2.0/24'], destination_addresses: ['203.0.113.10'] })
})

test('a removed row is not written, and the rows that stay keep their order', () => {
  const rules = list()
  const rows = rowsOf(rules)
  rows[1].removed = true
  assert.deepEqual(rulesToWrite(rows), [rules[0], rules[2], rules[3]])
  assert.deepEqual(pendingChanges(rows), { edited: 0, removed: 1, reordered: false })
  rows[1].removed = false
  assert.equal(hasPendingChanges(rows), false, 'putting a row back is no change')
})

test('moving rows is a change, and moving one back is not', () => {
  const rows = rowsOf()
  const moved = moveRow(rows, 3, 0)
  assert.deepEqual(moved.map((r) => r.key), [3, 0, 1, 2])
  assert.deepEqual(pendingChanges(moved), { edited: 0, removed: 0, reordered: true })
  assert.equal(describePending(pendingChanges(moved)), 'order changed')
  assert.deepEqual(rulesToWrite(moved).map((r) => r.description), ['Drop all', 'SSH', 'Web', 'Ping'])
  const back = moveRow(moved, 0, 3)
  assert.deepEqual(back.map((r) => r.key), [0, 1, 2, 3])
  assert.equal(hasPendingChanges(back), false)
})

test('moving a removed row about does not count as reordering the rules that stay', () => {
  const rows = rowsOf()
  rows[3].removed = true
  const moved = moveRow(rows, 3, 0)
  assert.deepEqual(pendingChanges(moved), { edited: 0, removed: 1, reordered: false })
})

test('moveRow leaves the list alone for a move that goes nowhere', () => {
  const rows = rowsOf()
  assert.deepEqual(moveRow(rows, 1, 1), rows)
  assert.deepEqual(moveRow(rows, -1, 2), rows)
  assert.deepEqual(moveRow(rows, 0, 9), rows)
  assert.notEqual(moveRow(rows, 1, 1), rows, 'it returns a copy, not the same array')
})

test('the pending changes are described in words', () => {
  assert.equal(describePending({ edited: 1, removed: 0, reordered: false }), '1 rule edited')
  assert.equal(describePending({ edited: 2, removed: 1, reordered: true }), '2 rules edited, 1 removed, order changed')
  assert.equal(describePending({ edited: 0, removed: 0, reordered: false }), '')
})

test('an address cell that is emptied is refused, not read as any', () => {
  const rows = rowsOf()
  rows[0].sources = ''
  rows[0].destinations = ' , '
  const p = problemsOf(rows[0])
  assert.match(p.sources, /at least one source address, or 0\.0\.0\.0\/0 for any/)
  assert.match(p.destinations, /at least one destination address/)
  assert.equal(rowsWithProblems(rows), 1)
})

test('addresses must be IPv4 addresses or ranges, and the first bad one is named', () => {
  const rows = rowsOf()
  for (const bad of ['::/0', 'example.com', '192.0.2.256', '192.0.2.0/33', '10.0.0']) {
    rows[0].sources = `192.0.2.1\n${bad}`
    assert.match(problemsOf(rows[0]).sources, new RegExp(`"${bad.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}" is not an IPv4 address or range`))
  }
  rows[0].sources = '192.0.2.1\n198.51.100.0/24'
  assert.equal(problemsOf(rows[0]).sources, undefined)
})

test('ports that were there cannot be cleared from a TCP or UDP rule, nor can a TCP or UDP rule be made with none', () => {
  const rows = rowsOf()
  rows[0].ports = ''
  assert.match(problemsOf(rows[0]).ports, /required for TCP and UDP/)
  rows[0].ports = '22'
  assert.equal(problemsOf(rows[0]).ports, undefined)
  // an "all" rule switched to TCP needs the ports it never had
  const all = rowsOf([rule('accept', 'all', null, { description: 'Any' })])
  all[0].protocol = 'tcp'
  assert.match(problemsOf(all[0]).ports, /required for TCP and UDP/)
  all[0].ports = '443'
  assert.equal(problemsOf(all[0]).ports, undefined)
})

test('a TCP rule that matched every port still does when only something else is edited', () => {
  const rows = rowsOf([rule('accept', 'tcp', null, { description: 'All TCP' })])
  rows[0].description = 'Every TCP port'
  assert.deepEqual(problemsOf(rows[0]), {})
  assert.deepEqual(ruleOfRow(rows[0]).destination_ports, undefined)
})

test('an ICMP rule has no ports, and a long description is refused', () => {
  const rows = rowsOf()
  rows[2].ports = '8'
  assert.match(problemsOf(rows[2]).ports, /ICMP rules have no ports/)
  rows[2].ports = ''
  rows[2].description = 'x'.repeat(251)
  assert.match(problemsOf(rows[2]).description, /251 characters; the most BinaryLane accepts is 250/)
  rows[2].description = 'x'.repeat(250)
  assert.equal(problemsOf(rows[2]).description, undefined)
})

test('a row that is removed, or not edited, has no problems whatever it holds', () => {
  const rows = rowsOf([rule('accept', 'tcp', ['22'], { source_addresses: ['::/0'] })])
  assert.deepEqual(problemsOf(rows[0]), {}, 'untouched: written as it came')
  rows[0].description = 'changed'
  assert.ok(problemsOf(rows[0]).sources, 'edited: now it is checked')
  rows[0].removed = true
  assert.deepEqual(problemsOf(rows[0]), {}, 'removed: not written')
})

test('two lists say the same when every rule does, in the same order, however a read spells a missing field', () => {
  const a = list()
  const b = list()
  assert.equal(sameRules(a, b), true)
  b[2] = { ...b[2], destination_ports: [] }
  b[3] = { ...b[3], description: ' Drop all ' }
  assert.equal(sameRules(a, b), true, 'no ports and empty ports, and padding in a description, are the same rule')
  assert.equal(sameRules(a, [...a].reverse()), false, 'the order is part of the list')
  assert.equal(sameRules(a, a.slice(0, 3)), false)
  const c = list()
  c[0] = { ...c[0], source_addresses: ['192.0.2.1'] }
  assert.equal(sameRules(a, c), false)
})

test('a held rule lands after every row whose middle is above the finger', () => {
  const mids = [50, 150, 250, 350]
  // letting go below the last row puts it last, above the first puts it first
  assert.equal(dropIndexAt(900, mids, 0), 3)
  assert.equal(dropIndexAt(-20, mids, 3), 0)
  // a rule let go where it is stays where it is
  for (let from = 0; from < 4; from++) assert.equal(dropIndexAt(mids[from], mids, from), from, `row ${from}`)
  assert.equal(dropIndexAt(mids[1] + 10, mids, 1), 1)
  // one place down, one place up
  assert.equal(dropIndexAt(300, mids, 1), 2)
  assert.equal(dropIndexAt(100, mids, 2), 1)
  // never outside the list
  assert.equal(dropIndexAt(1e9, mids, 2), 3)
  assert.equal(dropIndexAt(-1e9, mids, 1), 0)
  assert.equal(dropIndexAt(10, [], 0), 0)
  // a held row that is not in the list cannot send it past either end
  assert.equal(dropIndexAt(1e9, mids, 99), 3)
  assert.equal(dropIndexAt(-1e9, mids, -1), 0)
})

test('the space a rule is dropped into is the one between rules, or at either end', () => {
  // four rules: gaps 0 (above the first) to 4 (below the last)
  assert.equal(dropGapAt(0, 3), 0, 'moved to the top: the space above the first rule')
  assert.equal(dropGapAt(3, 0), 4, 'moved to the bottom: the space below the last rule')
  assert.equal(dropGapAt(1, 3), 1, 'moved up: the space in front of the rule it lands before')
  assert.equal(dropGapAt(2, 0), 3, 'moved down: the space behind the rule it lands after')
  assert.equal(dropGapAt(1, 0), 2)
  assert.equal(dropGapAt(0, 1), 0)
  assert.equal(dropGapAt(2, 2), null, 'a rule that stays opens no new space')
  // letting go in the gap and moving the rule there ends at the index that was meant
  for (let from = 0; from < 4; from++) for (let to = 0; to < 4; to++) {
    if (to === from) continue
    const g = dropGapAt(to, from)
    const order = [0, 1, 2, 3]
    const rest = order.filter((k) => k !== from)
    rest.splice(g > from ? g - 1 : g, 0, from)       // put it into the gap, counted in the rows without it
    assert.equal(rest.indexOf(from), to, `from ${from} to ${to} via gap ${g}`)
  }
})

test('a carried rule pulls the list towards the edge it is near, more the nearer it is', () => {
  const top = 76, bottom = 787                      // the visible part of the list on a phone: below the bar, above the bottom navigation
  const zone = edgeZone(bottom - top)
  assert.ok(zone >= 72 && zone <= 140, `the zone is ${zone}`)
  assert.deepEqual(edgePull(400, top, bottom), { dir: 0, depth: 0 }, 'the middle pulls nothing')
  assert.equal(edgePull(bottom - zone - 1, top, bottom).dir, 0, 'just outside the bottom zone')
  assert.equal(edgePull(bottom - zone + 1, top, bottom).dir, 1)
  assert.equal(edgePull(top + zone + 1, top, bottom).dir, 0)
  assert.equal(edgePull(top + zone - 1, top, bottom).dir, -1)
  assert.ok(edgePull(bottom - 5, top, bottom).depth > edgePull(bottom - zone + 10, top, bottom).depth, 'nearer the edge is deeper')
  assert.equal(edgePull(bottom + 400, top, bottom).depth, 1.5, 'a finger far beyond the edge is capped')
  assert.equal(edgePull(top - 400, top, bottom).dir, -1, 'and above the top pulls up')
  // the zone is in the part of the list that can be seen: a bar over the bottom of it moves the zone up
  // a thumb resting at 700 is in the zone of the part that can be seen, and was not in a zone measured to 835, which was mostly under the bar
  assert.equal(edgePull(700, top, 787).dir, 1)
  assert.equal(edgePull(700, top, 835).dir, 0)
})

test('the scroll speed starts slow, rises the longer the rule is held at the edge, and is capped', () => {
  let last = 0
  for (const s of [0, 0.5, 1, 2, 3, 4, 6, 10]) {
    const v = edgeScrollSpeed(s, 1)
    assert.ok(v >= last, `${s} s: ${v} is not slower than ${last}`)
    last = v
  }
  assert.ok(edgeScrollSpeed(0, 1) >= 200 && edgeScrollSpeed(0, 1) <= 300, 'it starts gently')
  assert.ok(edgeScrollSpeed(2, 1) > 3 * edgeScrollSpeed(0, 1), 'and is well on its way after two seconds')
  assert.equal(edgeScrollSpeed(60, 1), 6000, 'a hundred rules need a top speed, and it has one')
  assert.ok(edgeScrollSpeed(1, 1) > edgeScrollSpeed(1, 0.5), 'nearer the edge is faster')
  assert.ok(edgeScrollSpeed(0, 0) > 0, 'once in the zone it always moves')
  assert.equal(edgeScrollSpeed(-3, 1), edgeScrollSpeed(0, 1), 'time never runs backwards')
})

test('a draft that only holds typed layout is kept against the rules it was typed against, and let go once they move', () => {
  const rules = [rule('accept', 'tcp', ['22'], { description: 'Operations SSH' })]
  const rows = draftFromRules(rules)
  // "Operations SSH" and a space: the next word has not been typed yet, and the rule has not changed
  const typing = rows.map((r) => ({ ...r, description: 'Operations SSH ', sources: '0.0.0.0/0\n' }))
  assert.equal(hasPendingChanges(typing), false, 'layout alone is not a change')
  assert.equal(draftApplies({ base: rules, rows: typing }, rules), true, 'but it is kept, so the cell does not take the space back')
  assert.equal(draftApplies({ base: rules, rows: typing }, [rule('drop', 'tcp', ['22'], { description: 'Operations SSH' })]), false, 'the rules moved on: the cells show them')
  // with changes waiting it is kept whatever the rules say: whether they can still be saved over is decided elsewhere
  const edited = rows.map((r) => ({ ...r, description: 'Operations SSH updated' }))
  assert.equal(draftApplies({ base: rules, rows: edited }, [rule('drop', 'tcp', ['22'])]), true)
  assert.equal(ruleOfRow({ ...typing[0] }).description, 'Operations SSH', 'and the layout is not written')
  assert.equal(rulesToWrite(typing)[0], rules[0], 'a rule that was only typed in layout is written as it came')
})

test('a problem in the field being typed in waits until the field is left, and still stops the save', () => {
  const rows = draftFromRules([rule('accept', 'tcp', ['22'])]).map((r) => ({ ...r, sources: '10.0.', ports: '' }))
  const p = problemsOf(rows[0])
  assert.ok(p.sources && p.ports)
  assert.deepEqual(shownProblems(p, 'sources'), { ports: p.ports }, 'half an address is not called wrong while it is typed')
  assert.deepEqual(shownProblems(p), p, 'once the field is left, it is')
  assert.deepEqual(shownProblems(p, 'description'), p, 'typing in a field with no problem hides nothing')
  assert.equal(rowsWithProblems(rows), 1, 'and saving is stopped whether it is shown or not')
})

test('a problem announced a moment after its field is left is read then, not when the field was left', () => {
  const rows = draftFromRules([rule('accept', 'tcp', ['22']), rule('accept', 'tcp', ['80'])]).map((r) => ({ ...r, sources: '10.0.', ports: '' }))
  const key = rows[1].key
  assert.equal(problemToSay(rows, key, 'sources'), problemsOf(rows[1]).sources, 'still wrong: said')
  assert.ok(problemToSay(rows, key, 'sources') && problemToSay(rows, key, 'ports'))
  const fixed = rows.map((r) => (r.key === key ? { ...r, sources: '10.0.0.0/8' } : r))
  assert.equal(problemToSay(fixed, key, 'sources'), undefined, 'fixed from its menu in the meantime: not said')
  const icmp = rows.map((r) => (r.key === key ? { ...r, protocol: 'icmp', ports: '' } : r))
  assert.equal(problemToSay(icmp, key, 'ports'), undefined, 'switched to ICMP, which clears the ports: not said')
  const removed = rows.map((r) => (r.key === key ? { ...r, removed: true } : r))
  assert.equal(problemToSay(removed, key, 'sources'), undefined, 'removed: not said')
  assert.equal(problemToSay(rows.slice(0, 1), key, 'sources'), undefined, 'gone with a reset draft: not said')
  const reordered = [rows[1], rows[0]]
  assert.equal(problemToSay(reordered, key, 'sources'), problemsOf(rows[1]).sources, 'found by its key, not its place')
})
