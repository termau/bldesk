// Manual regression checks for the local fake API. No live token, API or Electron dependency.
import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { devNull } from 'node:os'
import { fileURLToPath } from 'node:url'

const spec = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8'))
let mock, base
const token = 'fictitious-token-for-mock-backup-regressions'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

before(async () => {
  mock = spawn(process.execPath, [fileURLToPath(new URL('./mock.mjs', import.meta.url))], {
    env: { ...process.env, HTTP: '1', PORT: '0', MOCK_TOKEN: token, LOG: devNull }, stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Mock did not start: ${output}`)), 5000)
    mock.stdout.on('data', (b) => {
      output += b
      const match = output.match(/mock listening on (\d+)/)
      if (match) { base = `http://127.0.0.1:${match[1]}`; clearTimeout(timer); resolve() }
    })
    mock.stderr.on('data', (b) => output += b)
    mock.once('error', (e) => { clearTimeout(timer); reject(e) })
    mock.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Mock exited ${code}: ${output}`)) })
  })
})

after(async () => {
  if (mock && mock.exitCode === null) { const exited = once(mock, 'exit'); mock.kill(); await exited }
})

async function request(path, body, method = body === undefined ? 'GET' : 'POST', status = 200) {
  const r = await fetch(base + path, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const data = r.status === 204 ? null : await r.json()
  assert.equal(r.status, status, JSON.stringify(data))
  return data
}
const backups = async (id = 8100) => (await request(`/v2/servers/${id}/backups?per_page=100`)).backups
const server = async (id = 8100) => (await request(`/v2/servers/${id}`)).server
const take = (body, id = 8100, status = 200) => request(`/v2/servers/${id}/actions`, { type: 'take_backup', ...body }, 'POST', status)
async function completed(response, outcome = 'completed') {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const { action } = await request(`/v2/actions/${response.action.id}`)
    if (action.status !== 'in-progress') { assert.equal(action.status, outcome, action.error_message); return action }
    await sleep(10)
  }
  assert.fail('Mock action did not finish')
}
beforeEach(async () => {
  await request('/__mock/reset', {})
  await request('/__mock/config', { actionMs: 15 })
})

const upload = (body, id = 9003, status = 200) => request(`/v2/servers/${id}/backups`, { url: 'https://example.com/image.img.zst', ...body }, 'POST', status)

test('the default download response matches ImageDownload and leaves backups and actions unchanged', async () => {
  const { validatorFor } = await import('./spec.mjs')
  const validate = validatorFor('/components/schemas/ImageDownloadResponse')
  const before = await backups(), multiDisk = await backups(9001), actionsBefore = await request('/v2/actions')
  assert.ok(before.length >= 2, 'two fixture backups are needed to check the returned image identity')
  assert.ok(multiDisk[0]?.backup_info.backup_disks.length > 1, 'a multi-disk backup is needed to check every returned disk')
  for (const image of [...before.slice(0, 2), multiDisk[0]]) {
    const response = await request(`/v2/images/${image.id}/download`)
    assert.ok(validate(response), JSON.stringify(validate.errors))
    assert.equal(response.link.id, image.id)
    assert.ok(Date.parse(response.link.expiry) > Date.now())
    assert.ok(response.link.disks.length > 0)
    assert.deepEqual(response.link.disks.map(disk => disk.id), image.backup_info.backup_disks.map(disk => disk.id))
    for (const disk of response.link.disks) {
      assert.equal(new URL(disk.compressed_url).protocol, 'https:')
      assert.equal(new URL(disk.raw_url).protocol, 'https:')
    }
  }
  assert.deepEqual(await backups(), before)
  assert.deepEqual(await backups(9001), multiDisk)
  assert.deepEqual(await request('/v2/actions'), actionsBefore)
})

test('URL imports queue upload_image and do not assume the request label names the returned image', async () => {
  const before = await backups(8100)
  const queued = await upload({ backup_type: 'temporary', replacement_strategy: 'none', label: 'Imported disk' })
  assert.equal(queued.action.type, 'upload_image')
  await completed(queued)
  const held = await backups(9003)
  assert.equal(held.length, 1)
  assert.equal(held[0].name, 'Imported image')
  assert.notEqual(held[0].name, 'Imported disk')
  assert.equal(held[0].backup_info.server_id, 9003)
  assert.deepEqual(await backups(8100), before)
})

test('URL import slot strategies none, oldest, newest and specified share protection and ownership checks', async () => {
  await completed(await upload({ backup_type: 'temporary', replacement_strategy: 'none' }))
  const held = await backups(9003)
  await upload({ backup_type: 'temporary', replacement_strategy: 'none' }, 9003, 400)
  assert.deepEqual(await backups(9003), held)
  for (const strategy of ['oldest', 'newest']) {
    const before = await backups(9003)
    await completed(await upload({ backup_type: 'temporary', replacement_strategy: strategy }))
    assert.equal((await backups(9003)).length, 1)
    assert.notEqual((await backups(9003))[0].id, before[0].id)
  }
  const target = (await backups(9003))[0]
  await completed(await upload({ replacement_strategy: 'specified', backup_id_to_replace: target.id, backup_type: target.backup_info.type, url: 'https://example.com/install.iso?download=1' }))
  assert.equal((await backups(9003))[0].backup_info.iso, true)
  await upload({ replacement_strategy: 'specified', backup_id_to_replace: (await backups(8100))[0].id }, 9003, 400)
  const daily = (await backups(8100)).find((b) => b.backup_info.type === 'daily')
  await request(`/v2/images/${daily.id}`, { locked: true }, 'PUT')
  await upload({ replacement_strategy: 'specified', backup_id_to_replace: daily.id }, 8100, 400)
  const temp = (await backups(9003))[0]
  await completed(await request('/v2/servers/9003/actions', { type: 'attach_backup', image: temp.id }))
  await upload({ replacement_strategy: 'specified', backup_id_to_replace: temp.id }, 9003, 400)
})

test('invalid URL imports and failed actions do not replace a held image', async () => {
  const before = await backups(8100)
  for (const url of ['', 'file:///image.img', 'ftp://example.com/disk.img']) await upload({ url, backup_type: 'temporary', replacement_strategy: 'oldest' }, 8100, 400)
  await upload({ label: 'a'.repeat(251), backup_type: 'temporary', replacement_strategy: 'oldest' }, 8100, 400)
  await request('/__mock/config', { actionOutcome: 'errored' })
  await completed(await upload({ backup_type: 'temporary', replacement_strategy: 'oldest' }, 8100), 'errored')
  assert.deepEqual(await backups(8100), before)
})

test('specified URL imports require the matching slot type and return field errors without queuing', async () => {
  const held = await backups(8100)
  const target = held.find((b) => b.backup_info.type === 'daily')
  const beforeActions = (await request('/v2/servers/8100/actions')).actions
  for (const type of [undefined, 'monthly']) {
    const result = await upload({ replacement_strategy: 'specified', backup_id_to_replace: target.id, ...(type ? { backup_type: type } : {}) }, 8100, 400)
    assert.equal(result.status, 400)
    assert.ok(result.errors['backup_type, backup_id_to_replace'].some((s) => s.includes('match')))
    assert.match(result.message, /backup_type/)
  }
  const badUrl = await upload({ url: 'ftp://example.com/image' }, 8100, 400)
  assert.ok(badUrl.errors.url)
  const badLabel = await upload({ label: 'x'.repeat(251), backup_type: 'daily', replacement_strategy: 'oldest' }, 8100, 400)
  assert.ok(badLabel.errors.label)
  assert.deepEqual((await request('/v2/servers/8100/actions')).actions, beforeActions)
  assert.deepEqual(await backups(8100), held)
  await completed(await upload({ replacement_strategy: 'specified', backup_id_to_replace: target.id, backup_type: 'daily' }, 8100))
  assert.equal((await backups(8100)).filter((b) => b.backup_info.type === 'daily').length, 1)
})

test('offered and retired plan backup options match the schema and the public snapshot in #198', async () => {
  const offered = (await request('/v2/sizes?per_page=100')).sizes
  const retired = (await request('/v2/sizes?server_id=9002&per_page=100')).sizes
  assert.ok(offered.length > 0)
  assert.ok(retired.some((s) => s.slug === 'a-3040'))
  for (const size of [...offered, ...retired, (await server(9002)).size]) {
    const o = size.options
    assert.equal(o.daily_backups, 0)
    assert.equal(o.weekly_backups, 0)
    assert.equal(o.monthly_backups, 0)
    assert.equal(o.backups_cost_per_backup_per_gigabyte, .05)
    assert.equal(o.offsite_backups_cost_per_gigabyte, .05)
    assert.deepEqual(Object.keys(o.offsite_backup_frequency_cost).sort(), spec.components.schemas.OffsiteBackupFrequencyCost.required.toSorted())
    assert.ok(Object.values(o.offsite_backup_frequency_cost).every((n) => n === 0))
  }
})

test('backups have all four real slot types, unique IDs and matching owning server metadata', async () => {
  const fleet = (await request('/v2/servers?per_page=100')).servers
  const seen = new Set()
  for (const s of fleet) {
    const list = await backups(s.id)
    assert.deepEqual(s.backup_ids, list.map((b) => b.id))
    if (s.id === 9003) { assert.deepEqual(list, []); assert.equal(s.selected_size_options.daily_backups, 0); assert.equal(s.next_backup_window, null); continue }
    assert.deepEqual(list.map((b) => b.backup_info.type).toSorted(), spec.components.schemas.BackupSlot.enum.toSorted())
    for (const b of list) {
      assert.ok(!seen.has(b.id)); seen.add(b.id)
      assert.equal(b.backup_info.server_id, s.id)
      assert.equal(b.backup_info.iso, false)
      assert.equal(b.backup_info.locked, false)
      assert.equal(b.backup_info.offsite, b.backup_info.type !== 'temporary' && s.selected_size_options.offsite_backups)
      assert.equal(b.backup_info.backup_disks.length, s.disks.length)
      for (const d of b.backup_info.backup_disks) {
        for (const key of spec.components.schemas.BackupDisk.required) assert.ok(Object.hasOwn(d,key))
      }
    }
  }
})

test('temporary backups stay on their server, including a server with no scheduled slots', async () => {
  const otherBefore = await backups(8101)
  await completed(await take({ backup_type: 'temporary', replacement_strategy: 'none', label: 'Isolated manual backup' }, 9003))
  const created = await backups(9003)
  assert.equal(created.length, 1)
  assert.equal(created[0].name, 'Isolated manual backup')
  assert.equal(created[0].backup_info.type, 'temporary')
  assert.equal(created[0].backup_info.server_id, 9003)
  assert.deepEqual((await server(9003)).backup_ids, created.map((b) => b.id))
  assert.deepEqual(await backups(8101), otherBefore)
  await take({ backup_type: 'daily', replacement_strategy: 'oldest' }, 9003, 400)
})

test('a newly created server starts empty and its requested retention controls subsequent backups', async () => {
  const { server: created } = await request('/v2/servers', {
    name: 'mock-backup-regression', size: 'std-1vcpu', image: 'ubuntu-24.04', region: 'syd',
    options: { disk: 60, daily_backups: 1, weekly_backups: 0, monthly_backups: 0, offsite_backups: true }
  })
  assert.deepEqual(created.backup_ids, [])
  assert.ok(created.features.includes('backups'))
  await completed(await take({ backup_type: 'daily', replacement_strategy: 'oldest', label: 'First' }, created.id))
  await completed(await take({ backup_type: 'daily', replacement_strategy: 'oldest', label: 'Second' }, created.id))
  const list = await backups(created.id)
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 'Second')
  assert.equal(list[0].backup_info.server_id, created.id)
  assert.equal(list[0].backup_info.offsite, true)
  assert.equal(list[0].min_disk_size, 60)
})

test('a temporary slot with no scheduled backups needs a replacement strategy once occupied', async () => {
  await request('/__mock/config', { temporaryLimit: 99 }) // this is about the slot, not the two-in-seven-days limit below
  const options = (await server(9003)).selected_size_options
  await completed(await take({ backup_type: 'temporary', replacement_strategy: 'none', label: 'First' }, 9003))
  const first = await backups(9003)
  await take({ backup_type: 'temporary', replacement_strategy: 'none' }, 9003, 400)
  assert.deepEqual(await backups(9003), first)
  await completed(await take({ backup_type: 'temporary', replacement_strategy: 'oldest', label: 'Oldest replacement' }, 9003))
  const second = await backups(9003)
  assert.equal(second.length, 1)
  assert.notEqual(second[0].id, first[0].id)
  await completed(await take({ backup_type: 'temporary', replacement_strategy: 'specified', backup_id_to_replace: second[0].id, label: 'Named replacement' }, 9003))
  const third = await backups(9003)
  assert.equal(third.length, 1)
  assert.equal(third[0].name, 'Named replacement')
  assert.notEqual(third[0].id, second[0].id)
  assert.deepEqual((await server(9003)).selected_size_options, options)
})

test('resize backs up into an empty temporary slot, then requires explicit replacement', async () => {
  const before = await server(9003)
  const resize = (memory, pre_action_backup, status = 200) => request('/v2/servers/9003/actions', {
    type: 'resize', options: { memory }, pre_action_backup: { type: 'take_backup', backup_type: 'temporary', ...pre_action_backup }
  }, 'POST', status)
  await completed(await resize(before.memory + 1024, { replacement_strategy: 'none' }))
  const first = await backups(9003)
  assert.equal(first.length, 1)
  assert.equal((await server(9003)).memory, before.memory + 1024)
  await resize(before.memory, { replacement_strategy: 'none' }, 400)
  assert.equal((await server(9003)).memory, before.memory + 1024)
  assert.deepEqual(await backups(9003), first)
  await completed(await resize(before.memory, { replacement_strategy: 'specified', backup_id_to_replace: first[0].id }))
  assert.equal((await server(9003)).memory, before.memory)
  const replaced = await backups(9003)
  assert.equal(replaced.length, 1)
  assert.notEqual(replaced[0].id, first[0].id)
  assert.deepEqual((await server(9003)).selected_size_options, before.selected_size_options)
})

test('a third temporary backup in seven days is refused however it is asked for; scheduled slots and other servers are not limited', async () => {
  const before = await server(8100)
  await completed(await take({ backup_type: 'temporary', replacement_strategy: 'oldest', label: 'One' }))
  await completed(await take({ backup_type: 'temporary', replacement_strategy: 'oldest', label: 'Two' }))
  const held = await backups()
  const temporary = held.find((b) => b.backup_info.type === 'temporary')
  await take({ backup_type: 'temporary', replacement_strategy: 'oldest' }, 8100, 400)
  await take({ backup_type: 'temporary', replacement_strategy: 'specified', backup_id_to_replace: temporary.id }, 8100, 400)
  await request('/v2/servers/8100/actions', {
    type: 'resize', options: { memory: before.memory + 1024 }, pre_action_backup: { type: 'take_backup', backup_type: 'temporary', replacement_strategy: 'oldest' }
  }, 'POST', 400)
  assert.equal((await server()).memory, before.memory)
  assert.deepEqual(await backups(), held)
  await completed(await take({ backup_type: 'daily', replacement_strategy: 'oldest', label: 'Daily is not limited' }))
  await completed(await take({ backup_type: 'temporary', replacement_strategy: 'none', label: 'Another server' }, 9003))
})

test('an ordinary temporary take and a pre-action replacement exhaust the allowance with the observed refusal body', async () => {
  const before = await server(9003)
  assert.deepEqual(before.backup_ids, [])
  for (const field of ['daily_backups', 'weekly_backups', 'monthly_backups']) assert.equal(before.selected_size_options[field], 0)
  assert.equal(before.selected_size_options.offsite_backups, false)
  await completed(await take({ backup_type: 'temporary', replacement_strategy: 'none' }, 9003))
  const first = await backups(9003)
  await completed(await request('/v2/servers/9003/actions', {
    type: 'resize', options: { memory: before.memory + 1024 },
    pre_action_backup: { type: 'take_backup', backup_type: 'temporary', replacement_strategy: 'oldest' }
  }))
  const held = await backups(9003)
  assert.equal(held.length, 1)
  assert.notEqual(held[0].id, first[0].id)
  assert.equal(held[0].backup_info.type, 'temporary')
  assert.equal(held[0].status, 'available')
  const resized = await server(9003)
  assert.equal(resized.memory, before.memory + 1024)
  assert.equal(resized.disk, before.disk)
  const actions = (await request('/v2/servers/9003/actions')).actions
  const refusal = await take({ backup_type: 'temporary', replacement_strategy: 'oldest' }, 9003, 400)
  assert.deepEqual(refusal, {
    type: 'https://tools.ietf.org/html/rfc7231#section-6.5.1',
    title: 'One or more validation errors occurred', status: 400,
    errors: { backup_type: ['Temporary backup limit of 2 per 7 day period has been reached.'] },
    message: 'backup_type: Temporary backup limit of 2 per 7 day period has been reached.'
  })
  assert.deepEqual((await request('/v2/servers/9003/actions')).actions, actions)
  assert.deepEqual(await backups(9003), held)
  assert.deepEqual(await server(9003), resized)
})

test('a resize over the temporary allowance returns the nested refusal without adding an action or changing state', async () => {
  await completed(await take({ backup_type: 'temporary', replacement_strategy: 'none' }, 9003))
  await completed(await take({ backup_type: 'temporary', replacement_strategy: 'oldest' }, 9003))
  const held = await backups(9003)
  const before = await server(9003)
  const actions = (await request('/v2/servers/9003/actions')).actions
  for (const replacement of [
    { replacement_strategy: 'oldest' },
    { replacement_strategy: 'specified', backup_id_to_replace: held[0].id }
  ]) {
    const refusal = await request('/v2/servers/9003/actions', {
      type: 'resize', options: { memory: before.memory + 1024, disk: before.disk + 10 },
      pre_action_backup: { type: 'take_backup', backup_type: 'temporary', ...replacement }
    }, 'POST', 400)
    assert.deepEqual(refusal, {
      type: 'https://tools.ietf.org/html/rfc7231#section-6.5.1',
      title: 'One or more validation errors occurred', status: 400,
      errors: { 'pre_action_backup.backup_type': ['Temporary backup limit of 2 per 7 day period has been reached.'] },
      message: 'pre_action_backup.backup_type: Temporary backup limit of 2 per 7 day period has been reached.'
    })
    await sleep(30)
    assert.deepEqual((await request('/v2/servers/9003/actions')).actions, actions)
    assert.deepEqual(await backups(9003), held)
    assert.deepEqual(await server(9003), before)
  }
})

test('none fills free scheduled slots and then rejects without changing any backup', async () => {
  for (const label of ['Free slot one', 'Free slot two']) {
    await completed(await take({ backup_type: 'daily', replacement_strategy: 'none', label }))
  }
  const full = await backups()
  assert.equal(full.filter((b) => b.backup_info.type === 'daily').length, 3)
  await take({ backup_type: 'daily', replacement_strategy: 'none', label: 'Must not appear' }, 8100, 400)
  assert.deepEqual(await backups(), full)
})

test('oldest uses a free slot first, then replaces only the oldest backup of that type', async () => {
  const before = await backups(), original = before.find((b) => b.backup_info.type === 'daily')
  await completed(await take({ backup_type: 'daily', replacement_strategy: 'oldest', label: 'Free first' }))
  assert.ok((await backups()).some((b) => b.id === original.id))
  await completed(await take({ backup_type: 'daily', replacement_strategy: 'oldest', label: 'Last free slot' }))
  const full = await backups()
  await completed(await take({ backup_type: 'daily', replacement_strategy: 'oldest', label: 'Replacement' }))
  const after = await backups()
  assert.equal(after.length, full.length)
  assert.ok(!after.some((b) => b.id === original.id))
  assert.equal(after.find((b) => b.name === 'Replacement').backup_info.type, 'daily')
  assert.deepEqual(after.filter((b) => b.backup_info.type !== 'daily'), before.filter((b) => b.backup_info.type !== 'daily'))
})

test('newest replaces the newest backup when its scheduled slots are full', async () => {
  const original = (await backups()).find((b) => b.backup_info.type === 'weekly')
  await completed(await take({ backup_type: 'weekly', replacement_strategy: 'none', label: 'Newer weekly' }))
  await completed(await take({ backup_type: 'weekly', replacement_strategy: 'newest', label: 'Replace newest' }))
  const list = await backups()
  assert.ok(list.some((b) => b.id === original.id))
  assert.ok(!list.some((b) => b.name === 'Newer weekly'))
  assert.equal(list.filter((b) => b.backup_info.type === 'weekly').length, 2)
})

test('a specified take requires its matching slot type and rejects another server\'s ID', async () => {
  const before = await backups(), target = before.find((b) => b.backup_info.type === 'monthly')
  for (const backup_type of [undefined, 'temporary']) {
    await take({ replacement_strategy: 'specified', backup_id_to_replace: target.id, backup_type }, 8100, 400)
    assert.deepEqual(await backups(), before)
  }
  await completed(await take({ replacement_strategy: 'specified', backup_id_to_replace: target.id, backup_type: 'monthly', label: 'Named replacement' }))
  const list = await backups()
  assert.equal(list.length, before.length)
  assert.ok(!list.some((b) => b.id === target.id))
  assert.equal(list.find((b) => b.name === 'Named replacement').backup_info.type, 'monthly')
  await take({ replacement_strategy: 'specified', backup_id_to_replace: (await backups(8101))[0].id }, 8100, 400)
  assert.deepEqual(await backups(), list)
})

test('locked and attached images cannot be replaced; oldest skips a locked candidate', async () => {
  const monthly = (await backups()).find((b) => b.backup_info.type === 'monthly')
  await request(`/v2/images/${monthly.id}`, { locked: true }, 'PUT')
  await take({ backup_type: 'monthly', replacement_strategy: 'oldest' }, 8100, 400)
  await take({ replacement_strategy: 'specified', backup_id_to_replace: monthly.id }, 8100, 400)
  await request(`/v2/images/${monthly.id}`, { locked: false }, 'PUT')
  await completed(await request('/v2/servers/8101/actions', { type: 'attach_backup', image: monthly.id }))
  await take({ backup_type: 'monthly', replacement_strategy: 'oldest' }, 8100, 400)
  await take({ replacement_strategy: 'specified', backup_id_to_replace: monthly.id }, 8100, 400)
  await completed(await request('/v2/servers/8101/actions', { type: 'detach_backup' }))
  await completed(await take({ backup_type: 'monthly', replacement_strategy: 'oldest', label: 'Detached replacement' }))
  const daily = (await backups()).find((b) => b.backup_info.type === 'daily')
  await request(`/v2/images/${daily.id}`, { locked: true }, 'PUT')
  for (const label of ['Unlocked older', 'Unlocked newer']) await completed(await take({ backup_type: 'daily', replacement_strategy: 'none', label }))
  await completed(await take({ backup_type: 'daily', replacement_strategy: 'oldest', label: 'Skip locked' }))
  assert.ok((await backups()).some((b) => b.id === daily.id))
  assert.ok(!(await backups()).some((b) => b.name === 'Unlocked older'))
})

test('a simulated failed action leaves backup state unchanged', async () => {
  const before = await backups()
  await request('/__mock/config', { actionOutcome: 'errored' })
  const { action } = await take({ backup_type: 'temporary', replacement_strategy: 'oldest', label: 'Failed' })
  await sleep(40)
  assert.equal((await request(`/v2/actions/${action.id}`)).action.status, 'errored')
  assert.deepEqual(await backups(), before)
})

test('reset clears new backups and an old pending action cannot leak into the reset fleet', async () => {
  await completed(await take({ backup_type: 'temporary', replacement_strategy: 'oldest', label: 'Added' }))
  await request('/__mock/config', { actionMs: 75 })
  await take({ backup_type: 'temporary', replacement_strategy: 'oldest', label: 'Pending before reset' })
  await request('/__mock/reset', {})
  await sleep(100)
  assert.equal((await backups()).length, 4)
  assert.ok((await backups()).every((b) => !['Added', 'Pending before reset'].includes(b.name)))
})

test('firewall writes are checked against the rule schema, and a write lands when its action completes', async () => {
  const write = (rules, status = 200) => request('/v2/servers/8100/actions', { type: 'change_advanced_firewall_rules', firewall_rules: rules }, 'POST', status)
  const rule = { action: 'accept', protocol: 'tcp', source_addresses: ['0.0.0.0/0'], destination_addresses: ['0.0.0.0/0'], destination_ports: ['22'] }
  const { destination_addresses, ...noDestination } = rule
  assert.match((await write([noDestination], 400)).message, /destination_addresses/)
  assert.match((await write([{ ...rule, destination_addresses: [] }], 400)).message, /destination_addresses/)
  assert.match((await write([{ ...rule, action: 'allow' }], 400)).message, /action/)
  // A hundred and one rules are refused, as the live API does; a hundred are accepted (below).
  assert.equal((await write(Array(101).fill(rule), 400)).message, 'Firewall rules are limited to 100 per server; 101 were submitted.')
  const before = (await request('/v2/servers/8100/advanced_firewall_rules')).firewall_rules

  // The change is applied when the action completes, not when it is queued.
  await request('/__mock/config', { actionMs: 60 })
  const queued = await write([rule])
  assert.deepEqual((await request('/v2/servers/8100/advanced_firewall_rules')).firewall_rules, before)
  await sleep(100)
  assert.deepEqual((await request('/v2/servers/8100/advanced_firewall_rules')).firewall_rules, [rule])
  assert.equal((await request(`/v2/actions/${queued.action.id}`)).action.status, 'completed')
  assert.deepEqual((await write([], 200)).action.type, 'change_advanced_firewall_rules')
  await sleep(100)
  assert.equal((await write(Array(100).fill(rule), 200)).action.type, 'change_advanced_firewall_rules')
})

for (const outcome of ['completed', 'errored']) {
  test(`a zero-delay ${outcome} action remains pending until its callback settles`, async () => {
    const before = await server()
    await request('/__mock/config', { actionMs: 0, actionOutcome: outcome })
    const queued = await request('/v2/servers/8100/actions', { type: 'power_off' })
    assert.equal(queued.action.status, 'in-progress')
    assert.equal(queued.action.completed_at, null)
    assert.equal(queued.action.error_message, null)
    assert.ok(Number.isFinite(queued.action.progress.percent_complete))
    assert.ok(queued.action.progress.percent_complete < 100)
    const settled = await completed(queued, outcome)
    assert.ok(Date.parse(settled.completed_at) >= Date.parse(settled.started_at))
    assert.equal(settled.progress.percent_complete, 100)
    assert.equal((await server()).status, outcome === 'completed' ? 'off' : before.status)
    if (outcome === 'errored') assert.match(settled.error_message, /simulated action failed/)
  })
}


test('a server that already has more than 100 rules may keep, edit or reduce them but not exceed what it has', async () => {
  const write = (rules, status = 200) => request('/v2/servers/8100/actions', { type: 'change_advanced_firewall_rules', firewall_rules: rules }, 'POST', status)
  const rule = (i) => ({ action: 'accept', protocol: 'tcp', source_addresses: ['192.0.2.1/32'], destination_addresses: ['0.0.0.0/0'], destination_ports: [String(1000 + i)] })
  const rules = (n) => Array.from({ length: n }, (_, i) => rule(i))
  await request('/__mock/reset', {})
  await request('/__mock/config', { actionMs: 20 })
  // The write cannot make such a server: 101 is refused when it has fewer.
  assert.match((await write(rules(101), 400)).message, /limited to 100 per server; 101 were submitted/)
  await request('/__mock/firewall', { server_id: 8100, firewall_rules: rules(110) })
  assert.equal((await request('/v2/servers/8100/advanced_firewall_rules')).firewall_rules.length, 110)
  // Kept, edited or reduced: accepted, though above 100.
  assert.equal((await write(rules(110))).action.type, 'change_advanced_firewall_rules')
  assert.equal((await write(rules(105))).action.type, 'change_advanced_firewall_rules')
  await sleep(60)
  assert.equal((await request('/v2/servers/8100/advanced_firewall_rules')).firewall_rules.length, 105)
  // Not grown beyond what it has now (105, no longer 110).
  assert.match((await write(rules(106), 400)).message, /105 this server already has; 106 were submitted/)
  assert.equal((await write(rules(105))).action.type, 'change_advanced_firewall_rules')
  await sleep(60)
  // Reduced to 100, the server is an ordinary one again: 101 is refused with the usual text.
  assert.equal((await write(rules(100))).action.type, 'change_advanced_firewall_rules')
  await sleep(60)
  assert.equal((await write(rules(101), 400)).message, 'Firewall rules are limited to 100 per server; 101 were submitted.')
  await request('/__mock/reset', {})
})
test('network changes that restart the server report BinaryLane\'s steps while they run, and land when they complete', async () => {
  await request('/__mock/config', { actionMs: 900 })
  const before = await server(8100)
  assert.notEqual(before.vpc_id, 902)
  const queued = await request('/v2/servers/8100/actions', { type: 'change_network', vpc_id: 902 })
  assert.equal(queued.action.progress.current_step, 'Shutting down server')
  await sleep(450)
  const mid = (await request(`/v2/actions/${queued.action.id}`)).action
  assert.equal(mid.status, 'in-progress')
  assert.equal(mid.progress.current_step, 'Moving server to destination VPC')
  assert.deepEqual(mid.progress.completed_steps, ['Shutting down server'])
  assert.equal((await server(8100)).status, 'active', 'the status stays active while it restarts')
  assert.equal((await server(8100)).vpc_id, before.vpc_id, 'the move lands when the action completes')
  await sleep(600)
  const done = await completed(queued)
  assert.deepEqual(done.progress.completed_steps, ['Shutting down server', 'Moving server to destination VPC', 'Starting server'])
  const moved = await server(8100)
  assert.equal(moved.vpc_id, 902)
  assert.match(moved.networks.v4.find((n) => n.type === 'private').ip_address, /^10\.21\./)
  await request('/__mock/config', { actionMs: 15 })
  await completed(await request('/v2/servers/8100/actions', { type: 'change_network', vpc_id: null }))
  assert.equal((await server(8100)).vpc_id, null)
})

test('the separate private interface and the private IPv4 change restart the server too, in two steps', async () => {
  const steps = async (body) => (await completed(await request('/v2/servers/8100/actions', body))).progress.completed_steps
  assert.deepEqual(await steps({ type: 'change_separate_private_network_interface', enabled: true }), ['Shutting down server', 'Starting server'])
  assert.equal((await server(8100)).networks.separate_private_network_interface, true)
  const current = (await server(8100)).networks.v4.find((n) => n.type === 'private').ip_address
  assert.deepEqual(await steps({ type: 'change_vpc_ipv4', current_ipv4_address: current, new_ipv4_address: '10.20.9.9' }), ['Shutting down server', 'Starting server'])
  assert.equal((await server(8100)).networks.v4.find((n) => n.type === 'private').ip_address, '10.20.9.9')
})

test('a move into a VPC that does not exist fails and leaves the server where it was', async () => {
  const before = (await server(8100)).vpc_id
  const action = await completed(await request('/v2/servers/8100/actions', { type: 'change_network', vpc_id: 424242 }), 'errored')
  assert.match(action.error_message, /not found/)
  assert.equal((await server(8100)).vpc_id, before)
})

test('proceed replaces the original timer before applying an action', async () => {
  const before = await server()
  await request('/__mock/config', { actionMs: 30, interaction: 'continue-after-ping-failure' })
  const queued = await request('/v2/servers/8100/actions', { type: 'shutdown' })
  await request(`/v2/actions/${queued.action.id}/proceed`, { proceed: true }, 'POST', 204)
  await sleep(80)
  const pending = (await request(`/v2/actions/${queued.action.id}`)).action
  assert.equal(pending.status, 'in-progress')
  assert.equal(pending.completed_at, null)
  assert.equal((await server()).status, before.status)
  await completed(queued)
  assert.equal((await server()).status, 'off')
})

test('answering after the original timer fired keeps the action pending until the resumed action settles', async () => {
  const before = await server()
  await request('/__mock/config', { actionMs: 15, interaction: 'continue-after-ping-failure' })
  const queued = await request('/v2/servers/8100/actions', { type: 'shutdown' })
  await sleep(60) // The original timer has fired while the action is waiting.
  assert.equal((await request(`/v2/actions/${queued.action.id}`)).action.status, 'in-progress')
  await request(`/v2/actions/${queued.action.id}/proceed`, { proceed: true }, 'POST', 204)
  await sleep(100) // The resumed action takes 400 ms.
  const pending = (await request(`/v2/actions/${queued.action.id}`)).action
  assert.equal(pending.status, 'in-progress')
  assert.equal(pending.completed_at, null)
  assert.equal((await server()).status, before.status)
  await completed(queued)
  assert.equal((await server()).status, 'off')
})

test('an action can stop and ask a question, and is answered at /proceed', async () => {
  await request('/__mock/config', { actionMs: 15, interaction: 'continue-after-ping-failure' })
  const { action } = await request('/v2/servers/8100/actions', { type: 'reboot' }, 'POST')
  await sleep(60)
  const waiting = (await request(`/v2/actions/${action.id}`)).action
  assert.equal(waiting.status, 'in-progress')
  assert.equal(waiting.completed_at, null)
  assert.equal(waiting.user_interaction_required.interaction_type, 'continue-after-ping-failure')
  // Other actions are not asked anything.
  const rename = await request('/v2/servers/8100/actions', { type: 'rename', name: 'x' }, 'POST')
  await sleep(60)
  assert.equal((await request(`/v2/actions/${rename.action.id}`)).action.user_interaction_required, null)
  await request(`/v2/actions/${action.id}/proceed`, { proceed: true }, 'POST', 204)
  await sleep(500)
  const done = (await request(`/v2/actions/${action.id}`)).action
  assert.equal(done.status, 'completed')
  assert.equal(done.user_interaction_required, null)
  const declined = await request('/v2/servers/8100/actions', { type: 'shutdown' }, 'POST')
  await request(`/v2/actions/${declined.action.id}/proceed`, { proceed: false }, 'POST', 204)
  await sleep(500)
  assert.equal((await request(`/v2/actions/${declined.action.id}`)).action.status, 'errored')
})

test('list responses carry the reference\'s links.pages (#237)', async () => {
  const { spec, pathRegexes, validatorFor, esc } = await import('./spec.mjs')
  const routes = ['/v2/servers', '/v2/account/keys', '/v2/actions', '/v2/vpcs', '/v2/load_balancers', '/v2/domains', '/v2/domains/example.com.au/records',
    '/v2/customers/my/invoices', '/v2/images', '/v2/sizes', '/v2/regions', '/v2/servers/8100/backups', '/v2/servers/8100/software',
    '/v2/data_usages/current', '/v2/vpcs/901/members', '/v2/servers/8100/actions']
  for (const route of routes) {
    const body = await request(route)
    assert.ok(body.links && typeof body.links.pages === 'object', `${route}: links.pages is missing (links: ${JSON.stringify(body.links)})`)
    // Whatever else in a response differs from the reference, `links` must not.
    const hit = pathRegexes.find((x) => x.re.test(route))
    const schema = spec.paths[hit.p].get.responses['200'].content['application/json'].schema
    const validate = validatorFor(schema.$ref ? schema.$ref.replace(/^#/, '') : `/paths/${esc(hit.p)}/get/responses/200/content/application~1json/schema`)
    validate(body)
    const linkErrors = (validate.errors ?? []).filter((e) => e.instancePath === '/links' || e.instancePath.startsWith('/links/'))
    assert.deepEqual(linkErrors, [], route)
  }
})

test('a created server answers with links.pages too', async () => {
  const created = await request('/v2/servers', { name: 'links-check-01', size: 'std-1vcpu', region: 'syd', image: 'ubuntu-24.04' })
  assert.ok(created.links && typeof created.links.pages === 'object')
})

test('a second account (extraToken) sees only its own server (#138)', async () => {
  await request('/__mock/config', { extraToken: 'second-token-for-the-mock-test' })
  const get = (path) => fetch(base + path, { headers: { authorization: 'Bearer second-token-for-the-mock-test' } })
  const list = await (await get('/v2/servers')).json()
  assert.deepEqual(list.servers.map((s) => s.id), [9101])
  assert.equal((await get('/v2/servers/9101')).status, 200)
  assert.equal((await get('/v2/servers/8100')).status, 404)
  assert.equal((await get('/v2/servers/8100/backups')).status, 404)
  // The first account is unchanged.
  assert.ok((await request('/v2/servers')).servers.length > 1)
})

test('backup_settings is reported, and change_backup_schedule changes only what is sent and answers 202 with no body', async () => {
  const { backup_settings: first } = await server(8100)
  assert.deepEqual(Object.keys(first).sort(), ['backup_day_of_month', 'backup_day_of_week', 'backup_hour_of_day', 'offsite_backup_settings'])
  const post = (b) => fetch(`${base}/v2/servers/8100/actions`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'change_backup_schedule', ...b }) })
  const ok = await post({ backup_hour_of_day: 5 })
  assert.equal(ok.status, 202)
  assert.equal(await ok.text(), '', 'no action to follow, as the live API answers')
  const { backup_settings: second } = await server(8100)
  assert.deepEqual(second, { ...first, backup_hour_of_day: 5 }, 'the hour changed and the days did not')
  for (const bad of [{ backup_hour_of_day: 24 }, { backup_hour_of_day: -1 }, { backup_hour_of_day: 2.5 }, { backup_day_of_week: 7 }, { backup_day_of_month: 29 }, { backup_day_of_month: 0 }]) {
    assert.equal((await post(bad)).status, 400, JSON.stringify(bad))
  }
  assert.deepEqual((await server(8100)).backup_settings, second, 'a refused change leaves the schedule alone')
  const edge = await post({ backup_hour_of_day: 0, backup_day_of_week: 6, backup_day_of_month: 28 })
  assert.equal(edge.status, 202)
  assert.deepEqual((await server(8100)).backup_settings, { ...first, backup_hour_of_day: 0, backup_day_of_week: 6, backup_day_of_month: 28 })
})
