// Structural guard for auto-updater: prevents regression of unsigned macOS
// auto-update support, Squirrel.Mac code signing traps, and quit handlers.
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []

const updaterFile = resolve(root, 'src/main/updater.ts')
const indexFile = resolve(root, 'src/main/index.ts')

const updaterContent = readFileSync(updaterFile, 'utf8')
const indexContent = readFileSync(indexFile, 'utf8')
const codeOnly = updaterContent.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '')

// 1. Invariant: autoDownload must NOT be unconditionally true.
// On macOS, autoDownload=true hands the zip to Squirrel.Mac which crashes on unsigned builds.
if (!codeOnly.includes('if(isMac){autoUpdater.autoDownload=false') &&
    !codeOnly.includes('autoUpdater.autoDownload=!isMac') &&
    !codeOnly.includes('isMac?false:true')) {
  failures.push('updater.ts: autoUpdater.autoDownload must be false on macOS to prevent Squirrel.Mac SQRLCodeSignatureErrorDomain failures')
}

// 2. Invariant: SQRLCodeSignatureErrorDomain must be suppressed/ignored on macOS
if (!updaterContent.includes('SQRLCodeSignatureErrorDomain')) {
  failures.push('updater.ts: must explicitly handle/suppress SQRLCodeSignatureErrorDomain on macOS')
}

// 3. Invariant: installMacUpdate must strip macOS quarantine flags
if (!updaterContent.includes('xattr -cr')) {
  failures.push('updater.ts: installMacUpdate must execute "xattr -cr" to prevent Gatekeeper quarantine issues')
}

// 4. Invariant: installMacUpdate must wait for the old PID before swapping
if (!updaterContent.includes('while kill -0 $PID 2>/dev/null; do')) {
  failures.push('updater.ts: installMacUpdate must wait for process PID termination before swapping app bundles')
}

// 5. Invariant: onAppQuit must be exported and called in before-quit
if (!updaterContent.includes('static onAppQuit(): void')) {
  failures.push('updater.ts: UpdaterManager must expose onAppQuit() for background update application')
}
if (!indexContent.includes('UpdaterManager.onAppQuit()')) {
  failures.push('index.ts: app.on("before-quit") must invoke UpdaterManager.onAppQuit()')
}

// 6. Test bash syntax of the script installMacUpdate writes out and runs. Its
// template is read from updater.ts, so the check cannot drift from what ships,
// and filled with stand-in values once for each forceRunAfter branch.
let scriptTemplate = null
const updaterAst = ts.createSourceFile(updaterFile, updaterContent, ts.ScriptTarget.Latest, true)
function findScriptTemplate(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(updaterAst) === 'scriptContent' && node.initializer && ts.isTemplateLiteral(node.initializer)) {
    scriptTemplate = node.initializer.getText(updaterAst)
  }
  ts.forEachChild(node, findScriptTemplate)
}
findScriptTemplate(updaterAst)
if (!scriptTemplate) {
  failures.push('updater.ts: installMacUpdate must build its script as "const scriptContent = `...`" so the guard can syntax-check the script that ships')
} else {
  for (const forceRunAfter of [true, false]) {
    try {
      const script = runInNewContext(scriptTemplate, {
        process: { pid: 99999 },
        zipPath: '/tmp/Update.zip',
        stagingDir: '/tmp/Staging',
        stagedApp: '/tmp/Staging/BLDesk.app',
        targetApp: '/tmp/Test.app',
        shQuote: (word) => `'${word}'`,
        forceRunAfter
      })
      execFileSync('bash', ['-n'], { input: script, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      failures.push(`installMacUpdate script (forceRunAfter=${forceRunAfter}) failed the bash syntax check, or could not be built (a new variable in its template needs a stand-in value in this guard): ${err.message}`)
    }
  }
  failures.push(...installOrderProblems(scriptTemplate))
}

// 7. The installed app may only be swapped out by renaming, once the new bundle has unzipped and been copied next to
// it: unzip's exit status must be acted on, and no recursive rm may name the installed app, directly or through a
// variable set to it. Plain-text checks on the script template, with its bash comments removed. They cannot follow
// the script's logic, so these still pass: an exit status that is captured and tested wrongly, a removal through a
// path built another way (a subfolder of the app, `$(...)`, `find -delete`), a rename of the app to a folder that is
// deleted later, or a copy over the installed app.
function installOrderProblems(template) {
  const problems = []
  const lines = template.split('\n').map((l) => l.replace(/(^|\s)#.*$/, ''))
  const appRefs = new Set(['${targetApp}', '${shQuote(targetApp)}'])
  for (const l of lines) {
    const alias = l.match(/^\s*([A-Za-z_]\w*)=(?:(["']?)\$\{targetApp\}\2|\$\{shQuote\(targetApp\)\})\s*$/)
    if (alias) appRefs.add('$' + alias[1])
  }
  const lead = new Set(['if', 'elif', 'then', 'else', 'do', 'while', 'until', '!', '{', '(', 'command', 'exec'])
  const commands = (line) =>
    line.split(/&&|\|\||[;|]/).map((seg) => {
      const words = seg.trim().split(/\s+/).filter(Boolean)
      const tested = []
      while (words.length && lead.has(words[0])) tested.push(words.shift())
      return { words, tested }
    })
  let unzipChecked = false
  lines.forEach((line, i) => {
    for (const { words, tested } of commands(line)) {
      const name = (words[0] || '').split('/').pop()
      if (name === 'rm') {
        const opts = []
        const operands = []
        for (const w of words.slice(1)) (w.startsWith('-') && !operands.length ? opts : operands).push(w)
        const recursive = opts.some((o) => o === '--recursive' || (/^-[^-]/.test(o) && /[rR]/.test(o)))
        const names = operands.map((o) => o.replace(/^(["'])(.*)\1$/, '$2').replace(/\/+$/, ''))
        if (recursive && names.some((n) => appRefs.has(n))) {
          problems.push(`updater.ts: the installMacUpdate script removes the installed app ("${line.trim()}"); copy the new bundle next to it and swap the two by renaming instead`)
        }
      }
      if (name === 'unzip') {
        const next = lines.slice(i + 1).find((l) => l.trim())
        const captured = next && next.match(/^\s*([A-Za-z_]\w*)=\$\?\s*$/)
        const usedLater = captured && lines.slice(i + 2).some((l) => new RegExp(`\\$${captured[1]}\\b`).test(l))
        if (tested.some((t) => ['if', 'elif', 'while', 'until', '!'].includes(t)) || /&&|\|\|/.test(line) || usedLater) unzipChecked = true
      }
    }
  })
  if (!unzipChecked) {
    problems.push('updater.ts: the installMacUpdate script must act on unzip\'s exit status (in an if, with && or ||, or saved with VAR=$? on the next line and tested) before it replaces the installed app')
  }
  return problems
}

if (failures.length > 0) {
  console.error('Updater guards failed:\n' + failures.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}

console.log('Updater guards passed')
