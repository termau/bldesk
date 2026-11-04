/**
 * Human-readable names for BinaryLane action types.
 *
 * The API's action `type` is a snake_case identifier (`power_cycle`,
 * `enable_rescue_mode`). That is fine in a confirm dialog the user has just
 * opened deliberately, but a toast reporting an outcome minutes later is prose,
 * and "power_cycle" is not.
 *
 * Title-casing the identifier handles almost every type correctly, so the map
 * below covers only the words that rule gets wrong — acronyms.
 */
const ACRONYMS: Record<string, string> = {
  ipv4: 'IPv4',
  ipv6: 'IPv6',
  vpc: 'VPC',
  ssh: 'SSH',
  dns: 'DNS',
  ip: 'IP',
  os: 'OS',
  id: 'ID',
  cpu: 'CPU',
  url: 'URL'
}

export function describeActionType(type: string): string {
  if (!type) return 'Server action'
  return type
    .split('_')
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Actions BLDesk sends that BinaryLane's public API reference does not list. Each is a recorded exception to the
 * "public API only" rule (AGENTS.md), kept on the maintainer's decision, and the confirmation says so: what it does is
 * not documented in the reference and could change. scripts/gui-test/check-requests.mjs carries the same list.
 */
const UNPUBLISHED_ACTIONS = new Set(['enable_rescue_mode'])

export const UNPUBLISHED_ACTION_NOTE =
  "This action is not in BinaryLane's public API reference, so its behaviour is not documented there and it could change or stop working."

/** The note to show in a confirmation for an action the public reference does not list, or none. */
export function unpublishedActionNotes(type: string): string[] | undefined {
  return UNPUBLISHED_ACTIONS.has(type) ? [UNPUBLISHED_ACTION_NOTE] : undefined
}

/**
 * Network changes BinaryLane carries out by restarting the server. The action reports the steps "Shutting down server" and
 * "Starting server" (a move between networks adds "Moving server to destination VPC" between them), and the server's uptime
 * starts again from zero. Seen on a live server on 4 November 2026 for all three; the reference describes only what each
 * one changes, and the server's `status` stays `active` throughout, so nothing else on screen says it is down.
 */
const RESTARTING_ACTIONS = new Set(['change_network', 'change_separate_private_network_interface', 'change_vpc_ipv4'])

export function restartsServer(type: string | undefined): boolean {
  return !!type && RESTARTING_ACTIONS.has(type)
}

/** The warning in a confirmation for a change that restarts the server. */
export const RESTART_NOTE =
  'A running server is restarted to do this: BinaryLane shuts it down, makes the change and starts it again, so everything running on it stops and starts again.'

/** What the toast says while such a change is being applied. */
export const RESTART_TOAST = 'Applying this change. A running server is restarted to do it.'

/** One honest sentence per power action, for the confirm dialog. */
export function powerActionSummary(type: string): string {
  switch (type) {
    case 'reboot':
      return 'Asks the OS to restart cleanly (ACPI). The server is back within a minute or two if the OS cooperates.'
    case 'shutdown':
      return 'Sends an ACPI shutdown signal. The OS decides whether to honour it — BinaryLane reports the signal delivered, not the server off.'
    case 'power_off':
      return 'Cuts power at the hypervisor. Equivalent to pulling the plug: anything unsaved in the guest is lost.'
    case 'power_cycle':
      return 'Cuts power at the hypervisor and starts the server again. Equivalent to pulling the plug and reconnecting it.'
    case 'power_on':
      return 'Starts the server.'
    default:
      return `Submits "${describeActionType(type)}" to BinaryLane.`
  }
}
