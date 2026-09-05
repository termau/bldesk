import { TerminalLaunchOptions } from './ipc-types'

/**
 * SSH command building shared by the main process (which spawns it) and the
 * renderer (which shows / copies it on failure). One builder, one quoting rule
 * per platform, one validator — so nothing user-typed reaches a shell unchecked.
 */

export type ShellFlavour = 'posix' | 'win32'

// ---------------------------------------------------------------------------
// Host validation: hostname | IPv4 | IPv6 (bare or [bracketed], optional %zone)
// ---------------------------------------------------------------------------

// RFC 1123 labels plus `_`: not strictly a hostname character, but common on LANs
// (Windows names, SRV-style records) and accepted by OpenSSH; inert in every shell here.
const LABEL_RE = /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/
const HEX_GROUP_RE = /^[0-9A-Fa-f]{1,4}$/
const ZONE_RE = /^[A-Za-z0-9._-]{1,32}$/

export function isValidHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false
  const trimmed = host.endsWith('.') ? host.slice(0, -1) : host // absolute FQDN
  if (trimmed.length === 0) return false
  return trimmed.split('.').every((label) => LABEL_RE.test(label))
}

export function isValidIpv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/** Bare IPv6, optionally with a `%zone` suffix; embedded IPv4 in the last position allowed. */
export function isValidIpv6(host: string): boolean {
  let addr = host
  const zoneAt = addr.indexOf('%')
  if (zoneAt !== -1) {
    if (!ZONE_RE.test(addr.slice(zoneAt + 1))) return false
    addr = addr.slice(0, zoneAt)
  }
  if (!/^[0-9A-Fa-f:.]+$/.test(addr)) return false

  const doubleColons = addr.split('::').length - 1
  if (doubleColons > 1) return false
  const [head, tail] = doubleColons === 1 ? addr.split('::') : [addr, undefined]

  // An embedded dotted IPv4 is only legal as the final textual component of the
  // whole address (`::ffff:192.0.2.1`), never before a `::`.
  const parseGroups = (s: string, ipv4AllowedLast: boolean): number | null => {
    if (s === '') return 0
    const groups = s.split(':')
    let count = 0
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]
      if (g.includes('.')) {
        if (!ipv4AllowedLast || i !== groups.length - 1 || !isValidIpv4(g)) return null
        count += 2
      } else if (HEX_GROUP_RE.test(g)) {
        count += 1
      } else {
        return null
      }
    }
    return count
  }

  const headCount = parseGroups(head, tail === undefined)
  if (headCount === null) return false
  if (tail === undefined) return headCount === 8
  const tailCount = parseGroups(tail, true)
  if (tailCount === null) return false
  return headCount + tailCount <= 7
}

/**
 * Returns the canonical bare host for an ssh *argv* destination, or null if invalid.
 * IPv6 comes back WITHOUT brackets: OpenSSH's `user@host` parsing does not strip
 * them (`ssh root@[::1]` → "Could not resolve hostname"); brackets belong only in
 * `ssh://` URIs — see sshUriHost().
 */
export function normaliseSshHost(raw: string): string | null {
  const host = raw.trim()
  if (host.startsWith('[') || host.endsWith(']')) {
    if (!(host.startsWith('[') && host.endsWith(']'))) return null
    const inner = host.slice(1, -1)
    return isValidIpv6(inner) ? inner : null
  }
  if (host.includes(':')) return isValidIpv6(host) ? host : null
  if (/^[\d.]+$/.test(host)) return isValidIpv4(host) ? host : null
  return isValidHostname(host) ? host : null
}

/** Host formatted for an `ssh://` URI: IPv6 bracketed, zone delimiter percent-encoded (RFC 6874). */
export function sshUriHost(raw: string): string | null {
  const host = normaliseSshHost(raw)
  if (host === null) return null
  return host.includes(':') ? `[${host.replace('%', '%25')}]` : host
}

const USER_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/
const CONTROL_RE = /[\x00-\x1f\x7f]/

/** Returns an error message if the options can't safely become an ssh command, else null. */
export function validateSshTarget(options: TerminalLaunchOptions): string | null {
  const raw = (options.host || '').trim()
  if (!raw) return 'No host given.'
  if (normaliseSshHost(raw) === null) return `"${raw}" is not a valid hostname or IP address.`
  const user = options.username || 'root' // same default rule as sshArgv
  if (!USER_RE.test(user)) return `"${user}" is not a valid SSH username.`
  if (options.port !== undefined) {
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
      return `Port ${options.port} is out of range.`
    }
  }
  if (options.privateKeyPath !== undefined) {
    if (options.privateKeyPath.trim() === '') return 'The private key path is empty.'
    if (CONTROL_RE.test(options.privateKeyPath)) return 'The private key path contains control characters.'
  }
  return null
}

// ---------------------------------------------------------------------------
// argv + quoting
// ---------------------------------------------------------------------------

/**
 * `ssh [-p port] [-i key] user@host` as an argv array — never a shell string.
 * Call validateSshTarget first; this assumes the host normalises.
 */
export function sshArgv(options: TerminalLaunchOptions, remoteCommand?: string): string[] {
  const user = options.username || 'root'
  const host = normaliseSshHost(options.host) ?? options.host.trim()
  const argv = ['ssh']
  if (options.port) argv.push('-p', String(options.port))
  if (options.privateKeyPath) argv.push('-i', options.privateKeyPath)
  argv.push(`${user}@${host}`)
  // OpenSSH sends this to the remote login shell only AFTER authentication.
  // Its exit status is the remote command's status (255 for SSH errors).
  if (remoteCommand !== undefined) argv.push(remoteCommand)
  return argv
}

/** POSIX single-quote a word so it survives `sh -c`. */
export function shQuote(word: string): string {
  return `'${word.replace(/'/g, `'\\''`)}'`
}

/** PowerShell single-quote a word (no expansion inside; inner quotes are doubled). */
export function psQuote(word: string): string {
  return `'${word.replace(/'/g, "''")}'`
}

const POSIX_SAFE = /^[A-Za-z0-9@%+=:,./_-]+$/
// PowerShell: `@` splats, `:` scopes, `$` expands, `\` is fine — keep the bare set tiny.
const PS_SAFE = /^[A-Za-z0-9._-]+$/

/** Human-readable command line for error messages / clipboard, quoted for the target shell. */
export function formatSshCommand(options: TerminalLaunchOptions, flavour: ShellFlavour): string {
  return sshArgv(options)
    .map((w) => {
      if (flavour === 'win32') return PS_SAFE.test(w) ? w : psQuote(w)
      return POSIX_SAFE.test(w) ? w : shQuote(w)
    })
    .join(' ')
}
