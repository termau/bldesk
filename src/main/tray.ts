import { app, BrowserWindow, Menu, MenuItemConstructorOptions, Notification, Tray, clipboard, nativeImage, NativeImage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { NotificationKind, SystemNotificationOptions, TrayFleetSummary, TraySettings } from '../shared/ipc-types'
import { DeepLinkManager } from './deeplink'
import { formatDeepLink } from '../shared/deeplink'
import { UpdaterManager } from './updater'

/**
 * The tray / menu-bar item (FEATURES.md #3).
 *
 * The renderer owns the data — it already polls the server list every 15 s and
 * tracks actions to completion — and pushes a `TrayFleetSummary` here whenever
 * the picture changes. Main turns that into a tooltip, a menu with counts and a
 * Quick SSH submenu, and (on macOS) a title next to the icon while actions run.
 *
 * Settings live in `<userData>/tray.json` and are edited from the menu itself,
 * so there is no renderer UI to build or keep in sync. Notification categories
 * are filtered here too: every notification the app sends passes through
 * `notify()`, and a muted kind is dropped before it reaches the OS.
 */

const SETTINGS_FILE = 'tray.json'

const DEFAULTS: TraySettings = {
  launchAtLogin: false,
  closeToTray: true,
  notifyServerState: true,
  notifyActions: true,
  notifyBalance: true
}

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

function readSettings(): TraySettings {
  try {
    const p = settingsPath()
    if (existsSync(p)) {
      const parsed = JSON.parse(readFileSync(p, 'utf8'))
      const out = { ...DEFAULTS }
      for (const key of Object.keys(DEFAULTS) as Array<keyof TraySettings>) {
        if (typeof parsed?.[key] === 'boolean') out[key] = parsed[key]
      }
      return out
    }
  } catch (err) {
    console.warn('[Tray] Failed to read settings:', err)
  }
  return { ...DEFAULTS }
}

function writeSettings(s: TraySettings): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf8')
  } catch (err) {
    console.warn('[Tray] Failed to write settings:', err)
  }
}

const KIND_SETTING: Partial<Record<NotificationKind, keyof TraySettings>> = {
  'server-state': 'notifyServerState',
  action: 'notifyActions',
  balance: 'notifyBalance'
}

export class TrayManager {
  private static tray: Tray | null = null
  private static settings: TraySettings = { ...DEFAULTS }
  private static summary: TrayFleetSummary | null = null
  private static getWindow: () => BrowserWindow | null = () => null
  private static showWindow: () => void = () => {}
  private static hiddenToTrayNoticeShown = false

  static init(opts: { icon: NativeImage; getWindow: () => BrowserWindow | null; showWindow: () => void }): void {
    this.getWindow = opts.getWindow
    this.showWindow = opts.showWindow
    this.settings = readSettings()
    // Re-assert the login item only when it is on: registering an unpackaged
    // dev binary fails ("Operation not permitted" on macOS), and there is
    // nothing to reconcile when the user never asked for it.
    if (this.settings.launchAtLogin) this.applyLoginItem()

    try {
      this.tray = new Tray(opts.icon)
      this.tray.setToolTip('BLDesk - BinaryLane Desktop')
      this.tray.on('double-click', () => this.showWindow())
      // Windows: single click opens; macOS/Linux show the menu on click.
      if (process.platform === 'win32') this.tray.on('click', () => this.showWindow())
      this.rebuild()
    } catch (err) {
      console.warn('[Tray] Failed to initialize tray:', err)
      this.tray = null
    }
  }

  static getSettings(): TraySettings {
    return { ...this.settings }
  }

  static setSetting<K extends keyof TraySettings>(key: K, value: TraySettings[K]): TraySettings {
    this.settings = { ...this.settings, [key]: value }
    writeSettings(this.settings)
    if (key === 'launchAtLogin') this.applyLoginItem()
    this.rebuild()
    return this.getSettings()
  }

  /** Called by the renderer whenever the fleet picture changes. */
  static update(summary: TrayFleetSummary): void {
    this.summary = summary
    this.rebuild()
  }

  /** Renderer is gone (profile switch mid-flight, window closed): show a neutral state. */
  static clear(): void {
    this.summary = null
    this.rebuild()
  }

  /**
   * The one place app notifications go through. Returns whether it was shown,
   * so callers can fall back to in-app feedback when a kind is muted.
   */
  static notify(options: SystemNotificationOptions): boolean {
    const kind = options.kind ?? 'general'
    const gate = KIND_SETTING[kind]
    if (gate && !this.settings[gate]) return false
    if (!Notification.isSupported()) return false
    const n = new Notification({ title: options.title, body: options.body, silent: false })
    // Clicking a notification is a request to look, so bring the window back.
    n.on('click', () => this.showWindow())
    n.show()
    return true
  }

  /** Whether a window close should hide to the tray rather than quit. */
  static shouldHideOnClose(): boolean {
    return this.settings.closeToTray && this.tray !== null
  }

  /** The window was just hidden instead of closed; say so the first time. */
  static onHiddenToTray(): void {
    if (this.hiddenToTrayNoticeShown) return
    this.hiddenToTrayNoticeShown = true
    this.notify({
      title: 'BLDesk is still running',
      body:
        process.platform === 'darwin'
          ? 'Find it in the menu bar. Use Quit from there to exit fully.'
          : 'Find it in the system tray. Use Quit from there to exit fully.'
    })
  }

  static dispose(): void {
    this.tray?.destroy()
    this.tray = null
  }

  // -------------------------------------------------------------------------

  private static applyLoginItem(): void {
    // Electron implements this on macOS and Windows only; Linux autostart is a
    // .desktop file the user manages, so the menu item is hidden there.
    if (process.platform === 'linux') return
    if (!app.isPackaged) {
      console.log('[Tray] Not packaged; launch-at-login not applied (dev mode).')
      return
    }
    try {
      app.setLoginItemSettings({ openAtLogin: this.settings.launchAtLogin, openAsHidden: true })
    } catch (err) {
      console.warn('[Tray] Failed to set login item:', err)
    }
  }

  private static rebuild(): void {
    if (!this.tray) return
    const s = this.summary

    // Tooltip: the counts at a glance.
    const parts: string[] = []
    if (s) {
      parts.push(`${s.running} running`)
      if (s.off) parts.push(`${s.off} off`)
      if (s.other) parts.push(`${s.other} other`)
      if (s.inProgress) parts.push(`${s.inProgress} in progress`)
      if (s.awaitingAnswer) parts.push(`${s.awaitingAnswer} awaiting your answer`)
      if (s.failedInvoices) parts.push(`${s.failedInvoices} failed payment${s.failedInvoices === 1 ? '' : 's'}`)
    }
    this.tray.setToolTip(s ? `BLDesk — ${parts.join(', ')}` : 'BLDesk - BinaryLane Desktop')

    // macOS shows text beside the icon. Only while something needs you —
    // a permanent number in the menu bar is noise, a transient one is a signal.
    // "!" outranks the spinner: a paused action or a failed payment is a thing
    // to act on, progress is just a thing to know.
    if (process.platform === 'darwin') {
      const needsYou = (s?.awaitingAnswer ?? 0) + (s?.failedInvoices ?? 0)
      const title = needsYou ? `!${needsYou}` : s?.inProgress ? `↻${s.inProgress}` : ''
      this.tray.setTitle(title, { fontType: 'monospacedDigit' })
    }

    const template: MenuItemConstructorOptions[] = []

    template.push({ label: s?.accountName ? `BLDesk — ${s.accountName}` : 'BLDesk - BinaryLane Cloud', enabled: false })
    if (s) {
      template.push({ label: `● ${s.running} running · ○ ${s.off} off${s.other ? ` · ◌ ${s.other} other` : ''}`, enabled: false })
      if (s.inProgress) template.push({ label: `↻ ${s.inProgress} action${s.inProgress === 1 ? '' : 's'} in progress`, enabled: false })
      if (s.awaitingAnswer) {
        template.push({
          label: `? ${s.awaitingAnswer} action${s.awaitingAnswer === 1 ? '' : 's'} need${s.awaitingAnswer === 1 ? 's' : ''} your answer…`,
          click: () => this.showWindow()
        })
      }
      if (s.failedInvoices) {
        template.push({
          label: `⚠ ${s.failedInvoices} invoice payment${s.failedInvoices === 1 ? '' : 's'} failed…`,
          click: () => {
            this.showWindow()
            DeepLinkManager.dispatch(formatDeepLink({ kind: 'tab', tab: 'billing' }))
          }
        })
      }
      if (typeof s.availableCredit === 'number') {
        template.push({ label: `Credit: $${s.availableCredit.toFixed(2)} AUD`, enabled: false })
      }
    } else {
      template.push({ label: 'Not signed in', enabled: false })
    }

    template.push({ type: 'separator' })
    template.push({ label: 'Open Dashboard', click: () => this.showWindow() })

    // Servers: one submenu each, running ones first. Read-only conveniences
    // only — anything that changes a server belongs behind the window's review
    // step, not a menu click with no preview.
    const all = s?.servers ?? []
    if (all.length > 0) {
      const sorted = [...all].sort((a, b) => {
        if (a.status === b.status) return a.name.localeCompare(b.name)
        return a.status === 'active' ? -1 : b.status === 'active' ? 1 : 0
      })
      template.push({
        label: 'Servers',
        submenu: sorted.map<MenuItemConstructorOptions>((srv) => ({
          label: `${srv.status === 'active' ? '●' : srv.status === 'off' ? '○' : '◌'} ${srv.name}`,
          sublabel: srv.ip,
          submenu: [
            {
              label: 'Open in BLDesk',
              click: () => {
                this.showWindow()
                DeepLinkManager.dispatch(formatDeepLink({ kind: 'server', serverId: srv.id }))
              }
            },
            {
              label: srv.ip ? `Copy IP  ${srv.ip}` : 'Copy IP',
              enabled: !!srv.ip,
              click: () => clipboard.writeText(srv.ip!)
            },
            {
              label: 'SSH as root',
              enabled: !!srv.ip && srv.status === 'active',
              click: () => {
                this.showWindow()
                DeepLinkManager.dispatch(formatDeepLink({ kind: 'ssh', serverId: srv.id }))
              }
            }
          ]
        }))
      })
    }

    template.push({ type: 'separator' })

    const settingsItems: MenuItemConstructorOptions[] = []
    if (process.platform !== 'linux') {
      settingsItems.push({
        label: 'Launch at login',
        type: 'checkbox',
        checked: this.settings.launchAtLogin,
        click: (item) => this.setSetting('launchAtLogin', item.checked)
      })
    }
    settingsItems.push(
      {
        label: 'Keep running in tray when window is closed',
        type: 'checkbox',
        checked: this.settings.closeToTray,
        click: (item) => this.setSetting('closeToTray', item.checked)
      },
      { type: 'separator' },
      {
        label: 'Notify when a server changes state',
        type: 'checkbox',
        checked: this.settings.notifyServerState,
        click: (item) => this.setSetting('notifyServerState', item.checked)
      },
      {
        label: 'Notify when an action finishes or fails',
        type: 'checkbox',
        checked: this.settings.notifyActions,
        click: (item) => this.setSetting('notifyActions', item.checked)
      },
      {
        label: 'Notify about billing (low credit, failed payments)',
        type: 'checkbox',
        checked: this.settings.notifyBalance,
        click: (item) => this.setSetting('notifyBalance', item.checked)
      }
    )
    template.push({ label: 'Settings', submenu: settingsItems })

    template.push({
      label: 'Check for updates',
      enabled: app.isPackaged,
      click: () => void UpdaterManager.check()
    })

    template.push({ type: 'separator' })
    template.push({ label: 'Quit BLDesk', click: () => app.quit() })

    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }
}

/** Convenience for callers that only have a data URL fallback. */
export function trayImageFromDataUrl(dataUrl: string): NativeImage {
  return nativeImage.createFromDataURL(dataUrl)
}
