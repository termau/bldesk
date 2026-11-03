import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import createClient from 'openapi-fetch'
import * as errors from '../src/renderer/src/api/errors.ts'

const source = readFileSync(new URL('../src/renderer/src/api/client.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText
const endpoint = '/v2/domains/refresh_nameserver_cache'
const tokens = { a: 'fictitious-mutation-account-a', b: 'fictitious-mutation-account-b' }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const response = (status = 204, body) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' }
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await sleep(5) }
  assert.fail('Transport did not reach the expected execution count')
}

// Production adapter/openapi-fetch are unchanged; clock, transport and digest settlement are controlled.
function fixture(native = false, failDigest = false, digest = webcrypto.subtle.digest.bind(webcrypto.subtle)) {
  let now = 10000, digests = 0
  const calls = [], warnings = [], keys = [], events = [], module = { exports: {} }
  let reply = () => response()
  class Clock extends Date { static now() { return now } }
  class TrackingMap extends Map {
    set(key, value) { keys.push(String(key)); return super.set(key, value) }
  }
  const execute = async (method, url, headers, body, route) => {
    const authorization = new Headers(headers).get('authorization')
    const account = Object.entries(tokens).find(([, token]) => authorization === `Bearer ${token}`)?.[0]
    assert.ok(account, 'Only fictitious credentials may execute')
    const call = { account, method, path: new URL(url).pathname, body, route }
    calls.push(call)
    return reply(call)
  }
  const window = {
    async fetch(input, init) {
      const request = new Request(input, init)
      return execute(request.method, request.url, request.headers, await request.text(), 'web')
    },
    dispatchEvent(event) { events.push(event.type) },
    ...(native ? { Capacitor: { isNativePlatform: () => true, Plugins: { CapacitorHttp: {
      async request(options) {
        const answer = await execute(options.method, options.url, options.headers, options.data, 'native')
        return { status: answer.status, data: await answer.text(), headers: Object.fromEntries(answer.headers) }
      }
    } } } } : {})
  }
  runInNewContext(compiled, {
    module, exports: module.exports, Request, Response, Headers, URL, TypeError, CustomEvent, TextEncoder,
    Date: Clock, Map: TrackingMap, console: { warn: (...args) => warnings.push(args.join(' ')) }, window,
    crypto: { subtle: { digest(...args) {
      digests++
      if (failDigest) return Promise.reject(new Error('Fixture digest unavailable'))
      return digest(...args)
    } } },
    require(name) {
      if (name === 'openapi-fetch') return { __esModule: true, default: createClient }
      if (name === './errors') return errors
      throw new Error(`Unexpected import: ${name}`)
    }
  })
  const client = token => module.exports.createBinaryLaneClient(token)
  return { client, a: client(tokens.a), b: client(tokens.b), calls, warnings, keys, events,
    advance: ms => { now += ms }, reply: fn => { reply = fn }, digests: () => digests }
}

for (const native of [false, true]) {
  const mode = native ? 'native adapter' : 'web adapter'

  test(`${mode}: different credentials execute separately inside the cooldown`, async () => {
    const f = fixture(native), gate = deferred()
    f.reply(() => gate.promise.then(() => response()))
    const a = f.a.POST(endpoint)
    await until(() => f.calls.length === 1)
    const b = f.b.POST(endpoint).then(value => ({ value }), error => ({ error }))
    try {
      await until(() => f.calls.length === 2)
      assert.deepEqual(f.calls.map(call => call.account), ['a', 'b'])
      assert.ok(f.calls.every(call => call.route === (native ? 'native' : 'web')))
      gate.resolve()
      assert.equal((await a).response.status, 204)
      assert.equal((await b).value?.response.status, 204)
    } finally { gate.resolve(); await Promise.allSettled([a, b]) }
  })

  test(`${mode}: B's delayed refusal is not replaced by A's successful response`, async () => {
    const f = fixture(native), gateA = deferred(), gateB = deferred()
    f.reply(call => call.account === 'a' ? gateA.promise : gateB.promise)
    const a = f.a.POST(endpoint)
    await until(() => f.calls.length === 1)
    f.advance(1650)
    const b = f.b.POST(endpoint).then(value => ({ value }), error => ({ error }))
    try {
      await until(() => f.calls.length === 2)
      gateB.resolve(response(429, { title: 'Too Many Requests', status: 429, detail: 'Fixture B refusal' }))
      const resultB = (await b).value
      assert.equal(resultB?.response.status, 429)
      assert.equal(resultB?.error.detail, 'Fixture B refusal')
      gateA.resolve(response())
      assert.equal((await a).response.status, 204)
      assert.deepEqual(f.calls.map(call => call.account), ['a', 'b'])
    } finally { gateA.resolve(response()); gateB.resolve(response()); await Promise.allSettled([a, b]) }
  })

  test(`${mode}: separate JSON mutation results stay with the right credential`, async () => {
    const f = fixture(native), gate = deferred()
    f.reply(call => gate.promise.then(() => response(200, { domain: {
      id: call.account === 'a' ? 9101 : 9201, name: 'fixture.example', ttl: 3600, zone_file: '', current_nameservers: []
    } })))
    const create = client => client.POST('/v2/domains', { body: { name: 'fixture.example' } })
    const a = create(f.a)
    await until(() => f.calls.length === 1)
    f.advance(1650)
    const b = create(f.b).then(value => ({ value }), error => ({ error }))
    try {
      await until(() => f.calls.length === 2)
      gate.resolve()
      assert.equal((await a).data.domain.id, 9101)
      assert.equal((await b).value?.data.domain.id, 9201)
    } finally { gate.resolve(); await Promise.allSettled([a, b]) }
  })

  test(`${mode}: recreated clients with the same trimmed token retain the cooldown`, async () => {
    const f = fixture(native)
    assert.equal((await f.a.POST(endpoint)).response.status, 204)
    await assert.rejects(f.client(`  ${tokens.a}  `).POST(endpoint), /Action was already submitted/)
    assert.equal(f.calls.length, 1)
    f.advance(1500)
    assert.equal((await f.client(tokens.a).POST(endpoint)).response.status, 204)
    assert.equal(f.calls.length, 2)
  })

  test(`${mode}: simultaneous same-credential requests execute only once`, async () => {
    const f = fixture(native)
    const results = await Promise.allSettled([f.a.POST(endpoint), f.client(tokens.a).POST(endpoint)])
    assert.equal(f.calls.length, 1)
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const rejection = results.find(result => result.status === 'rejected')
    assert.match(rejection.reason.message, /Action was already submitted/)
  })

  test(`${mode}: an already-resolved digest cannot split same-credential check and registration`, async () => {
    const f = fixture(native, false, () => Promise.resolve(new ArrayBuffer(32)))
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => f.client(tokens.a).POST(endpoint)))
    assert.equal(f.calls.length, 1)
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const rejections = results.filter(result => result.status === 'rejected')
    assert.equal(rejections.length, 2)
    assert.ok(rejections.every(result => /Action was already submitted/.test(result.reason.message)))
  })

  test(`${mode}: same-credential pending requests still coalesce after the cooldown`, async () => {
    const f = fixture(native), gate = deferred()
    f.reply(() => gate.promise)
    const a = f.a.POST(endpoint)
    await until(() => f.calls.length === 1)
    f.advance(1500)
    const duplicate = f.client(tokens.a).POST(endpoint)
    try {
      await until(() => f.warnings.some(text => text.includes('Reusing in-flight request')))
      assert.equal(f.calls.length, 1)
      gate.resolve(response())
      assert.deepEqual((await Promise.all([a, duplicate])).map(value => value.response.status), [204, 204])
    } finally { gate.resolve(response()); await Promise.allSettled([a, duplicate]) }
  })

  test(`${mode}: a failed request is not replayed or allowed to suppress another credential`, async () => {
    const f = fixture(native)
    f.reply(call => {
      if (call.account === 'a') throw new TypeError('Fixture connection lost')
      return response()
    })
    await assert.rejects(f.a.POST(endpoint), TypeError)
    assert.equal((await f.b.POST(endpoint)).response.status, 204)
    assert.deepEqual(f.calls.map(call => call.account), ['a', 'b'])
    f.advance(1500)
    f.reply(() => response())
    assert.equal((await f.a.POST(endpoint)).response.status, 204)
    assert.deepEqual(f.calls.map(call => call.account), ['a', 'b', 'a'])
  })

  test(`${mode}: a request-specific authorization header does not borrow its client's default response`, async () => {
    const f = fixture(native), gate = deferred()
    f.reply(() => gate.promise.then(() => response()))
    const a = f.a.POST(endpoint)
    await until(() => f.calls.length === 1)
    const override = f.a.POST(endpoint, { headers: { Authorization: `Bearer ${tokens.b}` } })
      .then(value => ({ value }), error => ({ error }))
    try {
      await until(() => f.calls.length === 2)
      gate.resolve()
      assert.equal((await a).response.status, 204)
      assert.equal((await override).value?.response.status, 204)
      assert.deepEqual(f.calls.map(call => call.account), ['a', 'b'])
    } finally { gate.resolve(); await Promise.allSettled([a, override]) }
  })
}

test('native adapter: removed Authorization headers retain the factory token scope', async () => {
  const f = fixture(true), gate = deferred()
  f.reply(() => gate.promise.then(() => response()))
  const options = { headers: { Authorization: null } }
  const a = f.a.POST(endpoint, options)
  await until(() => f.calls.length === 1)
  const b = f.b.POST(endpoint, options).then(value => ({ value }), error => ({ error }))
  try {
    await until(() => f.calls.length === 2)
    assert.deepEqual(f.calls.map(call => call.account), ['a', 'b'])
    assert.ok(f.calls.every(call => call.route === 'native'))
    gate.resolve()
    assert.equal((await a).response.status, 204)
    assert.equal((await b).value?.response.status, 204)
  } finally { gate.resolve(); await Promise.allSettled([a, b]) }
})

test('API tokens and Authorization headers are not stored raw in tracking keys or warnings', async () => {
  const f = fixture()
  await f.a.POST(endpoint)
  await assert.rejects(f.a.POST(endpoint), /Action was already submitted/)
  await f.b.POST(endpoint)
  assert.ok(f.keys.length >= 4)
  assert.ok(f.keys.every(key => /^[a-f0-9]{64}:POST:/.test(key)))
  for (const token of Object.values(tokens)) {
    assert.ok(f.keys.every(key => !key.includes(token)))
    assert.ok(f.warnings.every(text => !text.includes(token)))
  }
})

test('read requests do not require a credential fingerprint or mutation cooldown', async () => {
  const f = fixture(false, true)
  f.reply(() => response(200, { regions: [] }))
  const results = await Promise.all([f.a.GET('/v2/regions'), f.a.GET('/v2/regions'), f.b.GET('/v2/regions')])
  assert.ok(results.every(result => result.response.status === 200))
  assert.deepEqual(f.calls.map(call => call.account), ['a', 'a', 'b'])
  assert.equal(f.calls.length, 3)
  assert.equal(f.digests(), 0)
})

test('empty credentials fail before hashing or executing a request', async () => {
  const f = fixture()
  assert.equal((await f.client('  ').POST(endpoint)).response.status, 401)
  assert.equal(f.calls.length, 0)
  assert.equal(f.digests(), 0)
})

test('fingerprint failure does not send an unscoped mutation', async () => {
  const f = fixture(false, true)
  await assert.rejects(f.a.POST(endpoint), /Fixture digest unavailable/)
  assert.equal(f.calls.length, 0)
  assert.equal(f.digests(), 1)
})
