// Stateful fake BinaryLane API (plus the help service and the GitHub release feed) for GUI testing.
// Responses are generated from the public OpenAPI reference (../../openapi.json), then overridden with fleet data.
// Normally started by launch.mjs; see README.md. Environment: PORT, MOCK_TOKEN, CERT and KEY (or HTTP=1), LOG, SPEC.
import https from 'node:https'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync, appendFileSync } from 'node:fs'
import { devNull } from 'node:os'

const SPEC = JSON.parse(readFileSync(process.env.SPEC || new URL('../../openapi.json', import.meta.url), 'utf8'))
const PORT = Number(process.env.PORT || 8443)
const TOKEN = process.env.MOCK_TOKEN
if (!TOKEN) throw new Error('MOCK_TOKEN is required')
const LOG = process.env.LOG || devNull
const S = SPEC.components.schemas
// A stand-in installer for the update scenario: the real bytes are never installed by this harness.
const DEB = Buffer.from('not a real package: BLDesk GUI test update payload\n')
const DEB_SHA = createHash('sha512').update(DEB).digest('base64')
const VERSION = process.env.APP_VERSION || JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

// ---------- schema-driven generator ----------
const ref = (s) => (s && s.$ref ? S[s.$ref.split('/').pop()] : s)
function flat(s) {
  s = ref(s) || {}
  if (s.allOf) {
    const parts = s.allOf.map(flat)
    return { ...Object.assign({}, ...parts), properties: Object.assign({}, ...parts.map((p) => p.properties || {})) }
  }
  return s
}
function gen(s, d = 0, key = '') {
  s = flat(s)
  if (s.oneOf || s.anyOf) return gen((s.oneOf || s.anyOf)[0], d, key)
  if (s.example !== undefined) return s.example
  if (s.enum) return s.enum[0]
  const t = s.type || (s.properties ? 'object' : undefined)
  if (t === 'object' || s.properties) {
    if (d > 3) return {}
    const o = {}
    for (const [k, v] of Object.entries(s.properties || {})) o[k] = gen(v, d + 1, k)
    return o
  }
  if (t === 'array') return d > 2 ? [] : [gen(s.items, d + 1, key)]
  if (t === 'integer' || t === 'number') return s.minimum ?? 1
  if (t === 'boolean') return false
  if (t === 'string') {
    if (s.format === 'date-time') return '2026-09-01T00:00:00Z'
    if (/email/.test(key)) return 'user@example.com'
    if (/url|link/.test(key)) return 'https://example.com/'
    if (/ip|address/.test(key)) return '203.0.113.10'
    return key || 'text'
  }
  return null
}
const itemSchema = (wrapper, prop) => {
  const p = flat(S[wrapper].properties[prop])
  return p.type === 'array' ? p.items : p
}
const mk = (wrapper, prop, over = {}) => ({ ...gen(itemSchema(wrapper, prop)), ...over })

// ---------- fixtures ----------
const REGIONS = [
  ['syd', 'Sydney', true], ['bne', 'Brisbane', true], ['mel', 'Melbourne', true],
  ['per', 'Perth', true], ['sin', 'Singapore', true], ['adl', 'Adelaide', false]
]
const regionObj = ([slug, name, available]) => mk('RegionsResponse', 'regions', { slug, name, available, features: ['backups', 'ipv6'], sizes: [] })
const regions = REGIONS.map(regionObj)
const regionBySlug = (s) => regions.find((r) => r.slug === s)

const sizeRows = [
  ['std-min', 1, 1024, 20, 4.9, 1024], ['std-1vcpu', 1, 2048, 40, 9.8, 2048], ['std-2vcpu', 2, 4096, 60, 19.6, 3072],
  ['std-4vcpu', 4, 8192, 100, 39.2, 4096], ['std-6vcpu', 6, 12288, 180, 58.8, 6144], ['std-8vcpu', 8, 16384, 340, 78.4, 8192]
]
const sizeOpts = (memMax, extra = {}) => ({
  disk_min: 20, disk_max: 2000, disk_cost_per_additional_gigabyte: 0.11, restricted_disk_values: null,
  memory_max: memMax, memory_cost_per_additional_megabyte: 0.0048, transfer_max: 8192, transfer_cost_per_additional_gigabyte: 0.01,
  ipv4_addresses_max: 8, ipv4_addresses_cost_per_address: 2.5, discount_for_no_public_ipv4: 2.5,
  // Public sizes snapshot recorded in #198 on 2026-09-29.
  daily_backups: 0, weekly_backups: 0, monthly_backups: 0, backups_cost_per_backup_per_gigabyte: 0.05,
  offsite_backups_cost_per_gigabyte: 0.05,
  offsite_backup_frequency_cost: { daily_per_gigabyte: 0, weekly_per_gigabyte: 0, monthly_per_gigabyte: 0 }, ...extra
})
const sizes = sizeRows.map(([slug, vcpus, memory, disk, price, transfer]) => mk('SizesResponse', 'sizes', {
  slug, description: slug.replace('std-', 'Standard ').replace('vcpu', ' vCPU'), cpu_description: `${vcpus} vCPU`, storage_description: 'SSD',
  size_type: { slug: 'vps', name: 'Standard' }, available: true, regions: ['syd', 'bne', 'mel', 'per', 'sin', 'adl'],
  regions_out_of_stock: slug === 'std-8vcpu' ? ['per'] : [], price_monthly: price, price_hourly: +(price / 720).toFixed(5),
  disk, memory, transfer, excess_transfer_cost_per_gigabyte: 0.01, vcpus, vcpu_units: 'VCPU', options: sizeOpts(Math.max(memory * 4, 32768))
}))
sizes.push(mk('SizesResponse', 'sizes', {
  slug: 'cpu-2thr', description: 'CPU Optimised 2 threads', cpu_description: '2 threads', storage_description: 'NVMe',
  size_type: { slug: 'cpu', name: 'CPU Optimised' }, available: true, regions: ['syd', 'mel'], regions_out_of_stock: ['mel'],
  price_monthly: 45, price_hourly: 0.0625, disk: 100, memory: 8192, transfer: 4096, excess_transfer_cost_per_gigabyte: 0.01, vcpus: 2, vcpu_units: 'THR',
  options: sizeOpts(16384, { restricted_disk_values: [100, 200, 400], disk_min: 100, disk_max: 400 })
}))
const retiredSize = mk('SizesResponse', 'sizes', {
  slug: 'a-3040', description: 'Legacy GS1', cpu_description: '2 vCPU', storage_description: 'SSD', size_type: { slug: 'vps', name: 'Standard' },
  available: false, regions: ['mel'], regions_out_of_stock: [], price_monthly: 30, price_hourly: 0.04, disk: 60, memory: 3072, transfer: 3000,
  excess_transfer_cost_per_gigabyte: 0.01, vcpus: 2, vcpu_units: 'VCPU', options: sizeOpts(6144, { disk_max: 200 })
})
const allSizes = () => [...sizes, retiredSize]
const sizeBySlug = (s) => allSizes().find((x) => x.slug === s)

const imgRows = [
  [101, 'ubuntu-24.04', 'Ubuntu 24.04 LTS', 'Ubuntu', 0, 0], [102, 'debian-12', 'Debian 12', 'Debian', 0, 0],
  [103, 'almalinux-9', 'AlmaLinux 9', 'AlmaLinux', 0, 0], [104, 'rockylinux-9', 'Rocky Linux 9', 'Rocky Linux', 0, 0],
  [201, 'windows-2022', 'Windows Server 2022', 'Windows', 2048, 40], [202, 'windows-2022-sql', 'Windows Server 2022 + SQL Server', 'Windows', 4096, 60],
  [301, 'cpanel-whm-rocky-8', 'cPanel/WHM on Rocky Linux 8', 'cPanel', 2048, 40]
]
const images = imgRows.map(([id, slug, full_name, distribution, mem, disk]) => mk('ImagesResponse', 'images', {
  id, slug, name: full_name, full_name, distribution, public: true, regions: ['syd', 'bne', 'mel', 'per', 'sin'], min_disk_size: disk || 10,
  min_memory_megabytes: mem || 512, type: 'distribution', image_type: 'distribution', backup_info: null,
  distribution_info: { password_recovery: ['manual'], remote_access_user: distribution === 'Windows' ? 'Administrator' : 'root', features: distribution === 'Windows' ? [] : ['user-data', 'ssh-keys'] }
}))
const imgBySlug = (s) => images.find((i) => i.slug === s) || images[0]

const RNAMES = ['edge-web', 'api', 'postgres', 'queue-worker', 'redis', 'observability']
const nowIso = () => new Date().toISOString()
function mkServer(o) {
  const size = sizeBySlug(o.size_slug), region = regionBySlug(o.region), image = imgBySlug(o.image)
  const options = {
    daily_backups: o.backups === false ? 0 : 3, weekly_backups: o.backups === false ? 0 : 2,
    monthly_backups: o.backups === false ? 0 : 1, offsite_backups: !!o.offsite, ...o.options
  }
  const hasBackups = options.daily_backups + options.weekly_backups + options.monthly_backups > 0
  const v4 = o.public === false ? [] : [{ ip_address: o.ip, type: 'public', netmask: '255.255.255.0', gateway: '203.0.113.1', reverse_name: null }]
  ;(o.extra_ips || []).forEach((ip) => v4.push({ ip_address: ip, type: 'public', netmask: '255.255.255.0', gateway: '203.0.113.1' }))
  v4.push({ ip_address: `10.${20 + (o.vpc_id % 10)}.0.${o.id % 200}`, type: 'private', netmask: '255.255.0.0', gateway: null })
  return mk('ServersResponse', 'servers', {
    id: o.id, name: o.name, memory: o.memory ?? size.memory, vcpus: size.vcpus, disk: o.disk ?? size.disk, vpc_id: o.vpc_id, created_at: '2026-08-01T00:00:00Z',
    status: o.status || 'active', backup_ids: [], features: hasBackups ? ['backups', 'ipv6'] : [],
    region, image, size, size_slug: size.slug,
    selected_size_options: { memory: o.memory ?? size.memory, disk: o.disk ?? size.disk, ipv4_addresses: v4.filter((n) => n.type === 'public').length, ...options },
    networks: { v4, v6: o.v6 ? [{ ip_address: '2001:db8:10::' + (o.id % 200).toString(16), type: 'public', netmask: 64, gateway: '2001:db8:10::1' }] : [] },
    next_backup_window: hasBackups ? { start_hour: 2, end_hour: 4, day: null } : null,
    attached_backup: null,
    disks: [{ id: o.id * 10, size_gigabytes: o.disk ?? size.disk, description: 'Primary disk', primary: true }, ...(o.extraDisk ? [{ id: o.id * 10 + 1, size_gigabytes: 50, description: 'Data', primary: false }] : [])],
    failover_ips: o.failover || [], partner_id: o.partner || null, password_change_supported: image.distribution !== 'Windows',
    permalink: `srv-${o.id}`, is_under_maintenance: false, cancelled_at: null,
    advanced_features: { enabled_advanced_features: image.distribution === 'Windows' ? ['emulated-hyperv', 'emulated-devices'] : ['cloud-init', 'qemu-guest-agent'], machine_type: 'pc_i440fx_7point2point1', processor_model: 0, video_device: 'cirrus-logic' }
  })
}
const IPB = ['203.0.113', '198.51.100', '192.0.2']
let servers, actions, nextId, keys, domains, lbs, vpcs, records, serverBackups, fails, cfg
function reset() {
  servers = []
  for (let i = 0; i < 18; i++) {
    const rg = ['syd', 'bne', 'mel'][Math.floor(i / 6)], role = RNAMES[i % 6], size = sizeRows[i % 6 === 2 ? 3 : i % 3 + 1][0]
    servers.push(mkServer({ id: 8100 + i, name: `${role}-${rg}-01`, size_slug: size, region: rg, image: ['ubuntu-24.04', 'debian-12', 'almalinux-9'][i % 3], vpc_id: 901 + Math.floor(i / 6), ip: `${IPB[Math.floor(i / 6)]}.${20 + (i % 6)}`, offsite: i % 6 === 2 }))
  }
  servers.push(
    mkServer({ id: 9001, name: 'win-app-01', size_slug: 'std-4vcpu', region: 'bne', image: 'windows-2022', vpc_id: 902, ip: '198.51.100.90', extraDisk: true }),
    mkServer({ id: 9002, name: 'legacy-gs1', size_slug: 'a-3040', region: 'mel', image: 'debian-12', vpc_id: 903, ip: '192.0.2.91' }),
    mkServer({ id: 9003, name: 'stopped-batch-01', size_slug: 'std-2vcpu', region: 'syd', image: 'ubuntu-24.04', vpc_id: 901, ip: '203.0.113.92', status: 'off', backups: false }),
    mkServer({ id: 9004, name: 'vpc-only-01', size_slug: 'std-1vcpu', region: 'syd', image: 'ubuntu-24.04', vpc_id: 901, public: false }),
    mkServer({ id: 9005, name: 'building-01', size_slug: 'std-1vcpu', region: 'syd', image: 'ubuntu-24.04', vpc_id: 901, ip: '203.0.113.94', status: 'new' }),
    mkServer({ id: 9006, name: 'ha-partner-a', size_slug: 'std-2vcpu', region: 'syd', image: 'ubuntu-24.04', vpc_id: 901, ip: '203.0.113.95', partner: 9007 }),
    mkServer({ id: 9007, name: 'ha-partner-b', size_slug: 'std-2vcpu', region: 'syd', image: 'ubuntu-24.04', vpc_id: 901, ip: '203.0.113.96', partner: 9006 }),
    mkServer({ id: 9008, name: 'a-very-long-server-name-that-should-truncate-in-the-list-and-header-views-01.internal.example.com.au', size_slug: 'std-1vcpu', region: 'syd', image: 'debian-12', vpc_id: 901, ip: '203.0.113.97' }),
    mkServer({ id: 9009, name: 'multi-ip-v6-01', size_slug: 'std-4vcpu', region: 'mel', image: 'almalinux-9', vpc_id: 903, ip: '192.0.2.98', extra_ips: ['192.0.2.99', '192.0.2.100'], v6: true, failover: ['192.0.2.150'] }),
    mkServer({ id: 9010, name: 'cpanel-host-01', size_slug: 'std-6vcpu', region: 'syd', image: 'cpanel-whm-rocky-8', vpc_id: 901, ip: '203.0.113.101' })
  )
  actions = new Map(); nextId = 50000; serverBackups = new Map(); fails = []; cfg = { updateVersion: null, empty: false, rejectAuth: false, unpaid: false, actionMs: 2500, actionOutcome: 'completed', latencyMs: 0 }
  servers.forEach((s, index) => {
    const list = s.next_backup_window ? [
      ['temporary', 'Before database upgrade', 1], ['daily', 'Nightly production baseline', 2],
      ['weekly', 'Weekly recovery checkpoint', 7], ['monthly', 'Monthly archive', 28]
    ].map(([type, name, days], i) => makeBackup(s, type, name, new Date(Date.now() - days * 86400000).toISOString(), 7101 + index * 10 + i)) : []
    setBackups(s, list)
  })
  keys = [['ops-laptop', true], ['deploy-ci', false], ['old-key-2024', false], ['a-key-with-a-particularly-long-name-to-test-wrapping-in-the-table', false]].map(([name, def], i) => mk('SshKeysResponse', 'ssh_keys', {
    id: 9100 + i, name, default: def, public_key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${'x'.repeat(30)}${i} ${name}@host`, fingerprint: `SHA256:${'abcdefghijklmnop'.repeat(2)}${i}`
  }))
  domains = ['example.com.au', 'atlas-demo.net', 'a-rather-long-domain-name-for-layout-testing.example.org'].map((name) => mk('DomainsResponse', 'domains', { name, ttl: 3600, id: name }))
  let rid = 6000
  const rec = (type, name, data, extra = {}) => mk('DomainRecordsResponse', 'domain_records', { id: rid++, type, name, data, ttl: 3600, priority: null, port: null, weight: null, flags: null, tag: null, ...extra })
  records = {}
  domains.forEach((d) => {
    records[d.name] = [rec('A', '@', '203.0.113.20'), rec('AAAA', '@', '2001:db8::20'), rec('CNAME', 'www', `${d.name}.`), rec('MX', '@', 'mail.example.net.', { priority: 10 }),
      rec('TXT', '@', 'v=spf1 include:_spf.example.net ~all'), rec('TXT', 'selector._domainkey', `v=DKIM1; k=rsa; p=${'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC'.repeat(6)}`),
      rec('SRV', '_sip._tcp', 'sip.example.net.', { priority: 5, port: 5060, weight: 10 }), rec('CAA', '@', 'letsencrypt.org', { flags: 0, tag: 'issue' }), rec('NS', '@', 'ns1.binarylane.com.au.')]
  })
  lbs = [0, 1, 2].map((i) => mk('LoadBalancersResponse', 'load_balancers', {
    id: 950 + i, name: `edge-${['syd', 'bne', 'mel'][i]}.example.com`, ip: `${IPB[i]}.10`, region: regions[[0, 1, 2][i]], status: 'active', server_ids: [8100 + i * 6, 8101 + i * 6],
    forwarding_rules: [{ entry_protocol: 'https', entry_port: 443, target_protocol: 'http', target_port: 8080 }, { entry_protocol: 'http', entry_port: 80, target_protocol: 'http', target_port: 8080 }],
    health_check: { protocol: 'https', path: '/health', port: 443, interval_seconds: 10, timeout_seconds: 5, unhealthy_threshold: 3, healthy_threshold: 2 }
  }))
  vpcs = [0, 1, 2].map((i) => mk('VpcsResponse', 'vpcs', { id: 901 + i, name: `production-${['syd', 'bne', 'mel'][i]}`, ip_range: `10.${20 + i}.0.0/16`, description: 'Application network', route_entries: [] }))
}
reset()

const firewall = (s) => {
  const i = s.id - 8100, r = (description, protocol, src, ports, action = 'accept') => ({ description, protocol, source_addresses: src, destination_addresses: ['0.0.0.0/0'], destination_ports: ports, action })
  const out = [r('Operations SSH', 'tcp', ['192.0.2.25/32'], ['22'])]
  if (i % 6 < 2) out.push(r('Public HTTPS', 'tcp', ['0.0.0.0/0'], ['443']))
  if (i % 6 === 2) out.push(r('PostgreSQL from app network', 'tcp', ['10.0.0.0/8'], ['5432']))
  if (s.id === 9003) return []
  out.push(r('Node exporter', 'tcp', ['192.0.2.25/32'], ['9100']), r('Default deny', 'all', ['0.0.0.0/0'], [], 'drop'))
  return out
}
const fwOverride = new Map()
const sample = (s, off = 0) => {
  const i = s.id % 100, ratio = [.36, .62, .81, .94, .25, .48][i % 6], wave = 1 + Math.sin(off * .32 + i) * .2
  return mk('SampleSetsResponse', 'sample_sets', {
    period: { start: new Date(Date.now() - (off + 1) * 300000).toISOString(), end: new Date(Date.now() - off * 300000).toISOString() },
    average: { cpu_usage_percent: s.vcpus * 100 * ratio * wave, cpu_usage_detailed: Array(s.vcpus).fill(100 * ratio * wave), memory_usage_bytes: s.memory * 1024 ** 2 * ratio, storage_usage_megabytes: s.disk * 1024 * (.35 + ratio * .4),
      network_incoming_kbps: 2500 + ratio * 18000 * wave, network_outgoing_kbps: 1200 + ratio * 14000 * wave, storage_read_kbps: 1000 + ratio * 23000 * wave, storage_write_kbps: 800 + ratio * 15000 * wave, storage_read_iops: 300 + ratio * 1500, storage_write_iops: 100 + ratio * 900 }
  })
}
function makeBackup(s, type, name, createdAt = nowIso(), id = nextId++) {
  const disks = s.disks.map((d, i) => ({ id: id * 10 + i, min_disk_size: d.size_gigabytes, size_gigabytes: d.size_gigabytes / 2, description: d.description }))
  return mk('BackupsResponse', 'backups', {
    id, name, created_at: createdAt, min_disk_size: disks.reduce((n, d) => n + d.min_disk_size, 0), type: 'backup', status: 'available',
    size_gigabytes: disks.reduce((n, d) => n + d.size_gigabytes, 0),
    backup_info: { type, server_id: s.id, offsite: type !== 'temporary' && s.selected_size_options.offsite_backups, locked: false, iso: false, backup_disks: disks }
  })
}
function setBackups(s, list) { serverBackups.set(s.id, list); s.backup_ids = list.map((b) => b.id) }
const backupsFor = (s) => serverBackups.get(s.id) || []
const backupImage = (id) => [...serverBackups.values()].flat().find((b) => b.id === id)
const isAttached = (id) => servers.some((s) => s.attached_backup?.id === id)
function backupPlan(s, body) {
  const list = backupsFor(s), strategy = body.replacement_strategy
  const replaceable = (b) => !b.backup_info.locked && !isAttached(b.id)
  if (strategy === 'specified') {
    const replace = list.find((b) => b.id === body.backup_id_to_replace)
    if (!replace) return { error: 'The specified backup does not belong to this server.' }
    if (!replaceable(replace)) return { error: 'The specified backup is locked or attached.' }
    return { type: replace.backup_info.type, replace }
  }
  if (!['none', 'oldest', 'newest'].includes(strategy)) return { error: 'Invalid backup replacement strategy.' }
  const type = body.backup_type
  if (!S.BackupSlot.enum.includes(type)) return { error: 'A valid backup_type is required.' }
  // Temporary backups have no configurable retention count. Scheduled slots use this server's options, not plan inclusions.
  const capacity = type === 'temporary' ? Infinity : s.selected_size_options[`${type}_backups`]
  if (!(capacity > 0)) return { error: `No ${type} backup slots are configured.` }
  const held = list.filter((b) => b.backup_info.type === type)
  if (held.length < capacity) return { type }
  if (strategy === 'none') return { error: `No free ${type} backup slots.` }
  const candidates = held.filter(replaceable).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const replace = strategy === 'oldest' ? candidates[0] : candidates.at(-1)
  return replace ? { type, replace } : { error: `No replaceable ${type} backups.` }
}
const invoices = Array.from({ length: 27 }, (_, i) => mk('InvoicesResponse', 'invoices', {
  invoice_id: 4000 + i, invoice_number: `INV-${20260 - i}`, amount: 40 + i * 3.3, tax: 3.6, created: new Date(Date.now() - i * 30 * 86400000).toISOString(), date_due: new Date(Date.now() - (i * 30 - 14) * 86400000).toISOString(),
  paid: i !== 0, refunded: false, reference: '', invoice_view_url: 'https://home.binarylane.com.au/invoice/' + i, invoice_download_url: 'https://home.binarylane.com.au/invoice/' + i + '.pdf', payment_failure_count: i === 0 ? 1 : 0, invoice_items: []
}))
const softwareFor = (slug) => /windows/.test(slug) ? [mk('SoftwaresResponse', 'software', { id: 5001, name: 'Remote Desktop SAL', description: 'Additional remote desktop user', enabled: true, price_monthly: 9.09, maximum_licence_count: 50, minimum_licence_count: 0, supported_operating_systems: ['windows-2022'] }), mk('SoftwaresResponse', 'software', { id: 5002, name: 'Windows Server Standard', description: '', enabled: true, price_monthly: 25, maximum_licence_count: 1, minimum_licence_count: 1, supported_operating_systems: ['windows-2022'] })]
  : /cpanel/.test(slug) ? [mk('SoftwaresResponse', 'software', { id: 5100, name: 'cPanel Pro', description: 'Up to 30 accounts', enabled: true, price_monthly: 38, maximum_licence_count: 1, minimum_licence_count: 1, supported_operating_systems: ['cpanel-whm-rocky-8'] })] : null

// ---------- actions ----------
function newAction(type, server, body) {
  const id = nextId++, a = { id, type, server_id: server?.id, body, startedAt: Date.now(), ms: cfg.actionMs, outcome: cfg.actionOutcome }
  actions.set(id, a)
  setTimeout(() => applyAction(a, server), a.ms)
  return id
}
function applyAction(a, server) {
  if (a.outcome !== 'completed' || !server || !servers.includes(server)) return
  const b = a.body || {}
  if (['power_on', 'reboot', 'power_cycle', 'boot'].includes(a.type)) server.status = 'active'
  if (['shutdown', 'power_off'].includes(a.type)) server.status = 'off'
  if (a.type === 'resize') {
    if (b.size) { server.size_slug = b.size; server.size = sizeBySlug(b.size); server.vcpus = server.size.vcpus; server.memory = server.size.memory; server.disk = server.size.disk }
    if (b.options?.memory) server.memory = b.options.memory
    if (b.options?.disk) server.disk = b.options.disk
  }
  if (a.type === 'take_backup') {
    const plan = backupPlan(server, b)
    if (plan.error) { a.outcome = 'errored'; a.error = plan.error; return }
    setBackups(server, [...backupsFor(server).filter((image) => image !== plan.replace), makeBackup(server, plan.type, b.label || 'Manual backup')])
  }
  if (a.type === 'attach_backup') server.attached_backup = { id: b.image, disk_identifiers: ['sdb'], attached_at: nowIso(), attachment_expires: null }
  if (a.type === 'detach_backup') server.attached_backup = null
  if (a.type === 'change_advanced_firewall_rules') fwOverride.set(server.id, b.firewall_rules || [])
}
function actionView(a) {
  const done = Date.now() - a.startedAt >= a.ms, server = servers.find((s) => s.id === a.server_id)
  const status = !done ? 'in-progress' : a.outcome === 'errored' ? 'errored' : 'completed'
  const base = mk('ActionsResponse', 'actions', {
    id: a.id, status, type: a.type, started_at: new Date(a.startedAt).toISOString(), completed_at: done ? new Date(a.startedAt + a.ms).toISOString() : null,
    resource_type: 'server', resource_id: a.server_id ?? 0, region: server?.region, region_slug: server?.region?.slug, title: a.type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    reason: 'Your request is being processed', progress: { current_step: done ? '' : 'Working', current_step_detail: null, percent_complete: done ? 100 : Math.min(90, Math.round((Date.now() - a.startedAt) / a.ms * 100)), completed_steps: done ? ['Working'] : [] },
    error_message: done && a.outcome === 'errored' ? a.error || 'The simulated action failed (mock server).' : null, result_data: null, blocking_invoice_id: null, user_interaction_required: null
  })
  return base
}

// ---------- HTTP ----------
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(status === 204 ? undefined : JSON.stringify(body)) }
const page = (list, q, key) => {
  if (cfg.empty && ['servers', 'domains', 'load_balancers', 'vpcs', 'ssh_keys', 'invoices', 'backups', 'domain_records', 'actions', 'licensed_software', 'members'].includes(key)) list = []
  const per = q.get('per_page') === '0' ? 0 : Number(q.get('per_page') || 20), pg = Number(q.get('page') || 1)
  const items = per === 0 ? [] : list.slice((pg - 1) * per, pg * per)
  return { [key]: items, links: {}, meta: { total: list.length } }
}
const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { try { r(JSON.parse(Buffer.concat(c).toString() || 'null')) } catch { r(null) } }) })

async function handleApi(req, res, u, body) {
  const p = u.pathname, m = req.method, q = u.searchParams
  let mt
  if (m === 'GET' && p === '/v2/account') return json(res, 200, { account: mk('AccountResponse', 'account', { email: 'operator@example.com', status: 'active', email_verified: true, two_factor_authentication_enabled: true, configured_payment_methods: ['credit-card'], additional_ipv4_limit: 64, tax_code: { name: 'GST', fixed_percent: 10 } }) })
  if (m === 'GET' && p === '/v2/account/keys') return json(res, 200, page(keys, q, 'ssh_keys'))
  if (m === 'POST' && p === '/v2/account/keys') { const k = mk('SshKeysResponse', 'ssh_keys', { id: nextId++, name: body.name, default: !!body.default, public_key: body.public_key, fingerprint: 'SHA256:newkey' }); if (k.default) { /* keep other defaults */ } keys.push(k); return json(res, 200, { ssh_key: k }) }
  if ((mt = p.match(/^\/v2\/account\/keys\/(\d+)$/))) {
    const k = keys.find((x) => x.id === +mt[1]); if (!k) return json(res, 404, { id: 'not_found', message: 'Key not found' })
    if (m === 'PUT') { k.name = body.name; if (body.default != null) k.default = body.default; return json(res, 200, { ssh_key: k }) }
    if (m === 'DELETE') { keys = keys.filter((x) => x !== k); return json(res, 204) }
  }
  if (m === 'GET' && p === '/v2/actions') return json(res, 200, page([...actions.values()].reverse().map(actionView), q, 'actions'))
  if ((mt = p.match(/^\/v2\/actions\/(\d+)$/)) && m === 'GET') { const a = actions.get(+mt[1]); return a ? json(res, 200, { action: actionView(a) }) : json(res, 404, { id: 'not_found', message: 'Action not found' }) }
  if (m === 'GET' && p === '/v2/customers/my/balance') return json(res, 200, { balance: mk('BalanceResponse', 'balance', { available_credit: 2480, balance: 2480, unbilled_total: 684.2, charges: [] }) })
  if (m === 'GET' && p === '/v2/customers/my/invoices') return json(res, 200, page(invoices, q, 'invoices'))
  if (m === 'GET' && p === '/v2/customers/my/unpaid-payment-failed-invoices') return json(res, 200, { invoices: cfg.unpaid ? [invoices[0]] : [] })
  if (m === 'GET' && p === '/v2/data_usages/current') return json(res, 200, { ...page([mk('DataUsagesResponse', 'data_usages', { transfer_gigabytes: 4096, current_transfer_usage_gigabytes: 1310.5, current_excess_transfer_gigabytes: 0 })], q, 'data_usages') })
  if (m === 'GET' && p === '/v2/domains') return json(res, 200, page(domains, q, 'domains'))
  if (m === 'GET' && p === '/v2/domains/nameservers') return json(res, 200, { local_nameservers: ['ns1.binarylane.com.au', 'ns2.binarylane.com.au', 'ns3.binarylane.com.au'] })
  if (m === 'POST' && p === '/v2/domains/refresh_nameserver_cache') return json(res, 204)
  if ((mt = p.match(/^\/v2\/domains\/([^/]+)\/records$/))) {
    const d = decodeURIComponent(mt[1]); if (!records[d]) return json(res, 404, { id: 'not_found', message: 'Domain not found' })
    if (m === 'GET') return json(res, 200, page(records[d], q, 'domain_records'))
    if (m === 'POST') { const r = mk('DomainRecordsResponse', 'domain_records', { id: nextId++, ttl: 3600, priority: null, port: null, weight: null, flags: null, tag: null, ...body }); records[d].push(r); return json(res, 200, { domain_record: r }) }
  }
  if ((mt = p.match(/^\/v2\/domains\/([^/]+)\/records\/(\d+)$/)) && m === 'DELETE') { const d = decodeURIComponent(mt[1]); records[d] = (records[d] || []).filter((r) => r.id !== +mt[2]); return json(res, 204) }
  if ((mt = p.match(/^\/v2\/domains\/([^/]+)$/)) && m === 'DELETE') { domains = domains.filter((x) => x.name !== decodeURIComponent(mt[1])); return json(res, 204) }
  if (m === 'GET' && p === '/v2/images') return json(res, 200, page(images, q, 'images'))
  if ((mt = p.match(/^\/v2\/images\/(\d+)$/))) {
    const image = backupImage(+mt[1]) || images.find((i) => i.id === +mt[1])
    if (!image) return json(res, 404, { id: 'not_found', message: 'Image not found' })
    if (m === 'GET') return json(res, 200, { image })
    if (m === 'PUT' && image.type === 'backup' && image.backup_info) {
      if (body?.locked != null) {
        if (image.backup_info.type === 'temporary' || isAttached(image.id)) return json(res, 400, { id: 'bad_request', message: 'Cannot lock or unlock temporary or attached backups.' })
        image.backup_info.locked = !!body.locked
      }
      if (body?.name != null) image.name = body.name
      return json(res, 200, { image })
    }
  }
  if (m === 'GET' && /^\/v2\/images\/\d+\/download$/.test(p)) return json(res, 200, { link: 'https://example.com/download/image.raw.gz' })
  if (m === 'GET' && p === '/v2/regions') return json(res, 200, page(regions, q, 'regions'))
  if (m === 'GET' && p === '/v2/sizes') {
    let list = sizes.map((s) => ({ ...s }))
    const image = q.get('image'), sid = q.get('server_id')
    if (image && /windows/.test(image)) list.forEach((s) => { if (['std-6vcpu', 'std-8vcpu'].includes(s.slug)) s.regions_out_of_stock = [...new Set([...s.regions_out_of_stock, 'bne'])] })
    if (image && /ubuntu/.test(image)) list.forEach((s) => { if (s.vcpus >= 4 && s.slug.startsWith('std')) s.regions_out_of_stock = [...new Set([...s.regions_out_of_stock, 'mel'])] })
    if (sid) { const sv = servers.find((s) => s.id === +sid); if (sv && sv.size_slug === retiredSize.slug) list.push({ ...retiredSize }) }
    return json(res, 200, page(list, q, 'sizes'))
  }
  if (m === 'GET' && p === '/v2/load_balancers') return json(res, 200, page(lbs, q, 'load_balancers'))
  if (m === 'POST' && p === '/v2/load_balancers') { const l = mk('LoadBalancersResponse', 'load_balancers', { id: nextId++, ip: '203.0.113.200', status: 'new', server_ids: [], ...body }); lbs.push(l); return json(res, 200, { load_balancer: l, links: {} }) }
  if ((mt = p.match(/^\/v2\/load_balancers\/(\d+)(\/servers)?$/))) {
    const l = lbs.find((x) => x.id === +mt[1]); if (!l) return json(res, 404, { id: 'not_found', message: 'Load balancer not found' })
    if (!mt[2] && m === 'GET') return json(res, 200, { load_balancer: l })
    if (!mt[2] && m === 'DELETE') { lbs = lbs.filter((x) => x !== l); return json(res, 204) }
    if (mt[2] && m === 'POST') { l.server_ids = [...new Set([...l.server_ids, ...(body?.server_ids || [])])]; return json(res, 204) }
    if (mt[2] && m === 'DELETE') { l.server_ids = l.server_ids.filter((i) => !(body?.server_ids || []).includes(i)); return json(res, 204) }
  }
  if (m === 'GET' && p === '/v2/vpcs') return json(res, 200, page(vpcs, q, 'vpcs'))
  if (m === 'POST' && p === '/v2/vpcs') { const v = mk('VpcsResponse', 'vpcs', { id: nextId++, ...body }); vpcs.push(v); return json(res, 200, { vpc: v }) }
  if ((mt = p.match(/^\/v2\/vpcs\/(\d+)(\/members)?$/))) {
    if (mt[2] && m === 'GET') return json(res, 200, page(servers.filter((s) => s.vpc_id === +mt[1]).map((s) => mk('VpcMembersResponse', 'members', { resource_id: s.id, resource_type: 'server', name: s.name })), q, 'members'))
    if (!mt[2] && m === 'DELETE') { vpcs = vpcs.filter((v) => v.id !== +mt[1]); return json(res, 204) }
  }
  if (m === 'GET' && p === '/v2/servers') return json(res, 200, page(servers, q, 'servers'))
  if (m === 'POST' && p === '/v2/servers') {
    const id = nextId++, s = mkServer({ id, name: body.name, size_slug: body.size, region: body.region, image: body.image, vpc_id: body.vpc_id || 901, ip: '203.0.113.' + (id % 200), status: 'new', backups: false,
      memory: body.options?.memory, disk: body.options?.disk, options: { ...(body.backups ? { daily_backups: 2 } : {}), ...body.options } })
    servers.push(s); setTimeout(() => { s.status = 'active' }, cfg.actionMs * 2); return json(res, 200, { server: s, links: {} })
  }
  if ((mt = p.match(/^\/v2\/servers\/(\d+)(\/.*)?$/))) {
    const s = servers.find((x) => x.id === +mt[1]), sub = mt[2] || ''
    if (!s) return json(res, 404, { id: 'not_found', message: 'Server not found' })
    if (sub === '' && m === 'GET') return json(res, 200, { server: s })
    if (sub === '' && m === 'DELETE') { servers = servers.filter((x) => x !== s); serverBackups.delete(s.id); return json(res, 204) }
    if (sub === '/actions' && m === 'GET') return json(res, 200, page([...actions.values()].filter((a) => a.server_id === s.id).reverse().map(actionView), q, 'actions'))
    if (sub === '/actions' && m === 'POST') {
      if (body?.type === 'take_backup') {
        const plan = backupPlan(s, body)
        if (plan.error) return json(res, 400, { id: 'bad_request', message: plan.error })
      }
      if (body?.type === 'attach_backup' && !backupImage(body.image)) return json(res, 400, { id: 'bad_request', message: 'Backup image not found.' })
      return json(res, 200, { action: actionView(actions.get(newAction(body?.type || 'unknown', s, body))) })
    }
    if (sub === '/advanced_firewall_rules') return json(res, 200, { firewall_rules: fwOverride.get(s.id) ?? firewall(s) })
    if (sub === '/available_advanced_features') return json(res, 200, { available_advanced_server_features: { advanced_features: ['emulated-hyperv', 'emulated-devices', 'driver-disk', 'cloud-init', 'emulated-tpm', 'unset-uuid', 'local-rtc', 'qemu-guest-agent', 'uefi-boot'], machine_types: ['pc_i440fx_7point2point1'], processor_models: [{ id: 0, name: 'Host default' }], video_devices: ['cirrus-logic', 'standard', 'virtio', 'virtio-wide'] } })
    if (sub === '/backups') return json(res, 200, page(backupsFor(s), q, 'backups'))
    if (sub === '/console') return json(res, 200, { console: { iframe: `https://api.binarylane.com.au/__console/${s.id}`, browser: `https://api.binarylane.com.au/__console/${s.id}`, width: 1024, height: 768, expiry: new Date(Date.now() + 600000).toISOString() } })
    if (sub === '/software') return json(res, 200, page(s.image.distribution === 'Windows' ? [mk('LicensedSoftwaresResponse', 'licensed_software', { licence_count: 2, incompatible: false, software: softwareFor('windows-2022')[0] })] : [], q, 'licensed_software'))
    if (sub === '/threshold_alerts') return json(res, 200, { threshold_alerts: ['cpu', 'memory-used', 'storage-used', 'data-transfer-used'].map((t, i) => mk('ThresholdAlertsResponse', 'threshold_alerts', { alert_type: t, name: t, unit: '%', description: '', enabled: i !== 3, value: [90, 85, 90, 80][i], current_value: [35, 62, 48, 12][i], last_raised: null, last_cleared: null })) })
    if (sub === '/user_data') return json(res, 200, { user_data: '#cloud-config\npackages:\n  - nginx\n  - prometheus-node-exporter\nruncmd:\n  - systemctl enable --now nginx\n' })
  }
  if ((mt = p.match(/^\/v2\/samplesets\/(\d+)(\/latest)?$/))) {
    const s = servers.find((x) => x.id === +mt[1]) || servers[0]
    const age = s.status === 'off' ? 12 : 0 // buckets of five minutes; the app treats a sample older than about 15 minutes as "not running"
    return mt[2] ? json(res, 200, { sample_set: sample(s, age) }) : json(res, 200, { sample_sets: Array.from({ length: 288 }, (_, i) => sample(s, age + 287 - i)), links: {}, meta: { total: 288 } })
  }
  if ((mt = p.match(/^\/v2\/software\/operating_system\/(.+)$/)) && m === 'GET') { const sw = softwareFor(decodeURIComponent(mt[1])); return sw ? json(res, 200, page(sw, q, 'software')) : json(res, 404, { id: 'not_found', message: 'No software' }) }
  if ((mt = p.match(/^\/v2\/actions\/(\d+)\/proceed$/))) return json(res, 204)
  appendFileSync(LOG, `UNHANDLED ${m} ${p}\n`)
  return json(res, 404, { id: 'not_found', message: `Mock: unhandled ${m} ${p}` })
}

const feedVersion = () => cfg.updateVersion || VERSION
const helpJson = (u) => u.pathname.endsWith('/suggest') ? { suggestions: ['how do I add an SSH key', 'how do I resize a server', 'what is a VPC'] }
  : { answer: 'This is a canned answer from the mock help service. Open the linked article for the full steps.', id: '42', results: [{ title: 'Adding an SSH key', url: 'https://support.binarylane.com.au/support/solutions/articles/1000000001-ssh-keys' }] }

const create = process.env.HTTP ? (h) => http.createServer(h) : (h) => https.createServer({ cert: readFileSync(process.env.CERT), key: readFileSync(process.env.KEY) }, h)
const server = create(async (req, res) => {
  const u = new URL(req.url, 'https://x'), host = (req.headers.host || '').split(':')[0], body = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) ? await readBody(req) : null
  appendFileSync(LOG, `${new Date().toISOString()} ${req.method} ${host}${u.pathname}${u.search} ${body ? JSON.stringify(body).slice(0, 300) : ''}\n`)
  if (cfg.latencyMs) await new Promise((r) => setTimeout(r, cfg.latencyMs))
  // control plane
  if (u.pathname.startsWith('/__mock/')) {
    if (u.pathname === '/__mock/reset') { reset(); fwOverride.clear(); return json(res, 200, { ok: true }) }
    if (u.pathname === '/__mock/config') { Object.assign(cfg, body || {}); return json(res, 200, cfg) }
    if (u.pathname === '/__mock/fail') { fails.push({ match: new RegExp(body.match), status: body.status || 500, count: body.count ?? 1 }); return json(res, 200, { ok: true }) }
    return json(res, 200, { requests: 'see log file' })
  }
  if (host === 'uai.adamhomenet.com') return u.pathname.endsWith('/feedback') ? json(res, 204) : json(res, 200, helpJson(u))
  if (host === 'github.com' || host === 'api.github.com') {
    if (u.pathname.endsWith('.atom')) { res.writeHead(200, { 'content-type': 'application/atom+xml' }); return res.end(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:github.com,2008:Repository/1/v${feedVersion()}</id><updated>2026-09-25T00:00:00Z</updated><link rel="alternate" type="text/html" href="https://github.com/termau/bldesk/releases/tag/v${feedVersion()}"/><title>${VERSION}</title></entry></feed>`) }
    if (u.pathname.endsWith('.deb')) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': DEB.length }); return res.end(DEB) }
    if (u.pathname.endsWith('.yml')) { res.writeHead(200, { 'content-type': 'text/yaml' }); return res.end(`version: ${feedVersion()}\nfiles:\n  - url: BLDesk-${feedVersion()}-linux-amd64.deb\n    sha512: ${DEB_SHA}\n    size: ${DEB.length}\npath: BLDesk-${feedVersion()}-linux-amd64.deb\nsha512: ${DEB_SHA}\nreleaseDate: '2026-09-25T00:00:00.000Z'\n`) }
    if (u.pathname.endsWith('/releases/latest')) return json(res, 200, { tag_name: `v${feedVersion()}`, prerelease: false, assets: [] })
    if (u.pathname.includes('/releases')) return json(res, 200, [{ tag_name: `v${feedVersion()}`, prerelease: false, assets: [] }])
    return json(res, 404, {})
  }
  if (u.pathname.startsWith('/__console/')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><body style="background:#111;color:#0f0;font-family:monospace"><h3>Mock console</h3></body></html>') }
  // BinaryLane API
  const auth = req.headers.authorization || ''
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  if (cfg.rejectAuth || auth !== `Bearer ${TOKEN}`) return json(res, 401, { id: 'unauthorized', message: 'Unauthorized (mock: token does not match).' })
  const f = fails.find((x) => x.count > 0 && x.match.test(u.pathname))
  if (f) { f.count--; return json(res, f.status, { id: f.status === 429 ? 'too_many_requests' : 'server_error', message: `Injected ${f.status}` }) }
  try { await handleApi(req, res, u, body) } catch (e) { appendFileSync(LOG, `ERROR ${req.method} ${u.pathname} ${e.stack}\n`); json(res, 500, { id: 'mock_error', message: String(e) }) }
})
server.listen(PORT, '127.0.0.1', () => console.log(`mock listening on ${server.address().port}`))
