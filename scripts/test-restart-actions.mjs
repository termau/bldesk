// Network changes that restart the server must say so: node --test scripts/test-restart-actions.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
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

test('the warning says the server is restarted and that what runs on it stops and starts again; the toast says it is restarting', () => {
  assert.match(RESTART_NOTE, /restarted/)
  assert.match(RESTART_NOTE, /shuts it down/)
  assert.match(RESTART_NOTE, /starts it again/)
  assert.match(RESTART_NOTE, /everything running on it stops and starts again/)
  assert.match(RESTART_TOAST, /restarting/)
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
