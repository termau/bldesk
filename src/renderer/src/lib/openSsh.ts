import type { TerminalLaunchOptions, TerminalLaunchResult } from '@shared/ipc-types'
import { launchSsh } from './launchSsh'

export const OPEN_SSH_EVENT = 'bldesk:open-ssh'
export type OpenSshOptions = TerminalLaunchOptions & { serverId?: number; serverName?: string }
const PREFERENCE = 'bldesk_prefer_native_terminal'
const pending: OpenSshOptions[] = []
export function prefersNativeTerminal(): boolean {
  try { return localStorage.getItem(PREFERENCE) === 'true' } catch { return false }
}
export function setPreferNativeTerminal(value: boolean): void {
  try { localStorage.setItem(PREFERENCE, String(value)) } catch { /* optional */ }
}
export async function openSsh(options: OpenSshOptions, native = false): Promise<TerminalLaunchResult> {
  if (native || !window.bldeskApi?.pty || prefersNativeTerminal()) return launchSsh(options)
  // A cold deep link can be routed during React's initial effect flush. Queue
  // until TerminalView owns the request rather than reporting a false success.
  const event = new CustomEvent(OPEN_SSH_EVENT, { detail: options, cancelable: true })
  window.dispatchEvent(event)
  if (!event.defaultPrevented) pending.push(options)
  return { success: true, terminal: 'BLDesk' }
}

export function takePendingSsh(): OpenSshOptions[] {
  return pending.splice(0)
}
