import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { basename, dirname, join } from 'path'
import type { AccountProfile, SaveProfileInput } from '../shared/ipc-types'
import {
  decideProfileAccessTransition,
  mergeProtectedServerIds,
  normalizeProtectedServerIds,
  normalizeStoredAccessMode,
  type ProfileAccessMode,
  type ProfileSafetyPolicy
} from '../shared/binarylane-policy'
import {
  areCanonicalResourceSafetyTargets,
  mergeResourceSafetyTargets,
  normalizeResourceSafetyTargets,
  resourceSafetyKey,
  type ResourceSafetyTarget
} from '../shared/resource-safety'

const VAULT_VERSION = 2 as const
const CREDENTIAL_SCHEME = 'electron-safe-storage' as const
const CREDENTIAL_VERSION = 1 as const
const MAX_VAULT_BYTES = 5 * 1024 * 1024
const MAX_SECRET_LENGTH = 64 * 1024
const MAX_METADATA_LENGTH = 4096

export type VaultErrorCode =
  | 'storage-unavailable'
  | 'weak-storage-backend'
  | 'invalid-input'
  | 'corrupt-vault'
  | 'unsupported-version'
  | 'locked-credential'
  | 'vault-read-failed'
  | 'vault-write-failed'

/** A stable, non-secret error code suitable for translating at the IPC boundary. */
export class VaultError extends Error {
  public readonly code: VaultErrorCode

  public constructor(code: VaultErrorCode, message: string) {
    super(message)
    this.name = 'VaultError'
    this.code = code
  }
}

interface CredentialEnvelopeV1 {
  scheme: typeof CREDENTIAL_SCHEME
  version: typeof CREDENTIAL_VERSION
  encoding: 'base64'
  ciphertext: string
}

interface VaultProfileRecord extends AccountProfile {
  credential: CredentialEnvelopeV1
}

interface VaultFileV2 {
  version: typeof VAULT_VERSION
  activeProfileId: string | null
  profiles: VaultProfileRecord[]
}

interface LegacyProfileRecord {
  id: string
  name: string
  encryptedToken: string
  email?: string
  isDefault?: boolean
  createdAt: string
  accessMode: ProfileAccessMode
  protectedServerIds: number[]
  maintenanceServerIds: number[]
  protectedResources: ResourceSafetyTarget[]
  maintenanceResources: ResourceSafetyTarget[]
}

interface LegacyVaultFile {
  activeProfileId: string | null
  profiles: LegacyProfileRecord[]
}

export interface ProfileCredential extends ProfileSafetyPolicy {
  token: string
}

export interface VerifiedSaveProfileInput extends SaveProfileInput {
  /** Set only by the privileged BinaryLane account validation request. */
  verifiedEmail: string
}

function getVaultFilePath(): string {
  if (!app.isReady()) {
    throw new VaultError('storage-unavailable', 'The credential vault is not available before the app is ready.')
  }
  return join(app.getPath('userData'), 'vault.enc')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrno(value: unknown, code: string): boolean {
  return isObject(value) && value.code === code
}

function requiredString(
  value: unknown,
  field: string,
  options: { allowEmpty?: boolean; maxLength?: number } = {}
): string {
  const maxLength = options.maxLength ?? MAX_METADATA_LENGTH
  if (
    typeof value !== 'string' ||
    (!options.allowEmpty && value.length === 0) ||
    value.length > maxLength ||
    value.includes('\0')
  ) {
    throw new VaultError('corrupt-vault', `The credential vault contains an invalid ${field}.`)
  }
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, field, { allowEmpty: true })
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new VaultError('corrupt-vault', `The credential vault contains an invalid ${field}.`)
  }
  return value
}

function validateProfileName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_METADATA_LENGTH ||
    value.includes('\0') ||
    value.trim().length === 0
  ) {
    throw new VaultError('invalid-input', 'The profile name is empty or invalid.')
  }
  return value.trim()
}

function validateVerifiedEmail(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_METADATA_LENGTH ||
    value.includes('\0') ||
    !value.includes('@') ||
    value.trim().length === 0
  ) {
    throw new VaultError('invalid-input', 'BinaryLane did not return a valid verified account identity.')
  }
  return value.trim()
}

function decodeCanonicalBase64(value: string): Buffer | null {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return null
  }

  const decoded = Buffer.from(value, 'base64')
  return decoded.length > 0 && decoded.toString('base64') === value ? decoded : null
}

function isStrictEvenHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^(?:[0-9a-fA-F]{2})+$/.test(value)
}

function validateSecret(token: unknown, source: 'input' | 'vault'): string {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > MAX_SECRET_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(token)
  ) {
    throw new VaultError(
      source === 'input' ? 'invalid-input' : 'locked-credential',
      source === 'input'
        ? 'The API token is empty or invalid.'
        : 'A saved credential could not be decoded safely. Re-enter the API token for this profile.'
    )
  }
  return token
}

function ensureSecureStorage(): void {
  if (!app.isReady() || !safeStorage.isEncryptionAvailable()) {
    throw new VaultError(
      'storage-unavailable',
      'OS-protected credential storage is unavailable. No API token was read or saved.'
    )
  }

  if (process.platform === 'linux') {
    const backend = safeStorage.getSelectedStorageBackend()
    if (backend === 'basic_text' || backend === 'unknown') {
      throw new VaultError(
        'weak-storage-backend',
        'A secure Linux keyring is unavailable. BLDesk refuses to store API tokens with basic-text encryption.'
      )
    }
  }
}

function parseCredential(value: unknown): CredentialEnvelopeV1 {
  if (!isObject(value)) {
    throw new VaultError('corrupt-vault', 'The credential vault contains an invalid credential envelope.')
  }
  if (
    value.scheme !== CREDENTIAL_SCHEME ||
    value.version !== CREDENTIAL_VERSION ||
    value.encoding !== 'base64'
  ) {
    throw new VaultError('unsupported-version', 'The credential vault uses an unsupported credential format.')
  }

  const ciphertext = requiredString(value.ciphertext, 'credential ciphertext', {
    maxLength: MAX_SECRET_LENGTH * 8
  })
  if (!decodeCanonicalBase64(ciphertext)) {
    throw new VaultError('corrupt-vault', 'The credential vault contains malformed encrypted data.')
  }

  return {
    scheme: CREDENTIAL_SCHEME,
    version: CREDENTIAL_VERSION,
    encoding: 'base64',
    ciphertext
  }
}

function parseV2Profile(value: unknown): VaultProfileRecord {
  if (!isObject(value)) {
    throw new VaultError('corrupt-vault', 'The credential vault contains an invalid profile.')
  }
  if (value.accessMode !== 'observe' && value.accessMode !== 'guarded' && value.accessMode !== 'full') {
    throw new VaultError('corrupt-vault', 'The credential vault contains an invalid profile access mode.')
  }
  if (!Array.isArray(value.protectedServerIds)) {
    throw new VaultError('corrupt-vault', 'The credential vault contains invalid protected server IDs.')
  }
  if (!value.protectedServerIds.every((id) => Number.isSafeInteger(id) && Number(id) > 0)) {
    throw new VaultError('corrupt-vault', 'The credential vault contains invalid protected server IDs.')
  }
  if (
    value.maintenanceServerIds !== undefined &&
    (!Array.isArray(value.maintenanceServerIds) ||
      !value.maintenanceServerIds.every((id) => Number.isSafeInteger(id) && Number(id) > 0))
  ) {
    throw new VaultError('corrupt-vault', 'The credential vault contains invalid maintenance server IDs.')
  }
  if (value.protectedResources !== undefined && !areCanonicalResourceSafetyTargets(value.protectedResources)) {
    throw new VaultError('corrupt-vault', 'The credential vault contains invalid Read-only resource tiers.')
  }
  if (value.maintenanceResources !== undefined && !areCanonicalResourceSafetyTargets(value.maintenanceResources)) {
    throw new VaultError('corrupt-vault', 'The credential vault contains invalid Maintenance resource tiers.')
  }

  const protectedServerIds = normalizeProtectedServerIds(value.protectedServerIds)
  const maintenanceServerIds = normalizeProtectedServerIds(value.maintenanceServerIds)
  const protectedResources = normalizeResourceSafetyTargets(value.protectedResources)
  const maintenanceResources = normalizeResourceSafetyTargets(value.maintenanceResources)
  const protectedSet = new Set(protectedServerIds)
  if (maintenanceServerIds.some((id) => protectedSet.has(id))) {
    throw new VaultError('corrupt-vault', 'A server cannot be both locked and in maintenance mode.')
  }
  const protectedResourceKeys = new Set(protectedResources.map(resourceSafetyKey))
  if (maintenanceResources.some((target) => protectedResourceKeys.has(resourceSafetyKey(target)))) {
    throw new VaultError('corrupt-vault', 'A resource cannot be both Read-only and in Maintenance mode.')
  }
  if (
    value.accessMode === 'full' &&
    (protectedServerIds.length > 0 || maintenanceServerIds.length > 0 ||
      protectedResources.length > 0 || maintenanceResources.length > 0)
  ) {
    throw new VaultError('corrupt-vault', 'A full-access profile cannot contain safety tiers.')
  }
  // Older V2 builds allowed a guarded profile with no configured server IDs.
  // Its effective behaviour was observe-only, so preserve that fail-closed
  // meaning while bringing the stored metadata into the new invariant.
  const accessMode =
    value.accessMode === 'guarded' &&
      protectedServerIds.length === 0 && maintenanceServerIds.length === 0 &&
      protectedResources.length === 0 && maintenanceResources.length === 0
      ? 'observe'
      : value.accessMode

  return {
    id: requiredString(value.id, 'profile ID'),
    name: requiredString(value.name, 'profile name', { allowEmpty: true }),
    email: optionalString(value.email, 'profile email'),
    isDefault: optionalBoolean(value.isDefault, 'default profile flag'),
    createdAt: requiredString(value.createdAt, 'profile creation time'),
    accessMode,
    protectedServerIds,
    maintenanceServerIds,
    protectedResources,
    maintenanceResources,
    credential: parseCredential(value.credential)
  }
}

function validateProfileSet(activeProfileId: string | null, profiles: VaultProfileRecord[]): void {
  const ids = new Set<string>()
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      throw new VaultError('corrupt-vault', 'The credential vault contains duplicate profile IDs.')
    }
    ids.add(profile.id)
  }

  if (profiles.length === 0 && activeProfileId !== null) {
    throw new VaultError('corrupt-vault', 'The empty credential vault has an invalid active profile.')
  }
  if (activeProfileId !== null && !ids.has(activeProfileId)) {
    throw new VaultError('corrupt-vault', 'The credential vault references an unknown active profile.')
  }
}

function parseVaultV2(value: unknown): VaultFileV2 {
  if (!isObject(value) || value.version !== VAULT_VERSION || !Array.isArray(value.profiles)) {
    throw new VaultError('corrupt-vault', 'The versioned credential vault is malformed.')
  }
  if (value.activeProfileId !== null && typeof value.activeProfileId !== 'string') {
    throw new VaultError('corrupt-vault', 'The credential vault contains an invalid active profile ID.')
  }

  const profiles = value.profiles.map(parseV2Profile)
  const activeProfileId = value.activeProfileId
  validateProfileSet(activeProfileId, profiles)
  return { version: VAULT_VERSION, activeProfileId, profiles }
}

function parseLegacyProfile(value: unknown): LegacyProfileRecord {
  if (!isObject(value)) {
    throw new VaultError('corrupt-vault', 'The legacy credential vault contains an invalid profile.')
  }

  if (
    value.protectedServerIds !== undefined &&
    (!Array.isArray(value.protectedServerIds) ||
      !value.protectedServerIds.every((id) => Number.isSafeInteger(id) && Number(id) > 0))
  ) {
    // Dropping a malformed stored ID could silently remove protection from a
    // live server, so stored policy corruption is not repaired heuristically.
    throw new VaultError('corrupt-vault', 'The legacy credential vault contains invalid protected server IDs.')
  }
  if (
    value.maintenanceServerIds !== undefined &&
    (!Array.isArray(value.maintenanceServerIds) ||
      !value.maintenanceServerIds.every((id) => Number.isSafeInteger(id) && Number(id) > 0))
  ) {
    throw new VaultError('corrupt-vault', 'The legacy credential vault contains invalid maintenance server IDs.')
  }
  if (value.protectedResources !== undefined && !areCanonicalResourceSafetyTargets(value.protectedResources)) {
    throw new VaultError('corrupt-vault', 'The legacy credential vault contains invalid Read-only resource tiers.')
  }
  if (value.maintenanceResources !== undefined && !areCanonicalResourceSafetyTargets(value.maintenanceResources)) {
    throw new VaultError('corrupt-vault', 'The legacy credential vault contains invalid Maintenance resource tiers.')
  }
  const protectedServerIds = normalizeProtectedServerIds(value.protectedServerIds)
  const protectedSet = new Set(protectedServerIds)
  const maintenanceServerIds = normalizeProtectedServerIds(value.maintenanceServerIds).filter(
    (id) => !protectedSet.has(id)
  )
  const protectedResources = normalizeResourceSafetyTargets(value.protectedResources)
  const protectedResourceKeys = new Set(protectedResources.map(resourceSafetyKey))
  const maintenanceResources = normalizeResourceSafetyTargets(value.maintenanceResources).filter(
    (target) => !protectedResourceKeys.has(resourceSafetyKey(target))
  )
  let accessMode = normalizeStoredAccessMode(value.accessMode)
  if (
    accessMode === 'full' &&
    (protectedServerIds.length > 0 || maintenanceServerIds.length > 0 ||
      protectedResources.length > 0 || maintenanceResources.length > 0)
  ) {
    accessMode = 'observe'
  }
  if (
    accessMode === 'guarded' &&
    protectedServerIds.length === 0 && maintenanceServerIds.length === 0 &&
    protectedResources.length === 0 && maintenanceResources.length === 0
  ) {
    accessMode = 'observe'
  }

  return {
    id: requiredString(value.id, 'legacy profile ID'),
    name: requiredString(value.name, 'legacy profile name', { allowEmpty: true }),
    email: optionalString(value.email, 'legacy profile email'),
    isDefault: optionalBoolean(value.isDefault, 'legacy default profile flag'),
    createdAt: requiredString(value.createdAt, 'legacy profile creation time'),
    encryptedToken: requiredString(value.encryptedToken, 'legacy encrypted token', {
      maxLength: MAX_SECRET_LENGTH * 8
    }),
    // Missing means the profile predates policies and retains its old full
    // behaviour. A present but unknown value fails closed to observe-only.
    accessMode,
    protectedServerIds,
    maintenanceServerIds,
    protectedResources,
    maintenanceResources
  }
}

function parseLegacyVault(value: unknown): LegacyVaultFile {
  if (!isObject(value) || !Array.isArray(value.profiles)) {
    throw new VaultError('corrupt-vault', 'The legacy credential vault is malformed.')
  }
  if (value.activeProfileId !== null && typeof value.activeProfileId !== 'string') {
    throw new VaultError('corrupt-vault', 'The legacy credential vault contains an invalid active profile ID.')
  }

  const profiles = value.profiles.map(parseLegacyProfile)
  const ids = new Set<string>()
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      throw new VaultError('corrupt-vault', 'The legacy credential vault contains duplicate profile IDs.')
    }
    ids.add(profile.id)
  }

  return { activeProfileId: value.activeProfileId, profiles }
}

function metadataFor(record: VaultProfileRecord): AccountProfile {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    isDefault: record.isDefault,
    createdAt: record.createdAt,
    accessMode: record.accessMode,
    protectedServerIds: [...record.protectedServerIds],
    maintenanceServerIds: [...record.maintenanceServerIds],
    protectedResources: record.protectedResources.map((target) => ({ ...target })),
    maintenanceResources: record.maintenanceResources.map((target) => ({ ...target }))
  }
}

function activeRecord(vault: VaultFileV2): VaultProfileRecord | null {
  if (vault.profiles.length === 0) return null
  return (
    vault.profiles.find((profile) => profile.id === vault.activeProfileId) ??
    vault.profiles.find((profile) => profile.isDefault) ??
    vault.profiles[0] ??
    null
  )
}

function unionProtectedServerIds(current: number[], requested: unknown): number[] {
  return mergeProtectedServerIds(current, requested)
}

function mergeSafetyTierIds(
  currentProtected: number[],
  currentMaintenance: number[],
  requestedProtected: unknown,
  requestedMaintenance: unknown
): { protectedServerIds: number[]; maintenanceServerIds: number[] } {
  // Both sets are monotonic. Locking wins when the same ID appears in either
  // set, which is the only permitted Maintenance -> Locked transition.
  const protectedServerIds = unionProtectedServerIds(currentProtected, requestedProtected)
  const protectedSet = new Set(protectedServerIds)
  const maintenanceServerIds = mergeProtectedServerIds(currentMaintenance, requestedMaintenance).filter(
    (id) => !protectedSet.has(id)
  )
  return { protectedServerIds, maintenanceServerIds }
}

function mergeResourceSafetyTiers(
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

export class VaultManager {
  private static decryptCredential(credential: CredentialEnvelopeV1): string {
    ensureSecureStorage()
    const ciphertext = decodeCanonicalBase64(credential.ciphertext)
    if (!ciphertext) {
      throw new VaultError('corrupt-vault', 'The credential vault contains malformed encrypted data.')
    }

    try {
      return validateSecret(safeStorage.decryptString(ciphertext), 'vault')
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError(
        'locked-credential',
        'A saved credential cannot be decrypted for this OS user. Re-enter the API token for this profile.'
      )
    }
  }

  private static encryptCredential(tokenValue: unknown): CredentialEnvelopeV1 {
    ensureSecureStorage()
    const token = validateSecret(tokenValue, 'input')

    try {
      const encrypted = safeStorage.encryptString(token)
      if (encrypted.length === 0) throw new Error('empty ciphertext')
      const credential: CredentialEnvelopeV1 = {
        scheme: CREDENTIAL_SCHEME,
        version: CREDENTIAL_VERSION,
        encoding: 'base64',
        ciphertext: encrypted.toString('base64')
      }

      // Do not commit a credential that the selected OS backend cannot recover.
      if (this.decryptCredential(credential) !== token) {
        throw new Error('credential verification mismatch')
      }
      return credential
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError(
        'storage-unavailable',
        'OS-protected credential encryption failed. No API token was saved.'
      )
    }
  }

  private static decodeLegacyToken(encryptedToken: string): string {
    ensureSecureStorage()

    // Legacy safeStorage values were emitted as even-length hexadecimal. That
    // classification wins absolutely: an undecryptable OS-bound blob must not
    // be reinterpreted as Base64 plaintext after a restore or user change.
    if (isStrictEvenHex(encryptedToken)) {
      try {
        return validateSecret(safeStorage.decryptString(Buffer.from(encryptedToken, 'hex')), 'vault')
      } catch (error) {
        if (error instanceof VaultError) throw error
        throw new VaultError(
          'locked-credential',
          'A legacy credential cannot be decrypted for this OS user. The original vault was left unchanged.'
        )
      }
    }

    // The only accepted fallback is the exact canonical Base64 emitted by the
    // former plaintext fallback. Invalid or ambiguous data is never guessed at.
    const decoded = decodeCanonicalBase64(encryptedToken)
    if (!decoded) {
      throw new VaultError(
        'corrupt-vault',
        'A legacy credential is neither OS-encrypted hexadecimal nor canonical Base64.'
      )
    }
    const token = decoded.toString('utf8')
    if (!decoded.equals(Buffer.from(token, 'utf8'))) {
      throw new VaultError('corrupt-vault', 'A legacy credential is not valid UTF-8.')
    }
    return validateSecret(token, 'vault')
  }

  private static migrateLegacyVault(legacy: LegacyVaultFile): VaultFileV2 {
    const profiles = legacy.profiles.map((profile): VaultProfileRecord => {
      const token = this.decodeLegacyToken(profile.encryptedToken)
      return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        isDefault: profile.isDefault,
        createdAt: profile.createdAt,
        accessMode: profile.accessMode,
        protectedServerIds: [...profile.protectedServerIds],
        maintenanceServerIds: [...profile.maintenanceServerIds],
        protectedResources: profile.protectedResources.map((target) => ({ ...target })),
        maintenanceResources: profile.maintenanceResources.map((target) => ({ ...target })),
        credential: this.encryptCredential(token)
      }
    })

    let activeProfileId = legacy.activeProfileId
    if (profiles.length === 0) {
      activeProfileId = null
    } else if (!activeProfileId || !profiles.some((profile) => profile.id === activeProfileId)) {
      activeProfileId = profiles.find((profile) => profile.isDefault)?.id ?? profiles[0].id
    }

    const migrated: VaultFileV2 = { version: VAULT_VERSION, activeProfileId, profiles }
    this.writeVault(migrated)
    return migrated
  }

  private static parseSerializedVault(serialized: string): VaultFileV2 | LegacyVaultFile {
    let parsed: unknown
    try {
      parsed = JSON.parse(serialized)
    } catch {
      throw new VaultError('corrupt-vault', 'The credential vault is not valid JSON.')
    }

    if (isObject(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'version')) {
      if (parsed.version !== VAULT_VERSION) {
        throw new VaultError('unsupported-version', 'The credential vault was written by an unsupported version.')
      }
      return parseVaultV2(parsed)
    }
    return parseLegacyVault(parsed)
  }

  private static readVault(): VaultFileV2 {
    ensureSecureStorage()
    const vaultPath = getVaultFilePath()
    let stats: ReturnType<typeof lstatSync>
    try {
      stats = lstatSync(vaultPath)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return { version: VAULT_VERSION, activeProfileId: null, profiles: [] }
      }
      throw new VaultError('vault-read-failed', 'The credential vault could not be inspected safely.')
    }

    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new VaultError('corrupt-vault', 'The credential vault path is not a regular file.')
    }
    if (stats.size <= 0 || stats.size > MAX_VAULT_BYTES) {
      throw new VaultError('corrupt-vault', 'The credential vault has an invalid size.')
    }

    let serialized: string
    try {
      serialized = readFileSync(vaultPath, 'utf8')
    } catch {
      throw new VaultError('vault-read-failed', 'The credential vault could not be read safely.')
    }

    const parsed = this.parseSerializedVault(serialized)
    if ('version' in parsed) return parsed
    return this.migrateLegacyVault(parsed)
  }

  private static writeVault(vault: VaultFileV2): void {
    ensureSecureStorage()

    const serialized = `${JSON.stringify(vault, null, 2)}\n`
    if (Buffer.byteLength(serialized, 'utf8') > MAX_VAULT_BYTES) {
      throw new VaultError('vault-write-failed', 'The credential vault is too large to write safely.')
    }

    // A full schema round-trip verifies the candidate while deliberately not
    // decrypting unchanged credentials. Safety-policy updates therefore never
    // bring the API token into plaintext memory.
    try {
      parseVaultV2(JSON.parse(serialized))
    } catch (error) {
      if (error instanceof VaultError) throw error
      throw new VaultError('vault-write-failed', 'The credential vault could not be serialized safely.')
    }

    const vaultPath = getVaultFilePath()
    const vaultDirectory = dirname(vaultPath)
    const tempPath = join(vaultDirectory, `.${basename(vaultPath)}.${process.pid}.${randomUUID()}.tmp`)
    let descriptor: number | null = null
    let renamed = false

    try {
      mkdirSync(vaultDirectory, { recursive: true, mode: 0o700 })
      descriptor = openSync(tempPath, 'wx', 0o600)
      writeFileSync(descriptor, serialized, 'utf8')
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = null

      const staged = readFileSync(tempPath, 'utf8')
      if (staged !== serialized) {
        throw new VaultError('vault-write-failed', 'The staged credential vault failed byte-for-byte verification.')
      }
      parseVaultV2(JSON.parse(staged))

      // The temporary file is in the same directory, so rename is an atomic
      // replacement: a crash exposes either the old complete file or the new one.
      renameSync(tempPath, vaultPath)
      renamed = true

      if (process.platform !== 'win32') {
        const directoryDescriptor = openSync(vaultDirectory, 'r')
        try {
          fsyncSync(directoryDescriptor)
        } finally {
          closeSync(directoryDescriptor)
        }
      }

      const committed = readFileSync(vaultPath, 'utf8')
      if (committed !== serialized) {
        throw new VaultError('vault-write-failed', 'The committed credential vault failed byte-for-byte verification.')
      }
      parseVaultV2(JSON.parse(committed))
    } catch (error) {
      if (descriptor !== null) {
        try {
          closeSync(descriptor)
        } catch {
          // Preserve the original failure.
        }
      }
      if (!renamed) {
        try {
          unlinkSync(tempPath)
        } catch {
          // Preserve the original failure. The orphan contains only encrypted
          // ciphertext and is ignored because its name is never discovered.
        }
      }
      if (error instanceof VaultError) throw error
      throw new VaultError('vault-write-failed', 'The credential vault could not be committed atomically.')
    }
  }

  public static getProfiles(): AccountProfile[] {
    return this.readVault().profiles.map(metadataFor)
  }

  public static getActiveProfile(): AccountProfile | null {
    const record = activeRecord(this.readVault())
    return record ? metadataFor(record) : null
  }

  public static getProfileCredential(profileId: string): ProfileCredential | null {
    const vault = this.readVault()
    const record = vault.profiles.find((profile) => profile.id === profileId)
    if (!record) return null
    return {
      token: this.decryptCredential(record.credential),
      accessMode: record.accessMode,
      protectedServerIds: [...record.protectedServerIds],
      maintenanceServerIds: [...record.maintenanceServerIds],
      protectedResources: record.protectedResources.map((target) => ({ ...target })),
      maintenanceResources: record.maintenanceResources.map((target) => ({ ...target }))
    }
  }

  public static getActiveProfilePolicy(): ProfileSafetyPolicy | null {
    const record = activeRecord(this.readVault())
    if (!record) return null
    return {
      accessMode: record.accessMode,
      protectedServerIds: [...record.protectedServerIds],
      maintenanceServerIds: [...record.maintenanceServerIds],
      protectedResources: record.protectedResources.map((target) => ({ ...target })),
      maintenanceResources: record.maintenanceResources.map((target) => ({ ...target }))
    }
  }

  public static saveProfile(profile: VerifiedSaveProfileInput): {
    success: boolean
    profileId: string
    updated?: boolean
    error?: string
  } {
    if (!isObject(profile)) {
      throw new VaultError('invalid-input', 'The profile is invalid.')
    }

    const name = validateProfileName(profile.name)
    const token = validateSecret(profile.token, 'input')
    const verifiedEmail = validateVerifiedEmail(profile.verifiedEmail)
    if (profile.isDefault !== undefined && typeof profile.isDefault !== 'boolean') {
      throw new VaultError('invalid-input', 'The default profile flag is invalid.')
    }
    if (
      profile.profileId !== undefined &&
      (typeof profile.profileId !== 'string' || profile.profileId.length === 0)
    ) {
      throw new VaultError('invalid-input', 'The profile ID is invalid.')
    }

    const vault = this.readVault()
    const wanted = name.toLowerCase()
    const byId = profile.profileId
      ? vault.profiles.find((candidate) => candidate.id === profile.profileId)
      : undefined
    const byName = vault.profiles.find((candidate) => candidate.name.trim().toLowerCase() === wanted)

    if (profile.profileId && !byId) {
      return { success: false, profileId: '', error: 'The profile no longer exists.' }
    }
    if (!byId && byName) {
      return {
        success: false,
        profileId: '',
        error: `A profile named "${byName.name}" already exists. Use the update action on that profile to replace its API key.`
      }
    }
    if (byId && byName && byId.id !== byName.id) {
      return { success: false, profileId: '', error: `A profile named "${byName.name}" already exists.` }
    }

    if (byId?.email && byId.email.trim().toLowerCase() !== verifiedEmail.toLowerCase()) {
      return {
        success: false,
        profileId: byId.id,
        error: `This token belongs to ${verifiedEmail}, not the saved ${byId.email} account. Add it as a new observe-only profile instead.`
      }
    }

    // Policy is never accepted from credential-save IPC. New profiles start in
    // observe mode; a verified same-account rotation preserves policy. Legacy
    // profiles without a stored identity are safely downgraded until reviewed.
    const accessMode: ProfileAccessMode = byId
      ? (byId.email ? byId.accessMode : 'observe')
      : 'observe'
    const protectedServerIds = byId ? [...byId.protectedServerIds] : []
    const maintenanceServerIds = byId ? [...byId.maintenanceServerIds] : []
    const protectedResources = byId ? byId.protectedResources.map((target) => ({ ...target })) : []
    const maintenanceResources = byId ? byId.maintenanceResources.map((target) => ({ ...target })) : []

    const credential = this.encryptCredential(token)
    if (byId) {
      byId.name = name
      byId.email = verifiedEmail
      byId.credential = credential
      byId.accessMode = accessMode
      byId.protectedServerIds = protectedServerIds
      byId.maintenanceServerIds = maintenanceServerIds
      byId.protectedResources = protectedResources
      byId.maintenanceResources = maintenanceResources
      if (profile.isDefault) {
        vault.profiles.forEach((candidate) => (candidate.isDefault = candidate.id === byId.id))
        vault.activeProfileId = byId.id
      }
      this.writeVault(vault)
      return { success: true, profileId: byId.id, updated: true }
    }

    const newId = `profile_${randomUUID()}`
    const newRecord: VaultProfileRecord = {
      id: newId,
      name,
      email: verifiedEmail,
      credential,
      isDefault: profile.isDefault ?? vault.profiles.length === 0,
      createdAt: new Date().toISOString(),
      accessMode,
      protectedServerIds,
      maintenanceServerIds,
      protectedResources,
      maintenanceResources
    }

    if (newRecord.isDefault || vault.profiles.length === 0) {
      vault.profiles.forEach((candidate) => (candidate.isDefault = false))
      vault.activeProfileId = newId
    }

    vault.profiles.push(newRecord)
    this.writeVault(vault)
    return { success: true, profileId: newId, updated: false }
  }

  public static updateProfileSafety(
    profileId: string,
    accessModeValue: ProfileAccessMode,
    protectedServerIdsValue: number[],
    maintenanceServerIdsValue: number[],
    protectedResourcesValue: ResourceSafetyTarget[],
    maintenanceResourcesValue: ResourceSafetyTarget[]
  ): { success: boolean; error?: string } {
    const vault = this.readVault()
    const record = vault.profiles.find((profile) => profile.id === profileId)
    if (!record) return { success: false, error: 'The profile does not exist.' }

    const transition = decideProfileAccessTransition(record.accessMode, accessModeValue)
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
    const { protectedServerIds, maintenanceServerIds } = mergeSafetyTierIds(
      record.protectedServerIds,
      record.maintenanceServerIds,
      protectedServerIdsValue,
      maintenanceServerIdsValue
    )
    const { protectedResources, maintenanceResources } = mergeResourceSafetyTiers(
      record.protectedResources,
      record.maintenanceResources,
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

    record.accessMode = accessMode
    record.protectedServerIds = protectedServerIds
    record.maintenanceServerIds = maintenanceServerIds
    record.protectedResources = protectedResources
    record.maintenanceResources = maintenanceResources
    this.writeVault(vault)
    return { success: true }
  }

  public static setActiveProfile(profileId: string): { success: boolean; error?: string } {
    const vault = this.readVault()
    if (!vault.profiles.some((profile) => profile.id === profileId)) {
      return { success: false, error: 'The profile does not exist.' }
    }

    vault.activeProfileId = profileId
    this.writeVault(vault)
    return { success: true }
  }

  public static deleteProfile(profileId: string): { success: boolean; error?: string } {
    const vault = this.readVault()
    const index = vault.profiles.findIndex((profile) => profile.id === profileId)
    if (index < 0) return { success: false, error: 'The profile does not exist.' }

    const [removed] = vault.profiles.splice(index, 1)
    if (vault.activeProfileId === profileId) {
      vault.activeProfileId = vault.profiles[0]?.id ?? null
    }
    if (removed.isDefault && vault.profiles.length > 0) {
      const replacement = activeRecord(vault) ?? vault.profiles[0]
      vault.profiles.forEach((profile) => (profile.isDefault = profile.id === replacement.id))
    }

    this.writeVault(vault)
    return { success: true }
  }
}
