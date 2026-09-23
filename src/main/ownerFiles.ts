import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'

/*
 * Files under userData that hold account data (the vault, History, settings)
 * are readable by their owner only. The userData directory is usually 0700
 * already, but that is Electron's choice rather than a guarantee, and a copy
 * or backup of one file keeps its own mode.
 *
 * Best effort throughout: a filesystem that ignores modes (FAT, some network
 * shares, Windows) must not stop the app from reading or saving.
 */

export function restrictToOwner(path: string, mode = 0o600): void {
  try {
    chmodSync(path, mode)
  } catch (err) {
    console.warn('[ownerFiles] Could not restrict permissions on', path, err)
  }
}

export function ensureOwnerDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  // `mode` only applies when the directory is created.
  restrictToOwner(dir, 0o700)
}

/** Write via a temp file and rename, so a crash or full disk never leaves a half-written file. */
export function writeOwnerFileAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 })
  try {
    renameSync(tmp, path)
  } catch (err) {
    // Windows can refuse to replace a file another process has open.
    try {
      unlinkSync(tmp)
    } catch {
      /* already gone */
    }
    if (process.platform !== 'win32') throw err
    writeFileSync(path, data, { encoding: 'utf8', mode: 0o600 })
  }
  restrictToOwner(path)
}
