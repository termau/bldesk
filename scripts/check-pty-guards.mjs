// Structural guard: checking that two helper names occur somewhere is not
// enough. The actual spawn call must receive the resolved SSH path and argv.
import ts from 'typescript'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []
const owner = 'src/main/pty.ts'
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(resolve(dir, e.name)) : /\.[cm]?[jt]sx?$/.test(e.name) ? [resolve(dir, e.name)] : [])
}
let spawns = 0
for (const file of walk(resolve(root, 'src'))) {
  const rel = relative(root, file).replaceAll('\\', '/')
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  function visit(node) {
    if (ts.isStringLiteral(node) && /^node-pty(?:\/|$)/.test(node.text) && rel !== owner) failures.push(`${rel}: only ${owner} may import node-pty`)
    if (rel === owner && ts.isCallExpression(node) && node.expression.getText(source) === 'pty.spawn') {
      spawns++
      const [exe, argv] = node.arguments.map((a) => a.getText(source).replace(/\s/g, ''))
      if (exe !== 'sshPath' || argv !== 'sshArgv(options,options.remoteCommand).slice(1)') failures.push('PTY spawn must use sshPath and sshArgv(options, options.remoteCommand).slice(1), never a local shell')
    }
    if (rel === owner && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'spawn' && node.expression.getText(source) !== 'pty.spawn') {
      failures.push('PTY owner may not add another spawn call; all processes go through the single guarded pty.spawn site')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (rel === owner) {
    const text = source.getText().replace(/\s/g, '')
    for (const required of ["constsshPath=findOnPath('ssh')", 'validateSshTarget(options)', 'requireMainRenderer(event)', 'event.sender!==mainWindow.webContents', 'useConpty:true', "session.process.kill('SIGHUP')"]) {
      if (!text.includes(required)) failures.push(`PTY owner must retain ${required}`)
    }
    const registrations = source.getText().match(/ipcMain\.handle\('pty:[^\n]+/g) || []
    if (registrations.length !== 5 || registrations.some((s) => !s.includes('requireMainRenderer(event)'))) failures.push('All five PTY IPC handlers must check the main renderer before acting')
    if (/from\s+['"]node:child_process['"]|require\(['"]node:child_process['"]\)/.test(source.getText())) failures.push('PTY owner may not import child_process')
  }
}
if (spawns !== 1) failures.push('Exactly one PTY spawn site is allowed')
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('PTY ownership/argv guards passed')
