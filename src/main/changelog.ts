import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, appendFileSync, unlinkSync } from 'fs'
import { ensureOwnerDir, restrictToOwner, writeOwnerFileAtomic } from './ownerFiles'

/**
 * Append-only change log, one JSONL file per profile under
 * `<userData>/changelog/`. See renderer `lib/changelog.ts` for what an entry
 * is. Main owns the files so a "Reset cache" in the renderer cannot wipe the
 * history, and so it is on disk in a form the user can read or back up.
 */

const MAX_ENTRIES = 5000

interface Entry {
  id: string
  at: string
  [k: string]: unknown
}

// History records what was done to which server, including broadcast command
// text, so its folder and files are readable by their owner only.
let dirReady = false
const tightened = new Set<string>()

function dir(): string {
  const d = join(app.getPath('userData'), 'changelog')
  if (!dirReady) {
    ensureOwnerDir(d)
    dirReady = true
  }
  return d
}

function safeName(profileId: string): string {
  return profileId.replace(/[^A-Za-z0-9_.-]/g, '_')
}

function file(profileId: string): string {
  const p = join(dir(), `${safeName(profileId)}.jsonl`)
  // Files written by earlier builds keep their old mode until tightened once.
  if (!tightened.has(p) && existsSync(p)) {
    restrictToOwner(p)
    tightened.add(p)
  }
  return p
}

function readAll(profileId: string): Entry[] {
  const p = file(profileId)
  if (!existsSync(p)) return []
  const out: Entry[] = []
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // a torn line from a crash mid-write; skip it rather than lose the file
    }
  }
  return out
}

function writeAll(profileId: string, entries: Entry[]): void {
  writeOwnerFileAtomic(file(profileId), entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''))
}

export class ChangeLogStore {
  static append(entry: Entry & { profileId: string }): void {
    try {
      appendFileSync(file(entry.profileId), JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 })
      // Trim occasionally rather than on every write.
      if (Math.random() < 0.02) {
        const all = readAll(entry.profileId)
        if (all.length > MAX_ENTRIES) writeAll(entry.profileId, all.slice(-MAX_ENTRIES))
      }
    } catch (err) {
      console.warn('[ChangeLog] append failed:', err)
    }
  }

  static update(profileId: string, id: string, patch: Record<string, unknown>): void {
    try {
      const all = readAll(profileId)
      const i = all.findIndex((e) => e.id === id)
      if (i < 0) return
      all[i] = { ...all[i], ...patch }
      writeAll(profileId, all)
    } catch (err) {
      console.warn('[ChangeLog] update failed:', err)
    }
  }

  static list(profileId: string, limit = 500): Entry[] {
    try {
      const all = readAll(profileId)
      return all.slice(-limit)
    } catch (err) {
      console.warn('[ChangeLog] list failed:', err)
      return []
    }
  }

  static clear(profileId: string): void {
    try {
      const p = file(profileId)
      if (existsSync(p)) unlinkSync(p)
    } catch (err) {
      console.warn('[ChangeLog] clear failed:', err)
    }
  }
}
