import { app, BrowserWindow } from 'electron'
import { DEEP_LINK_SCHEME, findDeepLinkInArgv, isDeepLinkUrl } from '../shared/deeplink'
import { IS_PRODUCTION_BUILD } from './developmentUserData'

/**
 * OS-level registration and delivery of bldesk:// links.
 *
 * Delivery differs per platform:
 *  - macOS fires `open-url` (on cold start it can arrive before `ready`).
 *  - Windows / Linux pass the URL in argv — on cold start in process.argv,
 *    and for a running instance via `second-instance` (we hold the single
 *    instance lock in index.ts).
 *
 * The renderer may not exist yet when a link arrives, so links are queued and
 * handed over when it asks (`getPending`) or pushed when it's already up.
 */

export class DeepLinkManager {
  private static pending: string | null = null
  private static getWindow: () => BrowserWindow | null = () => null
  private static ensureWindow: () => void = () => {}
  private static rendererReady = false

  /** Call before app.whenReady() so a cold-start `open-url` on macOS isn't missed. */
  static register(opts: { getWindow: () => BrowserWindow | null; ensureWindow: () => void }): void {
    this.getWindow = opts.getWindow
    this.ensureWindow = opts.ensureWindow

    // Only the baked production flavor may claim or consume bldesk:// links.
    // A packaged local build is still a local build and must have no protocol
    // relationship with an installed Stable/Beta application.
    if (!IS_PRODUCTION_BUILD || !app.isPackaged) return
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)

    app.on('open-url', (event, url) => {
      event.preventDefault()
      this.dispatch(url)
    })

    // Cold start on Windows / Linux
    const initial = findDeepLinkInArgv(process.argv)
    if (initial) this.pending = initial
  }

  /** Wire into the existing `second-instance` handler (Windows / Linux, app already running). */
  static handleSecondInstance(argv: readonly string[]): void {
    if (!IS_PRODUCTION_BUILD || !app.isPackaged) return
    const url = findDeepLinkInArgv(argv)
    if (url) this.dispatch(url)
  }

  /** Renderer signals it has mounted and subscribed; flush anything queued. */
  static markRendererReady(): void {
    this.rendererReady = true
    if (this.pending) {
      const url = this.pending
      this.pending = null
      this.send(url)
    }
  }

  /** One-shot read of a queued link (renderer calls on mount). */
  static takePending(): string | null {
    const url = this.pending
    this.pending = null
    return url
  }

  static dispatch(url: string): void {
    if (!isDeepLinkUrl(url)) return
    console.log('[DeepLink] Received:', url)

    this.ensureWindow()
    const win = this.getWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }

    if (this.rendererReady && win && !win.isDestroyed()) {
      this.send(url)
    } else {
      this.pending = url
    }
  }

  static onWindowClosed(): void {
    this.rendererReady = false
  }

  private static send(url: string): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('deeplink:open', url)
    else this.pending = url
  }
}
