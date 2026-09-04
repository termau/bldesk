import { contextBridge, ipcRenderer } from 'electron'
import { IpcApi, UpdaterState } from '../shared/ipc-types'

const api: IpcApi = {
  // Vault & Auth
  getProfiles: () => ipcRenderer.invoke('vault:getProfiles'),
  getActiveProfile: () => ipcRenderer.invoke('vault:getActiveProfile'),
  validateBinaryLaneToken: (token) => ipcRenderer.invoke('binarylane:validateToken', token),
  binaryLaneRequest: (profileId, request) => ipcRenderer.invoke('binarylane:request', profileId, request),
  saveProfile: (profile) => ipcRenderer.invoke('vault:saveProfile', profile),
  updateProfileSafety: (
    profileId,
    accessMode,
    protectedServerIds,
    maintenanceServerIds,
    protectedResources,
    maintenanceResources
  ) =>
    ipcRenderer.invoke(
      'vault:updateProfileSafety',
      profileId,
      accessMode,
      protectedServerIds,
      maintenanceServerIds,
      protectedResources,
      maintenanceResources
    ),
  deleteProfile: (profileId) => ipcRenderer.invoke('vault:deleteProfile', profileId),
  setActiveProfile: (profileId) => ipcRenderer.invoke('vault:setActiveProfile', profileId),

  // Terminal & Console
  launchNativeTerminal: (options) => ipcRenderer.invoke('terminal:launchNative', options),
  openRescueConsole: (options) => ipcRenderer.invoke('console:openRescue', options),

  // SSH Keys
  getLocalSshKeys: () => ipcRenderer.invoke('vault:getLocalSshKeys'),

  // System Notifications
  sendNotification: (options) => ipcRenderer.invoke('system:sendNotification', options),

  // Local change log
  changelogAppend: (entry) => ipcRenderer.invoke('changelog:append', entry),
  changelogUpdate: (profileId, id, patch) => ipcRenderer.invoke('changelog:update', profileId, id, patch),
  changelogList: (profileId, limit) => ipcRenderer.invoke('changelog:list', profileId, limit),
  changelogClear: (profileId) => ipcRenderer.invoke('changelog:clear', profileId),

  // Device-wide cloud-init templates
  templatesList: () => ipcRenderer.invoke('templates:list'),
  templatesGet: (slug) => ipcRenderer.invoke('templates:get', slug),
  templatesSave: (document, oldSlug) => ipcRenderer.invoke('templates:save', document, oldSlug),
  templatesRemove: (slug) => ipcRenderer.invoke('templates:remove', slug),
  templatesReveal: (slug) => ipcRenderer.invoke('templates:reveal', slug),

  // Tray / menu bar
  updateTray: (summary) => ipcRenderer.invoke('tray:update', summary),
  getTraySettings: () => ipcRenderer.invoke('tray:getSettings'),

  // Window Controls
  platform: process.platform,
  onWindowMaximized: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on('window:maximized', handler)
    return () => ipcRenderer.removeListener('window:maximized', handler)
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // External Links
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  probeTcp: (target, port, timeoutMs) => ipcRenderer.invoke('net:probeTcp', target, port, timeoutMs),
  probePing: (target, timeoutMs) => ipcRenderer.invoke('net:probePing', target, timeoutMs),
  traceroute: (target, maxHops) => ipcRenderer.invoke('net:traceroute', target, maxHops),
  setProbeTargets: (ips: string[]) => ipcRenderer.invoke('net:setTargets', ips),

  // Auto-update
  getUpdaterState: () => ipcRenderer.invoke('updater:getState'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  setUpdateChannel: (channel) => ipcRenderer.invoke('updater:setChannel', channel),
  onUpdaterState: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, state: UpdaterState) => listener(state)
    ipcRenderer.on('updater:state', handler)
    return () => ipcRenderer.removeListener('updater:state', handler)
  },

  // Deep links (bldesk://)
  getPendingDeepLink: () => ipcRenderer.invoke('deeplink:getPending'),
  deepLinkReady: () => ipcRenderer.invoke('deeplink:ready'),
  onDeepLink: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, url: string) => listener(url)
    ipcRenderer.on('deeplink:open', handler)
    return () => ipcRenderer.removeListener('deeplink:open', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('bldeskApi', api)
  } catch (error) {
    console.error('Failed to expose bldeskApi in main world:', error)
  }
} else {
  // @ts-ignore (define in window)
  window.bldeskApi = api
}
