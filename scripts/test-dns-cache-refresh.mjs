import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import createClient from 'openapi-fetch'
import { QueryClient, MutationObserver, onlineManager } from '@tanstack/react-query'
import { ApiError, apiFailure } from '../src/renderer/src/api/errors.ts'

// Exercise the production hook and click handler with real mutation-cache state, not a second busy-flag implementation.
const querySource = readFileSync(new URL('../src/renderer/src/api/queries.ts', import.meta.url), 'utf8')
const queries = ts.createSourceFile('queries.ts', querySource, ts.ScriptTarget.Latest, true)
const hookNames = ['dnsCacheRefreshMutationKey', 'useDnsCacheRefreshMutation']
const declarations = hookNames.map(name => {
  const declaration = queries.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  assert.ok(declaration, `${name} must exist`)
  return declaration.getText(queries)
})
const uiSource = readFileSync(new URL('../src/renderer/src/components/dns/DnsManager.tsx', import.meta.url), 'utf8')
const ui = ts.createSourceFile('DnsManager.tsx', uiSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers = []
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ui) === 'handleFlushCache') handlers.push(node.initializer.getText(ui))
  ts.forEachChild(node, visit)
}
visit(ui)
assert.equal(handlers.length, 1)
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const hookCode = compile(declarations.join('\n'))
const handlerCode = compile(`export const run = ${handlers[0]}`)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await sleep(5) }
  assert.fail('Mutation did not settle')
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const response = (status = 204, body) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' }
})

function fixture() {
  // Prove the operation opts out even if a host QueryClient enables mutation retries.
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 2, retryDelay: 0, gcTime: Infinity } } })
  const requests = [], notices = [], failures = [], views = []
  let reply = () => response()
  const module = { exports: {} }
  runInNewContext(hookCode, { module, exports: module.exports, apiFailure, Error, useMutation: options => options })
  const client = profile => createClient({ baseUrl: 'https://dns-fixture.invalid', fetch: async request => {
    requests.push({ profile, method: request.method, path: new URL(request.url).pathname })
    return reply()
  } })
  function view(profile = 'fixture-a', api = client(profile), observer) {
    const options = module.exports.useDnsCacheRefreshMutation(api, profile)
    if (observer) observer.setOptions(options)
    else observer = new MutationObserver(queryClient, options)
    const unsubscribe = views.find(v => v.observer === observer)?.unsubscribe ?? observer.subscribe(() => {})
    const key = module.exports.dnsCacheRefreshMutationKey(profile)
    const handler = { exports: {} }
    runInNewContext(handlerCode, {
      module: handler, exports: handler.exports, client: api, queryClient, refreshKey: key,
      refreshCache: { mutateAsync: () => observer.mutate() },
      window: { bldeskApi: { sendNotification: notice => notices.push(notice) } },
      notifyFailure: (title, error) => failures.push({ title, error })
    })
    const v = { run: handler.exports.run, observer, unsubscribe, pending: () => queryClient.isMutating({ mutationKey: key, exact: true }) }
    views.push(v)
    return v
  }
  return { queryClient, requests, notices, failures, client, view,
    reply: fn => { reply = fn },
    close: () => { views.forEach(v => v.unsubscribe()); queryClient.clear() } }
}

test('same-tick clicks and a remounted view share one pending refresh', async () => {
  const f = fixture(), gate = deferred(), first = f.view()
  try {
    f.reply(() => gate.promise)
    first.run(); first.run()
    assert.equal(first.pending(), 1)
    first.unsubscribe()
    const remounted = f.view()
    assert.equal(remounted.pending(), 1)
    remounted.run()
    await until(() => f.requests.length === 1)
    assert.deepEqual(f.requests, [{ profile: 'fixture-a', method: 'POST', path: '/v2/domains/refresh_nameserver_cache' }])
    gate.resolve(response())
    await until(() => remounted.pending() === 0)
    assert.equal(f.failures.length, 0)
    assert.equal(f.notices.length, 1)
    remounted.run()
    await until(() => f.requests.length === 2 && remounted.pending() === 0)
    assert.equal(f.notices.length, 2)
  } finally { f.close() }
})

test('a successful refresh reports success once and releases the control', async () => {
  const f = fixture(), v = f.view()
  try {
    v.run(); v.run()
    await until(() => f.requests.length === 1 && v.pending() === 0)
    assert.equal(f.notices.length, 1)
    assert.equal(f.notices[0].title, 'DNS Cache Flushed')
    assert.equal(f.failures.length, 0)
  } finally { f.close() }
})

for (const [status, body, reason] of [
  [400, { title: 'Bad Request', status: 400, detail: 'Fixture validation failed.', errors: { domain: ['Fixture domain unavailable.'] } }, 'Fixture domain unavailable.'],
  [429, { detail: 'Fixture refresh already in progress.' }, 'Fixture refresh already in progress.'],
  [400, undefined, 'HTTP 400'],
  [429, undefined, 'HTTP 429']
]) {
  test(`HTTP ${status} ${body ? 'with a reason' : 'without a body'} fails once, releases and allows a later request`, async () => {
    const f = fixture(), v = f.view()
    try {
      f.reply(() => response(status, body))
      v.run()
      await until(() => f.failures.length === 1 && v.pending() === 0)
      await sleep(20)
      assert.equal(f.requests.length, 1)
      assert.equal(f.notices.length, 0)
      assert.equal(f.failures[0].title, 'Flush failed')
      assert.ok(f.failures[0].error instanceof ApiError)
      assert.equal(f.failures[0].error.status, status)
      assert.ok(f.failures[0].error.message.includes(reason))
      f.reply(() => response())
      v.run()
      await until(() => f.notices.length === 1 && v.pending() === 0)
      assert.equal(f.requests.length, 2)
    } finally { f.close() }
  })
}

test('a transport rejection is not retried and does not leave the control busy', async () => {
  const f = fixture(), v = f.view()
  try {
    f.reply(() => { throw new TypeError('Fixture connection lost.') })
    v.run()
    await until(() => f.failures.length === 1 && v.pending() === 0)
    await sleep(20)
    assert.equal(f.requests.length, 1)
    assert.equal(f.notices.length, 0)
    assert.equal(f.failures[0].error.message, 'Fixture connection lost.')
    f.reply(() => response())
    v.run()
    await until(() => f.notices.length === 1 && v.pending() === 0)
    assert.equal(f.requests.length, 2)
  } finally { f.close() }
})

test('an offline click fails now and is not queued to run when connectivity returns', async () => {
  const f = fixture(), v = f.view(), wasOnline = onlineManager.isOnline()
  f.queryClient.mount()
  try {
    onlineManager.setOnline(false)
    f.reply(() => { throw new TypeError('Fixture offline connection.') })
    v.run()
    await until(() => f.failures.length === 1 && v.pending() === 0)
    assert.equal(f.requests.length, 1)
    assert.equal(v.observer.getCurrentResult().isPaused, false)
    assert.equal(f.notices.length, 0)
    onlineManager.setOnline(true)
    await sleep(20)
    assert.equal(f.requests.length, 1)
    f.reply(() => response())
    v.run()
    await until(() => f.notices.length === 1 && v.pending() === 0)
    assert.equal(f.requests.length, 2)
  } finally { f.close(); f.queryClient.unmount(); onlineManager.setOnline(wasOnline) }
})

test('two profiles have independent pending keys even before an account-switch cache clear', async () => {
  const f = fixture(), a = deferred(), b = deferred(), first = f.view(), second = f.view('fixture-b')
  try {
    f.reply(() => a.promise); first.run()
    await until(() => f.requests.length === 1)
    assert.equal(first.pending(), 1)
    assert.equal(second.pending(), 0)
    f.reply(() => b.promise); second.run()
    await until(() => f.requests.length === 2)
    assert.equal(first.pending(), 1)
    assert.equal(second.pending(), 1)
    a.resolve(response())
    await until(() => first.pending() === 0)
    assert.equal(second.pending(), 1)
    b.resolve(response())
    await until(() => second.pending() === 0)
    assert.deepEqual(f.requests.map(r => r.profile), ['fixture-a', 'fixture-b'])
  } finally { f.close() }
})

test('a failure after leaving DNS is still reported in the originating account', async () => {
  const f = fixture(), gate = deferred(), first = f.view()
  try {
    f.reply(() => gate.promise); first.run()
    await until(() => f.requests.length === 1)
    first.unsubscribe()
    gate.resolve(response(429, { detail: 'Fixture refresh already in progress.' }))
    await until(() => f.failures.length === 1)
    assert.equal(f.notices.length, 0)
    const remounted = f.view()
    assert.equal(remounted.pending(), 0)
  } finally { f.close() }
})

for (const [oldStatus, oldBody] of [[204, undefined], [429, { detail: 'Fixture old-account refusal.' }]]) {
  test(`switching profiles while DNS stays mounted suppresses the old ${oldStatus} result without clearing the new request`, async () => {
    const f = fixture(), a = deferred(), b = deferred(), first = f.view()
    try {
      f.reply(() => a.promise); first.run()
      await until(() => f.requests.length === 1)
      // App.tsx clears the cache on account switches; the observer changes its mutation key.
      f.queryClient.clear()
      const second = f.view('fixture-b', f.client('fixture-b'), first.observer)
      f.reply(() => b.promise); second.run()
      await until(() => f.requests.length === 2)
      a.resolve(response(oldStatus, oldBody))
      await sleep(20)
      assert.equal(second.pending(), 1)
      assert.equal(f.notices.length, 0)
      assert.equal(f.failures.length, 0)
      b.resolve(response())
      await until(() => second.pending() === 0)
      assert.equal(f.notices.length, 1)
      assert.equal(f.failures.length, 0)
      assert.deepEqual(f.requests.map(r => r.profile), ['fixture-a', 'fixture-b'])
    } finally { f.close() }
  })
}

test('without a client the click handler sends nothing', async () => {
  const f = fixture(), v = f.view('fixture-a', null)
  try {
    v.run()
    await sleep(10)
    assert.equal(f.requests.length, 0)
    assert.equal(v.pending(), 0)
    assert.equal(f.notices.length, 0)
    assert.equal(f.failures.length, 0)
  } finally { f.close() }
})
