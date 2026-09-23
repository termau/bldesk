import { TerminalLaunchOptions, TerminalLaunchResult } from '@shared/ipc-types'
import { formatSshCommand, validateSshTarget } from '@shared/ssh'

const shellFlavour = (): 'posix' | 'win32' => (/Windows/i.test(navigator.userAgent) ? 'win32' : 'posix')

// One launch at a time: a double-click must not open two terminals or stack two alerts.
let inFlight = false

/**
 * Open an SSH session in the user's native terminal and surface the outcome.
 *
 * The main process never throws for a missing/failed terminal — it returns
 * `{ success: false, error, command }` — so this is the one place that turns any
 * failure (including a missing bridge or a rejected IPC call) into feedback:
 * copy the full ssh command to the clipboard and say what went wrong.
 */
export async function launchSsh(options: TerminalLaunchOptions): Promise<TerminalLaunchResult> {
  if (inFlight) return { success: false, error: 'A terminal launch is already in progress.' }
  inFlight = true
  try {
    const invalid = !options.host?.trim() && (options as { warning?: string }).warning || validateSshTarget(options)
    const fallbackCommand = invalid ? undefined : formatSshCommand(options, shellFlavour())

    let result: TerminalLaunchResult
    if (invalid) {
      result = { success: false, error: invalid }
    } else if (!window.bldeskApi?.launchNativeTerminal) {
      result = { success: false, error: 'Native terminal launch is not available in this build.', command: fallbackCommand }
    } else {
      try {
        result = await window.bldeskApi.launchNativeTerminal(options)
      } catch (err: any) {
        result = { success: false, error: err?.message || String(err), command: fallbackCommand }
      }
    }

    if (!result.success) await reportFailure(options.host, result)
    return result
  } finally {
    inFlight = false
  }
}

async function reportFailure(host: string, result: TerminalLaunchResult): Promise<void> {
  const command = result.command
  let copied = false
  if (command) {
    try {
      await navigator.clipboard.writeText(command)
      copied = true
    } catch {
      // clipboard may be unavailable; the alert still shows the command
    }
  }
  const lines = [`Couldn't open a terminal for ${host}.`, '', result.error || 'Unknown error']
  if (command) {
    lines.push('', copied ? 'The SSH command has been copied to your clipboard:' : 'Run this yourself:', command)
  }
  alert(lines.join('\n'))
}
