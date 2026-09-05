import { Preferences } from '@capacitor/preferences'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { HELP_API_ORIGIN, HELP_TIMEOUT_MS, helpQuestion, helpFeedbackBody, readHelpAnswer, readHelpSuggestions } from '@shared/help-api'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { AccountProfile, IpcApi, UpdateChannel, UpdaterState } from '@shared/ipc-types'
import { formatSshCommand, sshUriHost, validateSshTarget } from '@shared/ssh'

const PROFILES_KEY = 'bldesk_profiles_v1'
const ACTIVE_PROFILE_KEY = 'bldesk_active_profile_id_v1'

// No account client, token, profile id, server ids, History or ticket text.
async function helpRequest(path: string, body?: { id: number; helpful: boolean }): Promise<unknown> {
  const url = `${HELP_API_ORIGIN}${path}`
  if (Capacitor.isNativePlatform()) {
    // Native connect/read timeouts are separate. Bound the total wait too;
    // a late native completion is ignored, never retried.
    let deadline: ReturnType<typeof setTimeout> | undefined
    const response = await Promise.race([CapacitorHttp.request({
      url, method: body ? 'POST' : 'GET',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      data: body, connectTimeout: HELP_TIMEOUT_MS, readTimeout: HELP_TIMEOUT_MS,
      disableRedirects: true
    }), new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('Could not reach BinaryLane help.')), HELP_TIMEOUT_MS)
    })]).finally(() => clearTimeout(deadline))
    if (response.status < 200 || response.status >= 300) throw new Error('Could not reach BinaryLane help.')
    return body ? undefined : typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  }
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET', credentials: 'omit', redirect: 'error',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(HELP_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error('Could not reach BinaryLane help.')
  return body ? undefined : response.json()
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
  const cleanA = a.replace(/^v/, '').trim()
  const cleanB = b.replace(/^v/, '').trim()

  const [mainA, preA] = cleanA.split('-', 2)
  const [mainB, preB] = cleanB.split('-', 2)

  const numsA = mainA.split('.').map((n) => parseInt(n, 10) || 0)
  const numsB = mainB.split('.').map((n) => parseInt(n, 10) || 0)

  for (let i = 0; i < 3; i++) {
    const na = numsA[i] ?? 0
    const nb = numsB[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }

  // Major, minor, and patch are identical.
  // A version without a pre-release tag has higher precedence than one with.
  if (!preA && preB) return 1
  if (preA && !preB) return -1
  if (!preA && !preB) return 0

  // Both have pre-release tags: compare identifier by identifier
  const partsA = preA.split('.')
  const partsB = preB.split('.')
  const len = Math.max(partsA.length, partsB.length)

  for (let i = 0; i < len; i++) {
    const pA = partsA[i]
    const pB = partsB[i]
    if (pA === undefined) return -1
    if (pB === undefined) return 1

    const isNumA = /^\d+$/.test(pA)
    const isNumB = /^\d+$/.test(pB)

    if (isNumA && isNumB) {
      const numA = parseInt(pA, 10)
      const numB = parseInt(pB, 10)
      if (numA > numB) return 1
      if (numA < numB) return -1
    } else if (isNumA && !isNumB) {
      return -1
    } else if (!isNumA && isNumB) {
      return 1
    } else {
      const cmp = pA.localeCompare(pB)
      if (cmp !== 0) return cmp > 0 ? 1 : -1
    }
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
    const rawList = Array.isArray(data) ? data : [data]
    const releases = rawList.filter((r: any) => !r.draft && r.tag_name)
    const release = isBeta
      ? releases[0]
      : releases.find((r: any) => !r.prerelease) || releases[0]
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

export async function initMobileBridge(): Promise<void> {
  if (typeof window === 'undefined') return

  // If running inside Electron, native bldeskApi is already exposed via preload
  if (window.bldeskApi) {
    return
  }

  console.log('[MobileBridge] Initializing Capacitor/Web bridge for mobile Android...')

  /*
   * Profiles hold the account's API token, so they go in the platform secure
   * store, not Preferences.
   *
   * Preferences is plain SharedPreferences on Android: the token sat on disk in
   * cleartext, was eligible for Android Auto Backup, and the sign-in dialog
   * called itself a "Hardware Encrypted Vault" while offering none. SecureStorage
   * encrypts with AES-GCM under a key generated in the Android Keystore, so the
   * key is non-exportable and the ciphertext is useless off the device.
   *
   * Note the limit: a process running as this app's own UID can still ask the
   * Keystore to decrypt. This closes the at-rest and backup paths, not an
   * attacker who is already running as the app.
   */
  const getStoredProfiles = async (): Promise<AccountProfile[]> => {
    try {
      const secure = await SecureStorage.get(PROFILES_KEY, false, false)
      if (typeof secure === 'string' && secure) return JSON.parse(secure)
      if (secure && typeof secure === 'object') return secure as unknown as AccountProfile[]
    } catch (err) {
      console.warn('[MobileBridge] secure store unavailable, falling back:', err)
    }

    // One-time migration off the cleartext stores, which are then purged rather
    // than left behind as a second copy of the token.
    try {
      const { value } = await Preferences.get({ key: PROFILES_KEY })
      const legacy = value ?? localStorage.getItem(PROFILES_KEY)
      if (legacy) {
        const parsed = JSON.parse(legacy) as AccountProfile[]
        try {
          await SecureStorage.set(PROFILES_KEY, JSON.stringify(parsed), false, false)
          await Preferences.remove({ key: PROFILES_KEY })
          localStorage.removeItem(PROFILES_KEY)
          console.log('[MobileBridge] migrated profiles to the secure store')
        } catch (err) {
          // Keep the legacy copy if the secure write failed - losing the token
          // outright is worse than leaving it where it already was.
          console.warn('[MobileBridge] secure migration failed, keeping legacy store:', err)
        }
        return parsed
      }
    } catch {
      /* nothing stored yet */
    }
    return []
  }

  const saveStoredProfiles = async (profiles: AccountProfile[]): Promise<void> => {
    try {
      await SecureStorage.set(PROFILES_KEY, JSON.stringify(profiles), false, false)
      // Make sure no cleartext copy survives a save.
      await Preferences.remove({ key: PROFILES_KEY }).catch(() => undefined)
      localStorage.removeItem(PROFILES_KEY)
      return
    } catch (err) {
      console.warn('[MobileBridge] secure store write failed, falling back:', err)
    }
    try {
      await Preferences.set({ key: PROFILES_KEY, value: JSON.stringify(profiles) })
    } catch {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
    }
  }

  const mobileApi: IpcApi = {
    helpAsk: async question => readHelpAnswer(await helpRequest(`/api/help?q=${encodeURIComponent(helpQuestion(question))}`)),
    helpSuggest: async prefix => readHelpSuggestions(await helpRequest(`/api/help/suggest?q=${encodeURIComponent(helpQuestion(prefix))}`)),
    helpFeedback: async (id, helpful) => { await helpRequest('/api/help/feedback', helpFeedbackBody(id, helpful)) },
    getProfiles: async (): Promise<Omit<AccountProfile, 'token'>[]> => {
      const list = await getStoredProfiles()
      return list.map(({ token: _, ...rest }) => rest)
    },
    getActiveProfile: async (): Promise<AccountProfile | null> => {
      const profiles = await getStoredProfiles()
      if (profiles.length === 0) return null

      let activeId: string | null = null
      try {
        const { value } = await Preferences.get({ key: ACTIVE_PROFILE_KEY })
        activeId = value
      } catch {
        activeId = localStorage.getItem(ACTIVE_PROFILE_KEY)
      }

      if (activeId) {
        const found = profiles.find((p) => p.id === activeId)
        if (found) return found
      }
      return profiles[0]
    },
    saveProfile: async (input: { name: string; token: string; isDefault?: boolean }): Promise<{ success: boolean; profileId: string; error?: string }> => {
      try {
        const profiles = await getStoredProfiles()
        const newProfile: AccountProfile = {
          id: `profile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: input.name,
          token: input.token,
          isDefault: input.isDefault,
          createdAt: new Date().toISOString()
        }

        const updated = [...profiles, newProfile]
        await saveStoredProfiles(updated)

        if (input.isDefault || profiles.length === 0) {
          await mobileApi.setActiveProfile(newProfile.id)
        }

        return { success: true, profileId: newProfile.id }
      } catch (err: any) {
        return { success: false, profileId: '', error: err.message }
      }
    },
    deleteProfile: async (profileId: string): Promise<{ success: boolean }> => {
      const profiles = await getStoredProfiles()
      const updated = profiles.filter((p) => p.id !== profileId)
      await saveStoredProfiles(updated)
      return { success: true }
    },
    setActiveProfile: async (profileId: string): Promise<{ success: boolean }> => {
      try {
        await Preferences.set({ key: ACTIVE_PROFILE_KEY, value: profileId })
      } catch {
        localStorage.setItem(ACTIVE_PROFILE_KEY, profileId)
      }
      return { success: true }
    },
    launchNativeTerminal: async (opts) => {
      const invalid = validateSshTarget(opts)
      if (invalid) return { success: false, error: invalid }
      // sshUriHost brackets IPv6 and percent-encodes a zone delimiter, as an ssh:// URI needs.
      const host = sshUriHost(opts.host) ?? opts.host.trim()
      const uri = `ssh://${opts.username || 'root'}@${host}${opts.port ? `:${opts.port}` : ''}`
      window.open(uri, '_system')
      return { success: true, terminal: 'ssh:// handler', command: formatSshCommand(opts, 'posix') }
    },
    openRescueConsole: async (opts) => {
      window.open(opts.url, '_blank')
      return { success: true }
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
