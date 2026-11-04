// Network changes that restart the server must say so: node --test scripts/test-restart-actions.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { QueryClient, MutationObserver } from '@tanstack/react-query'
import { apiFailure } from '../src/renderer/src/api/errors.ts'
import { RESTART_NOTE, RESTART_TOAST, restartsServer } from '../src/renderer/src/lib/actionLabels.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const RESTARTING = ['change_network', 'change_separate_private_network_interface', 'change_vpc_ipv4']

test('the VPC move, the separate private interface and the private IPv4 change are the ones that restart the server', () => {
  for (const type of RESTARTING) assert.equal(restartsServer(type), true, type)
})

test('every other network change, and the power actions, are not treated as restarts', () => {
  for (const type of ['change_ipv6', 'change_ipv6_reverse_nameservers', 'change_reverse_name', 'change_port_blocking', 'reboot', 'power_cycle', 'shutdown', 'power_on', 'resize', 'rename', ''])
    assert.equal(restartsServer(type), false, type)
  assert.equal(restartsServer(undefined), false)
})

test('the warning says the server is restarted and that what runs on it stops and starts again; the toast says a running server is restarted', () => {
  assert.match(RESTART_NOTE, /restarted/)
  assert.match(RESTART_NOTE, /shuts it down/)
  assert.match(RESTART_NOTE, /starts it again/)
  assert.match(RESTART_NOTE, /everything running on it stops and starts again/)
  // Not "the server is restarting": a server that is already stopped stays stopped, so both say "a running server".
  assert.match(RESTART_TOAST, /A running server is restarted/)
  assert.doesNotMatch(RESTART_TOAST, /the server is restarting/i)
})

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

test('every screen that sends one of these actions shows the restart warning, so a new entry point cannot leave it out', () => {
  const senders = sourceFiles(join(root, 'src', 'renderer', 'src'))
    .filter((file) => !/actionLabels\.ts$/.test(file))
    .filter((file) => RESTARTING.some((type) => new RegExp(`['"\`]${type}['"\`]`).test(readFileSync(file, 'utf8'))))
  assert.ok(senders.length >= 2, `expected the Network tab and the VPCs page, found ${senders.map((f) => relative(root, f))}`)
  for (const file of senders) assert.match(readFileSync(file, 'utf8'), /RESTART_NOTE/, `${relative(root, file)} sends a restarting action without the warning`)
})

// ---- the submission of a restarting change (Network tab), as the production hook runs it: real mutation cache, no React.
const querySource = readFileSync(join(root, 'src', 'renderer', 'src', 'api', 'queries.ts'), 'utf8')
const queries = ts.createSourceFile('queries.ts', querySource, ts.ScriptTarget.Latest, true)
const keyStatement = queries.statements.find((n) => ts.isVariableStatement(n) && n.declarationList.declarations[0].name.getText(queries) === 'networkActionMutationKey')
const hookDeclaration = queries.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'useServerActionMutation')
assert.ok(keyStatement && hookDeclaration, 'networkActionMutationKey and useServerActionMutation must exist in api/queries.ts')
const code = ts.transpileModule(`${keyStatement.getText(queries)}\n${hookDeclaration.getText(queries)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const queued = { id: 48200001, type: 'change_network', status: 'in-progress', resource_id: 8100, resource_type: 'server' }
const BODY = { type: 'change_network', vpc_id: 902 }

function fixture(reply) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity, retry: false } } })
  const module = { exports: {} }
  runInNewContext(code, { module, exports: module.exports, apiFailure, Error, useQueryClient: () => queryClient, useMutation: (options) => options })
  const { useServerActionMutation, networkActionMutationKey } = module.exports
  const requests = []
  const client = { POST: async (path, init) => { requests.push({ path, body: init.body }); return reply() } }
  // A "view" is one mounted tab: its own observer over the same cache. Mounting another is what leaving and reopening the tab does.
  const view = (options) => { const observer = new MutationObserver(queryClient, useServerActionMutation(client, options)); observer.subscribe(() => {}); return observer }
  return { queryClient, requests, view, key: networkActionMutationKey }
}

test('while the request is unanswered it counts as mutating for its server, in any view of the tab, and only for that server', async () => {
  const gate = deferred()
  const f = fixture(async () => { await gate.promise; return { data: { action: queued }, response: { ok: true, status: 200 } } })
  const first = f.view({ mutationKey: f.key(8100) })
  const done = first.mutate({ serverId: 8100, actionPayload: BODY })
  await settle()
  assert.equal(f.requests.length, 1)
  assert.equal(f.queryClient.isMutating({ mutationKey: f.key(8100) }), 1)
  // The tab is left and reopened: a new view over the same cache sees the same request, which is what keeps the controls locked.
  const reopened = f.view({ mutationKey: f.key(8100) })
  assert.equal(reopened.getCurrentResult().isPending, false, 'the reopened view has no state of its own for it')
  assert.equal(f.queryClient.isMutating({ mutationKey: f.key(8100) }), 1)
  assert.equal(f.queryClient.isMutating({ mutationKey: f.key(8101) }), 0)
  gate.resolve(); await done
  assert.equal(f.queryClient.isMutating({ mutationKey: f.key(8100) }), 0)
})

test('without a key (the Overview and the lists) it is not counted against the Network tab', async () => {
  const gate = deferred()
  const f = fixture(async () => { await gate.promise; return { data: { action: queued }, response: { ok: true, status: 200 } } })
  const done = f.view(undefined).mutate({ serverId: 8100, actionPayload: BODY })
  await settle()
  assert.equal(f.queryClient.isMutating({ mutationKey: f.key(8100) }), 0)
  gate.resolve(); await done
})

test('the queued action is handed over while the request still counts as pending, and before the mutation settles', async () => {
  const events = []
  const f = fixture(async () => ({ data: { action: queued }, response: { ok: true, status: 200 } }))
  const view = f.view({ mutationKey: f.key(8100) })
  const result = await view.mutate({
    serverId: 8100,
    actionPayload: BODY,
    onQueued: (action) => events.push(['queued', action.id, f.queryClient.isMutating({ mutationKey: f.key(8100) })])
  })
  assert.deepEqual(events, [['queued', queued.id, 1]], 'handed over while still counted, so the lock has no gap')
  assert.equal(result?.id, queued.id)
  assert.equal(f.queryClient.isMutating({ mutationKey: f.key(8100) }), 0)
})

test('nothing is handed over for a refusal or for an answer with no action, and the refusal still throws', async () => {
  const handed = []
  const refused = fixture(async () => ({ error: { message: 'The destination is not available.' }, response: { ok: false, status: 400 } }))
  await assert.rejects(refused.view({ mutationKey: refused.key(8100) }).mutate({ serverId: 8100, actionPayload: BODY, onQueued: (a) => handed.push(a) }), /not available/)
  const noAction = fixture(async () => ({ data: undefined, response: { ok: true, status: 202 } }))
  const result = await noAction.view({ mutationKey: noAction.key(8100) }).mutate({ serverId: 8100, actionPayload: BODY, onQueued: (a) => handed.push(a) })
  assert.equal(result, undefined)
  assert.deepEqual(handed, [])
  assert.equal(refused.queryClient.isMutating({ mutationKey: refused.key(8100) }), 0)
})
