import type { ProfileAccessMode } from './binarylane-policy'
import type { ResourceSafetyTarget } from './resource-safety'

export interface AccountProfile {
  id: string
  name: string
  email?: string
  isDefault?: boolean
  createdAt: string
  /** Observe-only, guarded by server ID, or deliberately unrestricted. */
  accessMode: ProfileAccessMode
  /** Server IDs that guarded mode must never mutate or open remote access to. */
  protectedServerIds: number[]
  /** Server IDs that guarded mode may reboot or back up, but not otherwise mutate. */
  maintenanceServerIds: number[]
  /** Durable non-server resources that Protected mode must never change. */
  protectedResources: ResourceSafetyTarget[]
  /** Durable non-server resources that may be maintained but not deleted/cancelled. */
  maintenanceResources: ResourceSafetyTarget[]
}

export interface SaveProfileInput {
  name: string
  token: string
  isDefault?: boolean
  profileId?: string
}

export interface BinaryLaneBridgeRequest {
  /** Path and query only. The privileged bridge pins the origin. */
  path: string
  method: string
  body?: string
}

export interface BinaryLaneBridgeResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export interface BinaryLaneTokenValidation {
  success: boolean
  email?: string
  error?: string
}

export interface TerminalLaunchOptions {
  /** Required for guarded profiles so the main process can enforce server protection. */
  serverId?: number
  host: string
  username?: string
  port?: number
  privateKeyPath?: string
}

export interface TerminalLaunchResult {
  success: boolean
  /** Why the launch failed — already human-readable. */
  error?: string
  /** Which emulator was used (e.g. "konsole", "Terminal.app"). */
  terminal?: string
  /** The ssh command line that was (or would have been) run — for clipboard fallback. */
  command?: string
}

export interface ConsoleWindowOptions {
  serverId: number
  serverName: string
  width?: number
  height?: number
}

/**
 * What a notification is about, so the user can mute a category from the tray
 * menu. Omitted → 'general', which is never filtered.
 */
export type NotificationKind = 'general' | 'server-state' | 'action' | 'balance'

export interface SystemNotificationOptions {
  title: string
  body: string
  icon?: string
  kind?: NotificationKind
}

// --- Tray / menu bar ---

export interface TrayServer {
  id: number
  name: string
  status: string
  /** Primary public IPv4, when the server has one. */
  ip?: string
  /** Image-derived native remote service. The tray must not offer SSH for RDP guests. */
  remoteService: 'ssh' | 'rdp'
}

/** What the renderer knows about the fleet, pushed to main for the tray. */
export interface TrayFleetSummary {
  accountName?: string
  running: number
  off: number
  /** Provisioning, archived, or otherwise not simply on/off. */
  other: number
  /** Actions being tracked to completion right now. */
  inProgress: number
  /** Actions BinaryLane has paused on a question nobody has answered yet. */
  awaitingAnswer: number
  /** Invoices whose payment attempt failed and remain unpaid. */
  failedInvoices: number
  servers: TrayServer[]
  /** Available prepaid credit in AUD, when the balance has loaded. */
  availableCredit?: number
}

export interface TraySettings {
  launchAtLogin: boolean
  /** Closing the window hides to the tray instead of quitting. */
  closeToTray: boolean
  notifyServerState: boolean
  notifyActions: boolean
  notifyBalance: boolean
}

export interface LocalSshKey {
  name: string
  publicKey: string
  pubPath?: string
  privateKeyPath?: string
}

// --- Auto-update ---

export type UpdateChannel = 'stable' | 'beta'

export type UpdaterStatus =
  | 'idle' // nothing happening (or dev mode)
  | 'checking'
  | 'up-to-date'
  | 'available' // found, download starting
  | 'downloading'
  | 'ready' // downloaded; restart to install
  | 'check-failed' // feed unreachable / no manifest published; version is unknown, not confirmed current
  | 'error'

export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  channel: UpdateChannel
  /** false in dev / unpackaged desktop builds. */
  supported: boolean
  availableVersion?: string
  releaseNotes?: string
  /** 0-100 while downloading. */
  progress?: number
  error?: string
  lastCheckedAt?: string
  apkUrl?: string
}

/** A change-log entry as stored; the renderer's lib/changelog.ts owns the shape. */
export interface ChangeLogRecord {
  id: string
  at: string
  profileId: string
}

export type TemplateGetResult =
  | { ok: true; document: string }
  | { ok: false; code: 'missing' | 'too_large' | 'unreadable'; message: string; bytes?: number }

/** Result of a TCP connect probe run from the user's machine (FEATURES.md #11). */
export interface TcpProbeResult {
  ok: boolean
  latencyMs?: number
  error?: 'timeout' | 'refused' | 'unreachable' | 'invalid-target' | 'other'
  detail?: string
}

export interface PingProbeResult {
  ok: boolean
  latencyMs?: number
  error?: string
}

export interface TracerouteHop {
  hop: number
  host?: string
  latencyMs?: number
  timedOut: boolean
}

/**
 * Identity attached to a local reachability probe. The main process resolves
 * the active vault policy and verifies that `host` is currently assigned to
 * this exact server before making any network contact.
 */
export interface ServerProbeTarget {
  profileId: string
  serverId: number
  host: string
}

export interface IpcApi {
  // Vault & Auth
  getProfiles: () => Promise<AccountProfile[]>
  getActiveProfile: () => Promise<AccountProfile | null>
  validateBinaryLaneToken: (token: string) => Promise<BinaryLaneTokenValidation>
  binaryLaneRequest: (profileId: string, request: BinaryLaneBridgeRequest) => Promise<BinaryLaneBridgeResponse>
  saveProfile: (profile: SaveProfileInput) => Promise<{ success: boolean; profileId: string; updated?: boolean; error?: string }>
  updateProfileSafety: (
    profileId: string,
    accessMode: ProfileAccessMode,
    protectedServerIds: number[],
    maintenanceServerIds: number[],
    protectedResources: ResourceSafetyTarget[],
    maintenanceResources: ResourceSafetyTarget[]
  ) => Promise<{ success: boolean; error?: string }>
  deleteProfile: (profileId: string) => Promise<{ success: boolean; error?: string }>
  setActiveProfile: (profileId: string) => Promise<{ success: boolean; error?: string }>
  
  // Terminal & Console
  launchNativeTerminal: (options: TerminalLaunchOptions) => Promise<TerminalLaunchResult>
  openRescueConsole: (options: ConsoleWindowOptions) => Promise<{ success: boolean; error?: string }>
  
  // SSH Keys & Local FS
  getLocalSshKeys: () => Promise<LocalSshKey[]>

  // System Notifications
  sendNotification: (options: SystemNotificationOptions) => Promise<void>

  // Local change log — see main/changelog.ts and renderer lib/changelog.ts
  changelogAppend: (entry: ChangeLogRecord) => Promise<void>
  changelogUpdate: (profileId: string, id: string, patch: Record<string, unknown>) => Promise<void>
  changelogList: (profileId: string, limit?: number) => Promise<any[]>
  changelogClear: (profileId: string) => Promise<void>

  // Device-wide cloud-init templates, stored as YAML documents.
  templatesList: () => Promise<string[]>
  templatesGet: (slug: string) => Promise<TemplateGetResult>
  templatesSave: (document: string, oldSlug?: string) => Promise<string>
  templatesRemove: (slug: string) => Promise<void>
  templatesReveal: (slug: string) => Promise<void>

  // Tray / menu bar — see main/tray.ts
  /** Push the current fleet picture; main rebuilds the tray tooltip and menu from it. */
  updateTray: (summary: TrayFleetSummary) => Promise<void>
  getTraySettings: () => Promise<TraySettings>
  
  // Window Controls
  /** 'darwin' | 'win32' | 'linux' in Electron; 'android' | 'web' from the mobile bridge. Decides whose window chrome is drawn. */
  platform: string
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>
  /** Fires on maximise / restore from any cause; returns an unsubscribe. */
  onWindowMaximized?: (listener: (maximized: boolean) => void) => () => void
  
  // Shell / Browser
  openExternal: (url: string) => Promise<void>

  /*
   * Reachability probes. Optional because they only exist in Electron - the
   * Android build has no raw sockets and no child_process, so the renderer
   * feature-detects these and hides the UI rather than shipping a button that
   * cannot work.
   */
  probeTcp?: (target: ServerProbeTarget, port: number, timeoutMs?: number) => Promise<TcpProbeResult>
  probePing?: (target: ServerProbeTarget, timeoutMs?: number) => Promise<PingProbeResult>
  traceroute?: (target: ServerProbeTarget, maxHops?: number) => Promise<TracerouteHop[]>
  /** Eligible addresses the main process will accept probes for; set from the server list. */
  setProbeTargets?: (ips: string[]) => Promise<void>

  // Auto-update
  getUpdaterState: () => Promise<UpdaterState>
  checkForUpdates: () => Promise<UpdaterState>
  installUpdate: () => Promise<void>
  setUpdateChannel: (channel: UpdateChannel) => Promise<UpdaterState>
  /** Subscribe to state changes; returns an unsubscribe function. */
  onUpdaterState: (listener: (state: UpdaterState) => void) => () => void

  // Deep links (bldesk://) — see shared/deeplink.ts for the URL grammar
  /** One-shot: a link that arrived before the renderer was listening (cold start). */
  getPendingDeepLink: () => Promise<string | null>
  /** Tell main the renderer is subscribed; flushes any queued link via onDeepLink. */
  deepLinkReady: () => Promise<void>
  /** Subscribe to links arriving while running; returns an unsubscribe function. */
  onDeepLink: (listener: (url: string) => void) => () => void
}

declare global {
  interface Window {
    bldeskApi: IpcApi
  }
}
