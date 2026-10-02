// Tests for the script the macOS updater writes and runs after the app quits: the paths it is given must be used as
// names, whatever characters they contain, and a failed install must keep the installed app.
// node --experimental-strip-types --no-warnings --test scripts/test-updater-script.mjs
//
// The template is read from src/main/updater.ts (as check-updater-guards.mjs does), filled in, and run under bash in a
// scratch folder. unzip, xattr, open and logger are replaced by shell functions that record their arguments, because
// the first needs a real archive and the others only exist on a Mac; cp, mv and rm are the real ones.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { shQuote } from '../src/shared/ssh.ts'

const updaterFile = new URL('../src/main/updater.ts', import.meta.url)
const source = readFileSync(updaterFile, 'utf8').replace(/\r\n/g, '\n')
const ast = ts.createSourceFile('updater.ts', source, ts.ScriptTarget.Latest, true)
let template = null
const find = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'scriptContent' && node.initializer && ts.isTemplateLiteral(node.initializer)) {
    template = node.initializer.getText(ast)
  }
  ts.forEachChild(node, find)
}
find(ast)
assert.ok(template, 'updater.ts builds the install script as "const scriptContent = `...`"')

// Characters a shell treats as syntax. A double quote and a newline are not allowed in Windows file names.
const awkward = ["it's $HOME `touch tick` $(touch sub);touch semi&touch amp (x)"]
if (process.platform !== 'win32') awkward.push('a"b$(touch dq)\nline two')

/** Stand-ins for the commands that need a real archive or a Mac. Each call is appended to calls.log as NUL-separated words. */
const prelude = `
rec() { printf '%s\\0' "$@" >> calls.log; printf '\\0' >> calls.log; }
kill() { return 1; }
unzip() { rec unzip "$@"; if [ -n "$FAIL_UNZIP" ]; then return "$FAIL_UNZIP"; fi; mkdir -p "$5/BLDesk.app" && echo new > "$5/BLDesk.app/version.txt"; }
xattr() { rec xattr "$@"; }
open() { rec open "$@"; }
logger() { rec logger "$@"; }
`

/** Lay out an installed app, a download and a staging folder named after `name`, run the script, and report what happened. */
function install(name, { forceRunAfter = false, failUnzip = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bldesk-updater-script-'))
  try {
    const targetApp = `${name}.app`
    const zipPath = `${name}.zip`
    const stagingDir = `${name}-staging`
    mkdirSync(join(dir, targetApp, 'Contents'), { recursive: true })
    writeFileSync(join(dir, targetApp, 'Contents', 'old.txt'), 'old')
    writeFileSync(join(dir, zipPath), 'zip')
    mkdirSync(join(dir, stagingDir))
    const script = runInNewContext(template, {
      process: { pid: 999999 },
      zipPath,
      stagingDir,
      stagedApp: `${stagingDir}/BLDesk.app`,
      targetApp,
      shQuote,
      forceRunAfter
    })
    let status = 0
    try {
      execFileSync('bash', ['-s'], { cwd: dir, input: prelude + script, env: { ...process.env, FAIL_UNZIP: failUnzip }, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      status = err.status
    }
    const log = existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8') : ''
    const calls = log.split('\0\0').filter(Boolean).map((record) => record.replace(/\0$/, '').split('\0'))
    const left = readdirSync(dir).filter((f) => f !== 'calls.log')
    const read = (...parts) => (existsSync(join(dir, ...parts)) ? readFileSync(join(dir, ...parts), 'utf8').trim() : null)
    return { status, calls, left, targetApp, zipPath, stagingDir, version: read(targetApp, 'version.txt'), old: read(targetApp, 'Contents', 'old.txt') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const name of awkward) {
  const label = JSON.stringify(name)

  test(`a path with shell syntax in it is installed as a name: ${label}`, () => {
    const r = install(name, { forceRunAfter: true })
    assert.equal(r.status, 0)
    // The new app is in place, and the only things left are that app and the log: nothing the characters could have
    // run (touch tick, sub, semi, amp, dq) created a file, and the staging folder and download are cleaned up.
    assert.equal(r.version, 'new')
    assert.deepEqual(r.left, [r.targetApp])
    const byName = Object.fromEntries(r.calls.map(([cmd, ...args]) => [cmd, args]))
    assert.deepEqual(byName.unzip, ['-q', '-o', r.zipPath, '-d', r.stagingDir])
    assert.deepEqual(byName.xattr, ['-cr', r.targetApp])
    assert.deepEqual(byName.open, [r.targetApp])
    assert.equal(byName.logger, undefined)
  })

  test(`a failed unzip keeps the installed app whatever its path: ${label}`, () => {
    const r = install(name, { failUnzip: '9' })
    assert.equal(r.status, 1)
    assert.equal(r.old, 'old')
    assert.equal(r.version, null)
    assert.deepEqual(r.left, [r.targetApp])
    assert.equal(r.calls.filter(([cmd]) => cmd === 'logger').length, 1)
    assert.equal(r.calls.some(([cmd]) => cmd === 'open'), false)
  })
}

test('open is only run when the app is to start again', () => {
  assert.equal(install('App', { forceRunAfter: false }).calls.some(([cmd]) => cmd === 'open'), false)
  assert.deepEqual(install('App', { forceRunAfter: true }).calls.find(([cmd]) => cmd === 'open'), ['open', 'App.app'])
})
