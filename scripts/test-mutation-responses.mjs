import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import createClient from 'openapi-fetch'
import { QueryClient, MutationObserver } from '@tanstack/react-query'
import * as errors from '../src/renderer/src/api/errors.ts'

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText
const compiled = compile(readFileSync(new URL('../src/renderer/src/api/client.ts', import.meta.url), 'utf8')) +
  '\nmodule.exports.testInFlight = inFlightMutations\n'
const queries = ts.createSourceFile('queries.ts', readFileSync(new URL('../src/renderer/src/api/queries.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const hook = queries.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useServerActionMutation')
assert.ok(hook)
const hookCode = compile(hook.getText(queries))
const domain = { domain: { id: 9101, name: 'fixture.example', ttl: 3600, zone_file: '', current_nameservers: [] } }
const refusal = { title: 'Bad Request', status: 400, detail: 'Fixture refusal', errors: { name: ['Fixture name refused'] } }
const action = { action: { id: 73001, type: 'reboot', status: 'in-progress', title: 'Fixture reboot', reason: 'Fixture accepted', started_at: '2026-11-02T00:00:00Z', completed_at: null, progress: { percent_complete: 0, completed_steps: [] } } }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const settle = promise => promise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await sleep(5) }
  assert.fail('Mutation did not reach the expected state')
}

function fixture(native = false) {
  let now = 10000, cloneCount = 0
  const calls = [], warnings = [], responses = [], module = { exports: {} }
  class Clock extends Date { static now() { return now } }
  class TrackedResponse extends Response {
    constructor(body, init) { super(body, init); responses.push(this) }
    clone() {
      cloneCount++
      assert.equal(module.exports.testInFlight.size, 0, 'No caller may join after response delivery starts')
      return super.clone()
    }
  }
  const response = (status = 200, body = domain, headers = { 'content-type': 'application/json', 'x-fixture': 'response-owner' }) =>
    new TrackedResponse(body === null ? null : JSON.stringify(body), { status, statusText: status === 200 ? 'Fixture OK' : '', headers })
  let reply = () => response()
  const execute = async (method, url, headers, body, route) => {
    assert.equal(new Headers(headers).get('authorization'), 'Bearer fictitious-response-body-token')
    const call = { method, path: new URL(url).pathname, body, route }
    calls.push(call)
    return reply(call)
  }
  const window = {
    async fetch(input, init) {
      const request = new Request(input, init)
      return execute(request.method, request.url, request.headers, await request.text(), 'web')
    },
    dispatchEvent() {},
    ...(native ? { Capacitor: { isNativePlatform: () => true, Plugins: { CapacitorHttp: {
      async request(options) {
        const answer = await execute(options.method, options.url, options.headers, options.data, 'native')
        return { status: answer.status, data: await answer.text(), headers: Object.fromEntries(answer.headers) }
      }
    } } } } : {})
  }
  runInNewContext(compiled, {
    module, exports: module.exports, Request, Response: TrackedResponse, Headers, URL, TypeError, CustomEvent, TextEncoder,
    Date: Clock, crypto: webcrypto, console: { warn: (...args) => warnings.push(args.join(' ')) }, window,
    require(name) {
      if (name === 'openapi-fetch') return { __esModule: true, default: createClient }
      if (name === './errors') return errors
      throw new Error(`Unexpected import: ${name}`)
    }
  })
  return { client: module.exports.createBinaryLaneClient('fictitious-response-body-token'), calls, warnings,
    inFlight: module.exports.testInFlight, responses, response,
    raw: (body, init) => new TrackedResponse(body, init),
    reply: fn => { reply = fn }, advance: ms => { now += ms }, clones: () => cloneCount }
}

const create = (client, options = {}) => client.POST('/v2/domains', { body: { name: 'fixture.example' }, ...options })
async function coalesce(f, count = 2, submit = () => create(f.client)) {
  const gate = deferred()
  f.reply(() => gate.promise)
  const pending = [settle(submit())]
  await until(() => f.calls.length === 1)
  f.advance(1650)
  for (let i = 1; i < count; i++) pending.push(settle(submit()))
  await until(() => f.warnings.filter(text => text.includes('Reusing in-flight request')).length === count - 1)
  assert.equal(f.calls.length, 1)
  return { gate, finish: () => Promise.all(pending), pending }
}

for (const native of [false, true]) {
  const mode = native ? 'native adapter' : 'web adapter'
  for (const count of [2, 4]) test(`${mode}: ${count} consumers independently parse one JSON response`, async () => {
    const f = fixture(native), p = await coalesce(f, count)
    p.gate.resolve(f.response())
    const results = await p.finish()
    assert.ok(results.every(row => row.status === 'fulfilled' && row.value.data.domain.id === 9101))
    const returned = results.map(row => row.value.response)
    assert.equal(new Set(returned).size, count)
    assert.ok(returned.includes(f.responses.at(-1)), 'One caller owns the original response')
    assert.equal(f.clones(), count - 1, 'No extra unread internal response branch')
    assert.ok(returned.every(reply => reply.headers.get('x-fixture') === 'response-owner' && reply.status === 200))
    returned[0].headers.set('x-fixture', 'changed-by-one-caller')
    assert.ok(returned.slice(1).every(reply => reply.headers.get('x-fixture') === 'response-owner'))
    assert.equal(f.inFlight.size, 0)
    assert.equal(f.calls.length, 1)
    assert.ok(f.calls.every(call => call.route === (native ? 'native' : 'web')))
  })

  for (const [status, body] of [[400, refusal], [204, null], [400, null]]) {
    test(`${mode}: shared HTTP ${status} ${body ? 'reason' : 'empty reply'} remains readable by both callers`, async () => {
      const f = fixture(native), p = await coalesce(f)
      p.gate.resolve(f.response(status, body))
      const results = await p.finish()
      assert.ok(results.every(row => row.status === 'fulfilled' && row.value.response.status === status))
      if (body) assert.ok(results.every(row => row.value.error.detail === refusal.detail))
      else if (status === 204) assert.ok(results.every(row => row.value.error === undefined && row.value.data === undefined))
      else assert.ok(results.every(row => row.value.error === '' && row.value.data === undefined))
      assert.notEqual(results[0].value.response, results[1].value.response)
      assert.equal(f.clones(), 1)
      assert.equal(f.calls.length, 1)
    })
  }

  test(`${mode}: a single caller gets the original without cloning`, async () => {
    const f = fixture(native)
    const result = await create(f.client)
    assert.equal(result.data.domain.id, 9101)
    assert.equal(result.response, f.responses.at(-1))
    assert.equal(f.clones(), 0)
    assert.equal(f.inFlight.size, 0)
  })

  test(`${mode}: inside-cooldown duplicate protection is unchanged`, async () => {
    const f = fixture(native), gate = deferred()
    f.reply(() => gate.promise)
    const first = settle(create(f.client))
    await until(() => f.calls.length === 1)
    try {
      await assert.rejects(create(f.client), /Action was already submitted/)
      gate.resolve(f.response())
      assert.equal((await first).value.data.domain.id, 9101)
      assert.equal(f.calls.length, 1)
      assert.equal(f.clones(), 0)
    } finally { gate.resolve(f.response()); await first }
  })

  test(`${mode}: a transport rejection reaches all consumers without resend and releases the entry`, async () => {
    const f = fixture(native), p = await coalesce(f, 3)
    p.gate.reject(new TypeError('Fixture connection lost'))
    const results = await p.finish()
    assert.ok(results.every(row => row.status === 'rejected' && row.reason.name === 'TypeError'))
    assert.equal(f.calls.length, 1)
    assert.equal(f.clones(), 0)
    assert.equal(f.inFlight.size, 0)
    f.reply(() => f.response())
    assert.equal((await create(f.client)).data.domain.id, 9101)
    assert.equal(f.calls.length, 2)
  })

  test(`${mode}: a settled response is not cached for the next mutation`, async () => {
    const f = fixture(native), p = await coalesce(f)
    p.gate.resolve(f.response())
    assert.ok((await p.finish()).every(row => row.status === 'fulfilled'))
    f.reply(() => f.response(200, { domain: { ...domain.domain, id: 9102 } }))
    assert.equal((await create(f.client)).data.domain.id, 9102)
    assert.equal(f.calls.length, 2)
    assert.equal(f.inFlight.size, 0)
  })
}

for (const native of [false, true]) {
  for (const [status, body] of [[200, action], [202, null], [400, refusal]]) {
    test(`${native ? 'native' : 'web'} adapter: three callers can request text with a timeout signal for HTTP ${status}`, async () => {
      const f = fixture(native)
      const p = await coalesce(f, 3, () => f.client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: 9003 } }, body: { type: 'reboot' },
        parseAs: 'text', signal: AbortSignal.timeout(60_000)
      }))
      p.gate.resolve(f.response(status, body))
      const results = await p.finish()
      assert.ok(results.every(row => row.status === 'fulfilled' && row.value.response.status === status))
      if (status === 200) assert.ok(results.every(row => JSON.parse(row.value.data).action.id === 73001))
      else if (status === 202) assert.ok(results.every(row => row.value.data === '' && row.value.error === undefined))
      else assert.ok(results.every(row => row.value.error.detail === refusal.detail))
      assert.equal(new Set(results.map(row => row.value.response)).size, 3)
      assert.equal(f.clones(), 2)
      assert.equal(f.calls.length, 1)
      assert.equal(f.calls[0].method, 'POST')
      assert.equal(f.calls[0].path, '/v2/servers/9003/actions')
      assert.equal(f.calls[0].route, native ? 'native' : 'web')
      assert.equal(f.inFlight.size, 0)
    })
  }
}

test('JSON without the expected content type is normalized once and readable by both callers', async () => {
  const f = fixture(), p = await coalesce(f)
  p.gate.resolve(f.response(200, domain, { 'content-type': 'text/plain' }))
  const results = await p.finish()
  assert.ok(results.every(row => row.status === 'fulfilled' && row.value.data.domain.id === 9101))
  assert.ok(results.every(row => row.value.response.headers.get('content-type') === 'application/json'))
  assert.equal(f.calls.length, 1)
})

test('streamed JSON can be read at different speeds by all registered callers', async () => {
  const f = fixture(), p = await coalesce(f, 3, () => create(f.client, { parseAs: 'stream' }))
  const bytes = new TextEncoder().encode(JSON.stringify(domain))
  let controller
  const stream = new ReadableStream({ start(value) { controller = value } })
  p.gate.resolve(f.raw(stream, { headers: { 'content-type': 'application/json' } }))
  const results = await p.finish()
  assert.ok(results.every(row => row.status === 'fulfilled'))
  const reads = results.map((row, index) => (async () => {
    await sleep(index * 10)
    return new Response(row.value.data).json()
  })())
  controller.enqueue(bytes.subarray(0, 12))
  await sleep(5)
  controller.enqueue(bytes.subarray(12)); controller.close()
  assert.ok((await Promise.all(reads)).every(value => value.domain.id === 9101))
  assert.equal(f.clones(), 2)
  assert.equal(f.calls.length, 1)
})

test('cancelling one response body does not cancel another reader', async () => {
  const f = fixture(), p = await coalesce(f, 2, () => create(f.client, { parseAs: 'stream' }))
  let controller, sourceCancels = 0
  const stream = new ReadableStream({ start(value) { controller = value }, cancel() { sourceCancels++ } })
  p.gate.resolve(f.raw(stream, { headers: { 'content-type': 'application/json' } }))
  const results = await p.finish()
  assert.ok(results.every(row => row.status === 'fulfilled'))
  const cancelled = results[0].value.data.cancel('Fixture reader cancelled')
  const reading = new Response(results[1].value.data).json()
  controller.enqueue(new TextEncoder().encode(JSON.stringify(domain))); controller.close()
  assert.equal((await reading).domain.id, 9101)
  await cancelled
  assert.equal(sourceCancels, 0)
  assert.equal(f.calls.length, 1)
})

test('cancelling every consumer reaches the source without an unread internal branch', async () => {
  const f = fixture(), p = await coalesce(f, 4, () => create(f.client, { parseAs: 'stream' }))
  let controller, sourceCancels = 0
  const stream = new ReadableStream({ start(value) { controller = value }, cancel() { sourceCancels++ } })
  p.gate.resolve(f.raw(stream, { headers: { 'content-type': 'application/json' } }))
  const results = await p.finish()
  assert.ok(results.every(row => row.status === 'fulfilled'))
  const cancellation = Promise.all(results.map(row => row.value.data.cancel('Fixture all readers cancelled')))
  const completed = await Promise.race([cancellation.then(() => true), sleep(300).then(() => false)])
  if (!completed) {
    controller.error(new Error('Fixture cleanup after missing cancellation'))
    await Promise.race([cancellation.catch(() => {}), sleep(100)])
  }
  assert.equal(completed, true)
  assert.equal(sourceCancels, 1)
  assert.equal(f.clones(), 3)
  assert.equal(f.calls.length, 1)
})

test('a body stream failure reaches every consumer without resending the mutation', async () => {
  const f = fixture(), p = await coalesce(f)
  let controller
  const stream = new ReadableStream({ start(value) { controller = value } })
  p.gate.resolve(f.raw(stream, { headers: { 'content-type': 'application/json' } }))
  await until(() => f.inFlight.size === 0)
  controller.error(new TypeError('Fixture body stream failed'))
  const results = await p.finish()
  assert.ok(results.every(row => row.status === 'rejected' && row.reason.message === 'Fixture body stream failed'))
  assert.equal(f.calls.length, 1)
  assert.equal(f.inFlight.size, 0)
})

test('malformed JSON produces the original parsing error for every consumer without a resend', async () => {
  const f = fixture(), p = await coalesce(f)
  p.gate.resolve(f.raw('{fixture-invalid-json', { headers: { 'content-type': 'application/json' } }))
  const results = await p.finish()
  assert.ok(results.every(row => row.status === 'rejected' && row.reason.name === 'SyntaxError'))
  assert.equal(f.calls.length, 1)
  assert.equal(f.inFlight.size, 0)
})

for (const failed of [false, true]) test(`production action hook gives both consumers the ${failed ? 'API refusal' : 'accepted action'}`, async () => {
  const f = fixture(), queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0, gcTime: Infinity } } })
  const module = { exports: {} }
  runInNewContext(hookCode, { module, exports: module.exports, Error, apiFailure: errors.apiFailure,
    useQueryClient: () => queryClient, useMutation: options => options })
  const options = module.exports.useServerActionMutation(f.client)
  const observers = [new MutationObserver(queryClient, options), new MutationObserver(queryClient, options)]
  const unsubscribe = observers.map(observer => observer.subscribe(() => {}))
  let next = 0
  const p = await coalesce(f, 2, () => observers[next++].mutate({ serverId: 9003, actionPayload: { type: 'reboot' } }))
  try {
    p.gate.resolve(f.response(failed ? 400 : 200, failed ? refusal : action))
    const results = await p.finish()
    if (failed) assert.ok(results.every(row => row.status === 'rejected' && row.reason.status === 400 && /Fixture/.test(row.reason.message)))
    else assert.ok(results.every(row => row.status === 'fulfilled' && row.value.id === 73001 && row.value.status === 'in-progress'))
    assert.deepEqual(observers.map(observer => observer.getCurrentResult().status), failed ? ['error', 'error'] : ['success', 'success'])
    assert.equal(f.calls.length, 1)
  } finally {
    p.gate.resolve(f.response()); await p.finish()
    unsubscribe.forEach(fn => fn()); queryClient.clear()
  }
})

test('real loopback fetch preserves response URL, redirect metadata, headers and body for both callers', async () => {
  const arrived = deferred(), release = deferred()
  let posts = 0, reads = 0
  const server = createServer(async (request, reply) => {
    request.resume()
    if (request.url === '/redirect') {
      if (request.method === 'POST') posts++
      reply.writeHead(302, { location: '/result' }); reply.end()
    } else if (request.url === '/result') {
      reads++; arrived.resolve(); await release.promise
      reply.writeHead(200, { 'content-type': 'application/json', 'x-fixture': 'network-response' }); reply.end(JSON.stringify(domain))
    } else { reply.writeHead(404); reply.end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const base = `http://127.0.0.1:${server.address().port}`
  const f = fixture()
  f.reply(call => fetch(base + '/redirect', { method: call.method, body: call.body, headers: { 'content-type': 'application/json' } }))
  const first = settle(create(f.client))
  let second
  try {
    await arrived.promise
    f.advance(1650); second = settle(create(f.client))
    await until(() => f.warnings.some(text => text.includes('Reusing in-flight request')))
    release.resolve()
    const results = await Promise.all([first, second])
    assert.ok(results.every(row => row.status === 'fulfilled' && row.value.data.domain.id === 9101))
    for (const row of results) {
      assert.equal(row.value.response.url, base + '/result')
      assert.equal(row.value.response.redirected, true)
      assert.equal(row.value.response.type, 'basic')
      assert.equal(row.value.response.headers.get('x-fixture'), 'network-response')
    }
    assert.equal(posts, 1)
    assert.equal(reads, 1)
    assert.equal(f.calls.length, 1)
  } finally {
    release.resolve(); await Promise.all([first, second].filter(Boolean))
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  }
})
