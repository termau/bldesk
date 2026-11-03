import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import createClient from 'openapi-fetch'
import * as errors from '../src/renderer/src/api/errors.ts'

// Exercise the real adapter without a WebView, account or network. Each load has fresh mutation state.
const source = readFileSync(new URL('../src/renderer/src/api/client.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText
function adapter(native, web = () => { throw new Error('Unexpected fetch fallback') }) {
  const calls = [], fallbacks = [], module = { exports: {} }
  const fetch = async (...args) => { fallbacks.push(args); return web(...args) }
  runInNewContext(compiled, {
    module, exports: module.exports, Request, Response, Headers, URL, TypeError, CustomEvent, TextEncoder, crypto: webcrypto,
    console: { warn() {} }, fetch,
    window: { fetch, dispatchEvent() {}, Capacitor: { isNativePlatform: () => true,
      Plugins: { CapacitorHttp: { request: async options => { calls.push(options); return native(options) } } }
    } },
    require(name) {
      if (name === 'openapi-fetch') return { __esModule: true, default: createClient }
      if (name === './errors') return errors
      throw new Error(`Unexpected import: ${name}`)
    }
  })
  return { client: module.exports.createBinaryLaneClient('fictitious-native-http-test-token'), calls, fallbacks }
}
const create = client => client.POST('/v2/servers', { body: { name: 'fixture.example', size: 'std-min', image: 'ubuntu-24.04', region: 'syd' } })

test('an uncertain native POST failure is not resent through JavaScript or fetch', async () => {
  const { client, calls, fallbacks } = adapter(() => { throw { code: 'IOException', message: 'lost response' } })
  await assert.rejects(create(client), { name: 'TypeError', message: 'No response from BinaryLane. If this request changed anything, it may or may not have gone through; check before trying again.' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].data.name, 'fixture.example')
  assert.equal(fallbacks.length, 0)
})

test('a native DELETE failure with no body is not resent', async () => {
  const { client, calls, fallbacks } = adapter(() => { throw { code: 'IOException', message: 'lost response' } })
  await assert.rejects(client.DELETE('/v2/servers/{server_id}', { params: { path: { server_id: 9003 } } }), /check before trying again/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'DELETE')
  assert.equal(calls[0].data, undefined)
  assert.equal(fallbacks.length, 0)
})

test('a native read failure does not claim a mutation may have happened', async () => {
  const { client, calls, fallbacks } = adapter(() => { throw { code: 'IOException', message: 'lost response' } })
  await assert.rejects(client.GET('/v2/servers'), { name: 'TypeError', message: 'No response from BinaryLane.' })
  assert.equal(calls.length, 1)
  assert.equal(fallbacks.length, 0)
})

test('a missing native implementation can fall back once without resending a native write', async () => {
  const { client, calls, fallbacks } = adapter(() => { throw { code: 'UNIMPLEMENTED' } },
    () => new Response(JSON.stringify({ server: { id: 9003 } }), { headers: { 'content-type': 'application/json' } }))
  assert.equal((await create(client)).data.server.id, 9003)
  assert.equal(calls.length, 1)
  assert.equal(fallbacks.length, 1)
})

test('native validation failures preserve the reason without another request', async () => {
  const body = { message: 'fixture validation reason', errors: { name: ['fixture validation reason'] } }
  const { client, calls, fallbacks } = adapter(() => ({ status: 400, data: body, headers: { 'content-type': 'application/json' } }))
  const response = await create(client)
  assert.equal(response.response.status, 400)
  assert.deepEqual(response.error, body)
  assert.equal(calls.length, 1)
  assert.equal(fallbacks.length, 0)
})

for (const status of [204, 304]) test(`a native ${status} response creates no second mutation`, async () => {
  const { client, calls, fallbacks } = adapter(() => ({ status, data: '', headers: {} }))
  const response = await create(client)
  assert.equal(response.response.status, status)
  assert.equal(calls.length, 1)
  assert.equal(fallbacks.length, 0)
})

test('a 205 parsing failure in openapi-fetch does not cause another mutation', async () => {
  const { client, calls, fallbacks } = adapter(() => ({ status: 205, data: '', headers: {} }))
  await assert.rejects(create(client), SyntaxError)
  assert.equal(calls.length, 1)
  assert.equal(fallbacks.length, 0)
})
