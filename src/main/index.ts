import { app, shell, BrowserWindow, ipcMain, nativeImage, NativeImage } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { VaultManager } from './safeStorage'
import { launchNativeTerminal } from './terminal'
import { registerPtyHandlers, closeAll as closeAllPtys } from './pty'
import { UpdaterManager } from './updater'
import { probeTcp, probePing, traceroute, setAllowedTargets } from './reachability'
import { DeepLinkManager } from './deeplink'
import { TrayManager } from './tray'
import { ChangeLogStore } from './changelog'
import { TemplateStore } from './templates'
import { registerHelpHandlers } from './help'
import { installWindowZoom, installZoomMenu } from './zoom'
import { ConsoleWindowOptions, SystemNotificationOptions, TerminalLaunchOptions, TrayFleetSummary, UpdateChannel } from '../shared/ipc-types'

// Linux sandbox note: Chromium decides how to sandbox before this file runs,
// so `--no-sandbox` cannot be added from here. The AppImage launcher
// (scripts/after-pack.cjs) adds it on kernels that leave no alternative; the
// .deb installs an AppArmor profile instead (linux/after-install.sh).

let mainWindow: BrowserWindow | null = null
/** Set on before-quit so a window close from Quit is not turned into a hide. */
let isQuitting = false

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
    join(appPath, 'out/preload/index.mjs'),
    join(appPath, 'out/preload/index.js'),
    join(appPath, 'out/preload/index.cjs'),
    join(__dirname, '../preload/index.mjs'),
    join(__dirname, '../preload/index.js'),
    join(__dirname, '../preload/index.cjs')
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
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  // Log renderer console messages to terminal
  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    console.log(`[Renderer] [${level}] ${message} (${sourceId}:${line})`)
  })

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
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

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
  registerPtyHandlers(() => mainWindow)
  registerHelpHandlers()
  // Vault & Auth
  ipcMain.handle('vault:getProfiles', async () => VaultManager.getProfiles())
  ipcMain.handle('vault:getActiveProfile', async () => VaultManager.getActiveProfile())
  ipcMain.handle('vault:saveProfile', async (_, profile) => VaultManager.saveProfile(profile))
  ipcMain.handle('vault:setActiveProfile', async (_, profileId) => VaultManager.setActiveProfile(profileId))
  ipcMain.handle('vault:deleteProfile', async (_, profileId) => VaultManager.deleteProfile(profileId))

  // Terminal & Console
  ipcMain.handle('terminal:launchNative', async (_, options: TerminalLaunchOptions) => {
    return launchNativeTerminal(options)
  })

  ipcMain.handle('console:openRescue', async (_, options: ConsoleWindowOptions) => {
    const consoleWindow = new BrowserWindow({
      width: options.width || 1024,
      height: options.height || 768,
      title: `Rescue Console - ${options.serverName} (#${options.serverId})`,
      backgroundColor: '#000000',
      autoHideMenuBar: true
    })
    consoleWindow.loadURL(options.url)
    return { success: true }
  })

  // SSH Keys & Local FS
  ipcMain.handle('vault:getLocalSshKeys', async () => {
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
   * Reachability probes (FEATURES.md #11). The renderer declares which addresses
   * it may probe via net:setTargets, and reachability.ts refuses anything else -
   * otherwise these handlers are a general-purpose scanner reachable from page
   * script.
   */
  ipcMain.handle('net:setTargets', (_, ips: string[]) => setAllowedTargets(Array.isArray(ips) ? ips : []))
  ipcMain.handle('net:probeTcp', (_, host: string, port: number, timeoutMs?: number) =>
    probeTcp(String(host), Number(port), timeoutMs)
  )
  ipcMain.handle('net:probePing', (_, host: string, timeoutMs?: number) => probePing(String(host), timeoutMs))
  ipcMain.handle('net:traceroute', (_, host: string, maxHops?: number) => traceroute(String(host), maxHops))

  ipcMain.handle('changelog:append', (_, entry) => ChangeLogStore.append(entry))
  ipcMain.handle('changelog:update', (_, profileId: string, id: string, patch) => ChangeLogStore.update(profileId, id, patch))
  ipcMain.handle('changelog:list', (_, profileId: string, limit?: number) => ChangeLogStore.list(profileId, limit))
  ipcMain.handle('changelog:clear', (_, profileId: string) => ChangeLogStore.clear(profileId))

  // Device-wide cloud-init template library
  ipcMain.handle('templates:list', () => TemplateStore.list())
  ipcMain.handle('templates:get', (_, slug: string) => TemplateStore.get(slug))
  ipcMain.handle('templates:save', (_, document: string, oldSlug?: string) => TemplateStore.save(document, oldSlug))
  ipcMain.handle('templates:remove', (_, slug: string) => TemplateStore.remove(slug))
  ipcMain.handle('templates:reveal', (_, slug: string) => TemplateStore.reveal(slug))

  // Tray / menu bar
  ipcMain.handle('tray:update', (_, summary: TrayFleetSummary) => TrayManager.update(summary))
  ipcMain.handle('tray:getSettings', () => TrayManager.getSettings())

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
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url)
  })

  // Deep links (bldesk://)
  ipcMain.handle('deeplink:getPending', () => DeepLinkManager.takePending())
  ipcMain.handle('deeplink:ready', () => DeepLinkManager.markRendererReady())

  // Auto-update
  ipcMain.handle('updater:getState', () => UpdaterManager.getState())
  ipcMain.handle('updater:check', () => UpdaterManager.check())
  ipcMain.handle('updater:install', () => UpdaterManager.install())
  ipcMain.handle('updater:setChannel', (_, channel: UpdateChannel) => UpdaterManager.setChannel(channel))
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
    electronApp.setAppUserModelId('com.termau.bldesk')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window, { zoom: true, escToCloseWindow: false })
      installWindowZoom(window)
    })

    installZoomMenu()
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
    closeAllPtys()
    UpdaterManager.dispose()
    TrayManager.dispose()
  })
}
