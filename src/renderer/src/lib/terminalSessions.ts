import type { PtyOpenOptions, PtySessionInfo } from '@shared/ipc-types'
import type { components } from '@shared/api/schema'
import { validateSshTarget } from '@shared/ssh'
import { matchServers, partitionByStatus } from './commands'
import { expandGroupRefs, type ServerGroup, type TagMap } from './serverGroups'

export type RememberedSession = Pick<PtySessionInfo, 'serverId' | 'serverName' | 'host' | 'username'>
export interface TerminalSession extends PtySessionInfo { options?: PtyOpenOptions; error?: string }
const STORAGE_KEY = 'bldesk_terminal_tabs_v1'
export function rememberOpenSessions(sessions: RememberedSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 32).map(({ serverId, serverName, host, username }) => ({ serverId, serverName, host, username }))))
  } catch { /* local storage is optional */ }
}
export function recallOpenSessions(): RememberedSession[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.slice(0, 32).filter((s) => s && typeof s.host === 'string' && typeof s.username === 'string' && typeof s.serverName === 'string' && !validateSshTarget(s))
      .map(({ serverId, serverName, host, username }) => ({ serverId, serverName, host, username }))
  } catch { return [] }
}

export function broadcastTargets(expression: string, servers: components['schemas']['Server'][], tags: TagMap, groups: ServerGroup[]) {
  const expanded = expandGroupRefs(expression, groups, servers, tags)
  const result = matchServers(servers, expanded.expression)
  const { eligible, skipped } = partitionByStatus(result.matches, 'active')
  // Also surface known-but-empty groups; otherwise a partial fan-out is invisible.
  const empty = expression.split(',').map((s) => s.trim()).filter((s) => s.startsWith('@') && !expandGroupRefs(s, groups, servers, tags).expression)
  const withIp = eligible.filter(({ server }) => {
    if (server.networks?.v4?.some((n) => n.type === 'public' && n.ip_address)) return true
    skipped.push({ server, pattern: expression, reason: 'no public IPv4 address' })
    return false
  })
  return { eligible: withIp, skipped, unmatched: [...new Set([...result.unmatched, ...expanded.unknownGroups, ...empty])] }
}

// Process-lifetime renderer registry, independent of the selected app tab.
// Output is memory-only and bounded, including output arriving before open resolves.
let snapshot: TerminalSession[] = []
const listeners = new Set<() => void>()
const output = new Map<string, string>()
const dataListeners = new Map<string, Set<(data: string) => void>>()
const exits = new Map<string, { exitCode: number; signal?: number }>()
const closing = new Set<string>()
let started = false
let initialization: Promise<void> | undefined
let remember = false
export const terminalSnapshot = () => snapshot
export function subscribeTerminals(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb) } }
function emit(): void {
  // An exited tab is still open in the UI and retains a useful reconnect action.
  // Keep it until the user explicitly closes the tab.
  if (remember) rememberOpenSessions(snapshot.filter((s) => !s.broadcast))
  listeners.forEach((cb) => cb())
}
export function enableSessionMemory(): void { remember = true; emit() }
/** Freeze the reopen list before main closes PTYs during app shutdown. */
export function finalizeSessionMemory(): void {
  if (remember) rememberOpenSessions(snapshot.filter((s) => !s.broadcast))
  remember = false
}
export function initializeTerminals(): Promise<void> {
  if (started) return initialization ?? Promise.resolve()
  const api = window.bldeskApi?.pty
  if (!api) return Promise.resolve()
  started = true
  api.onData((id, chunk) => {
    if (closing.has(id)) return
    output.set(id, ((output.get(id) || '') + chunk).slice(-262144))
    dataListeners.get(id)?.forEach((cb) => cb(chunk))
  })
  api.onExit((id, exitCode, signal) => {
    if (closing.delete(id)) { output.delete(id); exits.delete(id); return }
    exits.set(id, { exitCode, signal })
    snapshot = snapshot.map((s) => s.id === id ? { ...s, status: 'exited', exitCode, signal } : s)
    emit()
  })
  initialization = api.list().then((list) => {
    // A reloaded renderer no longer owns the old broadcast panel. Recover its
    // connections as visible tabs, never invisible/orphan processes or a rerun.
    snapshot = list.map((s) => ({ ...s, broadcast: false,
      serverName: s.broadcast ? `${s.serverName} (recovered broadcast)` : s.serverName,
      ...(exits.has(s.id) ? { status: 'exited' as const, ...exits.get(s.id) } : {}) }))
    emit()
  })
  return initialization
}
export function subscribeTerminalOutput(id: string, cb: (data: string) => void): () => void {
  const set = dataListeners.get(id) ?? new Set()
  dataListeners.set(id, set)
  set.add(cb)
  const buffered = output.get(id)
  if (buffered) cb(buffered)
  return () => { set.delete(cb); if (!set.size) dataListeners.delete(id) }
}
export async function createTerminal(options: PtyOpenOptions): Promise<string> {
  await initializeTerminals()
  const api = window.bldeskApi.pty
  if (!api) throw new Error('Embedded SSH is available on desktop only.')
  // Pending tabs are visible while the main process resolves/spawns SSH.
  const pendingId = `connecting-${crypto.randomUUID()}`
  const base: TerminalSession = { id: pendingId, serverId: options.serverId, serverName: options.serverName || options.host,
    host: options.host, username: options.username || 'root', status: 'connecting', options, broadcast: options.remoteCommand !== undefined }
  snapshot = [...snapshot, base]
  emit()
  try {
    const { id } = await api.open(options)
    const exited = exits.get(id)
    snapshot = snapshot.map((s) => s.id === pendingId ? { ...base, id, status: exited ? 'exited' : 'live', ...exited } : s)
    emit()
    return id
  } catch (error) {
    snapshot = snapshot.filter((s) => s.id !== pendingId)
    emit()
    throw error
  }
}
export async function closeTerminal(id: string): Promise<void> {
  if (snapshot.some((s) => s.id === id && s.status !== 'exited')) closing.add(id)
  try { await window.bldeskApi.pty?.close(id) }
  catch (e) { closing.delete(id); throw e }
  snapshot = snapshot.filter((s) => s.id !== id)
  output.delete(id)
  exits.delete(id)
  emit()
}
