// Run with a packaged Electron executable and ELECTRON_RUN_AS_NODE=1. This
// proves the packaged native ABI loads and its executable helper can spawn SSH.
const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const supplied = process.argv[2] && resolve(process.argv[2])
if (!supplied) throw new Error('Pass the packaged app Resources directory or a node-pty directory')
// Load JS through app.asar exactly as the app does. node-pty then rewrites its
// native/helper path to app.asar.unpacked. Loading JS directly from the latter
// would make node-pty 1.1.0 apply that rewrite twice.
const moduleDir = supplied.endsWith('node-pty') ? supplied : join(supplied, 'app.asar/node_modules/node-pty')
const pty = require(moduleDir)
const output = []
const child = pty.spawn('/usr/bin/ssh', ['-V'], { name: 'xterm-256color', cols: 80, rows: 24, env: { ...process.env, TERM: 'xterm-256color' } })
child.onData((data) => output.push(data))
child.onExit(({ exitCode }) => {
  assert.equal(exitCode, 0)
  assert.match(output.join(''), /OpenSSH/)
  console.log('PASS: packaged Electron ABI loaded node-pty and spawn-helper ran OpenSSH')
})
