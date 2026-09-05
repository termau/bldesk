import type { DiffLine, FieldChange } from './diff'

/**
 * Local, per-profile record of every change committed through BLDesk
 * (FEATURES.md #5). Written when the user confirms, updated when the action
 * settles, read by the History tab. Answers "what did I change on this
 * account last Tuesday" without asking BinaryLane, which keeps no such log
 * from the customer's point of view.
 *
 * Storage is the main process (`<userData>/changelog/<profile>.jsonl`) so it
 * survives a renderer cache reset; on Android / web it falls back to
 * localStorage. Entries are data about the user's own actions — nothing here
 * is ever sent anywhere.
 */

export type ChangeSeverity = 'normal' | 'destructive' | 'irreversible'

export type ChangeOutcome =
  /** Accepted by BinaryLane; the action may still be running. */
  | 'submitted'
  | 'completed'
  /** BinaryLane ran it and reported an error. */
  | 'errored'
  /** The request itself was rejected or never reached BinaryLane. */
  | 'failed'
  /** We stopped being able to follow it. */
  | 'lost'

export type ChangeTargetKind = 'server' | 'domain' | 'vpc' | 'loadbalancer' | 'sshkey' | 'account'

export interface ChangeTarget {
  kind: ChangeTargetKind
  id?: number | string
  name: string
}

export interface ChangeEntry {
  id: string
  /** ISO timestamp of the confirm. */
  at: string
  profileId: string
  /** What the user did, in their words: "Rebuild Server OS". */
  label: string
  target: ChangeTarget
  severity: ChangeSeverity
  summary?: string
  changes?: FieldChange[]
  diff?: DiffLine[]
  actionId?: number
  outcome: ChangeOutcome
  detail?: string
  /** Where it was started from. */
  source: 'ui' | 'palette'
  /** ISO timestamp of the last outcome update. */
  settledAt?: string
}

export type NewChange = Omit<ChangeEntry, 'id' | 'at' | 'profileId' | 'outcome' | 'settledAt'> & { outcome?: ChangeOutcome }

const LOCAL_KEY = (profileId: string) => `bldesk_changelog_${profileId}`
const LOCAL_MAX = 2000

/** Fired on window whenever the log changes, so the History tab can refresh. */
export const CHANGELOG_EVENT = 'bldesk:changelog'

let currentProfileId: string | undefined

/** App tells the log which account is active; entries are stamped with it. */
export function setChangeLogProfile(profileId: string | undefined): void {
  currentProfileId = profileId
}

export function getChangeLogProfile(): string | undefined {
  return currentProfileId
}

function newId(): string {
  return `chg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function emit(): void {
  try {
    window.dispatchEvent(new CustomEvent(CHANGELOG_EVENT))
  } catch {
    // no window (tests)
  }
}

// --- local fallback ---------------------------------------------------------

function localRead(profileId: string): ChangeEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(profileId))
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function localWrite(profileId: string, entries: ChangeEntry[]): void {
  try {
    localStorage.setItem(LOCAL_KEY(profileId), JSON.stringify(entries.slice(-LOCAL_MAX)))
  } catch {
    // quota — the log is a convenience, not state the app depends on
  }
}

// --- public API ---------------------------------------------------------------

/** Record a change the user has just confirmed. Returns its id for later outcome updates. */
export async function recordChange(change: NewChange, profileId = currentProfileId): Promise<string | undefined> {
  if (!profileId) return undefined
  const entry: ChangeEntry = {
    ...change,
    id: newId(),
    at: new Date().toISOString(),
    profileId,
    outcome: change.outcome ?? 'submitted'
  }
  const api = window.bldeskApi
  if (api?.changelogAppend) {
    await api.changelogAppend(entry).catch(() => localWrite(profileId, [...localRead(profileId), entry]))
  } else {
    localWrite(profileId, [...localRead(profileId), entry])
  }
  emit()
  return entry.id
}

export async function updateChange(id: string | undefined, patch: Partial<Pick<ChangeEntry, 'outcome' | 'detail' | 'actionId'>>, profileId = currentProfileId): Promise<void> {
  if (!id) return
  if (!profileId) return
  const full = { ...patch, settledAt: patch.outcome ? new Date().toISOString() : undefined }
  const api = window.bldeskApi
  if (api?.changelogUpdate) {
    await api.changelogUpdate(profileId, id, full).catch(() => {})
  } else {
    const list = localRead(profileId)
    const i = list.findIndex((e) => e.id === id)
    if (i >= 0) {
      list[i] = { ...list[i], ...full }
      localWrite(profileId, list)
    }
  }
  emit()
}

export async function listChanges(profileId: string, limit = 500): Promise<ChangeEntry[]> {
  const api = window.bldeskApi
  let entries: ChangeEntry[]
  if (api?.changelogList) {
    entries = await api.changelogList(profileId, limit).catch(() => localRead(profileId))
  } else {
    entries = localRead(profileId)
  }
  return [...entries].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

export async function clearChanges(profileId: string): Promise<void> {
  const api = window.bldeskApi
  if (api?.changelogClear) await api.changelogClear(profileId).catch(() => {})
  try {
    localStorage.removeItem(LOCAL_KEY(profileId))
  } catch {
    // ignore
  }
  emit()
}
