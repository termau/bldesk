import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, renameSync } from 'fs'
import { AccountProfile, SaveProfileResult, TokenStatus } from '../shared/ipc-types'
import { restrictToOwner, writeOwnerFileAtomic } from './ownerFiles'

const vaultPath = (): string => join(app.getPath('userData'), 'vault.enc')

interface EncryptedProfileRecord {
  id: string
  name: string
  /** safeStorage output as hex, or base64 when `unencrypted` is set. */
  encryptedToken: string
  /**
   * Set when the user chose to save without encryption because this system has
   * no working keyring. Tokens are never stored this way silently.
   */
  unencrypted?: true
  email?: string
  isDefault?: boolean
  createdAt: string
}

interface EncryptedVaultFile {
  activeProfileId: string | null
  profiles: EncryptedProfileRecord[]
}

const EMPTY_VAULT = (): EncryptedVaultFile => ({ activeProfileId: null, profiles: [] })

export class EncryptionUnavailableError extends Error {
  constructor() {
    super(
      process.platform === 'linux'
        ? 'This system has no working keyring, so BLDesk cannot encrypt the token. Install and unlock a Secret Service keyring such as GNOME Keyring or KWallet (on KDE, BLDesk may need to be started with --password-store=gnome-libsecret), then try again. Or save it without encryption: anyone who can read your BLDesk settings folder could then use this token.'
        : 'The operating system could not encrypt the token. Try again, or save it without encryption: anyone who can read your BLDesk settings folder could then use this token.'
    )
  }
}

/*
 * Whether safeStorage gives real protection here. On Linux with no Secret
 * Service or KWallet, Electron still reports encryption as available but uses
 * the `basic_text` backend, whose key is a constant built into Chromium - that
 * is obfuscation, not encryption, so it counts as unavailable.
 */
export function canEncrypt(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform === 'linux') {
      const backend = safeStorage.getSelectedStorageBackend()
      return backend !== 'basic_text' && backend !== 'unknown'
    }
    return true
  } catch {
    return false
  }
}

const HEX = /^(?:[0-9a-f]{2})+$/i

export class VaultManager {
  /*
   * A missing vault is empty. An unreadable or corrupt one is moved aside
   * rather than treated as empty, because the next save would otherwise
   * overwrite every profile in it.
   */
  private static readRawVault(): EncryptedVaultFile {
    const path = vaultPath()
    if (!existsSync(path)) return EMPTY_VAULT()
    // Earlier builds wrote the vault 0664 under the usual umask.
    restrictToOwner(path)
    try {
      const vault = JSON.parse(readFileSync(path, 'utf8')) as EncryptedVaultFile
      if (!vault || !Array.isArray(vault.profiles)) throw new Error('not a vault')
      return vault
    } catch (err) {
      const aside = `${path}.unreadable-${Date.now()}`
      console.error(`[VaultManager] Vault could not be read; moved to ${aside}:`, err)
      try {
        renameSync(path, aside)
      } catch {
        /* leave it; the save below will fail loudly instead */
      }
      return EMPTY_VAULT()
    }
  }

  /** Throws on failure, so a save is never reported as successful when nothing was written. */
  private static writeRawVault(data: EncryptedVaultFile): void {
    writeOwnerFileAtomic(vaultPath(), JSON.stringify(data, null, 2))
  }

  private static encryptToken(token: string, allowUnencrypted: boolean): Pick<EncryptedProfileRecord, 'encryptedToken' | 'unencrypted'> {
    if (canEncrypt()) return { encryptedToken: safeStorage.encryptString(token).toString('hex') }
    if (!allowUnencrypted) throw new EncryptionUnavailableError()
    return { encryptedToken: Buffer.from(token, 'utf8').toString('base64'), unencrypted: true }
  }

  /*
   * The token, or null when it cannot be read: the keyring is locked or gone,
   * or the entry was written under a different key. Null makes the app ask for
   * the token again, rather than sending whatever a failed decryption produced.
   */
  private static decryptRecord(record: EncryptedProfileRecord): string | null {
    if (record.unencrypted) return Buffer.from(record.encryptedToken, 'base64').toString('utf8')
    if (!HEX.test(record.encryptedToken) || !canEncrypt()) return null
    try {
      return safeStorage.decryptString(Buffer.from(record.encryptedToken, 'hex'))
    } catch {
      return null
    }
  }

  /*
   * Earlier builds fell back to base64 without saying so and without marking
   * the entry. safeStorage output is always hex, so a non-hex entry is one of
   * those: encrypt it now if the keyring works, otherwise mark it unencrypted
   * so the vault screen says so.
   */
  private static migrateLegacyEntries(vault: EncryptedVaultFile): void {
    let changed = false
    for (const record of vault.profiles) {
      if (record.unencrypted || HEX.test(record.encryptedToken)) continue
      const token = Buffer.from(record.encryptedToken, 'base64').toString('utf8')
      Object.assign(record, this.encryptToken(token, true))
      changed = true
    }
    if (changed) {
      try {
        this.writeRawVault(vault)
      } catch (err) {
        console.error('[VaultManager] Could not migrate legacy vault entries:', err)
      }
    }
  }

  private static tokenStatus(record: EncryptedProfileRecord): TokenStatus {
    if (record.unencrypted) return 'unencrypted'
    return this.decryptRecord(record) === null ? 'unreadable' : 'encrypted'
  }

  private static readVault(): EncryptedVaultFile {
    const vault = this.readRawVault()
    this.migrateLegacyEntries(vault)
    return vault
  }

  public static getProfiles(): Omit<AccountProfile, 'token'>[] {
    return this.readVault().profiles.map((record) => {
      const { encryptedToken: _token, unencrypted: _unencrypted, ...rest } = record
      return { ...rest, tokenStatus: this.tokenStatus(record) }
    })
  }

  /** The active profile. Its token is '' when it cannot be read, and the app then asks for it again. */
  public static getActiveProfile(): AccountProfile | null {
    const vault = this.readVault()
    if (vault.profiles.length === 0) return null

    const record =
      vault.profiles.find((p) => p.id === vault.activeProfileId) ?? vault.profiles.find((p) => p.isDefault) ?? vault.profiles[0]
    if (!record) return null

    return {
      id: record.id,
      name: record.name,
      email: record.email,
      token: this.decryptRecord(record) ?? '',
      tokenStatus: this.tokenStatus(record),
      isDefault: record.isDefault,
      createdAt: record.createdAt
    }
  }

  /**
   * Create a profile, or update an existing one.
   *
   * An explicit `profileId` updates that profile in place. Adding under a name
   * that already exists is refused rather than quietly becoming an update: two
   * profiles with one name are indistinguishable in the switcher, and silently
   * rewriting an existing account's token because the names matched is its own
   * surprise. Replacing a key is an explicit action that carries the profile id.
   *
   * With no working keyring the save is refused unless `allowUnencrypted` is
   * set, which the vault screen only sends after the user has chosen it.
   */
  public static saveProfile(profile: {
    name: string
    token: string
    email?: string
    isDefault?: boolean
    profileId?: string
    allowUnencrypted?: boolean
  }): SaveProfileResult {
    try {
      const vault = this.readVault()
      const stored = this.encryptToken(profile.token, profile.allowUnencrypted === true)

      const wanted = profile.name.trim().toLowerCase()
      const existing = profile.profileId ? vault.profiles.find((p) => p.id === profile.profileId) : undefined
      const byName = vault.profiles.find((p) => (p.name || '').trim().toLowerCase() === wanted)

      if (!existing && byName) {
        return {
          success: false,
          profileId: '',
          error: `A profile named "${byName.name}" already exists. Use the update action on that profile to replace its API key.`
        }
      }

      if (existing) {
        existing.encryptedToken = stored.encryptedToken
        if (stored.unencrypted) existing.unencrypted = true
        else delete existing.unencrypted
        if (profile.email) existing.email = profile.email
        if (profile.name.trim()) existing.name = profile.name.trim()
        if (profile.isDefault) {
          vault.profiles.forEach((p) => (p.isDefault = p.id === existing.id))
          vault.activeProfileId = existing.id
        }
        this.writeRawVault(vault)
        return { success: true, profileId: existing.id, updated: true }
      }

      const newId = `profile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      const newRecord: EncryptedProfileRecord = {
        id: newId,
        name: profile.name,
        email: profile.email,
        ...stored,
        isDefault: profile.isDefault ?? vault.profiles.length === 0,
        createdAt: new Date().toISOString()
      }

      if (newRecord.isDefault || vault.profiles.length === 0) {
        vault.profiles.forEach((p) => (p.isDefault = false))
        vault.activeProfileId = newId
      }

      vault.profiles.push(newRecord)
      this.writeRawVault(vault)
      return { success: true, profileId: newId, updated: false }
    } catch (err: any) {
      return {
        success: false,
        profileId: '',
        error: err?.message || 'The token could not be saved.',
        ...(err instanceof EncryptionUnavailableError ? { errorCode: 'encryption-unavailable' as const } : {})
      }
    }
  }

  public static setActiveProfile(profileId: string): { success: boolean } {
    try {
      const vault = this.readVault()
      if (!vault.profiles.some((p) => p.id === profileId)) return { success: false }
      vault.activeProfileId = profileId
      this.writeRawVault(vault)
      return { success: true }
    } catch (err) {
      console.error('[VaultManager] Could not set the active profile:', err)
      return { success: false }
    }
  }

  public static deleteProfile(profileId: string): { success: boolean } {
    try {
      const vault = this.readVault()
      vault.profiles = vault.profiles.filter((p) => p.id !== profileId)
      if (vault.activeProfileId === profileId) {
        vault.activeProfileId = vault.profiles.length > 0 ? vault.profiles[0].id : null
      }
      this.writeRawVault(vault)
      return { success: true }
    } catch (err) {
      console.error('[VaultManager] Could not delete the profile:', err)
      return { success: false }
    }
  }
}
