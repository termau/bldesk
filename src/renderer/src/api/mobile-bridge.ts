import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import type {
  AccountProfile,
  BinaryLaneBridgeRequest,
  BinaryLaneBridgeResponse,
  BinaryLaneTokenValidation,
  IpcApi,
  SaveProfileInput,
  UpdateChannel,
  UpdaterState
} from '@shared/ipc-types'
import {
  actionProceedIdForPath,
  binaryLaneUrlForPath,
  decideActionProceedAccess,
  decideProfileAccessTransition,
  decideBinaryLaneRequest,
  decideServerNetworkActionAccess,
  isRemoteAccessAllowed,
  mergeProtectedServerIds,
  normalizeProtectedServerIds,
  normalizeStoredAccessMode,
  serverActionsIdForPath,
  type ActionProceedContext,
  type ProfileAccessMode
} from '@shared/binarylane-policy'
import {
  areCanonicalResourceSafetyTargets,
  mergeResourceSafetyTargets,
  normalizeResourceSafetyTargets,
  resourceSafetyKey,
  type ResourceSafetyTarget
} from '@shared/resource-safety'
import { formatSshCommand, sshUriHost, validateSshTarget } from '@shared/ssh'

/*
 * Android note: this bridge enforces the same accidental-action policy as the
 * desktop UI, but it executes inside the WebView and is not a hostile-renderer
 * security boundary. A future app-owned native broker must own credentials and
 * policy before Android can make that stronger claim.
 */

const PROFILES_KEY = 'bldesk_profiles_v1'
const ACTIVE_PROFILE_KEY = 'bldesk_active_profile_id_v1'

interface StoredMobileProfile extends AccountProfile {
  /** Kept inside native secure storage and never returned through bldeskApi. */
  token: string
}

const mobileUpdaterListeners = new Set<(state: UpdaterState) => void>()

let currentMobileUpdaterState: UpdaterState = {
  status: 'idle',
  currentVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.32',
  channel: 'stable',
  supported: true
}

function broadcastMobileUpdater(patch: Partial<UpdaterState>) {
  currentMobileUpdaterState = { ...currentMobileUpdaterState, ...patch }
  mobileUpdaterListeners.forEach((l) => {
    try {
      l(currentMobileUpdaterState)
    } catch {}
  })
}

function semverCompare(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

async function checkMobileGithubUpdates(): Promise<UpdaterState> {
  broadcastMobileUpdater({ status: 'checking', error: undefined })
  try {
    const isBeta = currentMobileUpdaterState.channel === 'beta'
    const url = isBeta
      ? 'https://api.github.com/repos/termau/bldesk/releases'
      : 'https://api.github.com/repos/termau/bldesk/releases/latest'

    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10_000)
    })

    if (!res.ok) {
      throw new Error(`GitHub Releases returned HTTP ${res.status}`)
    }

    const data = await res.json()
    const release = Array.isArray(data) ? data[0] : data
    if (!release || !release.tag_name) {
      throw new Error('No release information found')
    }

    const latestTag = release.tag_name as string
    const latestVersion = latestTag.replace(/^v/, '')
    const currentVersion = currentMobileUpdaterState.currentVersion

    const apkAsset = release.assets?.find((a: any) => a.name?.toLowerCase().endsWith('.apk'))
    const apkUrl =
      apkAsset?.browser_download_url ||
      `https://github.com/termau/bldesk/releases/download/${latestTag}/BLDesk-android.apk`

    if (semverCompare(latestVersion, currentVersion) > 0) {
      broadcastMobileUpdater({
        status: 'available',
        availableVersion: latestVersion,
        releaseNotes: release.body || undefined,
        apkUrl,
        lastCheckedAt: new Date().toISOString()
      })
    } else {
      broadcastMobileUpdater({
        status: 'up-to-date',
        availableVersion: undefined,
        releaseNotes: undefined,
        apkUrl: undefined,
        lastCheckedAt: new Date().toISOString()
      })
    }
  } catch (err: any) {
    console.warn('[MobileBridge] Update check failed:', err)
    broadcastMobileUpdater({
      status: 'check-failed',
      error: err.message,
      lastCheckedAt: new Date().toISOString()
    })
  }
  return currentMobileUpdaterState
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

let mobileProfileMutationTail: Promise<void> = Promise.resolve()
let mobileProfileMutationEpoch = 0

/** Serialize native profile read-modify-write operations so a token rotation,
 * policy lock, deletion, or active-profile change cannot overwrite another. */
function withMobileProfileMutation<T>(operation: () => Promise<T>): Promise<T> {
  // Bump when the mutation is queued, not only when it completes, so readers
  // can detect a write that started while native storage was being read.
  mobileProfileMutationEpoch += 1
  const result = mobileProfileMutationTail.then(operation, operation)
  mobileProfileMutationTail = result.then(() => undefined, () => undefined)
  return result
}

function requireNativePlatform(): void {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('BinaryLane credentials are available only in the native BLDesk app.')
  }
}

function normalizeToken(value: unknown): string {
  const token = typeof value === 'string' ? value.trim() : ''
  if (!token || token.length > 4096 || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new Error('The BinaryLane API token format is invalid.')
  }
  return token
}

function normalizeStoredServerIds(value: unknown, field: string): number[] {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    !value.every((id) => Number.isSafeInteger(id) && Number(id) > 0)
  ) {
    throw new Error(`The mobile credential vault contains invalid ${field}.`)
  }
  return normalizeProtectedServerIds(value)
}

function mergeMobileSafetyTierIds(
  currentProtected: number[],
  currentMaintenance: number[],
  requestedProtected: unknown,
  requestedMaintenance: unknown
): { protectedServerIds: number[]; maintenanceServerIds: number[] } {
  const protectedServerIds = mergeProtectedServerIds(currentProtected, requestedProtected)
  const protectedSet = new Set(protectedServerIds)
  const maintenanceServerIds = mergeProtectedServerIds(currentMaintenance, requestedMaintenance).filter(
    (id) => !protectedSet.has(id)
  )
  return { protectedServerIds, maintenanceServerIds }
}

function mergeMobileResourceSafetyTiers(
  currentProtected: ResourceSafetyTarget[],
  currentMaintenance: ResourceSafetyTarget[],
  requestedProtected: unknown,
  requestedMaintenance: unknown
): { protectedResources: ResourceSafetyTarget[]; maintenanceResources: ResourceSafetyTarget[] } {
  const protectedResources = mergeResourceSafetyTargets(currentProtected, requestedProtected)
  const protectedKeys = new Set(protectedResources.map(resourceSafetyKey))
  const maintenanceResources = mergeResourceSafetyTargets(currentMaintenance, requestedMaintenance).filter(
    (target) => !protectedKeys.has(resourceSafetyKey(target))
  )
  return { protectedResources, maintenanceResources }
}

function normalizeStoredProfile(value: unknown): StoredMobileProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The mobile credential vault contains an invalid profile record.')
  }
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const token = normalizeToken(record.token)
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : ''
  if (!id || !name || !createdAt) {
    throw new Error('The mobile credential vault contains an incomplete profile record.')
  }
  const protectedServerIds = normalizeStoredServerIds(record.protectedServerIds, 'protected server IDs')
  const maintenanceServerIds = normalizeStoredServerIds(
    record.maintenanceServerIds,
    'maintenance server IDs'
  )
  const protectedSet = new Set(protectedServerIds)
  if (maintenanceServerIds.some((id) => protectedSet.has(id))) {
    throw new Error('A server cannot be both locked and in maintenance mode.')
  }
  if (record.protectedResources !== undefined && !areCanonicalResourceSafetyTargets(record.protectedResources)) {
    throw new Error('The mobile credential vault contains invalid Read-only resource tiers.')
  }
  if (record.maintenanceResources !== undefined && !areCanonicalResourceSafetyTargets(record.maintenanceResources)) {
    throw new Error('The mobile credential vault contains invalid Maintenance resource tiers.')
  }
  const protectedResources = normalizeResourceSafetyTargets(record.protectedResources)
  const protectedResourceKeys = new Set(protectedResources.map(resourceSafetyKey))
  const maintenanceResources = normalizeResourceSafetyTargets(record.maintenanceResources)
  if (maintenanceResources.some((target) => protectedResourceKeys.has(resourceSafetyKey(target)))) {
    throw new Error('A resource cannot be both Read-only and in Maintenance mode.')
  }
  let storedMode = normalizeStoredAccessMode(record.accessMode)
  if (
    storedMode === 'full' &&
    (protectedServerIds.length > 0 || maintenanceServerIds.length > 0 ||
      protectedResources.length > 0 || maintenanceResources.length > 0)
  ) {
    throw new Error('A full-access profile cannot contain safety tiers.')
  }
  if (
    storedMode === 'guarded' &&
    protectedServerIds.length === 0 && maintenanceServerIds.length === 0 &&
    protectedResources.length === 0 && maintenanceResources.length === 0
  ) {
    storedMode = 'observe'
  }
  return {
    id,
    name,
    email: typeof record.email === 'string' ? record.email : undefined,
    isDefault: typeof record.isDefault === 'boolean' ? record.isDefault : undefined,
    createdAt,
    accessMode: storedMode,
    protectedServerIds,
    maintenanceServerIds,
    protectedResources,
    maintenanceResources,
    token
  }
}

function parseProfileArray(raw: unknown, source: string): StoredMobileProfile[] {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      throw new Error(`The ${source} contains invalid JSON.`)
    }
  }
  if (!Array.isArray(value)) throw new Error(`The ${source} does not contain a profile list.`)
  return value.map(normalizeStoredProfile)
}

function serializeProfiles(profiles: StoredMobileProfile[]): string {
  return JSON.stringify(profiles.map(normalizeStoredProfile))
}

function toProfileMetadata(profile: StoredMobileProfile): AccountProfile {
  const { token: _token, ...metadata } = profile
  return metadata
}

async function readSecureProfiles(): Promise<StoredMobileProfile[] | null> {
  requireNativePlatform()
  const raw = await SecureStorage.get(PROFILES_KEY, false, false)
  return raw === null ? null : parseProfileArray(raw, 'mobile credential vault')
}

async function readLegacyProfiles(): Promise<StoredMobileProfile[] | null> {
  const { value: preferencesValue } = await Preferences.get({ key: PROFILES_KEY })
  const localValue = window.localStorage.getItem(PROFILES_KEY)
  const candidates = [preferencesValue, localValue].filter((value): value is string => Boolean(value))
  if (candidates.length === 0) return null

  const parsed = candidates.map((value) => parseProfileArray(value, 'legacy plaintext profile store'))
  const canonical = parsed.map(serializeProfiles)
  if (new Set(canonical).size > 1) {
    throw new Error('Conflicting legacy profile stores were found; refusing to choose one automatically.')
  }
  return parsed[0]
}

async function purgeLegacyProfiles(): Promise<void> {
  await Preferences.remove({ key: PROFILES_KEY })
  const { value } = await Preferences.get({ key: PROFILES_KEY })
  if (value != null) throw new Error('The plaintext Preferences copy of the API token could not be removed.')

  window.localStorage.removeItem(PROFILES_KEY)
  if (window.localStorage.getItem(PROFILES_KEY) !== null) {
    throw new Error('The plaintext localStorage copy of the API token could not be removed.')
  }
}

async function writeSecureProfiles(profiles: StoredMobileProfile[]): Promise<StoredMobileProfile[]> {
  requireNativePlatform()
  const payload = serializeProfiles(profiles)
  await SecureStorage.set(PROFILES_KEY, payload, false, false)
  const verified = await readSecureProfiles()
  if (!verified || serializeProfiles(verified) !== payload) {
    throw new Error('Secure profile storage verification failed; no plaintext fallback was written.')
  }
  await purgeLegacyProfiles()
  return verified
}

async function getStoredProfiles(): Promise<StoredMobileProfile[]> {
  requireNativePlatform()
  const secure = await readSecureProfiles()
  if (secure) {
    // A prior migration may have written securely but failed while purging its
    // old copy. Do not release credentials until every plaintext copy is gone.
    const legacy = await readLegacyProfiles()
    if (legacy && serializeProfiles(legacy) !== serializeProfiles(secure)) {
      throw new Error('Secure and legacy profile stores conflict; refusing to discard either copy automatically.')
    }
    await purgeLegacyProfiles()
    return secure
  }

  const legacy = await readLegacyProfiles()
  if (!legacy) return []
  const verified = await writeSecureProfiles(legacy)
  console.log('[MobileBridge] migrated profiles to native secure storage')
  return verified
}

async function readActiveProfileId(): Promise<string | null> {
  requireNativePlatform()
  const { value } = await Preferences.get({ key: ACTIVE_PROFILE_KEY })
  if (value) {
    window.localStorage.removeItem(ACTIVE_PROFILE_KEY)
    return value
  }

  const legacy = window.localStorage.getItem(ACTIVE_PROFILE_KEY)
  if (!legacy) return null
  await Preferences.set({ key: ACTIVE_PROFILE_KEY, value: legacy })
  const verified = await Preferences.get({ key: ACTIVE_PROFILE_KEY })
  if (verified.value !== legacy) throw new Error('Active profile migration could not be verified.')
  window.localStorage.removeItem(ACTIVE_PROFILE_KEY)
  return legacy
}

async function writeActiveProfileId(profileId: string): Promise<void> {
  requireNativePlatform()
  await Preferences.set({ key: ACTIVE_PROFILE_KEY, value: profileId })
  const verified = await Preferences.get({ key: ACTIVE_PROFILE_KEY })
  if (verified.value !== profileId) throw new Error('The active profile selection could not be verified.')
  window.localStorage.removeItem(ACTIVE_PROFILE_KEY)
}

async function clearActiveProfileId(): Promise<void> {
  requireNativePlatform()
  await Preferences.remove({ key: ACTIVE_PROFILE_KEY })
  const verified = await Preferences.get({ key: ACTIVE_PROFILE_KEY })
  if (verified.value != null) throw new Error('The active profile selection could not be removed.')
  window.localStorage.removeItem(ACTIVE_PROFILE_KEY)
}

function selectActiveStoredProfile(
  profiles: StoredMobileProfile[],
  activeId: string | null
): StoredMobileProfile | null {
  if (profiles.length === 0) return null
  return profiles.find((profile) => profile.id === activeId) ??
    profiles.find((profile) => profile.isDefault) ??
    profiles[0]
}

interface MobileProfileSnapshot {
  profiles: StoredMobileProfile[]
  activeProfile: StoredMobileProfile | null
  mutationEpoch: number
}

/**
 * Read profiles and the active pointer from one mutation-free interval.
 * Native secure storage and Preferences are separate stores, so a read that
 * overlaps a queued write must be retried instead of combining old and new
 * state. The epoch changes as soon as a write is queued.
 */
async function readMobileProfileSnapshot(): Promise<MobileProfileSnapshot> {
  for (;;) {
    const pendingMutations = mobileProfileMutationTail
    const mutationEpoch = mobileProfileMutationEpoch
    await pendingMutations
    if (
      pendingMutations !== mobileProfileMutationTail ||
      mutationEpoch !== mobileProfileMutationEpoch
    ) continue

    const profiles = await getStoredProfiles()
    const activeId = await readActiveProfileId()
    if (
      pendingMutations !== mobileProfileMutationTail ||
      mutationEpoch !== mobileProfileMutationEpoch
    ) continue

    return {
      profiles,
      activeProfile: selectActiveStoredProfile(profiles, activeId),
      mutationEpoch
    }
  }
}

async function getActiveStoredProfile(): Promise<StoredMobileProfile | null> {
  return (await readMobileProfileSnapshot()).activeProfile
}

function responseBody(data: unknown): string {
  if (data == null) return ''
  return typeof data === 'string' ? data : JSON.stringify(data)
}

function responseHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.toLowerCase() !== 'set-cookie')
      .map(([key, header]) => [key, String(header)])
  )
}

function statusText(status: number): string {
  if (status >= 200 && status < 300) return 'OK'
  if (status === 400) return 'Bad Request'
  if (status === 401) return 'Unauthorized'
  if (status === 403) return 'Forbidden'
  if (status === 404) return 'Not Found'
  if (status === 405) return 'Method Not Allowed'
  if (status >= 500) return 'Server Error'
  return ''
}

function requestData(body: string | undefined): unknown {
  if (body === undefined || body === '') return undefined
  if (new TextEncoder().encode(body).byteLength > 4 * 1024 * 1024) {
    throw new Error('BinaryLane request body exceeds the local safety limit.')
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('BinaryLane request body must be valid JSON.')
  }
}

async function nativeBinaryLaneRequest(
  token: string,
  url: string,
  method: string,
  body?: string
): Promise<BinaryLaneBridgeResponse> {
  requireNativePlatform()
  const result = await CapacitorHttp.request({
    url,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body !== undefined && method !== 'GET' ? { data: requestData(body) } : {}),
    connectTimeout: 15_000,
    readTimeout: 60_000,
    disableRedirects: true
  })
  if (new URL(result.url).origin !== new URL(url).origin) {
    throw new Error('BinaryLane returned a cross-origin redirect that BLDesk refused.')
  }
  return {
    status: result.status,
    statusText: statusText(result.status),
    headers: responseHeaders(result.headers),
    body: responseBody(result.data)
  }
}

function policyBlockMessage(reason: string | undefined): string {
  switch (reason) {
    case 'observe-only':
      return 'Blocked locally: this profile is observe-only.'
    case 'guarded-not-configured':
      return 'Blocked locally: set at least one server or resource to Read-only or Maintenance before enabling Protected mode.'
    case 'protected-server':
      return 'Blocked locally: this server is Read-only; changes and remote access are blocked while diagnostics remain available.'
    case 'maintenance-restricted':
      return 'Blocked locally: Maintenance permits operational access, firewall rules, diagnostics, power recovery, and non-replacing temporary backups, but not this structural change.'
    case 'protected-resource':
      return 'Blocked locally: this resource is Read-only; views remain available but changes are blocked.'
    case 'maintenance-resource-restricted':
      return 'Blocked locally: this resource is in Maintenance; in-place changes are allowed but deletion or cancellation is blocked.'
    case 'ambiguous-shared-resource':
      return 'Blocked locally: this request does not identify every server or resource it could change.'
    case 'unreviewed-read':
      return 'Blocked locally: this read endpoint is not in the reviewed BinaryLane API inventory.'
    case 'unreviewed-server-action':
      return 'Blocked locally: this server action is not in the reviewed BinaryLane API inventory.'
    case 'invalid-action-body':
      return 'Blocked locally: the server action body is not a valid reviewed JSON object.'
    case 'action-context-required':
    case 'server-network-context-required':
    case 'invalid-action-context':
      return 'Blocked locally: BLDesk could not verify every current server or network identity required by this action.'
    case 'unsupported-method':
    case 'invalid-method':
      return 'Blocked locally: the HTTP method is outside the reviewed BinaryLane API surface.'
    default:
      return 'Blocked locally: the BinaryLane request is outside the configured safety policy.'
  }
}

async function resolveMobileActionProceedContext(
  profile: StoredMobileProfile,
  actionId: number
): Promise<ActionProceedContext | null> {
  try {
    const contextUrl = binaryLaneUrlForPath(`/v2/actions/${actionId}`)
    if (!contextUrl) return null
    const response = await nativeBinaryLaneRequest(profile.token, contextUrl, 'GET')
    if (response.status < 200 || response.status >= 300) {
      return null
    }
    const data = JSON.parse(response.body) as { action?: Record<string, unknown> }
    const action = data?.action
    if (!action || action.id !== actionId) {
      return null
    }
    const interaction = action.user_interaction_required
    const interactionType = interaction !== null && typeof interaction === 'object' && !Array.isArray(interaction)
      ? (interaction as Record<string, unknown>).interaction_type
      : undefined
    return {
      actionId: action.id,
      status: action.status,
      resourceType: action.resource_type,
      resourceId: action.resource_id,
      actionType: action.type,
      interactionType
    }
  } catch {
    return null
  }
}

async function resolveMobileServerVpcContext(
  profile: StoredMobileProfile,
  serverId: number
): Promise<{ serverId: number; currentVpcId: number | null } | null> {
  try {
    const contextUrl = binaryLaneUrlForPath(`/v2/servers/${serverId}`)
    if (!contextUrl) return null
    const response = await nativeBinaryLaneRequest(profile.token, contextUrl, 'GET')
    if (response.status < 200 || response.status >= 300) return null

    const data = JSON.parse(response.body) as { server?: Record<string, unknown> }
    const server = data?.server
    if (!server || server.id !== serverId) return null

    const currentVpcId = Object.prototype.hasOwnProperty.call(server, 'vpc_id')
      ? server.vpc_id
      : null
    if (currentVpcId === null) return { serverId, currentVpcId: null }
    if (!Number.isSafeInteger(currentVpcId) || Number(currentVpcId) <= 0) return null
    return { serverId, currentVpcId: Number(currentVpcId) }
  } catch {
    return null
  }
}

function jsonBridgeResponse(
  status: number,
  statusTextValue: string,
  message: string,
  policy?: string
): BinaryLaneBridgeResponse {
  return {
    status,
    statusText: statusTextValue,
    headers: {
      'content-type': 'application/json',
      ...(policy ? { 'x-bldesk-policy': policy } : {})
    },
    body: JSON.stringify({ message })
  }
}

async function validateBinaryLaneToken(tokenValue: string): Promise<BinaryLaneTokenValidation> {
  try {
    requireNativePlatform()
    const token = normalizeToken(tokenValue)
    const path = '/v2/account'
    const decision = decideBinaryLaneRequest(
      { accessMode: 'observe', protectedServerIds: [], maintenanceServerIds: [] },
      'GET',
      path
    )
    const url = binaryLaneUrlForPath(path)
    if (!decision.allowed || !url) return { success: false, error: 'Local token validation policy rejected the request.' }

    const response = await nativeBinaryLaneRequest(token, url, decision.method)
    if (response.status < 200 || response.status >= 300) {
      return { success: false, error: `BinaryLane rejected the token (HTTP ${response.status}).` }
    }
    const parsed = JSON.parse(response.body) as { account?: { email?: unknown } }
    const email = typeof parsed.account?.email === 'string' ? parsed.account.email.trim() : ''
    if (!email || !email.includes('@')) {
      return { success: false, error: 'BinaryLane returned no verifiable account identity for this token.' }
    }
    return { success: true, email }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}

async function bridgeBinaryLaneRequest(
  profileId: string,
  request: BinaryLaneBridgeRequest
): Promise<BinaryLaneBridgeResponse> {
  requireNativePlatform()
  const url = binaryLaneUrlForPath(request?.path)
  if (!url) return jsonBridgeResponse(400, 'Bad Request', 'The BinaryLane API path was rejected locally.', 'invalid-path')

  let profileSnapshot: MobileProfileSnapshot
  try {
    profileSnapshot = await readMobileProfileSnapshot()
  } catch {
    return jsonBridgeResponse(
      503,
      'Service Unavailable',
      'The protected mobile credential vault could not be opened.',
      'vault-unavailable'
    )
  }
  let profile = profileSnapshot.activeProfile
  if (!profile) return jsonBridgeResponse(401, 'Unauthorized', 'No BinaryLane profile is active.', 'no-active-profile')
  if (profile.id !== profileId) {
    return jsonBridgeResponse(409, 'Conflict', 'The requested BinaryLane profile is no longer active.', 'inactive-profile')
  }

  const body = typeof request.body === 'string' ? request.body : undefined
  if (body !== undefined && new TextEncoder().encode(body).byteLength > 4 * 1024 * 1024) {
    return jsonBridgeResponse(413, 'Payload Too Large', 'The API request body exceeds the local safety limit.', 'body-too-large')
  }

  let decision = decideBinaryLaneRequest(profile, request.method, request.path, body)
  if (!decision.allowed && decision.reason === 'server-network-context-required') {
    const serverId = serverActionsIdForPath(request.path)
    if (serverId === null) {
      decision = { allowed: false, method: decision.method, reason: 'invalid-action-context' }
    } else {
      const tokenAtContextRead = profile.token
      const context = await resolveMobileServerVpcContext(profile, serverId)
      if (!context) {
        decision = { allowed: false, method: 'POST', reason: 'invalid-action-context' }
      } else {
        // Re-read native secure storage so a profile switch, token rotation or
        // newly strengthened entity tier wins over the earlier observation.
        try {
          profileSnapshot = await readMobileProfileSnapshot()
        } catch {
          return jsonBridgeResponse(
            503,
            'Service Unavailable',
            'The protected mobile credential vault could not be reopened.',
            'vault-unavailable'
          )
        }
        const currentProfile = profileSnapshot.activeProfile
        if (
          !currentProfile ||
          currentProfile.id !== profileId ||
          currentProfile.token !== tokenAtContextRead
        ) {
          return jsonBridgeResponse(
            409,
            'Conflict',
            'The active BinaryLane profile or token changed while the server network was checked.',
            'inactive-profile'
          )
        }
        profile = currentProfile
        decision = decideServerNetworkActionAccess(
          profile,
          context.serverId,
          context.currentVpcId,
          body
        )
      }
    }
  }
  if (!decision.allowed && decision.reason === 'action-context-required') {
    const actionId = actionProceedIdForPath(request.path)
    if (actionId === null) {
      decision = { allowed: false, method: decision.method, reason: 'invalid-action-context' }
    } else {
      const tokenAtContextRead = profile.token
      const context = await resolveMobileActionProceedContext(profile, actionId)
      if (!context) {
        decision = { allowed: false, method: 'POST', reason: 'invalid-action-context' }
      } else {
        // Re-read both secure profile data and the active pointer after the
        // awaited ownership lookup. A new token cannot reuse context proven by
        // the old account, and a newly Locked server must block this POST.
        try {
          profileSnapshot = await readMobileProfileSnapshot()
        } catch {
          return jsonBridgeResponse(
            503,
            'Service Unavailable',
            'The protected mobile credential vault could not be reopened.',
            'vault-unavailable'
          )
        }
        const currentProfile = profileSnapshot.activeProfile
        if (
          !currentProfile ||
          currentProfile.id !== profileId ||
          currentProfile.token !== tokenAtContextRead
        ) {
          return jsonBridgeResponse(
            409,
            'Conflict',
            'The active BinaryLane profile or token changed while the pending action was checked.',
            'inactive-profile'
          )
        }
        profile = currentProfile
        const proceed = decideActionProceedAccess(profile, context, body)
        decision = {
          allowed: proceed.allowed,
          method: 'POST',
          ...(proceed.authorizedBody !== undefined ? { authorizedBody: proceed.authorizedBody } : {}),
          ...(proceed.reason !== undefined ? { reason: proceed.reason } : {})
        }
      }
    }
  }
  if (!decision.allowed) {
    return jsonBridgeResponse(403, 'Forbidden', policyBlockMessage(decision.reason), decision.reason)
  }
  // A write queued after the snapshot invalidates this decision. Because the
  // epoch check and native request invocation are synchronous, no renderer
  // event can interleave between them.
  if (profileSnapshot.mutationEpoch !== mobileProfileMutationEpoch) {
    return jsonBridgeResponse(
      409,
      'Conflict',
      'The active BinaryLane safety policy changed before the request was sent.',
      'inactive-profile'
    )
  }
  try {
    const response = await nativeBinaryLaneRequest(profile.token, url, decision.method, decision.authorizedBody)
    if (response.status >= 300 && response.status < 400) {
      return jsonBridgeResponse(
        502,
        'Bad Gateway',
        'BinaryLane returned a redirect that BLDesk refused to follow.',
        'redirect-blocked'
      )
    }
    return response
  } catch {
    return jsonBridgeResponse(502, 'Bad Gateway', 'The BinaryLane API request could not be completed.')
  }
}

function parseBridgeJson(response: BinaryLaneBridgeResponse, purpose: string): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${purpose} was refused (HTTP ${response.status}).`)
  }
  try {
    const parsed = JSON.parse(response.body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(`${purpose} returned an invalid response.`)
  }
}

function normalizedHost(value: string): string {
  const trimmed = value.trim().toLowerCase()
  const unbracketed = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed
  return unbracketed.replace(/%25/g, '%')
}

function serverAddresses(payload: Record<string, unknown>, expectedServerId: number): Set<string> {
  const server = payload.server
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    throw new Error('BinaryLane returned no server for SSH destination verification.')
  }
  const serverRecord = server as Record<string, unknown>
  if (Number(serverRecord.id) !== expectedServerId) {
    throw new Error('BinaryLane returned a different server during SSH destination verification.')
  }
  const networks = serverRecord.networks
  if (!networks || typeof networks !== 'object' || Array.isArray(networks)) return new Set()

  const addresses = new Set<string>()
  const networkRecord = networks as Record<string, unknown>
  for (const family of ['v4', 'v6']) {
    const entries = networkRecord[family]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const address = (entry as Record<string, unknown>).ip_address
      if (typeof address === 'string' && address.trim()) addresses.add(normalizedHost(address))
    }
  }
  return addresses
}

async function verifySshDestination(profile: StoredMobileProfile, serverId: number, host: string): Promise<void> {
  const response = await bridgeBinaryLaneRequest(profile.id, {
    method: 'GET',
    path: `/v2/servers/${serverId}`
  })
  const payload = parseBridgeJson(response, 'SSH destination verification')
  if (!serverAddresses(payload, serverId).has(normalizedHost(host))) {
    throw new Error('SSH host does not belong to the selected BinaryLane server.')
  }

  // Close the profile-switch/policy-change race between the first check and the
  // API read. Remote access is granted only if the same profile still permits it.
  const current = await getActiveStoredProfile()
  if (!current || current.id !== profile.id || !isRemoteAccessAllowed(current, serverId)) {
    throw new Error('The active BinaryLane safety policy changed before SSH could open.')
  }
}

async function fetchConsoleUrl(
  profile: StoredMobileProfile,
  serverId: number
): Promise<{ url: string; width?: number; height?: number }> {
  const response = await bridgeBinaryLaneRequest(profile.id, {
    method: 'GET',
    path: `/v2/servers/${serverId}/console`
  })
  const payload = parseBridgeJson(response, 'Rescue console request')
  const consoleValue = payload.console
  if (!consoleValue || typeof consoleValue !== 'object' || Array.isArray(consoleValue)) {
    throw new Error('BinaryLane returned no rescue console details.')
  }
  const consoleRecord = consoleValue as Record<string, unknown>
  const candidate =
    typeof consoleRecord.browser === 'string'
      ? consoleRecord.browser
      : typeof consoleRecord.iframe === 'string'
        ? consoleRecord.iframe
        : ''
  if (!candidate) throw new Error('BinaryLane returned no rescue console URL.')

  const url = new URL(candidate)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('BinaryLane returned an unsafe rescue console URL.')
  }

  const current = await getActiveStoredProfile()
  if (!current || current.id !== profile.id || !isRemoteAccessAllowed(current, serverId)) {
    throw new Error('The active BinaryLane safety policy changed before the rescue console could open.')
  }
  return {
    url: url.toString(),
    width: Number.isSafeInteger(consoleRecord.width) ? Number(consoleRecord.width) : undefined,
    height: Number.isSafeInteger(consoleRecord.height) ? Number(consoleRecord.height) : undefined
  }
}

export async function initMobileBridge(): Promise<void> {
  if (typeof window === 'undefined') return

  // If running inside Electron, native bldeskApi is already exposed via preload.
  if (window.bldeskApi) return

  const isNative = Capacitor.isNativePlatform()
  console.log(`[MobileBridge] Initializing ${isNative ? 'native Android' : 'non-credential web'} bridge...`)

  const mobileApi: IpcApi = {
    getProfiles: async () => (isNative ? (await readMobileProfileSnapshot()).profiles.map(toProfileMetadata) : []),
    getActiveProfile: async () => {
      if (!isNative) return null
      const active = await getActiveStoredProfile()
      return active ? toProfileMetadata(active) : null
    },
    validateBinaryLaneToken: async (token) => {
      if (!isNative) return { success: false, error: 'Token validation is disabled in ordinary web builds.' }
      return validateBinaryLaneToken(token)
    },
    binaryLaneRequest: async (profileId, request) => {
      if (!isNative) throw new Error('BinaryLane API requests are disabled in ordinary web builds.')
      return bridgeBinaryLaneRequest(profileId, request)
    },
    saveProfile: async (input: SaveProfileInput) => withMobileProfileMutation(async () => {
      if (!isNative) {
        return { success: false, profileId: '', error: 'Credential storage is disabled in ordinary web builds.' }
      }
      try {
        const name = input.name.trim()
        const token = normalizeToken(input.token)
        if (!name) throw new Error('Profile name is required.')
        // Validate again at the secure write boundary. The earlier UI check is
        // only feedback and cannot establish account identity for storage.
        const validation = await validateBinaryLaneToken(token)
        if (!validation.success || !validation.email) {
          throw new Error(validation.error || 'The token account could not be verified.')
        }
        const verifiedEmail = validation.email.trim()
        const profiles = await getStoredProfiles()
        const byId = input.profileId ? profiles.findIndex((profile) => profile.id === input.profileId) : -1
        if (input.profileId && byId < 0) throw new Error('The profile to update no longer exists.')
        const duplicate = profiles.find(
          (profile, index) => index !== byId && profile.name.trim().toLowerCase() === name.toLowerCase()
        )
        if (duplicate) throw new Error(`A profile named "${duplicate.name}" already exists.`)

        const existing = byId >= 0 ? profiles[byId] : null
        if (existing?.email && existing.email.trim().toLowerCase() !== verifiedEmail.toLowerCase()) {
          throw new Error(
            `This token belongs to ${verifiedEmail}, not the saved ${existing.email} account. Add it as a new observe-only profile instead.`
          )
        }
        const isDefault = input.isDefault ?? existing?.isDefault ?? profiles.length === 0
        const protectedServerIds = existing ? [...existing.protectedServerIds] : []
        const maintenanceServerIds = existing ? [...existing.maintenanceServerIds] : []
        const protectedResources = existing ? existing.protectedResources.map((target) => ({ ...target })) : []
        const maintenanceResources = existing ? existing.maintenanceResources.map((target) => ({ ...target })) : []
        const accessMode: ProfileAccessMode = existing
          ? (existing.email ? existing.accessMode : 'observe')
          : 'observe'
        const profile: StoredMobileProfile = {
          id: existing?.id ?? `profile_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name,
          email: verifiedEmail,
          isDefault,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          accessMode,
          protectedServerIds,
          maintenanceServerIds,
          protectedResources,
          maintenanceResources,
          token
        }

        if (isDefault) profiles.forEach((candidate) => (candidate.isDefault = false))
        if (byId >= 0) profiles[byId] = profile
        else profiles.push(profile)
        await writeSecureProfiles(profiles)
        if (isDefault || profiles.length === 1) await writeActiveProfileId(profile.id)
        return { success: true, profileId: profile.id, updated: byId >= 0 }
      } catch (error) {
        return { success: false, profileId: '', error: errorMessage(error) }
      }
    }),
    updateProfileSafety: async (
      profileId,
      accessModeValue,
      protectedServerIdsValue,
      maintenanceServerIdsValue,
      protectedResourcesValue,
      maintenanceResourcesValue
    ) => withMobileProfileMutation(async () => {
      if (!isNative) return { success: false, error: 'Profiles are disabled in ordinary web builds.' }
      try {
        const profiles = await getStoredProfiles()
        const index = profiles.findIndex((profile) => profile.id === profileId)
        if (index < 0) return { success: false, error: 'The profile no longer exists.' }

        const profile = profiles[index]
        const transition = decideProfileAccessTransition(profile.accessMode, accessModeValue)
        const accessMode = transition.mode
        if (
          !Array.isArray(protectedServerIdsValue) ||
          !protectedServerIdsValue.every((id) => Number.isSafeInteger(id) && id > 0) ||
          !Array.isArray(maintenanceServerIdsValue) ||
          !maintenanceServerIdsValue.every((id) => Number.isSafeInteger(id) && id > 0) ||
          !areCanonicalResourceSafetyTargets(protectedResourcesValue) ||
          !areCanonicalResourceSafetyTargets(maintenanceResourcesValue)
        ) {
          return { success: false, error: 'Safety tiers contain an invalid server or resource identity.' }
        }
        const { protectedServerIds, maintenanceServerIds } = mergeMobileSafetyTierIds(
          profile.protectedServerIds,
          profile.maintenanceServerIds,
          protectedServerIdsValue,
          maintenanceServerIdsValue
        )
        const { protectedResources, maintenanceResources } = mergeMobileResourceSafetyTiers(
          profile.protectedResources,
          profile.maintenanceResources,
          protectedResourcesValue,
          maintenanceResourcesValue
        )
        if (!transition.allowed) {
          return {
            success: false,
            error: 'Only a migrated legacy full-access profile may remain unrestricted; tiered profiles cannot be promoted to full access.'
          }
        }
        if (
          accessMode === 'full' &&
          (protectedServerIds.length > 0 || maintenanceServerIds.length > 0 ||
            protectedResources.length > 0 || maintenanceResources.length > 0)
        ) {
          return {
            success: false,
            error: 'A profile with safety tiers cannot be switched to full access.'
          }
        }
        if (
          accessMode === 'guarded' &&
          protectedServerIds.length === 0 && maintenanceServerIds.length === 0 &&
          protectedResources.length === 0 && maintenanceResources.length === 0
        ) {
          return {
            success: false,
            error: 'Protected mode requires at least one Read-only or Maintenance entity.'
          }
        }

        profiles[index] = {
          ...profile,
          accessMode,
          protectedServerIds,
          maintenanceServerIds,
          protectedResources,
          maintenanceResources
        }
        await writeSecureProfiles(profiles)
        return { success: true }
      } catch (error) {
        return { success: false, error: errorMessage(error) }
      }
    }),
    deleteProfile: async (profileId) => withMobileProfileMutation(async () => {
      if (!isNative) return { success: false, error: 'Profiles are disabled in ordinary web builds.' }
      try {
        const profiles = await getStoredProfiles()
        if (!profiles.some((profile) => profile.id === profileId)) {
          return { success: false, error: 'The profile no longer exists.' }
        }
        const updated = profiles.filter((profile) => profile.id !== profileId)
        await writeSecureProfiles(updated)
        const activeId = await readActiveProfileId()
        if (activeId === profileId) {
          const replacement = updated.find((profile) => profile.isDefault) ?? updated[0]
          if (replacement) await writeActiveProfileId(replacement.id)
          else await clearActiveProfileId()
        }
        return { success: true }
      } catch (error) {
        return { success: false, error: errorMessage(error) }
      }
    }),
    setActiveProfile: async (profileId) => withMobileProfileMutation(async () => {
      if (!isNative) return { success: false, error: 'Profiles are disabled in ordinary web builds.' }
      try {
        const profiles = await getStoredProfiles()
        if (!profiles.some((profile) => profile.id === profileId)) {
          return { success: false, error: 'The profile no longer exists.' }
        }
        await writeActiveProfileId(profileId)
        return { success: true }
      } catch (error) {
        return { success: false, error: errorMessage(error) }
      }
    }),
    launchNativeTerminal: async (opts) => {
      if (!isNative) return { success: false, error: 'Native terminals are unavailable in web builds.' }
      try {
        const serverId = opts.serverId
        const active = await getActiveStoredProfile()
        if (!active) {
          return { success: false, error: 'SSH is blocked locally by the active BinaryLane safety policy.' }
        }
        const invalid = validateSshTarget(opts)
        if (invalid) return { success: false, error: invalid }

        if (!Number.isSafeInteger(serverId) || Number(serverId) <= 0) {
          // Preserve the manual arbitrary-host terminal only for the explicit
          // legacy/unrestricted mode. Guarded access is always server-bound.
          if (active.accessMode !== 'full') {
            return { success: false, error: 'SSH requires a verified BinaryLane server ID.' }
          }
          const current = await getActiveStoredProfile()
          if (!current || current.id !== active.id || current.accessMode !== 'full') {
            return { success: false, error: 'The active BinaryLane safety policy changed before SSH could open.' }
          }
        } else {
          if (!isRemoteAccessAllowed(active, serverId)) {
            return { success: false, error: 'SSH is blocked locally by the active BinaryLane safety policy.' }
          }
          await verifySshDestination(active, Number(serverId), opts.host)
        }
        const host = sshUriHost(opts.host) ?? opts.host.trim()
        const uri = `ssh://${opts.username || 'root'}@${host}${opts.port ? `:${opts.port}` : ''}`
        window.open(uri, '_system')
        return { success: true, terminal: 'ssh:// handler', command: formatSshCommand(opts, 'posix') }
      } catch (error) {
        return { success: false, error: errorMessage(error) }
      }
    },
    openRescueConsole: async (opts) => {
      if (!isNative) return { success: false, error: 'Rescue consoles are unavailable in web builds.' }
      try {
        if (!Number.isSafeInteger(opts.serverId) || opts.serverId <= 0) {
          return { success: false, error: 'The rescue console requires a verified BinaryLane server ID.' }
        }
        const active = await getActiveStoredProfile()
        if (!active || !isRemoteAccessAllowed(active, opts.serverId)) {
          return { success: false, error: 'The rescue console is blocked locally by the active BinaryLane safety policy.' }
        }
        const consoleDetails = await fetchConsoleUrl(active, opts.serverId)
        // Ignore the renderer-supplied URL entirely. It is only retained in the
        // cross-platform IPC shape for compatibility with older callers.
        window.open(consoleDetails.url, '_blank')
        return { success: true }
      } catch (error) {
        return { success: false, error: errorMessage(error) }
      }
    },
    getLocalSshKeys: async () => {
      return []
    },
    sendNotification: async (opts) => {
      console.log(`[Notification] ${opts.title}: ${opts.body}`)
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(opts.title, { body: opts.body })
      }
    },
    // Change log: the renderer's localStorage fallback handles Android, so
    // these are intentionally absent — lib/changelog.ts checks for them.
    changelogAppend: undefined as any,
    changelogUpdate: undefined as any,
    changelogList: undefined as any,
    changelogClear: undefined as any,
    // Cloud-init templates use the renderer library's localStorage fallback.
    templatesList: undefined as any,
    templatesGet: undefined as any,
    templatesSave: undefined as any,
    templatesRemove: undefined as any,
    templatesReveal: undefined as any,
    // No tray on Android; the summary has nowhere to go.
    updateTray: async () => {},
    getTraySettings: async () => ({
      launchAtLogin: false,
      closeToTray: false,
      notifyServerState: true,
      notifyActions: true,
      notifyBalance: true
    }),
    platform: (window as any).Capacitor?.isNativePlatform?.() ? 'android' : 'web',
    minimizeWindow: async () => {},
    maximizeWindow: async () => {},
    closeWindow: async () => {},
    isMaximized: async () => false,
    openExternal: async (url: string) => {
      window.open(url, '_blank')
    },

    // Auto-update on Android: Check GitHub Releases and download newer APKs
    getUpdaterState: async () => currentMobileUpdaterState,
    checkForUpdates: async () => checkMobileGithubUpdates(),
    installUpdate: async () => {
      const url =
        currentMobileUpdaterState.apkUrl ||
        'https://github.com/termau/bldesk/releases/latest/download/BLDesk-android.apk'
      window.open(url, '_system')
    },
    setUpdateChannel: async (channel: UpdateChannel) => {
      broadcastMobileUpdater({ channel })
      return checkMobileGithubUpdates()
    },
    onUpdaterState: (cb) => {
      mobileUpdaterListeners.add(cb)
      cb(currentMobileUpdaterState)
      return () => {
        mobileUpdaterListeners.delete(cb)
      }
    },

    // Deep links: Android intent-filter + @capacitor/app `appUrlOpen` would feed
    // these; for now the web/mobile build accepts a link via the page URL hash.
    getPendingDeepLink: async () => {
      const hash = window.location.hash.replace(/^#/, '')
      return hash.startsWith('bldesk:') ? decodeURIComponent(hash) : null
    },
    deepLinkReady: async () => {},
    onDeepLink: () => () => {}
  }

  ;(window as any).bldeskApi = mobileApi

  // Perform background update check on app launch
  setTimeout(() => {
    checkMobileGithubUpdates().catch(() => {})
  }, 4000)
}
