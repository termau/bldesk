import type { LocalSshKey } from '@shared/ipc-types'
import type { components } from '@shared/api/schema'
import { validateSshTarget } from '@shared/ssh'

export const SSH_KEYS_EVENT = 'bldesk:ssh-key-associations'
type Source = 'manual' | 'learned'
export type ConnectMode = 'public' | 'name' | 'custom'
export type ConnectAddress = { mode: ConnectMode; host?: string }
type Store = { associations: Record<number, string>; sources: Record<number, Source>; lastWorking?: string;
  profileDefault?: { connect: 'public' | 'name' }; servers?: Record<number, { connect?: ConnectAddress }> }
const storageKey = (profileId: string) => `bldesk_ssh_keys_${profileId}`
function read(profileId?: string): Store {
  const empty: Store = { associations: {}, sources: {} }
  if (!profileId) return empty
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(profileId)) || '{}')
    for (const [id, path] of Object.entries(value.associations || {})) {
      if (/^[1-9]\d*$/.test(id) && typeof path === 'string' && path.trim()) {
        empty.associations[Number(id)] = path
        empty.sources[Number(id)] = value.sources?.[id] === 'learned' ? 'learned' : 'manual'
      }
    }
    if (typeof value.lastWorking === 'string') empty.lastWorking = value.lastWorking
    empty.profileDefault = { connect: value.profileDefault?.connect === 'name' ? 'name' : 'public' }
    empty.servers = {}
    for (const [id, entry] of Object.entries(value.servers || {})) {
      const connect = (entry as { connect?: ConnectAddress })?.connect
      if (/^[1-9]\d*$/.test(id) && connect && ['public', 'name', 'custom'].includes(connect.mode)) {
        empty.servers[Number(id)] = { connect: { mode: connect.mode, host: typeof connect.host === 'string' ? connect.host : undefined } }
      }
    }
  } catch { /* Malformed or unavailable local storage behaves like an empty store. */ }
  return empty
}
export function loadKeyAssociations(profileId?: string): Record<number, string> { return read(profileId).associations }
export function keyAssociationSource(profileId: string | undefined, serverId: number): Source | undefined {
  return read(profileId).sources[serverId]
}
export function lastWorkingKey(profileId?: string): string | undefined { return read(profileId).lastWorking }
/** Include explicitly chosen filenames outside discovery's ~/.ssh + .pub convention. */
export function availableSshKeys(profileId?: string, extraPaths: string[] = []): Promise<LocalSshKey[]> {
  const store = read(profileId)
  const paths = [...new Set([...Object.values(store.associations), ...(store.lastWorking ? [store.lastWorking] : []), ...extraPaths])]
  return window.bldeskApi.getLocalSshKeys(paths)
}
export function setKeyAssociation(profileId: string | undefined, serverId: number, path: string | null,
  source: Source = 'manual', localKeys?: LocalSshKey[]): void {
  if (!profileId || !Number.isSafeInteger(serverId) || serverId <= 0) return
  const value = read(profileId)
  if (localKeys) {
    const available = new Set(localKeys.map((k) => k.privateKeyPath).filter(Boolean))
    for (const [id, existing] of Object.entries(value.associations)) {
      if (!available.has(existing)) { delete value.associations[Number(id)]; delete value.sources[Number(id)] }
    }
    if (!available.has(value.lastWorking)) delete value.lastWorking
    if (path && !available.has(path)) path = null
  }
  if (path) {
    value.associations[serverId] = path
    value.sources[serverId] = source
    if (source === 'learned') value.lastWorking = path
  } else { delete value.associations[serverId]; delete value.sources[serverId] }
  try {
    localStorage.setItem(storageKey(profileId), JSON.stringify(value))
    window.dispatchEvent(new Event(SSH_KEYS_EVENT))
  } catch { /* Local persistence is optional. */ }
}
export function resolveKeyFor(profileId: string | undefined, serverId: number | undefined, localKeys: LocalSshKey[]): string | undefined {
  const value = read(profileId)
  const available = new Set(localKeys.map((k) => k.privateKeyPath).filter(Boolean))
  const associated = serverId === undefined ? undefined : value.associations[serverId]
  if (associated && available.has(associated)) return associated
  if (value.lastWorking && available.has(value.lastWorking)) return value.lastWorking
  return undefined
}

function writeAddress(profileId: string | undefined, update: (store: Store) => void): void {
  if (!profileId) return
  const store = read(profileId)
  update(store)
  try { localStorage.setItem(storageKey(profileId), JSON.stringify(store)); window.dispatchEvent(new Event(SSH_KEYS_EVENT)) } catch { /* optional */ }
}
export function defaultSshAddress(profileId?: string): 'public' | 'name' { return read(profileId).profileDefault?.connect || 'public' }
export function setDefaultSshAddress(profileId: string | undefined, connect: 'public' | 'name'): void {
  writeAddress(profileId, (store) => { store.profileDefault = { connect } })
}
export function serverConnectAddress(profileId: string | undefined, serverId: number): ConnectAddress | undefined {
  return read(profileId).servers?.[serverId]?.connect
}
export function setServerConnectAddress(profileId: string | undefined, serverId: number, connect: ConnectAddress | null): void {
  if (!Number.isSafeInteger(serverId) || serverId <= 0) return
  writeAddress(profileId, (store) => {
    store.servers ??= {}
    if (connect) store.servers[serverId] = { connect }
    else delete store.servers[serverId]
  })
}
export function resolveConnection(profileId: string | undefined, server: Pick<components['schemas']['Server'], 'id' | 'name' | 'networks'>, localKeys: LocalSshKey[]) {
  const connect = serverConnectAddress(profileId, server.id)
  const mode = connect?.mode || defaultSshAddress(profileId)
  const publicHost = server.networks?.v4?.find((n) => n.type === 'public')?.ip_address || ''
  let host = mode === 'custom' ? connect?.host || '' : mode === 'name' ? server.name : publicHost
  let origin: 'public' | 'name' | 'custom' | 'default-name' = mode === 'name' && !connect ? 'default-name' : mode
  let warning: string | undefined
  if (mode === 'name' && validateSshTarget({ host })) {
    host = publicHost; origin = 'public'
    warning = 'Server name is not a valid SSH address; using the public address.'
  }
  // A VPC-only server has no public IPv4, so Public address resolves to nothing
  // and SSH used to fail with a bare "No host given". Say which server, why, and
  // where to set an address that works.
  if (!host) {
    const privateIp = server.networks?.v4?.find((n) => n.type === 'private')?.ip_address
    warning = mode === 'custom'
      ? `${server.name} has no Custom SSH host set. Enter one in its Remote Access tab under Connect to.`
      : `${server.name} has no public IPv4 address, so there is no public address to connect to. In its Remote Access tab, set Connect to → Custom… to an address you can reach${privateIp ? `, such as its private address ${privateIp} over a VPN` : ''}, or choose Server name.`
  }
  const privateKeyPath = resolveKeyFor(profileId, server.id, localKeys)
  const key: 'associated' | 'last used' | 'ssh default' = privateKeyPath ? loadKeyAssociations(profileId)[server.id] === privateKeyPath ? 'associated' : 'last used' : 'ssh default'
  return { host, username: 'root' as const, privateKeyPath, origin: { host: origin, key }, warning }
}
