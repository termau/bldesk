import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { release } from 'node:os'
import type * as NodePty from 'node-pty'
import { sshArgv, validateSshTarget } from '../shared/ssh'
import type { PtyOpenOptions, PtySessionInfo } from '../shared/ipc-types'
import { findOnPath } from './terminal'

interface Session {
  process: NodePty.IPty
  info: PtySessionInfo
  pending: string
  timer?: ReturnType<typeof setTimeout>
  subscriptions: NodePty.IDisposable[]
}
const sessions = new Map<string, Session>()
let ptyModule: Promise<typeof import('node-pty')> | undefined
function loadPty(): Promise<typeof import('node-pty')> {
  // A damaged/missing native module must not prevent BLDesk from starting;
  // open() reports the failure and the renderer offers native SSH instead.
  return ptyModule ??= import('node-pty')
}
let getWindow: () => BrowserWindow | null = () => null

function send(channel: string, ...args: unknown[]): void {
  const win = getWindow()
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
}

function dimensions(cols: number, rows: number): void {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1 || cols > 1000 || rows > 1000) {
    throw new Error('Terminal dimensions must be whole numbers: 2–1000 columns, 1–1000 rows.')
  }
}

function flush(session: Session): void {
  clearTimeout(session.timer)
  session.timer = undefined
  while (session.pending) {
    send('pty:data', session.info.id, session.pending.slice(0, 65536))
    session.pending = session.pending.slice(65536)
  }
  session.pending = ''
}

export async function open(options: PtyOpenOptions): Promise<{ id: string }> {
  if (!options || typeof options.host !== 'string' ||
      (options.username !== undefined && typeof options.username !== 'string') ||
      (options.privateKeyPath !== undefined && typeof options.privateKeyPath !== 'string')) {
    throw new Error('Invalid SSH options.')
  }
  const invalid = validateSshTarget(options)
  if (invalid) throw new Error(invalid)
  dimensions(options.cols, options.rows)
  if (options.serverId !== undefined && (!Number.isSafeInteger(options.serverId) || options.serverId < 1)) throw new Error('Invalid server ID.')
  if (options.serverName !== undefined && (typeof options.serverName !== 'string' || options.serverName.length > 253)) throw new Error('Invalid server name.')
  if (options.remoteCommand !== undefined && (typeof options.remoteCommand !== 'string' || !options.remoteCommand.trim() || options.remoteCommand.length > 32768 || options.remoteCommand.includes('\0'))) {
    throw new Error('Broadcast command must contain 1–32768 characters and no NUL.')
  }
  if (sessions.size >= 32) throw new Error('At most 32 SSH sessions can run at once. Close a session first.')
  // node-pty 1.1.0 itself falls back to winpty below build 18309, even with
  // useConpty:true. Refuse that path (first supported stable release: 1903).
  const windowsBuild = Number(release().split('.')[2])
  if (process.platform === 'win32' && (!Number.isInteger(windowsBuild) || windowsBuild < 18362)) {
    throw new Error('Windows 10 1903 or later is required for the embedded terminal. Use Open in native terminal.')
  }
  const sshPath = findOnPath('ssh')
  if (!sshPath) throw new Error('OpenSSH client not found')
  const pty = await loadPty()
  const child = pty.spawn(sshPath, sshArgv(options, options.remoteCommand).slice(1), {
    name: 'xterm-256color', cols: options.cols, rows: options.rows,
    env: { ...process.env, TERM: 'xterm-256color' },
    ...(process.platform === 'win32' ? { useConpty: true } : {})
  })
  const id = randomUUID()
  const session: Session = {
    process: child, pending: '', subscriptions: [],
    info: { id, serverId: options.serverId, serverName: options.serverName || options.host,
      host: options.host, username: options.username || 'root', status: 'live', broadcast: options.remoteCommand !== undefined }
  }
  sessions.set(id, session)
  session.subscriptions.push(child.onData((data) => {
    session.pending += data
    // Bound each IPC payload as well as batching time; never log remote output.
    if (session.pending.length >= 65536) flush(session)
    else if (!session.timer) session.timer = setTimeout(() => flush(session), 16)
  }), child.onExit(({ exitCode, signal }) => {
    flush(session)
    sessions.delete(id)
    send('pty:exit', id, exitCode, signal)
    session.subscriptions.forEach((sub) => sub.dispose())
  }))
  return { id }
}

export function write(id: string, data: string): void {
  if (typeof data !== 'string' || data.length > 65536) throw new Error('Terminal input is too large (64 KiB maximum).')
  sessions.get(id)?.process.write(data)
}
export function resize(id: string, cols: number, rows: number): void {
  dimensions(cols, rows)
  sessions.get(id)?.process.resize(cols, rows)
}
export function close(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  // Keep it counted until onExit: rapid close/open cannot bypass the cap.
  session.process.kill('SIGHUP')
}
export function list(): PtySessionInfo[] { return [...sessions.values()].map((s) => ({ ...s.info })) }
export function closeAll(): void {
  for (const id of sessions.keys()) {
    try { close(id) } catch { /* already exiting */ }
  }
}

export function registerPtyHandlers(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  function requireMainRenderer(event: IpcMainInvokeEvent): void {
    const mainWindow = getWindow()
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('PTY access is restricted to the main window.')
    }
  }
  ipcMain.handle('pty:open', (event, options: PtyOpenOptions) => { requireMainRenderer(event); return open(options) })
  ipcMain.handle('pty:write', (event, id: string, data: string) => { requireMainRenderer(event); write(id, data) })
  ipcMain.handle('pty:resize', (event, id: string, cols: number, rows: number) => { requireMainRenderer(event); resize(id, cols, rows) })
  ipcMain.handle('pty:close', (event, id: string) => { requireMainRenderer(event); close(id) })
  ipcMain.handle('pty:list', (event) => { requireMainRenderer(event); return list() })
}
