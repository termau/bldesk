import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// useServerActions polls every 3 seconds only while it has already seen an action running, and every 30 seconds
// otherwise. A mutation that starts an action and does not read the list again leaves the Backups banner up to 30
// seconds behind, so every hook in queries.ts that queues an action must invalidate ['serverActions', serverId].
const source = readFileSync(new URL('../src/renderer/src/api/queries.ts', import.meta.url), 'utf8')
const file = ts.createSourceFile('queries.ts', source, ts.ScriptTarget.Latest, true)
const functions = new Map(
  file.statements
    .filter(node => ts.isFunctionDeclaration(node) && node.name)
    .map(node => [node.name.text, node.getText(file)])
)

const STARTS_ACTION = /client\.POST\('\/v2\/servers\/\{server_id\}\/(actions|backups)'/

test('every hook that starts a server action reads that server\'s action list again', () => {
  const starters = [...functions].filter(([name, text]) => name.startsWith('use') && STARTS_ACTION.test(text))
  assert.ok(starters.length >= 10, `expected the action hooks, found ${starters.map(([n]) => n).join(', ')}`)
  for (const [name, text] of starters) {
    assert.ok(
      /queryKey: \['serverActions', (serverId|variables\.serverId)\]/.test(text),
      `${name} starts a server action but never invalidates ['serverActions', serverId]`
    )
  }
})

// Each hook carries its own invalidation (no shared helper), so other tests that lift one hook out of queries.ts still run it.
const hooks = [
  'useServerActionMutation',
  'useUpdateFirewallRulesMutation',
  'useRestoreBackupMutation',
  'useToggleAutomatedBackupsMutation',
  'useAttachBackupMutation',
  'useDetachBackupMutation',
  'useNetworkActionMutation',
  'useServerActionWithHandoff',
  'useServerDiagnosticMutation'
]
const compiled = ts.transpileModule(
  hooks.map(name => {
    const text = functions.get(name)
    assert.ok(text, `${name} must still exist`)
    return text
  }).join('\n'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText

function load() {
  const invalidations = []
  const module = { exports: {} }
  runInNewContext(compiled, {
    module, exports: module.exports, Promise, setTimeout,
    ACTION_REQUEST_TIMEOUT_MS: 1,
    networkActionMutationKey: id => ['network-action', id],
    useQueryClient: () => ({ invalidateQueries: filter => { invalidations.push(filter.queryKey); return Promise.resolve() } }),
    useMutation: options => options
  })
  return { hooks: module.exports, invalidations }
}

const sawActions = (invalidations, id) =>
  invalidations.some(key => key.length === 2 && key[0] === 'serverActions' && key[1] === id)

test('the Backups tab mutations refresh the action list on success', () => {
  for (const name of ['useRestoreBackupMutation', 'useToggleAutomatedBackupsMutation', 'useAttachBackupMutation', 'useDetachBackupMutation', 'useUpdateFirewallRulesMutation']) {
    const { hooks: h, invalidations } = load()
    h[name]({}, 4101).onSuccess()
    assert.ok(sawActions(invalidations, 4101), `${name} did not invalidate ['serverActions', 4101]`)
  }
})

test('the generic action mutation refreshes the list for the server it was called for', () => {
  const { hooks: h, invalidations } = load()
  h.useServerActionMutation({}).onSuccess(undefined, { serverId: 4102, actionPayload: { type: 'reboot' } })
  assert.ok(sawActions(invalidations, 4102))
})

test('network, handoff and diagnostic actions refresh the list when they settle', async () => {
  for (const name of ['useNetworkActionMutation', 'useServerActionWithHandoff', 'useServerDiagnosticMutation']) {
    const { hooks: h, invalidations } = load()
    await h[name]({}, 4103).onSettled()
    assert.ok(sawActions(invalidations, 4103), `${name} did not invalidate ['serverActions', 4103]`)
  }
})
