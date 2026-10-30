// Tests for Import and Export in mPanel's text format (lib/firewallMpanel.ts, and readImportedRules in lib/firewallRules.ts). Node runs the
// TypeScript directly: node --test scripts/test-firewall-mpanel.mjs. Only documentation-range addresses (192.0.2.0/24, 198.51.100.0/24,
// 203.0.113.0/24) appear here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ANY_ADDRESS, readImportedRules } from '../src/renderer/src/lib/firewallRules.ts'
import { MPANEL_KEYS, mpanelText, readNetmask, splitMpanelList, toMpanelRules } from '../src/renderer/src/lib/firewallMpanel.ts'

// What mPanel's dialog shows, with the documentation addresses. SAMPLE leaves the netmask address out of the first rule; AS_PASTED has it.
const mp = (over = {}) => ({ sourceaddr: '192.0.2.10', destaddr: '203.0.113.17', destport: '22,80', action: 'ACCEPT', description: 'datacenter', protocol: 'ALL', ...over })
const SAMPLE = [
  mp({ sourceaddr: '0.0.0.0/0', destaddr: '224.0.0.0/4', destport: '', action: 'DROP', description: 'Multicast and broadcast traffic' }),
  mp(),
  mp({ sourceaddr: '0.0.0.0/0', destport: '', action: 'DROP', description: 'block everything else' })
]
const SAMPLE_RULES = [
  { action: 'drop', protocol: 'all', source_addresses: ['0.0.0.0/0'], destination_addresses: ['224.0.0.0/4'], description: 'Multicast and broadcast traffic' },
  { action: 'accept', protocol: 'all', source_addresses: ['192.0.2.10'], destination_addresses: ['203.0.113.17'], destination_ports: ['22', '80'], description: 'datacenter' },
  { action: 'drop', protocol: 'all', source_addresses: ['0.0.0.0/0'], destination_addresses: ['203.0.113.17'], description: 'block everything else' }
]
const MASKED = '0.0.0.255/0.0.0.255'
const AS_PASTED = [{ ...SAMPLE[0], destaddr: `224.0.0.0/4,${MASKED}` }, SAMPLE[1], SAMPLE[2]]
const AS_PASTED_RULES = [{ ...SAMPLE_RULES[0], destination_addresses: ['224.0.0.0/4', MASKED] }, SAMPLE_RULES[1], SAMPLE_RULES[2]]
// `kept` is the rules the server has now: 0.0.0.255/0.0.0.255 is accepted only in one of those, exactly.
const read = (rules, saved, kept) => readImportedRules(rules, saved, kept)

test('mPanel text imports as the API-shaped rules, and nothing else is added', () => {
  const r = read(SAMPLE)
  assert.equal(r.error, undefined)
  assert.deepEqual(r.rules, SAMPLE_RULES)
  // Exactly the reference's keys, in the reference's order of use: no mPanel key survives.
  for (const rule of r.rules) for (const k of MPANEL_KEYS.filter((k) => !['action', 'description', 'protocol'].includes(k))) assert.equal(k in rule, false, k)
})

test('0.0.0.255/0.0.0.255 is kept as a destination address, exactly as it is, in a rule the server already has, in either format', () => {
  // The sample as mPanel's dialog shows it, with the address in its multicast rule, on a server that has those rules.
  const r = read(AS_PASTED, 0, AS_PASTED_RULES)
  assert.equal(r.error, undefined)
  assert.deepEqual(r.rules, AS_PASTED_RULES)
  assert.deepEqual(r.rules[0].destination_addresses, ['224.0.0.0/4', MASKED])
  // Alone, first, and with spaces around it (mPanel's text is trimmed): the same string, in the same place, not converted.
  for (const [destaddr, expected] of [[MASKED, [MASKED]], [`${MASKED},224.0.0.0/4`, [MASKED, '224.0.0.0/4']], [` ${MASKED} , 203.0.113.17`, [MASKED, '203.0.113.17']]]) {
    assert.deepEqual(read([mp({ destaddr })], 0, [{ ...SAMPLE_RULES[1], destination_addresses: expected }]).rules[0].destination_addresses, expected, destaddr)
  }
  // The API's own format: the same address, in the same place, unchanged.
  const api = [{ action: 'drop', protocol: 'all', source_addresses: ['0.0.0.0/0'], destination_addresses: ['224.0.0.0/4', MASKED], description: 'Multicast and broadcast traffic' }]
  assert.deepEqual(read(api, 0, api).rules, api)
  const alone = [{ ...api[0], destination_addresses: [MASKED] }]
  assert.deepEqual(read(alone, 0, alone).rules[0].destination_addresses, [MASKED])
})

test('0.0.0.255/0.0.0.255 is refused in a rule the server does not already have, or has but not as it is, naming the rule and the key', () => {
  const text = (at, key) => `Rule ${at}: "${key}" has 0.0.0.255/0.0.0.255, which BLDesk keeps only in a rule this server already has, as it is, and does not add to a new or changed rule. Nothing was imported: remove that address from "${key}" and import again.`
  // The server has no rules, or none like it: no new rule may have the address, in either format.
  assert.equal(read(AS_PASTED).error, text(1, 'destaddr'))
  assert.equal(read(AS_PASTED, 0, []).error, text(1, 'destaddr'))
  assert.equal(read(AS_PASTED, 0, SAMPLE_RULES).error, text(1, 'destaddr'))
  assert.equal(read(AS_PASTED).rules, undefined)
  const api = [{ action: 'drop', protocol: 'all', source_addresses: ['0.0.0.0/0'], destination_addresses: [MASKED] }]
  assert.equal(read(api).error, text(1, 'destination_addresses'))
  // Only the rule that is new is named, and the rest of the file is not imported either.
  assert.equal(read([...SAMPLE, mp({ destaddr: MASKED })], 0, [...SAMPLE_RULES]).error, text(4, 'destaddr'))
  // A rule that has it but differs from the server's in anything (a port, a source, the action, the protocol, the description) is a new rule.
  const kept = { ...AS_PASTED_RULES[0] }
  for (const changed of [{ destination_ports: ['22'] }, { source_addresses: ['192.0.2.1'] }, { action: 'accept' }, { protocol: 'tcp' }, { description: 'Multicast' }, { destination_addresses: [MASKED, '224.0.0.0/4'] }]) {
    const file = [{ ...kept, ...changed }]
    assert.match(read(file, 0, [kept]).error, /^Rule 1: "destination_addresses" has 0\.0\.0\.255\/0\.0\.0\.255, which BLDesk keeps only in a rule this server already has/, JSON.stringify(changed))
  }
  // It is the rule, not the address, that has to exist: the server having the address in another rule does not allow a second one, and each
  // rule it has covers one rule of the file, so a copy of it is new.
  assert.equal(read([AS_PASTED[0], mp({ destaddr: MASKED })], 0, [AS_PASTED_RULES[0]]).error, text(2, 'destaddr'))
  assert.equal(read([AS_PASTED[0], AS_PASTED[0]], 0, [AS_PASTED_RULES[0]]).error, text(2, 'destaddr'))
  assert.equal(read([AS_PASTED[0], AS_PASTED[0]], 0, [AS_PASTED_RULES[0], AS_PASTED_RULES[0]]).rules.length, 2)
  // Whitespace around the description does not make it a different rule (the confirmation's diff treats it as the same).
  assert.equal(read([{ ...AS_PASTED[0], description: ' Multicast and broadcast traffic ' }], 0, [AS_PASTED_RULES[0]]).error, undefined)
})

test('0.0.0.255/0.0.0.255 as a source address is refused in either format, saying it is accepted only as a destination', () => {
  const text = (key) => `Rule 1: "${key}" has 0.0.0.255/0.0.0.255, which BLDesk accepts only as a destination address. Nothing was imported: remove that address from "${key}" and import again.`
  assert.equal(read([mp({ sourceaddr: MASKED })]).error, text('sourceaddr'))
  assert.equal(read([mp({ sourceaddr: `192.0.2.1, ${MASKED}` })]).error, text('sourceaddr'))
  assert.equal(read([mp({ sourceaddr: MASKED, destaddr: MASKED })]).error, text('sourceaddr'))
  assert.equal(read([{ action: 'accept', protocol: 'all', source_addresses: [MASKED], destination_addresses: ['0.0.0.0/0'] }]).error, text('source_addresses'))
  assert.equal(read([{ action: 'accept', protocol: 'all', source_addresses: ['192.0.2.1', MASKED], destination_addresses: [MASKED] }]).error, text('source_addresses'))
  assert.match(read([mp(), mp({ sourceaddr: MASKED })]).error, /^Rule 2: "sourceaddr" has 0\.0\.0\.255\/0\.0\.0\.255, which BLDesk accepts only as a destination address/)
  assert.equal(read([mp({ sourceaddr: MASKED })]).rules, undefined)
})

test('any other netmask with a gap is still refused, naming the rule, the key, the address and what to do', () => {
  for (const mask of ['255.0.255.0', '0.0.0.254', '255.255.255.1', '0.0.0.127']) {
    for (const address of ['198.51.100.0', '0.0.0.254']) {
      const r = read([mp(), mp({ destaddr: `224.0.0.0/4,${address}/${mask}` })])
      assert.equal(r.rules, undefined)
      assert.match(r.error, new RegExp(`^Rule 2: "destaddr" has ${address.replace(/\./g, '\\.')}\\/${mask.replace(/\./g, '\\.')}, an address with a netmask that is not a whole CIDR range`), `${address}/${mask}`)
      assert.match(r.error, /documents only an IPv4 address or a CIDR range, so BLDesk does not import this form \(the one exception is 0\.0\.0\.255\/0\.0\.0\.255, as a destination address in a rule this server already has\)\./)
      assert.match(r.error, /Nothing was imported: remove that address from the rule, or replace it with addresses or CIDR ranges, and import again\.$/)
    }
  }
  // The same mask on another address is not the accepted value, and neither is the accepted address with another mask.
  assert.match(read([mp({ destaddr: '192.0.2.0/0.0.0.255' })]).error, /^Rule 1: "destaddr" has 192\.0\.2\.0\/0\.0\.0\.255, an address with a netmask/)
  assert.match(read([mp({ destaddr: '0.0.0.255/0.0.0.254' })]).error, /^Rule 1: "destaddr" has 0\.0\.0\.255\/0\.0\.0\.254, an address with a netmask/)
  // In a source too, with the netmask message and the key named.
  assert.match(read([mp({ sourceaddr: '192.0.2.0/255.0.255.0' })]).error, /^Rule 1: "sourceaddr" has 192\.0\.2\.0\/255\.0\.255\.0, an address with a netmask/)
})

test('a netmask that is a whole range is written as CIDR; one with a gap is refused', () => {
  for (const [mask, bits] of [['255.255.255.255', 32], ['255.255.255.254', 31], ['255.255.255.128', 25], ['255.255.255.0', 24], ['255.255.254.0', 23], ['255.255.0.0', 16], ['255.0.0.0', 8], ['240.0.0.0', 4], ['128.0.0.0', 1], ['0.0.0.0', 0]]) {
    assert.deepEqual(readNetmask(`192.0.2.0/${mask}`), { kind: 'cidr', cidr: `192.0.2.0/${bits}` }, mask)
  }
  for (const mask of ['0.0.0.255', '255.0.255.0', '255.255.255.1', '128.0.0.1', '0.255.255.255', '255.255.0.255', '1.1.1.1']) {
    assert.deepEqual(readNetmask(`192.0.2.0/${mask}`), { kind: 'gap' }, mask)
  }
  // Not an address and a dotted mask: left to the ordinary address check.
  for (const other of ['192.0.2.0/24', '192.0.2.1', '0.0.0.0/0', '', 'any', '192.0.2.0/255.255.255', '192.0.2.0/255.255.255.256', '192.0.2.256/255.255.255.0', '2001:db8::/32']) assert.deepEqual(readNetmask(other), { kind: 'none' }, other)

  const r = read([mp({ sourceaddr: '192.0.2.0/255.255.255.0', destaddr: '198.51.100.0/255.255.255.128, 203.0.113.17' })])
  assert.equal(r.error, undefined)
  assert.deepEqual(r.rules[0].source_addresses, ['192.0.2.0/24'])
  assert.deepEqual(r.rules[0].destination_addresses, ['198.51.100.0/25', '203.0.113.17'])
  assert.match(read([mp({ destaddr: '198.51.100.0/255.0.255.0' })]).error, /^Rule 1: "destaddr" has 198\.51\.100\.0\/255\.0\.255\.0, an address with a netmask/)
  // A form that is not a netmask at all is an ordinary bad address, and the message names it.
  assert.match(read([mp({ destaddr: '203.0.113.17,198.51.100.0/255.255.255.256' })]).error, /^Rule 1: "destaddr" has "198\.51\.100\.0\/255\.255\.255\.256", which is not an IPv4 address or range/)
})

test('in BLDesk\'s own format a netmask is still refused and not converted, except 0.0.0.255/0.0.0.255 as a destination address in a rule the server has', () => {
  const bl = (source_addresses, destination_addresses) => [{ action: 'accept', protocol: 'all', source_addresses, destination_addresses }]
  assert.match(read(bl(['192.0.2.0/255.255.255.0'], ['0.0.0.0/0'])).error, /^Rule 1: "source_addresses" must be IPv4 addresses or ranges/)
  assert.match(read(bl(['0.0.0.0/0'], ['192.0.2.0/255.255.255.0'])).error, /^Rule 1: "destination_addresses" must be IPv4 addresses or ranges/)
  assert.match(read(bl(['0.0.0.0/0'], ['0.0.0.255/0.0.0.254'])).error, /^Rule 1: "destination_addresses" must be IPv4 addresses or ranges/)
  assert.match(read(bl(['0.0.0.0/0'], ['192.0.2.0/0.0.0.255'])).error, /^Rule 1: "destination_addresses" must be IPv4 addresses or ranges/)
  assert.match(read(bl(['0.0.0.0/0'], [` ${MASKED}`])).error, /^Rule 1: "destination_addresses" must be IPv4 addresses or ranges/)
  assert.deepEqual(read(bl(['0.0.0.0/0'], [MASKED]), 0, bl(['0.0.0.0/0'], [MASKED])).rules, bl(['0.0.0.0/0'], [MASKED]))
})

test('BLDesk\'s format still imports as it did, extra keys left out and a missing destination written as any', () => {
  const file = [
    { action: 'accept', protocol: 'tcp', source_addresses: ['192.0.2.1'], destination_ports: ['22'], description: 'ssh', extra: 'dropped' },
    { action: 'drop', protocol: 'all', source_addresses: ['0.0.0.0/0'], destination_addresses: ['203.0.113.0/24'] }
  ]
  assert.deepEqual(read(file).rules, [
    { action: 'accept', protocol: 'tcp', source_addresses: ['192.0.2.1'], destination_addresses: [ANY_ADDRESS], destination_ports: ['22'], description: 'ssh' },
    { action: 'drop', protocol: 'all', source_addresses: ['0.0.0.0/0'], destination_addresses: ['203.0.113.0/24'] }
  ])
  // Upper case is mPanel's habit, not BLDesk's: a BLDesk-shaped rule is still refused for it.
  assert.match(read([{ action: 'DROP', protocol: 'all', source_addresses: ['0.0.0.0/0'] }]).error, /^Rule 1: "action" must be "accept" or "drop"\.$/)
  // What the previous Export wrote (the rules as the API returned them, pretty-printed) is read back unchanged, an empty port list included.
  const apiShaped = SAMPLE_RULES.map((r) => ({ ...r, destination_ports: r.destination_ports ?? [] }))
  assert.deepEqual(read(JSON.parse(JSON.stringify(apiShaped, null, 2))).rules, apiShaped)
})

test('a file or rule that mixes the two formats is refused with the rule and the key named', () => {
  const bl = { action: 'accept', protocol: 'tcp', source_addresses: ['0.0.0.0/0'], destination_addresses: ['0.0.0.0/0'] }
  // One rule with both kinds of key.
  assert.match(read([{ ...mp(), destination_ports: ['22'] }]).error, /^Rule 1 has both "sourceaddr", which is mPanel's format, and "destination_ports", which is BLDesk's and the API's\. Use one format/)
  assert.match(read([bl, { ...mp({ destaddr: undefined }), source_addresses: ['0.0.0.0/0'] }]).error, /^Rule 2 has both "sourceaddr"[^]*"source_addresses"/)
  // Rules of different formats in one file, in either order.
  assert.match(read([mp(), bl]).error, /^Rule 2 has "source_addresses", which is BLDesk's and the API's format, but Rule 1 has "sourceaddr", which is mPanel's\. Use one format for every rule in the file\.$/)
  assert.match(read([bl, bl, mp({ destport: '' })]).error, /^Rule 3 has "sourceaddr", which is mPanel's format, but Rule 1 has "source_addresses", which is BLDesk's and the API's\./)
  // The mix is reported before a later value problem, so the first thing the person is told is the structure.
  assert.match(read([mp(), { ...bl, action: 'allow' }]).error, /^Rule 2 has "source_addresses"/)
  // A rule with only the shared keys, in a file of mPanel rules, is an mPanel rule that lacks its addresses (not a mix).
  assert.match(read([mp(), { action: 'ACCEPT', protocol: 'ALL' }]).error, /^Rule 2: "sourceaddr" must list at least one address/)
})

test('an mPanel rule with a key BLDesk has no place for is refused as a whole, never trimmed', () => {
  const r = read([mp(), mp({ enabled: true })])
  assert.equal(r.rules, undefined)
  assert.match(r.error, /^Rule 2 has "enabled", which BLDesk does not know\. Nothing was imported, rather than drop a field that could change what the rule does\. mPanel's format has "sourceaddr", "destaddr", "destport", "action", "description", "protocol"\.$/)
  // Keys are exact: BLDesk's own names and other cases are unknown keys in an mPanel rule... except where they are the shared ones.
  assert.match(read([mp({ Action: 'DROP' })]).error, /^Rule 1 has "Action"/)
  assert.match(read([mp({ source_addresses: [] })]).error, /^Rule 1 has both/)
  assert.match(read([mp({ id: 7 })]).error, /^Rule 1 has "id"/)
})

test('action and protocol are read in either case, and anything else is named', () => {
  for (const [action, protocol] of [['DROP', 'ALL'], ['drop', 'all'], ['Drop', 'All'], ['ACCEPT', 'TCP'], ['accept', 'udp'], ['Accept', 'Icmp']]) {
    const r = read([mp({ action, protocol, destport: '' })])
    assert.equal(r.error, undefined, `${action} ${protocol}`)
    assert.equal(r.rules[0].action, action.toLowerCase())
    assert.equal(r.rules[0].protocol, protocol.toLowerCase())
  }
  assert.match(read([mp({ action: 'ALLOW' })]).error, /^Rule 1: "action" must be "ACCEPT" or "DROP"\.$/)
  assert.match(read([mp({ action: undefined })]).error, /^Rule 1: "action" must be "ACCEPT" or "DROP"\.$/)
  assert.match(read([mp({ action: 1 })]).error, /"action"/)
  assert.match(read([mp(), mp({ protocol: 'GRE' })]).error, /^Rule 2: "protocol" must be "ALL", "ICMP", "TCP" or "UDP"\.$/)
  assert.match(read([mp({ protocol: undefined })]).error, /"protocol"/)
})

test('empty ports, empty destination and empty description mean every port, any destination and none', () => {
  const r = read([mp({ destport: '', destaddr: '', description: '' }), mp({ destport: '   ', destaddr: '  ', description: undefined }), mp({ destport: undefined, destaddr: undefined, description: null })])
  assert.equal(r.error, undefined)
  for (const rule of r.rules) {
    assert.deepEqual(rule, { action: 'accept', protocol: 'all', source_addresses: ['192.0.2.10'], destination_addresses: [ANY_ADDRESS] })
    assert.equal('destination_ports' in rule, false)
    assert.equal('description' in rule, false)
  }
  // A source is never defaulted: an address emptied by accident would open the rule to everyone.
  assert.match(read([mp({ sourceaddr: '' })]).error, /^Rule 1: "sourceaddr" must list at least one address, or 0\.0\.0\.0\/0 for any\.$/)
  assert.match(read([mp({ sourceaddr: undefined })]).error, /^Rule 1: "sourceaddr" must list at least one address/)
  assert.match(read([mp(), mp({ sourceaddr: ' ' })]).error, /^Rule 2: "sourceaddr"/)
})

test('items are split at commas and trimmed; an empty item, or a value that is not text, is refused with the key named', () => {
  assert.deepEqual(splitMpanelList(' 22 , 80,443 '), ['22', '80', '443'])
  assert.deepEqual(splitMpanelList(''), [])
  assert.deepEqual(splitMpanelList('  '), [])
  assert.deepEqual(splitMpanelList('22,,80'), ['22', '', '80'])
  const r = read([mp({ sourceaddr: ' 192.0.2.1 , 198.51.100.0/24 ', destaddr: '203.0.113.1,203.0.113.2', destport: ' 22 , 80,443 ' })])
  assert.deepEqual(r.rules[0].source_addresses, ['192.0.2.1', '198.51.100.0/24'])
  assert.deepEqual(r.rules[0].destination_addresses, ['203.0.113.1', '203.0.113.2'])
  assert.deepEqual(r.rules[0].destination_ports, ['22', '80', '443'])
  assert.match(read([mp({ destport: '22,,80' })]).error, /^Rule 1: "destport" has an empty item between its commas\.$/)
  assert.match(read([mp({ destport: '22,80,' })]).error, /^Rule 1: "destport" has an empty item/)
  assert.match(read([mp({ destaddr: ',203.0.113.1' })]).error, /^Rule 1: "destaddr" has an empty item/)
  assert.match(read([mp({ sourceaddr: ['192.0.2.1'] })]).error, /^Rule 1: "sourceaddr" must be text, with the items separated by commas\.$/)
  assert.match(read([mp({ destport: 22 })]).error, /^Rule 1: "destport" must be text/)
  assert.match(read([mp({ destaddr: 5 })]).error, /^Rule 1: "destaddr" must be text/)
  assert.match(read([mp({ description: 5 })]).error, /^Rule 1: "description" must be text\.$/)
  assert.match(read([mp({ sourceaddr: '192.0.2.1,::/0' })]).error, /^Rule 1: "sourceaddr" has "::\/0", which is not an IPv4 address or range, such as 192\.0\.2\.1 or 192\.0\.2\.0\/24\.$/)
  assert.match(read([mp({ destaddr: 'any' })]).error, /^Rule 1: "destaddr" has "any"/)
})

test('port ranges are kept exactly as written', () => {
  const r = read([mp({ protocol: 'TCP', destport: '1000-2000, 3000:4000,22' })])
  assert.deepEqual(r.rules[0].destination_ports, ['1000-2000', '3000:4000', '22'])
})

test('a description is kept as written, and one longer than the API accepts is refused', () => {
  assert.equal(read([mp({ description: '  spaced  ' })]).rules[0].description, '  spaced  ')
  assert.equal(read([mp({ description: 'x'.repeat(250) })]).error, undefined)
  assert.match(read([mp({ description: 'x'.repeat(251) })]).error, /^Rule 1: "description" is 251 characters; the most BinaryLane accepts is 250\.$/)
})

test('the limits that apply to any import apply to mPanel text too', () => {
  assert.deepEqual(read([]).rules, [])
  assert.match(read(Array.from({ length: 101 }, () => mp())).error, /^The file has 101 rules\. Firewall rules are limited to 100 per server\./)
  assert.equal(read(Array.from({ length: 100 }, () => mp())).error, undefined)
  assert.equal(read(Array.from({ length: 110 }, () => mp()), 110).error, undefined)
  assert.match(read([mp(), 5]).error, /^Rule 2 is not a rule object\.$/)
  assert.match(read([mp(), null]).error, /^Rule 2 is not a rule object\./)
  assert.match(read({}).error, /JSON array/)
})

test('Export writes mPanel\'s keys in mPanel\'s order, comma-joined, in upper case', () => {
  const rules = [
    { action: 'drop', protocol: 'all', source_addresses: ['0.0.0.0/0'], destination_addresses: ['224.0.0.0/4', '198.51.100.0/24'], description: 'Multicast' },
    { action: 'accept', protocol: 'tcp', source_addresses: ['192.0.2.10', '192.0.2.11'], destination_addresses: ['203.0.113.17'], destination_ports: ['22', '1000:2000', '1000-2000'], description: 'ssh' },
    { action: 'accept', protocol: 'icmp', source_addresses: ['0.0.0.0/0'], destination_addresses: ['0.0.0.0/0'], destination_ports: null, description: null },
    { action: 'drop', protocol: 'udp', source_addresses: ['0.0.0.0/0'], destination_addresses: ['0.0.0.0/0'], destination_ports: [] }
  ]
  const out = toMpanelRules(rules)
  for (const o of out) assert.deepEqual(Object.keys(o), ['sourceaddr', 'destaddr', 'destport', 'action', 'description', 'protocol'])
  assert.deepEqual(out[0], { sourceaddr: '0.0.0.0/0', destaddr: '224.0.0.0/4,198.51.100.0/24', destport: '', action: 'DROP', description: 'Multicast', protocol: 'ALL' })
  assert.deepEqual(out[1], { sourceaddr: '192.0.2.10,192.0.2.11', destaddr: '203.0.113.17', destport: '22,1000:2000,1000-2000', action: 'ACCEPT', description: 'ssh', protocol: 'TCP' })
  assert.deepEqual(out[2], { sourceaddr: '0.0.0.0/0', destaddr: '0.0.0.0/0', destport: '', action: 'ACCEPT', description: '', protocol: 'ICMP' })
  assert.equal(out[3].destport, '')
  // The text is the two-space pretty print mPanel's dialog shows, with no trailing newline.
  assert.equal(mpanelText(rules), JSON.stringify(out, null, 2))
  assert.equal(
    mpanelText([rules[1]]),
    [
      '[',
      '  {',
      '    "sourceaddr": "192.0.2.10,192.0.2.11",',
      '    "destaddr": "203.0.113.17",',
      '    "destport": "22,1000:2000,1000-2000",',
      '    "action": "ACCEPT",',
      '    "description": "ssh",',
      '    "protocol": "TCP"',
      '  }',
      ']'
    ].join('\n')
  )
  assert.equal(mpanelText([]), '[]')
})

test('Export then Import gives back the same rules, and Import then Export gives back the same text', () => {
  const rules = [
    ...SAMPLE_RULES,
    { action: 'accept', protocol: 'tcp', source_addresses: ['192.0.2.10', '198.51.100.0/24'], destination_addresses: ['203.0.113.17', '203.0.113.18'], destination_ports: ['22', '8000:9000', '1000-2000'], description: 'Web & "SSH", with a comma' },
    { action: 'accept', protocol: 'icmp', source_addresses: ['0.0.0.0/0'], destination_addresses: ['0.0.0.0/0'] },
    { action: 'drop', protocol: 'udp', source_addresses: ['192.0.2.0/24'], destination_addresses: ['0.0.0.0/0'], destination_ports: ['53'] },
    ...AS_PASTED_RULES
  ]
  const back = read(JSON.parse(mpanelText(rules)), 0, rules)
  assert.equal(back.error, undefined)
  assert.deepEqual(back.rules, rules)
  // The other way: text mPanel wrote reads and is written out again byte for byte.
  const text = JSON.stringify(SAMPLE, null, 2)
  assert.equal(mpanelText(read(JSON.parse(text)).rules), text)
  // Including the sample exactly as mPanel's dialog shows it, address with a netmask and all.
  const pasted = JSON.stringify(AS_PASTED, null, 2)
  assert.equal(mpanelText(read(JSON.parse(pasted), 0, AS_PASTED_RULES).rules), pasted)
  assert.match(pasted, /"destaddr": "224\.0\.0\.0\/4,0\.0\.0\.255\/0\.0\.0\.255"/)
  // And twice over.
  assert.equal(mpanelText(read(JSON.parse(mpanelText(back.rules)), 0, rules).rules), mpanelText(rules))
})

test('a rule with a netmask that is a whole range comes back as CIDR, which is the same addresses', () => {
  const text = JSON.stringify([mp({ destaddr: '198.51.100.0/255.255.255.0,203.0.113.17' })], null, 2)
  const r = read(JSON.parse(text))
  assert.equal(mpanelText(r.rules), JSON.stringify([mp({ destaddr: '198.51.100.0/24,203.0.113.17' })], null, 2))
})
