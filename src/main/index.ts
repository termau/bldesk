import { app, shell, BrowserWindow, ipcMain, nativeImage, NativeImage, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { isIP } from 'node:net'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { VaultManager } from './safeStorage'
import { launchAuthorizedTerminal } from './remoteAccess'
import { UpdaterManager } from './updater'
import { probeTcp, probePing, traceroute, setAllowedTargets } from './reachability'
import { DeepLinkManager } from './deeplink'
import { TrayManager } from './tray'
import { ChangeLogStore } from './changelog'
import { TemplateStore } from './templates'
import { ConsoleWindowOptions, SystemNotificationOptions, TerminalLaunchOptions, TrayFleetSummary, UpdateChannel, type ServerProbeTarget } from '../shared/ipc-types'
import { decideServerOperationAccess, isRemoteAccessAllowed } from '../shared/binarylane-policy'
import { decideResourceOperationAccess } from '../shared/resource-safety'
import { BinaryLaneBroker } from './binarylane'
import { IS_LOCAL_BUILD, LOCAL_APP_ID, PRODUCTION_APP_ID } from './developmentUserData'

// Linux sandbox note: Chromium decides how to sandbox before this file runs,
// so `--no-sandbox` cannot be added from here. The AppImage launcher
// (scripts/after-pack.cjs) adds it on kernels that leave no alternative; the
// production .deb installs an AppArmor profile instead (linux/after-install.sh).

let mainWindow: BrowserWindow | null = null
/** Set on before-quit so a window close from Quit is not turned into a hide. */
let isQuitting = false

function requireMainRenderer(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('Blocked IPC request from an untrusted renderer frame.')
  }
}

function isSafetyConfigured(policy: NonNullable<ReturnType<typeof VaultManager.getActiveProfilePolicy>>): boolean {
  return policy.protectedServerIds.length > 0 || policy.maintenanceServerIds.length > 0 ||
    policy.protectedResources.length > 0 || policy.maintenanceResources.length > 0
}

function requireCollectionMutationAccess(noun: string): void {
  const policy = VaultManager.getActiveProfilePolicy()
  if (!policy) throw new Error(`No active profile is available to create ${noun}.`)
  if (policy.accessMode === 'full') return
  if (policy.accessMode === 'observe') {
    throw new Error(`Observe-only safety blocks creating ${noun}.`)
  }
  if (!isSafetyConfigured(policy)) {
    throw new Error('Protected mode requires at least one Read-only or Maintenance entity.')
  }
}

function requireTemplateMutationAccess(slug: unknown, operation: 'maintenance' | 'destructive'): void {
  const policy = VaultManager.getActiveProfilePolicy()
  if (!policy) throw new Error('No active profile is available to change this template.')
  const decision = decideResourceOperationAccess(
    policy.accessMode,
    isSafetyConfigured(policy),
    policy,
    'template',
    slug,
    operation
  )
  if (decision.allowed) return
  if (decision.reason === 'protected-resource') {
    throw new Error('Read-only allows this template to be viewed, but blocks every change.')
  }
  if (decision.reason === 'maintenance-resource-restricted') {
    throw new Error('Maintenance allows in-place template edits, but blocks renaming or deleting it.')
  }
  if (decision.reason === 'observe-only') throw new Error('Observe-only safety blocks template changes.')
  if (decision.reason === 'guarded-not-configured') {
    throw new Error('Protected mode requires at least one Read-only or Maintenance entity.')
  }
  throw new Error('The template identity cannot be verified safely.')
}

/**
 * Resolve a renderer probe request against privileged state before any socket
 * or system diagnostic starts. The renderer's target allow-list remains useful
 * defence in depth, but it is not an authority: this binds the host to the
 * active vault profile, its current server tier, and BinaryLane's current
 * server record. A policy/profile change during the ownership lookup is caught
 * by the second vault check.
 */
async function authorizeProbeTarget(
  event: IpcMainInvokeEvent,
  targetValue: unknown
): Promise<string | null> {
  requireMainRenderer(event)
  if (!targetValue || typeof targetValue !== 'object' || Array.isArray(targetValue)) return null

  const target = targetValue as Partial<ServerProbeTarget>
  if (
    typeof target.profileId !== 'string' ||
    !Number.isSafeInteger(target.serverId) ||
    Number(target.serverId) <= 0 ||
    typeof target.host !== 'string' ||
    isIP(target.host) === 0
  ) {
    return null
  }

  let active: ReturnType<typeof VaultManager.getActiveProfile>
  try {
    active = VaultManager.getActiveProfile()
  } catch {
    return null
  }
  if (
    !active ||
    active.id !== target.profileId ||
    !decideServerOperationAccess(active, target.serverId, 'diagnostic').allowed
  ) {
    return null
  }

  const serverId = Number(target.serverId)
  try {
    if (!(await BinaryLaneBroker.verifyServerHost(active.id, serverId, target.host))) return null
  } catch {
    return null
  }

  try {
    const current = VaultManager.getActiveProfile()
    if (
      !current ||
      current.id !== active.id ||
      !decideServerOperationAccess(current, serverId, 'diagnostic').allowed
    ) {
      return null
    }
  } catch {
    return null
  }

  return target.host
}

function showMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else if (app.isReady()) {
    createWindow()
  }
}

function getPreloadPath(): string {
  const appPath = app.getAppPath()
  const candidatePaths = [
    join(appPath, 'out/preload/index.cjs'),
    join(appPath, 'out/preload/index.mjs'),
    join(appPath, 'out/preload/index.js'),
    join(__dirname, '../preload/index.cjs'),
    join(__dirname, '../preload/index.mjs'),
    join(__dirname, '../preload/index.js'),
  ]
  for (const p of candidatePaths) {
    if (existsSync(p)) return p
  }
  return candidatePaths[0]
}

function getRendererPath(): string {
  const appPath = app.getAppPath()
  const candidatePaths = [
    join(appPath, 'out/renderer/index.html'),
    join(__dirname, '../renderer/index.html'),
    join(process.resourcesPath, 'app.asar/out/renderer/index.html')
  ]
  for (const p of candidatePaths) {
    if (existsSync(p)) return p
  }
  return candidatePaths[0]
}

import { APP_ICON_DATA_URL, TRAY_ICON_DATA_URL } from './embedded-icons'

function getIconPath(filename: string): string {
  const possiblePaths = [
    join(process.resourcesPath, 'resources', filename),
    join(process.resourcesPath, filename),
    join(__dirname, '../../resources', filename),
    join(__dirname, '../resources', filename),
    join(app.getAppPath(), 'resources', filename)
  ]

  for (const p of possiblePaths) {
    if (existsSync(p)) return p
  }

  return possiblePaths[0]
}

function getAppIcon(): NativeImage {
  const icoPath = getIconPath('icon.ico')
  if (process.platform === 'win32' && existsSync(icoPath)) {
    try {
      const img = nativeImage.createFromPath(icoPath)
      if (!img.isEmpty()) return img
    } catch {
      // fallback to embedded
    }
  }
  return nativeImage.createFromDataURL(APP_ICON_DATA_URL)
}

function getTrayIcon(): NativeImage {
  const icoPath = getIconPath('icon.ico')
  if (process.platform === 'win32' && existsSync(icoPath)) {
    try {
      const img = nativeImage.createFromPath(icoPath)
      if (!img.isEmpty()) return img
    } catch {
      // fallback
    }
  }
  const trayPath = getIconPath('tray-16.png')
  if (existsSync(trayPath)) {
    try {
      const img = nativeImage.createFromPath(trayPath)
      if (!img.isEmpty()) return img
    } catch {
      // fallback to embedded
    }
  }
  return nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
}

function createWindow(): void {
  const preload = getPreloadPath()
  const appIcon = getAppIcon()
  console.log('[Main] Using preload path:', preload)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'BLDesk - BinaryLane Desktop',
    icon: appIcon,
    // One set of window chrome, not two. The app draws its own title bar with
    // window controls, so on Windows and Linux the OS frame is dropped (like
    // Chrome); on macOS the native traffic lights are kept and overlaid on the
    // app bar, and the app hides its own controls there. Resizing still works
    // on a frameless window; the bar is the drag region (see TitleBar.tsx).
    ...(process.platform === 'darwin'
      ? { frame: true, titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : { frame: false }),
    backgroundColor: '#212529', // PanelSite dark
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  // Development diagnostics only; production renderer output can contain account data.
  if (is.dev) {
    mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
      console.log(`[Renderer] [${level}] ${message} (${sourceId}:${line})`)
    })
  }

  mainWindow.once('ready-to-show', () => {
    console.log('[Main] Window ready to show - presenting rendered UI')
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.invalidate()
    }
  })

  // Fallback to ensure window is visible once loaded
  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // Enable Cmd+Option+I and F12 to toggle DevTools, and Cmd+R / F5 to reload
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F12' || (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
        mainWindow?.webContents.toggleDevTools()
        event.preventDefault()
      } else if (input.key === 'F5' || (input.meta && input.key.toLowerCase() === 'r')) {
        mainWindow?.webContents.reload()
        event.preventDefault()
      }
    }
  })

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
    console.error(`[Main] Page failed to load (${errorCode}): ${errorDescription} at ${validatedURL}`)
  })

  // Keep the renderer's maximise/restore icon honest whatever caused the change
  // (double-click on the bar, OS shortcut, our own button).
  const pushMaximized = () => mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized())
  mainWindow.on('maximize', pushMaximized)
  mainWindow.on('unmaximize', pushMaximized)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:' || url.protocol === 'mailto:') void shell.openExternal(url.toString())
    } catch {
      // Invalid/untrusted links stay closed.
    }
    return { action: 'deny' }
  })

  // The application shell never needs page-driven top-level navigation.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    console.log('[Main] Loading dev URL:', process.env['ELECTRON_RENDERER_URL'])
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    const rendererPath = getRendererPath()
    console.log('[Main] Loading production file from:', rendererPath)
    mainWindow.loadFile(rendererPath).catch((err) => {
      console.error('[Main] Failed to loadFile:', err)
    })
  }

  // Close → hide when the tray is keeping the app alive; the renderer (and its
  // polling) stays up, which is what makes background notifications possible.
  mainWindow.on('close', (event) => {
    if (isQuitting || !TrayManager.shouldHideOnClose()) return
    event.preventDefault()
    mainWindow?.hide()
    TrayManager.onHiddenToTray()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    DeepLinkManager.onWindowClosed()
    TrayManager.clear()
  })
}

function createTray(): void {
  TrayManager.init({
    icon: getTrayIcon(),
    getWindow: () => mainWindow,
    showWindow: showMainWindow
  })
}

function registerIpcHandlers(): void {
  // Vault & Auth
  ipcMain.handle('vault:getProfiles', async (event) => {
    requireMainRenderer(event)
    return VaultManager.getProfiles()
  })
  ipcMain.handle('vault:getActiveProfile', async (event) => {
    requireMainRenderer(event)
    return VaultManager.getActiveProfile()
  })
  ipcMain.handle('vault:saveProfile', async (event, profile) => {
    requireMainRenderer(event)
    const validation = await BinaryLaneBroker.validateToken(profile?.token)
    if (!validation.success || !validation.email) {
      return { success: false, profileId: '', error: validation.error || 'The token account could not be verified.' }
    }
    return VaultManager.saveProfile({
      name: profile?.name,
      token: profile?.token,
      isDefault: profile?.isDefault,
      profileId: profile?.profileId,
      verifiedEmail: validation.email
    })
  })
  ipcMain.handle(
    'vault:updateProfileSafety',
    async (
      event,
      profileId,
      accessMode,
      protectedServerIds,
      maintenanceServerIds,
      protectedResources,
      maintenanceResources
    ) => {
      requireMainRenderer(event)
      return VaultManager.updateProfileSafety(
        profileId,
        accessMode,
        protectedServerIds,
        maintenanceServerIds,
        protectedResources,
        maintenanceResources
      )
    }
  )
  ipcMain.handle('vault:setActiveProfile', async (event, profileId) => {
    requireMainRenderer(event)
    return VaultManager.setActiveProfile(profileId)
  })
  ipcMain.handle('vault:deleteProfile', async (event, profileId) => {
    requireMainRenderer(event)
    return VaultManager.deleteProfile(profileId)
  })
  ipcMain.handle('binarylane:validateToken', async (event, token) => {
    requireMainRenderer(event)
    return BinaryLaneBroker.validateToken(token)
  })
  ipcMain.handle('binarylane:request', async (event, profileId, request) => {
    requireMainRenderer(event)
    return BinaryLaneBroker.request(profileId, request)
  })

  // Terminal & Console
  ipcMain.handle('terminal:launchNative', async (event, options: TerminalLaunchOptions) => {
    requireMainRenderer(event)
    return launchAuthorizedTerminal(options)
  })

  ipcMain.handle('console:openRescue', async (event, options: ConsoleWindowOptions) => {
    requireMainRenderer(event)
    try {
      const active = VaultManager.getActiveProfile()
      if (!active || !isRemoteAccessAllowed(active, options.serverId)) {
        return { success: false, error: 'Rescue-console access is blocked for this server by the active safety policy.' }
      }
      const consoleResult = await BinaryLaneBroker.getRescueConsole(active.id, options.serverId)
      if (!consoleResult.success) return consoleResult

      const current = VaultManager.getActiveProfile()
      if (!current || current.id !== active.id || !isRemoteAccessAllowed(current, options.serverId)) {
        return { success: false, error: 'The active safety policy changed before the rescue console could open.' }
      }

      const consoleWindow = new BrowserWindow({
        width: consoleResult.width || options.width || 1024,
        height: consoleResult.height || options.height || 768,
        title: `Rescue Console - ${options.serverName} (#${options.serverId})`,
        backgroundColor: '#000000',
        autoHideMenuBar: true,
        webPreferences: {
          // A console URL is a short-lived capability. Isolate its cookies and
          // cache from both BLDesk and every other console window.
          partition: `bldesk-rescue-console-${randomUUID()}`,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      })
      consoleWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      consoleWindow.webContents.on('will-attach-webview', (attachEvent) => attachEvent.preventDefault())
      const blockNonHttpsNavigation = (navigationEvent: Electron.Event, targetUrl: string) => {
        try {
          if (new URL(targetUrl).protocol !== 'https:') navigationEvent.preventDefault()
        } catch {
          navigationEvent.preventDefault()
        }
      }
      consoleWindow.webContents.on('will-navigate', blockNonHttpsNavigation)
      consoleWindow.webContents.on('will-redirect', blockNonHttpsNavigation)
      void consoleWindow.loadURL(consoleResult.url)
      return { success: true }
    } catch {
      return { success: false, error: 'The protected credential vault could not authorize rescue-console access.' }
    }
  })

  // SSH Keys & Local FS
  ipcMain.handle('vault:getLocalSshKeys', async (event) => {
    requireMainRenderer(event)
    try {
      const sshDir = join(app.getPath('home'), '.ssh')
      if (!existsSync(sshDir)) return []
      const files = readdirSync(sshDir)
      const pubFiles = files.filter(f => f.endsWith('.pub'))
      return pubFiles.map(f => {
        const baseName = f.replace('.pub', '')
        const privPath = join(sshDir, baseName)
        const pubPath = join(sshDir, f)
        const hasPriv = existsSync(privPath)
        return {
          name: baseName,
          publicKey: readFileSync(pubPath, 'utf8').trim(),
          pubPath,
          privateKeyPath: hasPriv ? privPath : undefined
        }
      })
    } catch (err) {
      console.error('[Main] Failed to read local SSH keys:', err)
      return []
    }
  })

  // Notifications
  ipcMain.handle('system:sendNotification', async (_, options: SystemNotificationOptions) => {
    TrayManager.notify(options)
  })

  // Local change log
  /*
   * Reachability probes (FEATURES.md #11). The renderer only declares eligible
   * addresses via net:setTargets; it is not the authority. Every actual probe
   * is also bound to the trusted main frame, active vault profile, eligible
   * server tier, and a fresh BinaryLane server/address ownership check.
   */
  ipcMain.handle('net:setTargets', (event, ips: string[]) => {
    requireMainRenderer(event)
    setAllowedTargets(Array.isArray(ips) ? ips : [])
  })
  ipcMain.handle('net:probeTcp', async (event, target: ServerProbeTarget, port: number, timeoutMs?: number) => {
    const host = await authorizeProbeTarget(event, target)
    return host
      ? probeTcp(host, Number(port), timeoutMs)
      : { ok: false, error: 'invalid-target' as const, detail: 'blocked by the active server safety policy' }
  })
  ipcMain.handle('net:probePing', async (event, target: ServerProbeTarget, timeoutMs?: number) => {
    const host = await authorizeProbeTarget(event, target)
    return host ? probePing(host, timeoutMs) : { ok: false, error: 'blocked by the active server safety policy' }
  })
  ipcMain.handle('net:traceroute', async (event, target: ServerProbeTarget, maxHops?: number) => {
    const host = await authorizeProbeTarget(event, target)
    return host ? traceroute(host, maxHops) : []
  })

  ipcMain.handle('changelog:append', (event, entry) => {
    requireMainRenderer(event)
    return ChangeLogStore.append(entry)
  })
  ipcMain.handle('changelog:update', (event, profileId: string, id: string, patch) => {
    requireMainRenderer(event)
    return ChangeLogStore.update(profileId, id, patch)
  })
  ipcMain.handle('changelog:list', (event, profileId: string, limit?: number) => {
    requireMainRenderer(event)
    return ChangeLogStore.list(profileId, limit)
  })
  ipcMain.handle('changelog:clear', (event, profileId: string) => {
    requireMainRenderer(event)
    return ChangeLogStore.clear(profileId)
  })

  // Device-wide cloud-init template library
  ipcMain.handle('templates:list', (event) => {
    requireMainRenderer(event)
    return TemplateStore.list()
  })
  ipcMain.handle('templates:get', (event, slug: string) => {
    requireMainRenderer(event)
    return TemplateStore.get(slug)
  })
  ipcMain.handle('templates:save', (event, document: string, oldSlug?: string) => {
    requireMainRenderer(event)
    const newSlug = TemplateStore.slugForDocument(document)
    if (oldSlug === undefined) requireCollectionMutationAccess('a template')
    else requireTemplateMutationAccess(oldSlug, newSlug === oldSlug ? 'maintenance' : 'destructive')
    return TemplateStore.save(document, oldSlug)
  })
  ipcMain.handle('templates:remove', (event, slug: string) => {
    requireMainRenderer(event)
    requireTemplateMutationAccess(slug, 'destructive')
    return TemplateStore.remove(slug)
  })
  ipcMain.handle('templates:reveal', (event, slug: string) => {
    requireMainRenderer(event)
    return TemplateStore.reveal(slug)
  })

  // Tray / menu bar
  ipcMain.handle('tray:update', (event, summary: TrayFleetSummary) => {
    requireMainRenderer(event)
    return TrayManager.update(summary)
  })
  ipcMain.handle('tray:getSettings', (event) => {
    requireMainRenderer(event)
    return TrayManager.getSettings()
  })

  // Window Controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  // External Links
  ipcMain.handle('shell:openExternal', async (event, value: string) => {
    requireMainRenderer(event)
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'mailto:') throw new Error('Blocked external URL protocol.')
    await shell.openExternal(url.toString())
  })

  // Deep links (bldesk://)
  ipcMain.handle('deeplink:getPending', () => DeepLinkManager.takePending())
  ipcMain.handle('deeplink:ready', () => DeepLinkManager.markRendererReady())

  // Auto-update
  ipcMain.handle('updater:getState', (event) => {
    requireMainRenderer(event)
    return UpdaterManager.getState()
  })
  ipcMain.handle('updater:check', (event) => {
    requireMainRenderer(event)
    return UpdaterManager.check()
  })
  ipcMain.handle('updater:install', (event) => {
    requireMainRenderer(event)
    return UpdaterManager.install()
  })
  ipcMain.handle('updater:setChannel', (event, channel: UpdateChannel) => {
    requireMainRenderer(event)
    return UpdaterManager.setChannel(channel)
  })
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_, argv) => {
    showMainWindow()
    // Windows / Linux deliver bldesk:// links to the running instance via argv
    DeepLinkManager.handleSecondInstance(argv)
  })

  // Must be registered before `ready` so a cold-start open-url on macOS is caught
  DeepLinkManager.register({
    getWindow: () => mainWindow,
    ensureWindow: () => {
      if (!mainWindow && app.isReady()) createWindow()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId(IS_LOCAL_BUILD ? LOCAL_APP_ID : PRODUCTION_APP_ID)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    createWindow()
    createTray()
    UpdaterManager.init()

    app.on('activate', function () {
      showMainWindow()
    })
  })

  // Only reached when the window was actually destroyed (close-to-tray off, or
  // a hide that was later followed by Quit); a hidden window keeps the app up.
  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
    UpdaterManager.dispose()
    TrayManager.dispose()
  })
}
