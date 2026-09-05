// Real Electron + OpenSSH + node-pty against a disposable loopback SSH protocol
// fixture. No production account, SSH config, known_hosts, agent or cloud access.
// The server implements a small deterministic command set, NOT a VPS shell.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import ssh2 from 'ssh2'
const { Server, utils } = ssh2
const require = createRequire(import.meta.url)
const { _electron: electron } = await import(process.env.BLDESK_PLAYWRIGHT_MODULE || 'playwright')
const root = resolve(import.meta.dirname, '..')
const dir = mkdtempSync(join(tmpdir(), 'bldesk-terminal-smoke-'))
const key = join(dir, 'identity')
execFileSync('/usr/bin/ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', key, '-q'])
const publicKey = utils.parseKey(readFileSync(`${key}.pub`))
const clients = new Set()
const report = { connections: 0, authenticated: 0, passwords: 0, commands: [], sizes: [], output: dir }
const fixture = new Server({ hostKeys: [readFileSync(key)] }, (client) => {
  report.connections++
  clients.add(client)
  client.on('error', () => {}).on('close', () => clients.delete(client))
  client.on('authentication', (ctx) => {
    if (ctx.username === 'password' && ctx.method === 'password' && ctx.password === 'smoke-password') { report.passwords++; ctx.accept(); return }
    if (ctx.username !== 'password' && ctx.method === 'publickey' && ctx.key.data.equals(publicKey.getPublicSSH()) && (!ctx.signature || publicKey.verify(ctx.blob, ctx.signature) === true)) { ctx.accept(); return }
    ctx.reject(ctx.username === 'password' ? ['password'] : ['publickey'])
  }).on('ready', () => {
    report.authenticated++
    client.on('session', (accept) => {
      const session = accept()
      let rows = 24, cols = 80
      session.on('pty', (accept, _reject, info) => { rows = info.rows; cols = info.cols; report.sizes.push([rows, cols]); accept() })
      session.on('window-change', (accept, _reject, info) => { rows = info.rows; cols = info.cols; report.sizes.push([rows, cols]); accept?.() })
      session.on('exec', (accept, _reject, info) => {
        report.commands.push(info.command)
        const stream = accept()
        // Delay enough to exercise parallel startup; preserve real SSH exit status.
        setTimeout(() => { stream.write(`fixture-${report.commands.length}\n`); stream.exit(info.command === 'exit 7' ? 7 : 0); stream.end() }, 350)
      })
      session.on('shell', (accept) => {
        const stream = accept(); stream.write('BLDesk disposable SSH fixture\r\nfixture$ ')
        let line = ''
        stream.on('data', (data) => {
          for (const ch of data.toString()) {
            if (ch === '\r' || ch === '\n') {
              stream.write('\r\n'); report.commands.push(line)
              if (line === 'uname -a') stream.write(execFileSync('/usr/bin/uname', ['-a']).toString().replaceAll('\n', '\r\n'))
              else if (line === 'stty size') stream.write(`${rows} ${cols}\r\n`)
              else if (line === 'exit') { stream.exit(0); stream.end(); return }
              else if (line) stream.write(`marker:${line}\r\n`)
              line = ''; stream.write('fixture$ ')
            } else if (ch === '\u007f') line = line.slice(0, -1)
            else { line += ch; stream.write(ch) }
          }
        })
      })
    })
  })
})
await new Promise((r) => fixture.listen(0, '127.0.0.1', r))
const port = fixture.address().port
const config = join(dir, 'ssh-config')
writeFileSync(config, `Host *\n  HostName 127.0.0.1\n  Port ${port}\n  IdentityFile ${key}\n  IdentitiesOnly yes\n  IdentityAgent none\n  UserKnownHostsFile ${join(dir, 'known_hosts')}\n  GlobalKnownHostsFile /dev/null\n  StrictHostKeyChecking ask\n  ForwardAgent no\n  ClearAllForwardings yes\n  ConnectTimeout 5\n`)
const bin = join(dir, 'bin'); mkdirSync(bin)
writeFileSync(join(bin, 'ssh'), `#!/bin/sh\nexec /usr/bin/ssh -F '${config}' "$@"\n`, { mode: 0o755 })
const userData = join(dir, 'userData'); mkdirSync(userData)
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, BLDESK_TEST_USER_DATA: userData, BLDESK_TEST_KEY: key }
let app, page
const errors = []
const deep = (url) => page.evaluate((url) => window.dispatchEvent(new CustomEvent('bldesk:local-deep-link', { detail: url })), url)
async function launch() {
  app = await electron.launch({ executablePath: process.env.BLDESK_TEST_ELECTRON || require('electron'), args: [join(root, 'scripts/showcase/launcher.cjs')], env, timeout: 30000 })
  page = await app.firstWindow(); page.setDefaultTimeout(15000)
  page.on('pageerror', (e) => errors.push(e.stack || e.message))
  await page.getByText('edge-web-syd-01', { exact: true }).first().waitFor()
  await deep('bldesk://tab/terminal')
}
async function textContains(text) { await page.waitForFunction((text) => [...document.querySelectorAll('.xterm-rows')].some((e) => e.textContent.includes(text)), text) }
async function send(id, text) { await page.evaluate(([id, text]) => window.bldeskApi.pty.write(id, text), [id, text]) }
async function current() { return page.evaluate(() => window.bldeskApi.pty.list()) }
async function reachable(locator, label) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  const viewport = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, `${label} is not reachable: ${JSON.stringify({ box, viewport })}`)
}
async function until(predicate) {
  const deadline = Date.now() + 15000
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for async SSH/History condition')
    await new Promise((r) => setTimeout(r, 100))
  }
}
async function answerHostKey(id) {
  await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some((e) => /Are you sure|fixture\$/.test(e.textContent)))
  const prompt = await page.locator('.xterm-rows').allTextContents()
  if (prompt.some((s) => s.includes('Are you sure'))) await send(id, 'yes\r')
}
try {
  await launch()
  await page.getByLabel('SSH host', { exact: true }).fill('192.0.2.20')
  await page.getByLabel('SSH port', { exact: true }).fill(String(port))
  await page.getByLabel('SSH key', { exact: true }).selectOption(key)
  await page.getByRole('button', { name: 'Connect in BLDesk', exact: true }).click()
  await page.getByRole('tab', { name: /edge-web-syd-01.*live/ }).waitFor()
  let id = (await current())[0].id
  await answerHostKey(id)
  await textContains('fixture$')
  await send(id, 'uname -a\r'); await textContains('Darwin')
  await send(id, 'needle-scrollback\r'); await textContains('marker:needle-scrollback')
  await deep('bldesk://tab/servers'); assert.equal((await current()).length, 1)
  await deep('bldesk://tab/terminal'); await textContains('marker:needle-scrollback')
  await page.locator('.xterm-helper-textarea').first().focus()
  await page.keyboard.press('Meta+f')
  await page.getByLabel('Find in terminal').fill('needle-scrollback')
  await page.getByRole('button', { name: 'Find next', exact: true }).click()
  assert.equal(await page.getByText('No match', { exact: true }).count(), 0)
  await page.getByLabel('Close terminal search').click()
  // Actual native zoom, not CSS scaling. Keep screenshot evidence outside repo.
  for (const [width, height] of [[1024, 680], [1280, 840]]) for (const zoom of [0.8, 1, 1.25, 1.5]) {
    await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(width, height); w.webContents.setZoomFactor(zoom) }, { width, height, zoom })
    await page.waitForTimeout(250)
    await send(id, 'stty size\r')
    await reachable(page.getByRole('tab', { name: /edge-web-syd-01/ }), 'session tab')
    const terminalNav = page.getByRole('button', { name: 'Embedded SSH', exact: true })
    if (!(await terminalNav.isVisible())) await page.getByTitle('Open Navigation Menu').click()
    await reachable(terminalNav, 'terminal navigation')
    // Selecting the current tab also closes the compact drawer.
    if (await page.getByTitle('Open Navigation Menu').isVisible()) await terminalNav.click()
    await page.getByLabel('New SSH session').click()
    await reachable(page.getByRole('button', { name: 'Open in native terminal', exact: true }), 'connect-bar native action')
    await page.getByLabel('New SSH session').click()
    await page.locator('.xterm-helper-textarea').first().focus()
    await page.keyboard.press('Meta+f')
    await reachable(page.getByLabel('Find in terminal'), 'terminal find bar')
    await page.getByLabel('Close terminal search').click()
    const box = await page.locator('[data-testid="terminal-view"] .xterm-screen').first().boundingBox()
    assert.ok(box && box.width > 100 && box.height > 50, JSON.stringify({ width, height, zoom, box }))
    await page.screenshot({ path: join(dir, `terminal-${width}-${height}-${zoom}.png`) })
  }
  assert.ok(new Set(report.sizes.map(String)).size > 3, 'SSH window-change must track native resize/zoom')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 840); w.webContents.setZoomFactor(1) })
  await page.getByLabel('Close SSH edge-web-syd-01', { exact: true }).click()
  await until(async () => (await current()).length === 0)
  // Password path: deliberately select a user for which the fixture rejects keys.
  await page.getByLabel('New SSH session').click()
  await page.getByLabel('SSH user', { exact: true }).fill('password')
  await page.getByRole('button', { name: 'Connect in BLDesk', exact: true }).click()
  id = (await current())[0].id
  await textContains('password:')
  await send(id, 'smoke-password\r'); await textContains('fixture$')
  assert.equal(report.passwords, 1)
  await page.getByLabel('Close SSH edge-web-syd-01', { exact: true }).click()
  await page.getByLabel('New SSH session').click()
  await page.getByLabel('SSH user', { exact: true }).fill('root')
  // Native override is stubbed, never opens the user's terminal.
  await page.getByRole('button', { name: 'Open in native terminal', exact: true }).click()
  assert.equal(await app.evaluate(() => global.showcase.nativeLaunches.length), 1)
  await page.getByRole('button', { name: 'Broadcast', exact: true }).click()
  await page.getByLabel('Broadcast targets').fill('#8100,#8101')
  await page.getByLabel('Broadcast command').fill('hostname')
  // The new destructive dialog remains operable throughout the supported
  // native zoom/viewport matrix; cancel each dry run so nothing executes.
  for (const [width, height] of [[1024, 680], [1280, 840]]) for (const zoom of [0.8, 1.25, 1.5]) {
    await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(width, height); w.webContents.setZoomFactor(zoom) }, { width, height, zoom })
    await page.getByRole('button', { name: 'Run broadcast', exact: true }).click()
    await reachable(page.getByRole('button', { name: /Run on all targets/ }), 'broadcast confirm action')
    await reachable(page.getByRole('button', { name: /Cancel/ }), 'broadcast cancel action')
    await page.getByRole('button', { name: /Cancel/ }).click()
  }
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 840); w.webContents.setZoomFactor(1) })
  const sixTargets = '#8100,#8101,#8102,#8103,#8104,#8105'
  await page.getByLabel('Broadcast targets').fill(sixTargets)
  await page.getByRole('button', { name: 'Run broadcast', exact: true }).click()
  const typedConfirm = page.getByRole('dialog').locator('input')
  assert.equal(await page.getByRole('button', { name: /Run on all targets/ }).isDisabled(), true)
  await typedConfirm.fill(sixTargets)
  assert.equal(await page.getByRole('button', { name: /Run on all targets/ }).isEnabled(), true)
  await page.getByRole('button', { name: /Cancel/ }).click()
  await page.getByLabel('Broadcast targets').fill('#8100,#8101')
  await page.getByRole('button', { name: 'Run broadcast', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: /Run on all targets/ }).click()
  await until(() => page.evaluate(async () => (await window.bldeskApi.changelogList('showcase-demo')).some((e) => e.label === 'Broadcast SSH command' && e.outcome === 'completed')))
  assert.equal(await page.getByText('exit 0', { exact: true }).count(), 2)
  assert.equal(report.commands.filter((c) => c === 'hostname').length, 2)
  const history = await page.evaluate(() => window.bldeskApi.changelogList('showcase-demo'))
  assert.ok(history[0].summary.includes('hostname'))
  assert.ok(!JSON.stringify(history).includes('fixture-'))
  await page.getByRole('button', { name: 'Close broadcast', exact: true }).click()
  // Two tabs, full app restart, no auto-connect.
  await page.getByRole('button', { name: 'Connect in BLDesk', exact: true }).click()
  await textContains('fixture$')
  await page.getByLabel('New SSH session').click()
  await page.getByLabel('SSH host', { exact: true }).fill('192.0.2.21')
  await page.getByRole('button', { name: 'Connect in BLDesk', exact: true }).click()
  await until(async () => (await current()).length === 2)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bldesk_terminal_tabs_v1')))
  assert.equal(stored.length, 2)
  assert.deepEqual(Object.keys(stored[0]).sort(), ['host', 'serverId', 'serverName', 'username'])
  await app.close(); app = undefined
  const before = report.connections
  await launch()
  await page.getByLabel('Reopen SSH sessions').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Reopen 2 sessions' }).count(), 1)
  await page.waitForTimeout(500)
  assert.equal(report.connections, before)
  assert.equal((await current()).length, 0)
  assert.deepEqual(errors, [])
  console.log('PASS', JSON.stringify(report))
} catch (error) {
  console.error('FAIL', JSON.stringify(report), errors)
  if (page && !page.isClosed()) {
    console.error(await page.locator('[data-testid="terminal-view"]').innerText())
    await page.screenshot({ path: join(dir, 'failure.png') })
  }
  throw error
} finally {
  if (app) await app.close()
  for (const client of clients) client.end()
  await new Promise((r) => fixture.close(r))
}
