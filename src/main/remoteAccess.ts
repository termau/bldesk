import type { TerminalLaunchOptions, TerminalLaunchResult } from '../shared/ipc-types'
import { isRemoteAccessAllowed } from '../shared/binarylane-policy'
import { BinaryLaneBroker } from './binarylane'
import { VaultManager } from './safeStorage'
import { launchNativeTerminal } from './terminal'

/**
 * The only desktop entry point allowed to launch SSH. Callers may be the main
 * renderer or native UI such as the tray, so authorization belongs here rather
 * than at either UI boundary.
 */
export async function launchAuthorizedTerminal(options: TerminalLaunchOptions): Promise<TerminalLaunchResult> {
  try {
    const active = VaultManager.getActiveProfile()
    const serverId = Number(options.serverId)
    if (!active) {
      return { success: false, error: 'Remote access is blocked because no account profile is active.' }
    }

    // Full is the explicit legacy/unrestricted mode, so its manual terminal
    // keeps accepting arbitrary hosts. Guarded mode always requires a server
    // ID and an API-backed host binding.
    if (active.accessMode === 'full' && (!Number.isSafeInteger(serverId) || serverId <= 0)) {
      return launchNativeTerminal(options)
    }
    if (!isRemoteAccessAllowed(active, serverId)) {
      return { success: false, error: 'Remote access is blocked for this server by the active safety policy.' }
    }
    if (!await BinaryLaneBroker.verifyServerHost(active.id, serverId, options.host)) {
      return { success: false, error: 'The SSH host does not match the selected BinaryLane server.' }
    }

    // Close the policy/profile-change race while the verification request was
    // in flight. A newly protected target must never open a terminal.
    const current = VaultManager.getActiveProfile()
    if (!current || current.id !== active.id || !isRemoteAccessAllowed(current, serverId)) {
      return { success: false, error: 'The active safety policy changed before SSH could open.' }
    }
    return launchNativeTerminal(options)
  } catch {
    return { success: false, error: 'The protected credential vault could not authorize SSH access.' }
  }
}
