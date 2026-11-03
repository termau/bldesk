import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true }
}).outputText
const providerCode = compile('../src/renderer/src/context/ActionTrackerContext.tsx')
const logCode = compile('../src/renderer/src/lib/changelog.ts')
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const action = (id = 73001, status = 'in-progress', type = 'reboot') => ({
  id, type, status, resource_id: 8100, resource_type: 'server', started_at: '2026-11-03T00:00:00Z', completed_at: null
})

function fixture(confirmPowerState) {
  const storage = new Map(), writes = [], polls = [], notices = [], invalidations = [], timers = new Map(), timerDelays = new Map(), stateChanges = []
  const window = { dispatchEvent() {}, bldeskApi: { sendNotification: n => notices.push(n) } }
  const logModule = { exports: {} }
  runInNewContext(logCode, { module: logModule, exports: logModule.exports, window, CustomEvent,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) } })
  const log = logModule.exports
  const slots = [], effects = [], layouts = []
  let cursor = 0, rendered, client = { account: 'fixture-a' }, mounted = true
  function queueEffect(queue, fn, deps) {
    const at = cursor++, old = slots[at]
    if (old && deps.every((d, i) => Object.is(d, old.deps[i]))) return
    queue.push({ at, old, fn, deps })
  }
  function commitEffects(queue, layout = false) {
    const pending = queue.splice(0)
    // React cleans up every changed effect before running any of their bodies.
    for (const { old } of pending) old?.cleanup?.()
    for (const { at, fn, deps } of pending) slots[at] = { deps, fn, layout, cleanup: fn() }
  }
  // Execute the production provider with explicit hook/effect turns. Real React mounting is covered by the GUI fixture.
  const hooks = {
    createContext: () => ({ Provider: 'provider' }),
    createElement: (type, props) => ({ type, props }),
    useContext: () => null,
    useRef(value) { const at = cursor++; return slots[at] ??= { current: value } },
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = value; return [slots[at], next => {
      slots[at] = typeof next === 'function' ? next(slots[at]) : next
      stateChanges.push(slots[at])
    }] },
    useMemo(fn, deps) {
      const at = cursor++, old = slots[at]
      if (old && deps.every((d, i) => Object.is(d, old.deps[i]))) return old.value
      const value = fn(); slots[at] = { deps, value }; return value
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps) },
    useEffect: (fn, deps) => queueEffect(effects, fn, deps),
    useLayoutEffect: (fn, deps) => queueEffect(layouts, fn, deps)
  }
  const queryClient = { invalidateQueries: value => invalidations.push(value) }
  const provider = { exports: {} }
  runInNewContext(providerCode, { module: provider, exports: provider.exports, window, AbortController, Date,
    setTimeout: (fn, ms) => { const id = Symbol(); timers.set(id, fn); timerDelays.set(id, ms); return id },
    clearTimeout: id => { timers.delete(id); timerDelays.delete(id) },
    require(name) {
      if (name === 'react') return { __esModule: true, default: hooks, ...hooks }
      if (name === '@tanstack/react-query') return { useQueryClient: () => queryClient }
      if (name === '../lib/changelog') return { ...log, updateChange: (id, patch, profile) => {
        writes.push({ id, patch: { ...patch }, profile }); return log.updateChange(id, patch, profile)
      } }
      if (name === '../lib/failures') return { clearFailures() {} }
      if (name === '../api/queries') return {
        describeActionFailure: () => 'Fixture action failure',
        pollActionToSettled: (api, id, options) => {
          const gate = deferred(); polls.push({ api, id, options, gate })
          const abort = () => gate.reject(new DOMException('Aborted', 'AbortError'))
          if (options.signal?.aborted) abort()
          else options.signal?.addEventListener('abort', abort, { once: true })
          if (options.initial?.status === 'completed') gate.resolve({ state: 'completed', action: options.initial })
          return gate.promise
        }
      }
      throw new Error(`Unexpected import: ${name}`)
    }
  })
  function render({ passive = true } = {}) {
    assert.ok(mounted); cursor = 0
    rendered = provider.exports.ActionTrackerProvider({ client, confirmPowerState, children: null })
    commitEffects(layouts, true)
    if (passive) commitEffects(effects)
    return rendered.props.value
  }
  log.setChangeLogProfile('fixture-a'); render()
  async function record(profile = 'fixture-a', source = 'ui') {
    return log.recordChange({ label: 'Reboot', target: { kind: 'server', id: 8100, name: 'fixture-server' },
      severity: 'destructive', source }, profile)
  }
  return { polls, writes, notices, invalidations, timers, timerDelays, stateChanges, record, log, view: render,
    fireTimer(id) { const fn = timers.get(id); assert.equal(typeof fn, 'function'); timers.delete(id); timerDelays.delete(id); fn() },
    switchProfile(profile, nextClient = { account: profile }, options) { log.setChangeLogProfile(profile); client = nextClient; return render(options) },
    flushPassive: () => commitEffects(effects),
    replayEffects() {
      const pending = slots.filter(slot => slot?.fn)
      for (const slot of pending) slot.cleanup?.()
      for (const layout of [true, false]) for (const slot of pending.filter(slot => slot.layout === layout)) slot.cleanup = slot.fn()
    },
    discardRender() {
      assert.equal(effects.length + layouts.length, 0)
      const saved = slots.slice(), previous = client, output = rendered
      client = { account: 'discarded-fixture' }; cursor = 0
      provider.exports.ActionTrackerProvider({ client, confirmPowerState, children: null })
      slots.splice(0, slots.length, ...saved); effects.length = 0; layouts.length = 0
      client = previous; rendered = output
    },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.() },
    finish(index = 0, state = 'completed') { polls[index].gate.resolve({ state, action: action(polls[index].id, state) }) },
    entries: profile => log.listChanges(profile) }
}

for (const outcome of ['completed', 'errored', 'lost']) test(`shared action updates both History entries: ${outcome}`, async () => {
  const f = fixture(), first = await f.record(), second = await f.record('fixture-a', 'palette')
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  f.view().track(action(), 'Reboot', 'fixture-server', second)
  assert.equal(f.polls.length, 1)
  let rows = await f.entries('fixture-a')
  assert.ok(rows.every(row => row.actionId === 73001 && row.outcome === 'submitted'))
  if (outcome === 'lost') f.polls[0].gate.reject(new Error('Fixture poll lost'))
  else f.finish(0, outcome)
  await flush()
  rows = await f.entries('fixture-a')
  assert.equal(rows.length, 2)
  assert.ok(rows.every(row => row.outcome === outcome))
  assert.equal(f.view().tracked.length, 1)
  assert.equal(f.notices.length, outcome === 'lost' ? 0 : 1)
  f.unmount()
})

test('duplicate registration links an entry only once; a watch can start without a History id', async () => {
  const f = fixture(), id = await f.record()
  f.view().track(action(), 'Reboot')
  for (let i = 0; i < 3; i++) f.view().track(action(), 'Reboot', 'fixture-server', id)
  f.finish(); await flush()
  f.view().track(action(), 'Reboot', 'fixture-server', id)
  assert.equal(f.polls.length, 1)
  assert.equal(f.writes.filter(w => w.id === id && w.patch.actionId === 73001).length, 1)
  assert.equal(f.writes.filter(w => w.id === id && w.patch.outcome === 'completed').length, 1)
  f.unmount()
})

for (const outcome of ['completed', 'errored', 'lost']) test(`a late joiner receives ${outcome} without another poll or notification`, async () => {
  const f = fixture(), first = await f.record(), second = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  if (outcome === 'lost') f.polls[0].gate.reject(new Error('Fixture poll lost'))
  else f.finish(0, outcome)
  await flush()
  f.view().track(action(), 'Reboot', 'fixture-server', second)
  await flush()
  assert.equal(f.polls.length, 1)
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === outcome))
  assert.equal(f.notices.length, outcome === 'lost' ? 0 : 1)
  f.unmount()
})

for (const cleanup of ['switch', 'unmount']) test(`${cleanup} closes every pending entry in its originating profile`, async () => {
  const f = fixture(), first = await f.record(), second = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  f.view().track(action(), 'Reboot', 'fixture-server', second)
  if (cleanup === 'switch') f.switchProfile('fixture-b')
  else f.unmount()
  assert.ok(f.polls[0].options.signal.aborted)
  await flush()
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === 'lost'))
  assert.ok((await f.entries('fixture-a')).every(row => /stopped following/.test(row.detail)))
  if (cleanup === 'switch') assert.equal(f.view().tracked.length, 0)
  assert.equal((await f.entries('fixture-b')).length, 0)
  f.finish(); await flush()
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === 'lost'))
  if (cleanup === 'switch') f.unmount()
})

test('an aborted old watch cannot delete the new account watch for the same action id', async () => {
  const f = fixture(), old = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', old)
  f.switchProfile('fixture-b')
  const first = await f.record('fixture-b'), second = await f.record('fixture-b')
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  f.polls[0].options.onProgress({ ...action(), progress: { percent_complete: 99 } })
  assert.notEqual(f.view().tracked[0].percentComplete, 99, 'Old account progress must not update the new watch')
  f.finish(0); await flush()
  f.view().track(action(), 'Reboot', 'fixture-server', second)
  assert.equal(f.polls.length, 2)
  f.finish(1); await flush()
  assert.ok((await f.entries('fixture-b')).every(row => row.outcome === 'completed'))
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === 'lost'))
  f.unmount()
})

test('a stale callback arriving after a profile switch is linked as lost without starting a poll', async () => {
  const f = fixture(), id = await f.record(), stale = f.view().track
  f.switchProfile('fixture-b')
  stale(action(), 'Reboot', 'fixture-server', id)
  await flush()
  assert.equal(f.polls.length, 0)
  assert.equal((await f.entries('fixture-a'))[0].outcome, 'lost')
  assert.equal((await f.entries('fixture-b')).length, 0)
  f.unmount()
})

test('power-state detail reaches all entries, including a joiner after settlement', async () => {
  const power = deferred(), f = fixture(() => power.promise), first = await f.record(), second = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  f.finish(); await flush()
  f.view().track(action(), 'Reboot', 'fixture-server', second)
  power.resolve('on'); await flush()
  const third = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', third)
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === 'completed' && row.detail === 'Server is running.'))
  assert.equal(f.polls.length, 1)
  f.unmount()
})

test('shutdown signal detail reaches both entries and a late joiner without claiming the server is off', async () => {
  const f = fixture(), first = await f.record(), second = await f.record()
  const shutdown = action(73001, 'in-progress', 'shutdown')
  f.view().track(shutdown, 'Shut down', 'fixture-server', first)
  f.view().track(shutdown, 'Shut down', 'fixture-server', second)
  f.polls[0].gate.resolve({ state: 'completed', action: { ...shutdown, status: 'completed' } })
  await flush()
  const third = await f.record()
  f.view().track(shutdown, 'Shut down', 'fixture-server', third)
  const rows = await f.entries('fixture-a')
  assert.equal(rows.length, 3)
  for (const row of rows) {
    assert.equal(row.outcome, 'completed')
    assert.match(row.detail, /^Shutdown signal sent\./)
    assert.match(row.detail, /once its OS halts/)
    assert.notEqual(row.detail, 'Server is off.')
  }
  assert.equal(f.polls.length, 1)
  assert.equal(f.notices.length, 1)
  assert.match(f.view().tracked[0].detail, /^Shutdown signal sent\./)
  f.unmount()
})

test('profile changes preserve completed outcomes and discard late power observations', async () => {
  const power = deferred(), f = fixture(() => power.promise), id = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', id)
  f.finish(); await flush()
  f.view()
  assert.equal(f.timers.size, 1)
  f.switchProfile('fixture-b')
  assert.equal(f.timers.size, 0)
  power.resolve('off'); await flush()
  const row = (await f.entries('fixture-a'))[0]
  assert.equal(row.outcome, 'completed')
  assert.equal(row.detail, undefined)
  assert.equal((await f.entries('fixture-b')).length, 0)
  f.unmount()
})

test('a queued old toast timer cannot dismiss a new client action with the same id', async () => {
  const f = fixture(), first = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  f.finish(); await flush(); f.view()
  const [oldTimer] = f.timers.values()
  assert.equal(typeof oldTimer, 'function')
  f.switchProfile('fixture-b')
  const second = await f.record('fixture-b')
  f.view().track(action(), 'Reboot', 'fixture-server', second)
  assert.equal(f.view().tracked[0].state, 'running')
  oldTimer()
  assert.notEqual(f.view().tracked[0].dismissed, true)
  assert.equal(f.polls[1].options.signal.aborted, false)
  f.finish(1); await flush(); f.view()
  assert.equal(f.timers.size, 1)
  oldTimer()
  assert.equal(f.view().tracked.length, 1, 'The old timer must also leave the new completed toast alone')
  f.fireTimer(f.timers.keys().next().value)
  assert.equal(f.view().tracked.length, 0)
  assert.equal(f.polls[1].options.signal.aborted, true)
  assert.equal((await f.entries('fixture-b'))[0].outcome, 'completed')
  f.unmount()
})

test('the current eight-second timer removes the completed toast and retires its watch', async () => {
  const f = fixture(), first = await f.record(), second = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  f.view().track(action(), 'Reboot', 'fixture-server', second)
  f.finish(); await flush(); f.view()
  assert.equal(f.timers.size, 1)
  const [timer] = f.timers.keys()
  assert.equal(f.timerDelays.get(timer), 8000)
  f.fireTimer(timer)
  assert.equal(f.view().tracked.length, 0)
  assert.equal(f.timers.size, 0)
  assert.equal(f.polls[0].options.signal.aborted, true)
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === 'completed'))
  const third = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', third)
  assert.equal(f.polls.length, 2, 'A later registration starts a fresh watch after expiry')
  f.finish(1); await flush(); f.unmount()
})

test('other action progress does not replace or extend an existing completed-toast timer', async () => {
  const f = fixture(), first = await f.record(), second = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  f.finish(); await flush(); f.view()
  const [timer] = f.timers.keys()
  assert.ok(timer)
  f.view().track(action(73002), 'Reboot', 'fixture-server', second)
  for (const percent_complete of [10, 20, 30]) {
    f.polls[1].options.onProgress({ ...action(73002), progress: { percent_complete } })
    f.view()
    assert.equal(f.timers.size, 1)
    assert.equal(f.timers.keys().next().value, timer)
  }
  f.fireTimer(timer)
  assert.deepEqual(Array.from(f.view().tracked, row => row.actionId), [73002])
  assert.equal(f.polls[1].options.signal.aborted, false)
  f.finish(1); await flush(); f.unmount()
})

test('a callback retained after unmount cannot start a poll', async () => {
  const f = fixture(), id = await f.record(), stale = f.view().track
  f.unmount()
  stale(action(), 'Reboot', 'fixture-server', id)
  assert.equal(f.polls.length, 0)
  assert.equal((await f.entries('fixture-a'))[0].outcome, 'lost')
})

test('StrictMode effect cleanup and reactivation leave the mounted scope usable', async () => {
  const f = fixture()
  f.replayEffects()
  const id = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', id)
  assert.equal(f.polls.length, 1)
  f.finish(); await flush()
  assert.equal((await f.entries('fixture-a'))[0].outcome, 'completed')
  f.unmount()
})

test('a discarded render cannot stop the still-committed client', async () => {
  const f = fixture(), id = await f.record(), track = f.view().track
  f.discardRender()
  track(action(), 'Reboot', 'fixture-server', id)
  assert.equal(f.polls.length, 1)
  f.finish(); await flush()
  assert.equal((await f.entries('fixture-a'))[0].outcome, 'completed')
  f.unmount()
})

test('old callbacks cannot start tracking between a client commit and passive cleanup', async () => {
  const f = fixture(), id = await f.record(), stale = f.view().track
  f.switchProfile('fixture-b', { account: 'fixture-b' }, { passive: false })
  stale(action(), 'Reboot', 'fixture-server', id)
  assert.equal(f.polls.length, 0)
  assert.equal((await f.entries('fixture-a'))[0].outcome, 'lost')
  f.flushPassive(); f.unmount()
})

for (const outcome of ['completed', 'errored']) test(`old ${outcome} settlement before passive cleanup is closed as Lost track`, async () => {
  const f = fixture(), first = await f.record(), second = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  f.view().track(action(), 'Reboot', 'fixture-server', second)
  f.switchProfile('fixture-b', { account: 'fixture-b' }, { passive: false })
  assert.equal(f.polls[0].options.signal.aborted, false, 'Passive cleanup has not run yet')
  const updates = f.stateChanges.length, notices = f.notices.length
  f.finish(0, outcome); await flush()
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === 'submitted'))
  assert.equal(f.stateChanges.length, updates)
  assert.equal(f.notices.length, notices)
  f.flushPassive()
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === 'lost'))
  assert.equal((await f.entries('fixture-b')).length, 0)
  f.unmount()
})

test('old progress before passive cleanup cannot update the current client view', async () => {
  const f = fixture(), id = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', id)
  f.switchProfile('fixture-b', { account: 'fixture-b' }, { passive: false })
  assert.equal(f.polls[0].options.signal.aborted, false)
  const updates = f.stateChanges.length
  f.polls[0].options.onProgress({ ...action(), progress: { percent_complete: 99 } })
  assert.equal(f.stateChanges.length, updates)
  f.flushPassive()
  assert.equal((await f.entries('fixture-a'))[0].outcome, 'lost')
  f.finish(); await flush(); f.unmount()
})

test('old power observation before passive cleanup cannot rewrite a settled entry or notify the new client', async () => {
  const power = deferred(), f = fixture(() => power.promise), id = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', id)
  f.finish(); await flush(); f.view()
  f.switchProfile('fixture-b', { account: 'fixture-b' }, { passive: false })
  assert.equal(f.polls[0].options.signal.aborted, false)
  const updates = f.stateChanges.length, notices = f.notices.length, writes = f.writes.length
  power.resolve('off'); await flush()
  assert.equal(f.stateChanges.length, updates)
  assert.equal(f.notices.length, notices)
  assert.equal(f.writes.length, writes)
  f.flushPassive()
  const [row] = await f.entries('fixture-a')
  assert.equal(row.outcome, 'completed')
  assert.equal(row.detail, undefined)
  assert.equal((await f.entries('fixture-b')).length, 0)
  f.unmount()
})

test('two profiles using the same client retain their own History entries on one shared watch', async () => {
  const f = fixture(), first = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  f.switchProfile('fixture-b', f.polls[0].api)
  const second = await f.record('fixture-b')
  f.view().track(action(), 'Reboot', 'fixture-server', second)
  f.finish(); await flush()
  assert.equal(f.polls.length, 1)
  for (const profile of ['fixture-a', 'fixture-b']) {
    const rows = await f.entries(profile)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].profileId, profile)
    assert.equal(rows[0].outcome, 'completed')
  }
  f.unmount()
})

test('already-completed input and concurrent callers settle together', async () => {
  const f = fixture(), first = await f.record(), second = await f.record()
  f.view().track(action(73001, 'completed'), 'Reboot', 'fixture-server', first)
  f.view().track(action(73001, 'completed'), 'Reboot', 'fixture-server', second)
  await flush()
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === 'completed'))
  assert.equal(f.polls.length, 1)
  f.unmount()
})

for (const state of ['awaiting-interaction', 'blocked-by-invoice']) test(`shared entries remain Submitted while ${state}`, async () => {
  const f = fixture(), first = await f.record(), second = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  f.finish(0, state); await flush()
  f.view().track(action(), 'Reboot', 'fixture-server', second)
  assert.equal(f.polls.length, 2, 'The same watch resumes polling the stalled action')
  assert.equal(f.view().tracked[0].state, state)
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === 'submitted'))
  f.finish(1); await flush()
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === 'completed'))
  f.unmount()
})

test('different action ids keep independent outcomes', async () => {
  const f = fixture(), first = await f.record(), second = await f.record()
  f.view().track(action(73001), 'Reboot', 'fixture-server', first)
  f.view().track(action(73002), 'Reboot', 'fixture-server', second)
  f.finish(0); f.finish(1, 'errored'); await flush()
  const rows = await f.entries('fixture-a')
  assert.equal(rows.find(row => row.id === first).outcome, 'completed')
  assert.equal(rows.find(row => row.id === second).outcome, 'errored')
  assert.equal(f.polls.length, 2)
  f.unmount()
})

test('dismissing a running toast keeps all entries followed; a settled dismissal retires the watch', async () => {
  const f = fixture(), first = await f.record(), second = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', first)
  f.view().dismiss(73001)
  f.view().track(action(), 'Reboot', 'fixture-server', second)
  assert.equal(f.polls[0].options.signal.aborted, false)
  f.finish(); await flush()
  assert.ok((await f.entries('fixture-a')).every(row => row.outcome === 'completed'))
  f.view().dismiss(73001)
  assert.equal(f.polls[0].options.signal.aborted, true)
  const third = await f.record()
  f.view().track(action(), 'Reboot', 'fixture-server', third)
  assert.equal(f.polls.length, 2)
  f.finish(1); await flush()
  f.unmount()
})
