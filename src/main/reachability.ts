/**
 * Reachability probes run from the user's own machine (FEATURES.md #11).
 *
 * The point of the desktop app is that it sits where the customer sits: mPanel
 * can tell you a server is running, but only something on the customer's network
 * can tell you whether *they* can reach the guest's remote-management service.
 * BLDesk checks SSH/TCP 22 for Unix-like images and RDP/TCP 3389 for Windows.
 *
 * Three deliberate constraints:
 *
 * 1. **No raw sockets.** ICMP needs privileges we should not ask for, so ping
 *    shells out to the system binary and TCP uses an ordinary connect. A TCP
 *    connect to the normal SSH or RDP port is the more useful signal anyway -
 *    it is the thing the user is actually trying to do, and it survives
 *    networks that drop ICMP.
 *
 * 2. **No shell, ever.** The host reaches us from the renderer, so `ping` and
 *    `traceroute` are spawned with an argument array and `shell: false`, and the
 *    host is rejected unless it parses as a bare IP literal. A hostname would be
 *    harmless in itself, but accepting one means accepting a string that has to
 *    be proven safe; an IP literal proves itself.
 *
 * 3. **Only the account's own addresses, and not many of them.** The renderer
 *    declares the IPs it may probe and they are checked here. Be honest about
 *    what that buys: the list is set *by* the renderer, so it guards against
 *    bugs and stray calls, not against a renderer that has been taken over —
 *    which already holds the API token and could set any list it likes. The
 *    rate limit below is what makes even that case a poor scanner: a few dozen
 *    connects a minute to addresses you already own is not worth hijacking.
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import { isIP } from 'node:net'

export interface TcpProbeResult {
  ok: boolean
  latencyMs?: number
  /** 'refused' means something answered - the host is up, the port is shut. */
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

const MAX_TIMEOUT_MS = 10_000
const MAX_HOPS = 20

/** Targets the renderer is permitted to probe, replaced on every server refresh. */
let allowedTargets = new Set<string>()

export function setAllowedTargets(ips: string[]): void {
  allowedTargets = new Set(ips.filter((ip) => isIP(ip) !== 0))
}

/** Probes allowed per rolling minute, across all kinds. Plenty for a person, useless for a scan. */
const RATE_LIMIT_PER_MINUTE = 30
const recentProbes: number[] = []

function underRateLimit(): boolean {
  const now = Date.now()
  while (recentProbes.length && now - recentProbes[0] > 60_000) recentProbes.shift()
  if (recentProbes.length >= RATE_LIMIT_PER_MINUTE) return false
  recentProbes.push(now)
  return true
}

function checkTarget(host: string): string | null {
  if (isIP(host) === 0) return 'not an IP literal'
  if (!allowedTargets.has(host)) return 'not an address on this account'
  if (!underRateLimit()) return 'too many probes — wait a minute'
  return null
}

const clampTimeout = (ms: number | undefined): number =>
  Math.max(500, Math.min(Number(ms) || 3000, MAX_TIMEOUT_MS))

/**
 * Can we open a TCP connection, and how long did it take?
 *
 * A refusal is reported distinctly from a timeout: refused means the host is
 * alive and answered, which is a different problem from a silent drop and points
 * at a different fix (service down vs firewall).
 */
export function probeTcp(host: string, port: number, timeoutMs?: number): Promise<TcpProbeResult> {
  const bad = checkTarget(host)
  if (bad) return Promise.resolve({ ok: false, error: 'invalid-target', detail: bad })
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve({ ok: false, error: 'invalid-target', detail: 'port out of range' })
  }

  const timeout = clampTimeout(timeoutMs)
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const started = process.hrtime.bigint()
    let settled = false
    const finish = (r: TcpProbeResult): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(r)
    }

    socket.setTimeout(timeout)
    socket.once('connect', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      finish({ ok: true, latencyMs: Math.round(ms * 10) / 10 })
    })
    socket.once('timeout', () => finish({ ok: false, error: 'timeout' }))
    socket.once('error', (err: NodeJS.ErrnoException) => {
      const code = err.code
      finish({
        ok: false,
        error:
          code === 'ECONNREFUSED'
            ? 'refused'
            : code === 'EHOSTUNREACH' || code === 'ENETUNREACH'
              ? 'unreachable'
              : 'other',
        detail: code || err.message
      })
    })
    socket.connect(port, host)
  })
}

/** Run a system binary with no shell and a hard deadline. */
function run(cmd: string, args: string[], timeoutMs: number): Promise<{ out: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false, windowsHide: true })
    let out = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout?.on('data', (d) => {
      out += String(d)
    })
    child.stderr?.on('data', (d) => {
      out += String(d)
    })
    child.once('error', () => {
      clearTimeout(timer)
      resolve({ out, code: null })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ out, code })
    })
  })
}

/** Latency from the system ping, in ms. Output wording differs per platform. */
function parsePingLatency(out: string): number | undefined {
  // Windows: "time=12ms" or "time<1ms"; POSIX: "time=12.3 ms"
  const m = out.match(/time[=<]\s*([0-9]+(?:\.[0-9]+)?)\s*ms/i)
  if (m) return Number(m[1])
  // POSIX summary line: "rtt min/avg/max/mdev = 12.3/12.4/12.5/0.1 ms"
  const avg = out.match(/=\s*[0-9.]+\/([0-9.]+)\//)
  return avg ? Number(avg[1]) : undefined
}

export async function probePing(host: string, timeoutMs?: number): Promise<PingProbeResult> {
  const bad = checkTarget(host)
  if (bad) return { ok: false, error: bad }
  const timeout = clampTimeout(timeoutMs)
  const isWin = process.platform === 'win32'
  const args = isWin
    ? ['-n', '1', '-w', String(timeout), host]
    : ['-c', '1', '-W', String(Math.ceil(timeout / 1000)), host]

  const { out, code } = await run('ping', args, timeout + 1500)
  const latencyMs = parsePingLatency(out)
  // Windows ping exits 0 even for "Destination host unreachable", so the
  // presence of a latency reading is the signal, not the exit code.
  if (latencyMs !== undefined) return { ok: true, latencyMs }
  if (code === null) return { ok: false, error: 'ping unavailable or timed out' }
  return { ok: false, error: 'no reply' }
}

/** Hop list from tracert/traceroute output, best-effort across platforms. */
function parseTraceroute(out: string): TracerouteHop[] {
  const hops: TracerouteHop[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d{1,2})\s+(.*)$/)
    if (!m) continue
    const hop = Number(m[1])
    if (hop < 1 || hop > MAX_HOPS) continue
    const rest = m[2]
    const timedOut = /^\s*(\*\s*)+/.test(rest) && !/[0-9]+\s*ms/i.test(rest)
    const lat = rest.match(/([0-9]+(?:\.[0-9]+)?)\s*ms/i)
    const hostMatch = rest.match(/([a-z0-9][a-z0-9.-]*\.[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})/i)
    hops.push({
      hop,
      host: hostMatch ? hostMatch[1] : undefined,
      latencyMs: lat ? Number(lat[1]) : undefined,
      timedOut
    })
  }
  return hops
}

/**
 * Traceroute-lite: enough hops to attach to a support ticket, not a diagnostic
 * suite. Capped at 20 hops because the interesting part of a bad path is always
 * near the start, and an uncapped trace to an unreachable host takes minutes.
 */
export async function traceroute(host: string, maxHops?: number): Promise<TracerouteHop[]> {
  if (checkTarget(host)) return []
  const hops = Math.max(1, Math.min(Number(maxHops) || 15, MAX_HOPS))
  const isWin = process.platform === 'win32'
  const args = isWin
    ? ['-d', '-h', String(hops), '-w', '1500', host]
    : ['-n', '-m', String(hops), '-w', '2', host]
  const { out } = await run(isWin ? 'tracert' : 'traceroute', args, hops * 3000 + 5000)
  return parseTraceroute(out)
}
