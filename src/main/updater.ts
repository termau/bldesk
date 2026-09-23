import { app, BrowserWindow, Notification } from 'electron'
import electronUpdater, { type UpdateInfo, type ProgressInfo } from 'electron-updater'
import { join } from 'path'
import { createWriteStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { ensureOwnerDir, writeOwnerFileAtomic } from './ownerFiles'
import { execFileSync, spawn } from 'child_process'
import { UpdateChannel, UpdaterState, UpdaterStatus } from '../shared/ipc-types'

// electron-updater is CJS with dynamic getter exports; resolve via namespace/default
const autoUpdater = (electronUpdater as any).autoUpdater || (electronUpdater as any).default?.autoUpdater || electronUpdater

/**
 * Auto-update via electron-updater against GitHub Releases.
 *
 * Channel model: package.json "version" with no prerelease component publishes
 * `latest.yml` (stable); a `-beta.N` version publishes `beta.yml`. A client on
 * the beta channel reads beta.yml and will also accept stable releases newer
 * than its current version, so beta users are never stranded behind stable.
 *
 * The update feed URL is static (GitHub Releases today); switching to a
 * self-hosted "generic" provider later only needs `setFeedURL` here.
 */

const SETTINGS_FILE = 'updater.json'
/** Network-level failures that mean "couldn't reach the feed", not "no update". */
const OFFLINE_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH'
])
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6h
const INITIAL_DELAY_MS = 15 * 1000 // let the UI settle before hitting GitHub

interface UpdaterSettings {
  channel: UpdateChannel
}

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

function readSettings(): UpdaterSettings {
  try {
    const p = settingsPath()
    if (existsSync(p)) {
      const parsed = JSON.parse(readFileSync(p, 'utf8'))
      if (parsed?.channel === 'beta' || parsed?.channel === 'stable') return { channel: parsed.channel }
    }
  } catch (err) {
    console.warn('[Updater] Failed to read settings:', err)
  }
  return { channel: 'stable' }
}

function writeSettings(s: UpdaterSettings): void {
  try {
    writeOwnerFileAtomic(settingsPath(), JSON.stringify(s, null, 2))
  } catch (err) {
    console.warn('[Updater] Failed to write settings:', err)
  }
}

const isMac = process.platform === 'darwin'
let macPendingZipPath: string | null = null
let macDownloading = false

async function downloadMacZip(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void
): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP error ${res.status}: ${res.statusText}`)
  const total = Number(res.headers.get('content-length')) || 0
  let received = 0

  if (!res.body) throw new Error('Response body is empty')
  const reader = res.body.getReader()
  const out = createWriteStream(destPath)

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        received += value.length
        out.write(Buffer.from(value))
        if (total > 0) {
          onProgress(Math.min(100, Math.round((received / total) * 100)))
        }
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.end((err: any) => (err ? reject(err) : resolve()))
    })
  }
}

let macInstalling = false

function installMacUpdate(zipPath: string, forceRunAfter: boolean): void {
  if (macInstalling) return
  macInstalling = true

  const targetApp = process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, '')
  if (!targetApp.endsWith('.app') || !existsSync(targetApp)) {
    console.error('[Updater] Cannot locate app bundle to replace:', process.execPath)
    macInstalling = false
    return
  }

  const stagingDir = join(app.getPath('temp'), `bldesk-update-${Date.now()}`)
  ensureOwnerDir(stagingDir)

  const stagedApp = join(stagingDir, 'BLDesk.app')
  const scriptPath = join(stagingDir, 'install-update.sh')
  const scriptContent = `#!/bin/bash
PID=${process.pid}
COUNT=0
while kill -0 $PID 2>/dev/null; do
  sleep 0.1
  COUNT=$((COUNT+1))
  if [ $COUNT -ge 30 ]; then
    kill -9 $PID 2>/dev/null || true
    break
  fi
done

unzip -q -o "${zipPath}" -d "${stagingDir}"
if [ -d "${stagedApp}" ]; then
  rm -rf "${targetApp}"
  cp -R "${stagedApp}" "${targetApp}"
  xattr -cr "${targetApp}" 2>/dev/null || true
fi
rm -rf "${stagingDir}"
rm -f "${zipPath}"
${forceRunAfter ? `open "${targetApp}"` : ''}
`
  writeFileSync(scriptPath, scriptContent, { mode: 0o755 })
  const child = spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' })
  child.unref()
  setTimeout(() => app.exit(0), 100)
}

export class UpdaterManager {
  private static state: UpdaterState = {
    status: 'idle',
    currentVersion: app.getVersion(),
    channel: 'stable',
    supported: app.isPackaged
  }
  private static timer: NodeJS.Timeout | null = null
  private static initialised = false

  static init(): void {
    if (this.initialised) return
    this.initialised = true

    const settings = readSettings()
    this.state.channel = settings.channel

    if (!app.isPackaged) {
      console.log('[Updater] Not packaged; auto-update disabled (dev mode).')
      this.setState({ status: 'idle' })
      return
    }

    autoUpdater.logger = {
      info: (m: any) => console.log('[Updater]', m),
      warn: (m: any) => console.warn('[Updater]', m),
      error: (m: any) => console.error('[Updater]', m),
      debug: (m: any) => console.debug('[Updater]', m)
    }
    if (isMac) {
      // Squirrel.Mac requires Developer ID signatures; bypass on macOS via direct zip update
      autoUpdater.autoDownload = false
    } else {
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
    }
    try {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'termau',
        repo: 'bldesk'
      })
    } catch (err) {
      console.warn('[Updater] setFeedURL initialization failed:', err)
    }
    this.applyChannel(settings.channel)

    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking', error: undefined }))
    autoUpdater.on('update-available', async (info: UpdateInfo) => {
      this.setState({ status: 'available', availableVersion: info.version, releaseNotes: notesToString(info) })
      if (isMac) {
        if (macDownloading) return
        macDownloading = true
        try {
          const zipEntry = info.files?.find((f: any) => f.url && f.url.endsWith('.zip'))
          const zipFilename = zipEntry?.url || `BLDesk-${info.version}-mac-universal.zip`
          const tag = (info as any).tag || `v${info.version}`
          const downloadUrl = `https://github.com/termau/bldesk/releases/download/${tag}/${zipFilename}`
          const destDir = join(app.getPath('userData'), 'updates')
          ensureOwnerDir(destDir)
          const destPath = join(destDir, zipFilename)

          if (existsSync(destPath) && statSync(destPath).size > 1000000) {
            macPendingZipPath = destPath
            this.setState({ status: 'ready', availableVersion: info.version, progress: 100 })
            if (Notification.isSupported()) {
              new Notification({
                title: `BLDesk ${info.version} is ready`,
                body: 'Restart BLDesk to finish installing the update.'
              }).show()
            }
            return
          }

          this.setState({ status: 'downloading', progress: 0 })
          await downloadMacZip(downloadUrl, destPath, (progress) => {
            this.setState({ status: 'downloading', progress })
          })

          macPendingZipPath = destPath
          this.setState({ status: 'ready', availableVersion: info.version, progress: 100 })
          if (Notification.isSupported()) {
            new Notification({
              title: `BLDesk ${info.version} is ready`,
              body: 'Restart BLDesk to finish installing the update.'
            }).show()
          }
        } catch (err: any) {
          console.error('[Updater] macOS update download failed:', err)
          this.handleCheckError(err)
        } finally {
          macDownloading = false
        }
      }
    })
    autoUpdater.on('update-not-available', () =>
      this.setState({ status: 'up-to-date', availableVersion: undefined, lastCheckedAt: new Date().toISOString() })
    )
    autoUpdater.on('download-progress', (p: ProgressInfo) =>
      this.setState({ status: 'downloading', progress: Math.round(p.percent) })
    )
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.setState({ status: 'ready', availableVersion: info.version, progress: 100 })
      if (Notification.isSupported()) {
        new Notification({
          title: `BLDesk ${info.version} is ready`,
          body: 'Restart BLDesk to finish installing the update.'
        }).show()
      }
    })
    autoUpdater.on('error', (err: Error) => {
      if (isMac && String(err).includes('SQRLCodeSignatureErrorDomain')) return
      this.handleCheckError(err)
    })

    setTimeout(() => this.check(), INITIAL_DELAY_MS)
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  static getState(): UpdaterState {
    return { ...this.state }
  }

  static async check(): Promise<UpdaterState> {
    if (!app.isPackaged) return this.getState()
    if (this.state.status === 'checking' || this.state.status === 'downloading') return this.getState()
    this.setState({ status: 'checking', error: undefined })
    try {
      await autoUpdater.checkForUpdates()
    } catch (err: any) {
      this.handleCheckError(err)
    }
    return this.getState()
  }

  static install(): void {
    if (this.state.status !== 'ready') return
    if (isMac && macPendingZipPath && existsSync(macPendingZipPath)) {
      installMacUpdate(macPendingZipPath, true)
      return
    }
    // isSilent=false shows the installer UI on Windows; forceRunAfter restarts the app.
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  }

  static onAppQuit(): void {
    if (macInstalling) return
    if (isMac && this.state.status === 'ready' && macPendingZipPath && existsSync(macPendingZipPath)) {
      installMacUpdate(macPendingZipPath, false)
    }
  }

  static setChannel(channel: UpdateChannel): UpdaterState {
    if (channel !== 'stable' && channel !== 'beta') return this.getState()
    writeSettings({ channel })
    this.applyChannel(channel)
    this.setState({ channel, status: 'idle', availableVersion: undefined, error: undefined })
    if (app.isPackaged) void this.check()
    return this.getState()
  }

  static dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * A check that could not complete is reported as `check-failed`, never as
   * `up-to-date`. The two are not the same: `up-to-date` is a positive answer
   * from the feed, whereas an unreachable feed leaves the real version unknown.
   * Collapsing them hides a broken update channel behind a green tick.
   *
   * `check-failed` is deliberately not `error` — a missing manifest or an
   * offline machine is expected and shouldn't raise an alarm badge. It is still
   * surfaced honestly rather than silently.
   */
  private static handleCheckError(err: any): void {
    const msg = err?.message || String(err)
    const status = isFeedUnreachable(err) ? 'check-failed' : 'error'
    if (status === 'check-failed') {
      console.log('[Updater] Update check could not complete:', msg)
    } else {
      console.error('[Updater] Update check failed:', msg)
    }
    this.setState({
      status,
      availableVersion: undefined,
      error: msg,
      lastCheckedAt: new Date().toISOString()
    })
  }

  private static applyChannel(channel: UpdateChannel): void {
    if (!app.isPackaged) return
    // "latest" is electron-updater's name for the stable channel file.
    autoUpdater.channel = channel === 'beta' ? 'beta' : 'latest'
    autoUpdater.allowPrerelease = channel === 'beta'
    autoUpdater.allowDowngrade = false
  }

  private static setState(patch: Partial<UpdaterState>): void {
    this.state = { ...this.state, ...patch }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('updater:state', this.state)
    }
  }
}

/**
 * True when the check failed because the update feed could not be read at all:
 * no manifest published for this platform (404), or no usable network.
 *
 * Matched on `statusCode` and error codes rather than by searching the message
 * for "latest.yml" or "Cannot find", which also swallow real failures such as a
 * malformed manifest or a checksum mismatch.
 */
function isFeedUnreachable(err: any): boolean {
  if (err?.statusCode === 404) return true
  const code = err?.code
  if (typeof code === 'string' && (OFFLINE_CODES.has(code) || code === 'ENOENT')) return true
  return /HttpError:\s*404|\b404\s+Not Found\b|app-update\.yml/i.test(err?.message || '')
}

function notesToString(info: UpdateInfo): string | undefined {
  const notes = info.releaseNotes
  if (!notes) return undefined
  if (typeof notes === 'string') return notes
  return notes.map((n) => (typeof n === 'string' ? n : n.note || '')).join('\n')
}

export type { UpdaterStatus }
