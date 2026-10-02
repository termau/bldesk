import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, net, Notification } from 'electron'
import electronUpdater, { type UpdateInfo, type ProgressInfo } from 'electron-updater'
import { join } from 'path'
import { createReadStream, createWriteStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { ensureOwnerDir, writeOwnerFileAtomic } from './ownerFiles'
import { execFileSync, spawn } from 'child_process'
import { UpdateChannel, UpdaterState, UpdaterStatus } from '../shared/ipc-types'
import { restartArguments } from '../shared/deeplink'
import { shQuote } from '../shared/ssh'

// electron-updater is CJS with dynamic getter exports; resolve via namespace/default
const autoUpdater = (electronUpdater as any).autoUpdater || (electronUpdater as any).default?.autoUpdater || electronUpdater

/**
 * Auto-update via electron-updater against GitHub Releases.
 *
 * Channel model: every release, a `-beta.N` version included, is a full GitHub
 * release carrying `latest*.yml`; no `beta*.yml` is published (decision #166).
 * The Stable channel (`latest`, no prereleases) therefore sees betas too, and
 * the Beta channel (`beta`, prereleases allowed) reads the same releases. See
 * docs/AUTO_UPDATE.md.
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
/** A Linux package install (.deb), which updates through pkexec. The AppImage updater restarts itself. */
const isLinuxPackage = process.platform === 'linux' && !process.env.APPIMAGE
let macPendingZipPath: string | null = null
let macDownloading = false
/** A download that receives nothing for this long fails. */
const DOWNLOAD_IDLE_MS = 60 * 1000

async function downloadMacZip(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void
): Promise<void> {
  // net.fetch has no timeout of its own: without one, a download that stops sending never ends, and the status stays
  // "downloading", so no later check starts another.
  const stalled = new Error(`The update download stopped: nothing arrived for ${DOWNLOAD_IDLE_MS / 1000} seconds.`)
  const abort = new AbortController()
  let idle: ReturnType<typeof setTimeout> | undefined
  const expectData = () => {
    clearTimeout(idle)
    idle = setTimeout(() => abort.abort(stalled), DOWNLOAD_IDLE_MS)
  }
  expectData()
  try {
    // Electron's net, not Node's fetch, which ignores proxies. net.fetch uses the default session and electron-updater's
    // update check its own "electron-updater" session; BLDesk sets no proxy on either, so both follow the system's.
    const res = await net.fetch(url, { signal: abort.signal })
    if (!res.ok) throw new Error(`HTTP error ${res.status}: ${res.statusText}`)
    const total = Number(res.headers.get('content-length')) || 0
    let received = 0

    if (!res.body) throw new Error('Response body is empty')
    const reader = res.body.getReader()
    const out = createWriteStream(destPath)
    // Without a listener a failed write (a full disk, say) is an uncaught exception in the main process.
    let writeError: Error | null = null
    out.on('error', (err) => (writeError ??= err))

    try {
      while (!writeError) {
        const { done, value } = await reader.read()
        if (done) break
        expectData()
        if (value) {
          received += value.length
          out.write(Buffer.from(value))
          if (total > 0) {
            onProgress(Math.min(100, Math.round((received / total) * 100)))
          }
        }
      }
      await new Promise<void>((resolve, reject) => {
        out.end((err: any) => (err ? reject(err) : resolve()))
      })
    } catch (err) {
      // The first failure, taken before the clean-up below adds its own ("write after a stream was destroyed"). A failed
      // write destroys the stream before its 'error' event fires, so end() can reject first: out.errored has the cause.
      const cause = writeError ?? out.errored ?? (abort.signal.aborted ? stalled : err)
      // A download that failed part-way is not left behind.
      reader.cancel().catch(() => {})
      await new Promise<void>((resolve) => {
        if (out.closed) return resolve()
        out.once('close', () => resolve())
        out.destroy()
      })
      try {
        rmSync(destPath, { force: true })
      } catch {
        /* nothing to remove */
      }
      throw cause
    }
  } finally {
    clearTimeout(idle)
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
  // The installed app is replaced only once the new one has unzipped (exit 0, or 1 for warnings only) and been copied
  // next to it, by two renames in the same folder. A failure logs to the system log, exits non-zero and leaves a
  // complete app on disk: the installed one, or if putting it back fails too, both bundles, named in the log line.
  // Each path is written once, single-quoted, and the rest of the script only expands the variable: a quote, dollar
  // sign or backtick in a path is part of its name, never shell syntax.
  const scriptContent = `#!/bin/bash
PID=${process.pid}
ZIP=${shQuote(zipPath)}
STAGING=${shQuote(stagingDir)}
STAGED=${shQuote(stagedApp)}
TARGET=${shQuote(targetApp)}
COUNT=0
while kill -0 $PID 2>/dev/null; do
  sleep 0.1
  COUNT=$((COUNT+1))
  if [ $COUNT -ge 30 ]; then
    kill -9 $PID 2>/dev/null || true
    break
  fi
done

NEW="$TARGET.new"
OLD="$TARGET.old"
STATUS=1
LEFT=""
# Leftovers of an earlier attempt are cleared only while the installed app is in place. With no app at that path they
# may be the only copies of one, and nothing here touches them.
if [ -d "$TARGET" ]; then rm -rf "$NEW" "$OLD"; fi
unzip -q -o "$ZIP" -d "$STAGING"
UNZIP=$?
# unzip exits 1 for warnings and carries on; 2 and above are errors. Only that the app folder exists is checked after.
# mv would move a bundle into a folder that already exists, so each rename first checks that its destination is free.
if [ $UNZIP -le 1 ] && [ -d "$STAGED" ] && [ -d "$TARGET" ] && [ ! -e "$NEW" ] && [ ! -e "$OLD" ] && cp -R "$STAGED" "$NEW" && mv "$TARGET" "$OLD"; then
  if [ ! -e "$TARGET" ] && mv "$NEW" "$TARGET"; then
    rm -rf "$OLD"
    xattr -cr "$TARGET" 2>/dev/null || true
    STATUS=0
  elif [ -e "$TARGET" ] || ! mv "$OLD" "$TARGET"; then
    LEFT=" (the new version is in $NEW and the previous one in $OLD)"
  fi
fi
# $NEW is removed only when an app is at the installed path, and so is not the only copy of one.
if [ -z "$LEFT" ] && [ -d "$TARGET" ]; then rm -rf "$NEW"; fi
rm -rf "$STAGING"
rm -f "$ZIP"
[ $STATUS -eq 0 ] || logger -t BLDesk "Update not installed: the new version could not be unzipped and put in place$LEFT"
${forceRunAfter ? 'open "$TARGET"' : ''}
exit $STATUS
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
  /**
   * The update that has been downloaded and is waiting for a restart. It stays until it is installed or a newer one has
   * finished downloading: a later check (every few hours, or the Check button) that finds nothing, fails because the
   * machine is offline, or sees the same version again must not take the Restart button away.
   */
  private static held: { version: string } | null = null

  private static markReady(version: string): void {
    this.held = { version }
    this.setState({ status: 'ready', availableVersion: version, progress: 100 })
  }

  /** Back to the waiting update after a check that ended without replacing it. */
  private static restoreHeld(): void {
    if (this.held) this.setState({ status: 'ready', availableVersion: this.held.version, progress: 100, error: undefined })
  }

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
    if (isLinuxPackage) {
      // Restart with relaunchAfterExit rather than app.relaunch(); see there.
      // electron-updater emits this only once quitAndInstall has installed.
      autoUpdater.autoRunAppAfterInstall = false
      nativeAutoUpdater.on('before-quit-for-update', relaunchAfterExit)
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

    autoUpdater.on('checking-for-update', () => {
      if (!this.held) this.setState({ status: 'checking', error: undefined })
    })
    autoUpdater.on('update-available', async (info: UpdateInfo) => {
      if (this.held) {
        // The version already downloaded again: nothing to do, and the Restart button stays.
        if (info.version === this.held.version) return
        // A different version. On Windows and Linux electron-updater deletes the downloaded installer when a download
        // of another version starts, and again when it fails, so the waiting update cannot be installed any more and
        // must not be offered. (On macOS the zip is BLDesk's own and stays.)
        if (!isMac) this.held = null
      }
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
          // electron-updater refuses a file its feed gives no checksum for; this also needs the size. Every release's
          // latest-mac.yml lists both.
          const listed = zipEntry?.sha512 && zipEntry.size != null ? { sha512: zipEntry.sha512, size: zipEntry.size } : null
          if (!listed) {
            rmSync(destPath, { force: true })
            throw new Error(`BLDesk ${info.version} was not downloaded: the update feed does not list the size and SHA-512 checksum of its macOS download, so it cannot be checked.`)
          }

          // A zip already here may be an interrupted download: reuse it only if it matches the release's checksum.
          if (existsSync(destPath) && !(await zipMismatch(destPath, listed))) {
            macPendingZipPath = destPath
            this.markReady(info.version)
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
          const mismatch = await zipMismatch(destPath, listed)
          if (mismatch) {
            rmSync(destPath, { force: true })
            throw new Error(`The download of BLDesk ${info.version} was deleted, not installed: ${mismatch}. The next check downloads it again.`)
          }

          macPendingZipPath = destPath
          this.markReady(info.version)
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
    autoUpdater.on('update-not-available', () => {
      if (this.held) {
        this.setState({ lastCheckedAt: new Date().toISOString() })
        return
      }
      this.setState({ status: 'up-to-date', availableVersion: undefined, lastCheckedAt: new Date().toISOString() })
    })
    autoUpdater.on('download-progress', (p: ProgressInfo) =>
      this.setState({ status: 'downloading', progress: Math.round(p.percent) })
    )
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      // electron-updater reports a download it already holds again on every check: say "is ready" once.
      const repeat = this.held?.version === info.version
      this.markReady(info.version)
      if (!repeat && Notification.isSupported()) {
        new Notification({
          title: `BLDesk ${info.version} is ready`,
          body: 'Restart BLDesk to finish installing the update.'
        }).show()
      }
    })
    autoUpdater.on('error', (err: Error) => {
      if (isMac && String(err).includes('SQRLCodeSignatureErrorDomain')) return
      if (isLinuxPackage && /pkexec/.test(err?.message || '') && hasNoNewPrivs()) {
        // This window was restarted by an older BLDesk's app.relaunch(), so
        // pkexec cannot gain privileges here and exits with 127.
        this.handleCheckError(new Error('BLDesk can\'t install updates in this window. Close BLDesk completely, open it again from your app menu, then install the update.'))
        return
      }
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
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'installing') return this.getState()
    if (!this.held) this.setState({ status: 'checking', error: undefined })
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
    // The install runs synchronously and blocks this process for several seconds, so
    // the window looks frozen and a second click on Restart was queued and delivered
    // afterwards. electron-updater ignores that repeat call but clears its own
    // "already installing" flag when it does, so the quit handler then installed
    // again. Leaving 'ready' first removes the button and makes repeats no-ops.
    this.held = null
    this.setState({ status: 'installing' })
    // isSilent=false shows the installer UI on Windows. The app restarts through
    // autoRunAppAfterInstall, or relaunchAfterExit for a Linux package.
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  }

  static onAppQuit(): void {
    if (macInstalling) return
    // `held` too: while a newer version downloads the status is not ready, and the waiting update is still installed.
    if (isMac && (this.state.status === 'ready' || this.held) && macPendingZipPath && existsSync(macPendingZipPath)) {
      installMacUpdate(macPendingZipPath, false)
    }
  }

  static setChannel(channel: UpdateChannel): UpdaterState {
    if (channel !== 'stable' && channel !== 'beta') return this.getState()
    writeSettings({ channel })
    this.applyChannel(channel)
    this.held = null
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
    if (this.held) {
      // A downloaded update is still waiting: a failed check does not take it away.
      this.setState({ lastCheckedAt: new Date().toISOString() })
      this.restoreHeld()
      return
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

/**
 * Start BLDesk again once this process has exited, after a Linux package update.
 *
 * Not app.relaunch(): on Linux the instance it starts has no_new_privs set
 * (NoNewPrivs: 1 in /proc/<pid>/status), and so does everything it runs. The
 * next update's pkexec then cannot gain privileges and exits with 127, and sudo
 * fails in a local terminal opened from BLDesk. A detached shell started here
 * does not set the flag. It waits for this process to exit first, or the
 * single-instance lock would turn the new instance away.
 */
function relaunchAfterExit(): void {
  const waitThenRun = 'i=0; while kill -0 "$0" 2>/dev/null && [ "$i" -lt 300 ]; do sleep 0.2; i=$((i+1)); done; exec "$@"'
  try {
    spawn('/bin/sh', ['-c', waitThenRun, String(process.pid), process.execPath, ...restartArguments(process.argv)], {
      detached: true,
      stdio: 'ignore'
    }).unref()
  } catch (err) {
    console.error('[Updater] Could not restart BLDesk after the update:', err)
  }
}

/** Whether setuid programs such as pkexec are unable to gain privileges from this process. */
function hasNoNewPrivs(): boolean {
  try {
    return /^NoNewPrivs:\s*1$/m.test(readFileSync('/proc/self/status', 'utf8'))
  } catch {
    return false
  }
}

/**
 * Why a downloaded macOS update zip is not the file the release's `latest-mac.yml` lists, or null when it is: its size
 * and SHA-512 must be the ones listed there, so a partial or damaged download is never installed.
 */
async function zipMismatch(path: string, listed: { size: number; sha512: string }): Promise<string | null> {
  if (!existsSync(path)) return 'the file is missing'
  const size = statSync(path).size
  if (size !== listed.size) return `it is ${size} bytes, not the ${listed.size} the release lists`
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('base64') === listed.sha512 ? null : 'its SHA-512 checksum is not the one the release lists'
}

function notesToString(info: UpdateInfo): string | undefined {
  const notes = info.releaseNotes
  if (!notes) return undefined
  if (typeof notes === 'string') return notes
  return notes.map((n) => (typeof n === 'string' ? n : n.note || '')).join('\n')
}

export type { UpdaterStatus }
