import { app, ipcMain, session, shell, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'

/*
 * The main window's renderer holds the API token and has the full `bldeskApi`
 * bridge, so the rule here is simple: only the app's own page, in the main
 * window, may use it, and nothing may replace that page.
 *
 * - Navigation away from the app is blocked. Without this, dropping a link or
 *   file onto the window loaded that page with the preload attached.
 * - Every IPC handler checks its caller. A comparison of webContents alone is
 *   not enough, because it still matches after the window navigates, so the
 *   frame's URL must be the app's own entry.
 * - External links open only for http, https and mailto. On Windows other
 *   schemes can launch programs.
 * - Web permission requests are denied except clipboard writes.
 */

let getMainWindow: () => BrowserWindow | null = () => null
let appEntry: URL | null = null

/** The page the main window loads: the dev server in development, index.html when packaged. */
export function setAppEntry(url: string): void {
  appEntry = new URL(url)
}

export function isAppUrl(url: string | undefined): boolean {
  if (!url || !appEntry) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (appEntry.protocol === 'file:') return u.protocol === 'file:' && u.pathname === appEntry.pathname
  return u.origin === appEntry.origin
}

function isMainAppFrame(event: IpcMainInvokeEvent): boolean {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return false
  return event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && isAppUrl(event.senderFrame?.url)
}

const EXTERNAL_SCHEMES = new Set(['https:', 'http:', 'mailto:'])

export function openExternalSafe(url: unknown): Promise<void> {
  let u: URL
  try {
    u = new URL(String(url))
  } catch {
    return Promise.reject(new Error('Not a valid link.'))
  }
  if (!EXTERNAL_SCHEMES.has(u.protocol)) return Promise.reject(new Error(`Links using ${u.protocol} are not opened.`))
  return shell.openExternal(u.href)
}

/*
 * Wraps `ipcMain.handle` once, before any handler is registered, so every
 * channel - including ones added later - rejects callers that are not the
 * app's own page in the main window. The pty and SSH-key handlers keep their
 * own stricter checks as well.
 */
export function installIpcSenderGuard(windowGetter: () => BrowserWindow | null): void {
  getMainWindow = windowGetter
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) =>
    handle(channel, (event, ...args) => {
      if (!isMainAppFrame(event)) throw new Error(`IPC ${channel} is restricted to the BLDesk window.`)
      return listener(event, ...args)
    })
}

const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

function isMainContents(contents: WebContents | null): boolean {
  const win = getMainWindow()
  return !!contents && !!win && !win.isDestroyed() && contents === win.webContents
}

/** Navigation, new-window and permission rules for every webContents the app creates. */
export function installNavigationGuards(): void {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
    callback(isMainContents(contents) && ALLOWED_PERMISSIONS.has(permission))
  )
  session.defaultSession.setPermissionCheckHandler((contents, permission) => isMainContents(contents) && ALLOWED_PERMISSIONS.has(permission))

  app.on('web-contents-created', (_, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      // Links meant for the browser (target=_blank, window.open) go to the system browser.
      if (isMainContents(contents)) void openExternalSafe(url).catch(() => undefined)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (isMainContents(contents)) {
        if (!isAppUrl(url)) event.preventDefault()
        return
      }
      // Other windows (the rescue console) stay on the origin they were opened at.
      try {
        if (new URL(url).origin !== new URL(contents.getURL()).origin) event.preventDefault()
      } catch {
        event.preventDefault()
      }
    })
  })
}

/** The rescue console is a remote page: https only, and never in the app's own session. */
export function rescueConsoleUrl(url: unknown): string {
  let u: URL
  try {
    u = new URL(String(url))
  } catch {
    throw new Error('The console address is not a valid URL.')
  }
  if (u.protocol !== 'https:') throw new Error('The console address must use https.')
  return u.href
}

export const RESCUE_CONSOLE_PARTITION = 'rescue-console'

/** Deny every web permission in the console's own session. */
export function lockRescueConsoleSession(): void {
  const s = session.fromPartition(RESCUE_CONSOLE_PARTITION)
  s.setPermissionRequestHandler((_c, _p, callback) => callback(false))
  s.setPermissionCheckHandler(() => false)
}
