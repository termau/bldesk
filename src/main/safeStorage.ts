import { app, safeStorage } from 'electron'
import { join } from 'path'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { AccountProfile, StoredVaultData } from '../shared/ipc-types'

function getVaultFilePath(): string {
  try {
    return join(app.getPath('userData'), 'vault.enc')
  } catch {
    return join(process.env.HOME || '/tmp', '.bldesk_vault.enc')
  }
}

// The vault holds API tokens, so it is readable by its owner only. Best effort:
// a filesystem that ignores modes (FAT, some network shares) must not stop the
// vault from being read or saved.
function restrictToOwner(path: string): void {
  try {
    chmodSync(path, 0o600)
  } catch (err) {
    console.warn('[VaultManager] Could not restrict vault permissions:', err)
  }
}

interface EncryptedProfileRecord {
  id: string
  name: string
  encryptedToken: string // hex-encoded encrypted buffer
  email?: string
  isDefault?: boolean
  createdAt: string
}

interface EncryptedVaultFile {
  activeProfileId: string | null
  profiles: EncryptedProfileRecord[]
}

export class VaultManager {
  private static readRawVault(): EncryptedVaultFile {
    try {
      const vaultPath = getVaultFilePath()
      if (!existsSync(vaultPath)) {
        return { activeProfileId: null, profiles: [] }
      }
      // Earlier builds wrote the vault 0664 under the usual umask. Tighten it
      // on read so an existing install is fixed without waiting for a write.
      restrictToOwner(vaultPath)
      const raw = readFileSync(vaultPath, 'utf8')
      return JSON.parse(raw) as EncryptedVaultFile
    } catch (err) {
      console.error('[VaultManager] Failed to read vault file:', err)
      return { activeProfileId: null, profiles: [] }
    }
  }

  private static writeRawVault(data: EncryptedVaultFile): void {
    try {
      const vaultPath = getVaultFilePath()
      // `mode` only applies when the file is created, hence the explicit chmod.
      writeFileSync(vaultPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
      restrictToOwner(vaultPath)
    } catch (err) {
      console.error('[VaultManager] Failed to write vault file:', err)
    }
  }

  private static encryptToken(token: string): string {
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const buffer = safeStorage.encryptString(token)
        return buffer.toString('hex')
      }
    } catch (err) {
      console.warn('[VaultManager] safeStorage encryption failed, falling back:', err)
    }
    // Fallback if safeStorage not available
    return Buffer.from(token, 'utf8').toString('base64')
  }

  private static decryptToken(encryptedHex: string): string {
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const buffer = Buffer.from(encryptedHex, 'hex')
        return safeStorage.decryptString(buffer)
      }
    } catch (err) {
      console.warn('[VaultManager] safeStorage decryption failed, falling back:', err)
    }
    try {
      return Buffer.from(encryptedHex, 'base64').toString('utf8')
    } catch {
      return encryptedHex
    }
  }

  public static getProfiles(): Omit<AccountProfile, 'token'>[] {
    const vault = this.readRawVault()
    return vault.profiles.map(({ encryptedToken: _, ...rest }) => rest)
  }

  public static getActiveProfile(): AccountProfile | null {
    const vault = this.readRawVault()
    if (vault.profiles.length === 0) return null

    let activeRecord = vault.profiles.find((p) => p.id === vault.activeProfileId)
    if (!activeRecord) {
      activeRecord = vault.profiles.find((p) => p.isDefault) || vault.profiles[0]
    }

    if (!activeRecord) return null

    const decryptedToken = this.decryptToken(activeRecord.encryptedToken)
    return {
      id: activeRecord.id,
      name: activeRecord.name,
      email: activeRecord.email,
      token: decryptedToken,
      isDefault: activeRecord.isDefault,
      createdAt: activeRecord.createdAt
    }
  }

  public static getProfileToken(profileId: string): string | null {
    const vault = this.readRawVault()
    const record = vault.profiles.find((p) => p.id === profileId)
    if (!record) return null
    return this.decryptToken(record.encryptedToken)
  }

  /**
   * Create a profile, or update an existing one.
   *
   * Previously this always pushed a new record, so re-entering a token for an
   * account you already had silently produced a second profile with the same
   * name rather than replacing its key — leaving a stale, failing profile behind
   * and no way to repair one from the UI.
   *
   * An explicit `profileId` updates that profile. Failing that, a case-insensitive
   * name match updates in place, because two profiles with one name are
   * indistinguishable in the switcher and never intentional.
   */
  public static saveProfile(profile: {
    name: string
    token: string
    email?: string
    isDefault?: boolean
    profileId?: string
  }): {
    success: boolean
    profileId: string
    updated?: boolean
    error?: string
  } {
    try {
      const vault = this.readRawVault()
      const encrypted = this.encryptToken(profile.token)

      const wanted = profile.name.trim().toLowerCase()
      const byId = profile.profileId ? vault.profiles.find((p) => p.id === profile.profileId) : undefined
      const byName = vault.profiles.find((p) => (p.name || '').trim().toLowerCase() === wanted)

      // Adding under a name that already exists is refused rather than quietly
      // becoming an update. Two profiles with one name are indistinguishable in
      // the switcher, and silently rewriting an existing account's token because
      // the names happened to match is its own surprise. Replacing a key is an
      // explicit action that carries the profile id.
      if (!byId && byName) {
        return {
          success: false,
          profileId: '',
          error: `A profile named "${byName.name}" already exists. Use the update action on that profile to replace its API key.`
        }
      }

      const existing = byId

      if (existing) {
        existing.encryptedToken = encrypted
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
        encryptedToken: encrypted,
        isDefault: profile.isDefault ?? (vault.profiles.length === 0),
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
      return { success: false, profileId: '', error: err.message }
    }
  }

  public static setActiveProfile(profileId: string): { success: boolean } {
    const vault = this.readRawVault()
    const exists = vault.profiles.some((p) => p.id === profileId)
    if (!exists) return { success: false }

    vault.activeProfileId = profileId
    this.writeRawVault(vault)
    return { success: true }
  }

  public static deleteProfile(profileId: string): { success: boolean } {
    const vault = this.readRawVault()
    vault.profiles = vault.profiles.filter((p) => p.id !== profileId)
    if (vault.activeProfileId === profileId) {
      vault.activeProfileId = vault.profiles.length > 0 ? vault.profiles[0].id : null
    }
    this.writeRawVault(vault)
    return { success: true }
  }
}
