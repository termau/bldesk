import { spawn, ChildProcess } from 'child_process'
import { accessSync, constants } from 'fs'
import { basename, delimiter, extname, isAbsolute, join } from 'path'
import { TerminalLaunchOptions, TerminalLaunchResult } from '../shared/ipc-types'
import { formatSshCommand, psQuote, shQuote, sshArgv, validateSshTarget } from '../shared/ssh'

// ---------------------------------------------------------------------------
// PATH lookup
// ---------------------------------------------------------------------------

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a program name (or absolute path) to an executable, or null.
 * On Windows the bare name is tried first, then each PATHEXT extension.
 */
export function findOnPath(program: string): string | null {
  if (isAbsolute(program)) return isExecutable(program) ? program : null
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  // PATHEXT only applies to names without an extension; `powershell.exe` must not
  // be beaten by an earlier `powershell.exe.cmd`.
  const exts =
    process.platform === 'win32' && extname(program) === ''
      ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')]
      : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, program + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Linux / BSD terminal table
// ---------------------------------------------------------------------------

/**
 * How each emulator wants "run this program with these args". Order is preference
 * when $TERMINAL is unset: desktop-native terminals first, Debian's alternatives
 * shim and xterm last. Only emulators whose multi-arg syntax is verified are listed.
 */
const LINUX_TERMINALS: Array<{ name: string; argv: (cmd: string[]) => string[] }> = [
  { name: 'konsole', argv: (cmd) => ['-e', ...cmd] },
  { name: 'kitty', argv: (cmd) => [...cmd] },
  { name: 'alacritty', argv: (cmd) => ['-e', ...cmd] },
  { name: 'wezterm', argv: (cmd) => ['start', '--', ...cmd] },
  { name: 'ghostty', argv: (cmd) => ['-e', ...cmd] },
  { name: 'foot', argv: (cmd) => [...cmd] },
  { name: 'gnome-terminal', argv: (cmd) => ['--', ...cmd] },
  { name: 'xfce4-terminal', argv: (cmd) => ['-x', ...cmd] },
  { name: 'x-terminal-emulator', argv: (cmd) => ['-e', ...cmd] },
  { name: 'xterm', argv: (cmd) => ['-e', ...cmd] }
]

/**
 * Pick the terminal to use: $TERMINAL if set and present on PATH (using its known
 * syntax when we have one, `-e` otherwise), else the first table entry on PATH.
 */
function resolveLinuxTerminal(): { name: string; path: string; argv: (cmd: string[]) => string[] } | null {
  const preferred = process.env.TERMINAL?.trim()
  if (preferred) {
    const path = findOnPath(preferred)
    if (path) {
      const known = LINUX_TERMINALS.find((t) => t.name === basename(preferred))
      return { name: basename(preferred), path, argv: known?.argv ?? ((cmd) => ['-e', ...cmd]) }
    }
    console.warn(`[Terminal] $TERMINAL="${preferred}" is not on PATH; falling back to auto-detection`)
  }
  for (const t of LINUX_TERMINALS) {
    const path = findOnPath(t.name)
    if (path) return { ...t, path }
  }
  return null
}

/**
 * `sh -c` body that runs ssh, then execs the user's shell so the window stays open
 * after ssh exits (auth failure, declined host key…) and the message can be read.
 * A relative $SHELL with a slash would resolve against our cwd, so fall back to sh.
 */
function keepOpenScript(argv: string[]): string {
  const ssh = argv.map(shQuote).join(' ')
  return `${ssh}; s="\${SHELL:-sh}"; case "$s" in /*) ;; */*) s=sh ;; esac; exec "$s"`
}

// ---------------------------------------------------------------------------
// macOS terminal support
// ---------------------------------------------------------------------------

interface MacTerminalRunner {
  name: string
  isAvailable: () => boolean
  launch: (argv: string[], command: string) => Promise<void>
}

function hasMacApp(appName: string): boolean {
  const userHome = process.env.HOME || ''
  const candidates = [
    `/Applications/${appName}.app`,
    join(userHome, `Applications/${appName}.app`),
    `/System/Applications/Utilities/${appName}.app`
  ]
  return candidates.some((p) => {
    try {
      accessSync(p, constants.F_OK)
      return true
    } catch {
      return false
    }
  })
}

const MAC_TERMINALS: MacTerminalRunner[] = [
  {
    name: 'Ghostty',
    isAvailable: () => hasMacApp('Ghostty') || !!findOnPath('ghostty'),
    launch: async (argv) => {
      await spawnDetached('open', ['-na', 'Ghostty.app', '--args', '-e', 'sh', '-c', keepOpenScript(argv)])
    }
  },
  {
    name: 'iTerm2',
    isAvailable: () => hasMacApp('iTerm') || hasMacApp('iTerm2'),
    launch: async (argv) => {
      const asString = keepOpenScript(argv).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const script = `tell application "iTerm"\n  activate\n  try\n    tell current window to create tab with default profile command "sh -c \\"${asString}\\""\n  on error\n    create window with default profile command "sh -c \\"${asString}\\""\n  end try\nend tell`
      await spawnDetached('osascript', ['-e', script])
    }
  },
  {
    name: 'Warp',
    isAvailable: () => hasMacApp('Warp'),
    launch: async (argv) => {
      const ssh = argv.map(shQuote).join(' ')
      await spawnDetached('open', [`warp://action/new_tab?path=~&command=${encodeURIComponent(ssh)}`])
    }
  },
  {
    name: 'kitty',
    isAvailable: () => hasMacApp('kitty') || !!findOnPath('kitty'),
    launch: async (argv) => {
      await spawnDetached('open', ['-na', 'kitty.app', '--args', 'sh', '-c', keepOpenScript(argv)])
    }
  },
  {
    name: 'Alacritty',
    isAvailable: () => hasMacApp('Alacritty') || !!findOnPath('alacritty'),
    launch: async (argv) => {
      await spawnDetached('open', ['-na', 'Alacritty.app', '--args', '-e', 'sh', '-c', keepOpenScript(argv)])
    }
  },
  {
    name: 'WezTerm',
    isAvailable: () => hasMacApp('WezTerm') || !!findOnPath('wezterm'),
    launch: async (argv) => {
      await spawnDetached('open', ['-na', 'WezTerm.app', '--args', 'start', '--', 'sh', '-c', keepOpenScript(argv)])
    }
  },
  {
    name: 'Terminal.app',
    isAvailable: () => true, // default macOS terminal
    launch: async (argv) => {
      const asString = keepOpenScript(argv).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const script = `tell application "Terminal"\n  activate\n  do script "${asString}"\nend tell`
      await spawnDetached('osascript', ['-e', script])
    }
  }
]

function resolveMacTerminal(): MacTerminalRunner {
  const preferred = process.env.TERMINAL?.trim().toLowerCase()
  if (preferred) {
    const matched = MAC_TERMINALS.find(
      (t) => t.name.toLowerCase() === preferred || t.name.toLowerCase().includes(preferred)
    )
    if (matched && matched.isAvailable()) return matched
    console.warn(`[Terminal] $TERMINAL="${preferred}" is not available on macOS; defaulting to Terminal.app`)
  }
  // Default to native Terminal.app unless explicitly configured via $TERMINAL
  return MAC_TERMINALS.find((t) => t.name === 'Terminal.app') || MAC_TERMINALS[MAC_TERMINALS.length - 1]
}

// ---------------------------------------------------------------------------
// spawn helper: resolve on 'spawn', reject on 'error' — never an uncaught event
// ---------------------------------------------------------------------------

function spawnDetached(file: string, args: string[]): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(file, args, { detached: true, stdio: 'ignore' })
    } catch (err) {
      reject(err)
      return
    }
    child.once('spawn', () => {
      child.unref()
      resolve(child)
    })
    child.once('error', reject)
  })
}

/** Run a short-lived helper with no window and resolve with its exit code; reject on spawn failure. */
function runHidden(file: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(file, args, { stdio: 'ignore', windowsHide: true })
    } catch (err) {
      reject(err)
      return
    }
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      // (null, null) only happens alongside an 'error' event; let the rejection win.
      if (code === null && signal === null) return
      resolve(code ?? 1)
    })
  })
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function launchNativeTerminal(options: TerminalLaunchOptions): Promise<TerminalLaunchResult> {
  const invalid = validateSshTarget(options)
  if (invalid) return { success: false, error: invalid }

  const argv = sshArgv(options)
  const command = formatSshCommand(options, process.platform === 'win32' ? 'win32' : 'posix')

  try {
    if (process.platform === 'win32') {
      // Windows Terminal, default profile. Argv is passed straight through — no shell.
      try {
        await spawnDetached('wt.exe', ['new-tab', ...argv])
        return { success: true, terminal: 'Windows Terminal', command }
      } catch {
        // Fall back to a PowerShell window. libuv maps `detached` to DETACHED_PROCESS on
        // Windows (no console at all), so a console app must be launched via `start`,
        // which creates the window. cmd.exe itself runs hidden and is awaited: `start`
        // returns 0 only once it has launched the target, so the exit code is the proof.
        // The script is base64(UTF-16LE) so no user-controlled text is concatenated into
        // cmd.exe or PowerShell code.
        const powershell = findOnPath('powershell.exe') || findOnPath('pwsh.exe')
        if (!powershell) {
          return { success: false, error: 'Neither Windows Terminal nor PowerShell was found on PATH.', command }
        }
        const script = `& ${argv.map(psQuote).join(' ')}`
        const encoded = Buffer.from(script, 'utf16le').toString('base64')
        const code = await runHidden('cmd.exe', ['/c', 'start', '', powershell, '-NoLogo', '-NoExit', '-EncodedCommand', encoded])
        if (code !== 0) {
          return { success: false, error: `Could not start PowerShell (start exited with code ${code}).`, command }
        }
        return { success: true, terminal: basename(powershell, '.exe'), command }
      }
    }

    if (process.platform === 'darwin') {
      const term = resolveMacTerminal()
      try {
        await term.launch(argv, command)
        return { success: true, terminal: term.name, command }
      } catch (err: any) {
        if (term.name !== 'Terminal.app') {
          console.warn(`[Terminal] ${term.name} launch failed, falling back to Terminal.app:`, err)
          const fallback = MAC_TERMINALS.find((t) => t.name === 'Terminal.app')!
          await fallback.launch(argv, command)
          return { success: true, terminal: 'Terminal.app', command }
        }
        throw err
      }
    }

    const term = resolveLinuxTerminal()
    if (!term) {
      return {
        success: false,
        error:
          'No terminal emulator found. Set the TERMINAL environment variable to your terminal (e.g. konsole, kitty, alacritty) or install one of: ' +
          LINUX_TERMINALS.map((t) => t.name).join(', '),
        command
      }
    }
    await spawnDetached(term.path, term.argv(['sh', '-c', keepOpenScript(argv)]))
    return { success: true, terminal: term.name, command }
  } catch (err: any) {
    console.error('[Terminal] Failed to launch native terminal:', err)
    return { success: false, error: err?.message || String(err), command }
  }
}
