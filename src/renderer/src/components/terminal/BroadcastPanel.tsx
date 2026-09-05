import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { components } from '@shared/api/schema'
import type { TerminalLaunchOptions } from '@shared/ipc-types'
import { useConfirm } from '../../context/ConfirmContext'
import { updateChange } from '../../lib/changelog'
import { primaryIpv4 } from '../../lib/deeplinks'
import { loadGroups, loadTags, GROUPS_EVENT } from '../../lib/serverGroups'
import { broadcastTargets, createTerminal, closeTerminal, subscribeTerminals, terminalSnapshot } from '../../lib/terminalSessions'
import { TerminalTab } from './TerminalTab'

type Result = { name: string; id?: string; error?: string }
export function BroadcastPanel({ servers, profileId, connection, onClose }: {
  servers: components['schemas']['Server'][]; profileId?: string; connection: Omit<TerminalLaunchOptions, 'host'>; onClose: () => void
}) {
  const confirmAction = useConfirm()
  const sessions = useSyncExternalStore(subscribeTerminals, terminalSnapshot)
  const [expression, setExpression] = useState('')
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [notice, setNotice] = useState('')
  const [, refreshGroups] = useState(0)
  const run = useRef<{ changeId?: string; profileId: string; results: Result[]; starting: boolean; settled: boolean }>()
  const alive = useRef(true)
  const targets = broadcastTargets(expression, servers, loadTags(profileId), loadGroups(profileId))
  useEffect(() => {
    const changed = () => refreshGroups((n) => n + 1)
    window.addEventListener(GROUPS_EVENT, changed)
    return () => window.removeEventListener(GROUPS_EVENT, changed)
  }, [])
  useEffect(() => {
    alive.current = true
    const unloading = () => {
      const current = run.current
      if (current && !current.settled) void updateChange(current.changeId, { outcome: 'lost', detail: 'Renderer closed or reloaded before broadcast results were collected. Remote commands may still be running.' }, current.profileId)
    }
    window.addEventListener('beforeunload', unloading)
    return () => {
      window.removeEventListener('beforeunload', unloading)
      alive.current = false
      const current = run.current
      if (!current) return
      current.results.forEach((r) => { if (r.id) void closeTerminal(r.id) })
      if (!current.settled) {
        current.settled = true
        void updateChange(current.changeId, { outcome: 'lost', detail: 'Broadcast panel closed; SSH connections closed. Remote commands may still be running.' }, current.profileId)
      }
    }
  }, [])
  useEffect(() => {
    const current = run.current
    if (!current || current.starting || current.settled) return
    const states = current.results.map((r) => ({ ...r, session: sessions.find((s) => s.id === r.id) }))
    if (states.some((r) => r.id && r.session?.status !== 'exited')) return
    current.settled = true
    setBusy(false)
    const failed = states.some((r) => r.error || r.session?.exitCode !== 0 || r.session?.signal)
    // Metadata only: remote stdout/stderr must never enter History.
    void updateChange(current.changeId, { outcome: failed ? 'errored' : 'completed',
      detail: states.map((r) => `${r.name}: ${r.error ? 'SSH launch failed' : `exit ${r.session?.exitCode}${r.session?.signal ? `, signal ${r.session.signal}` : ''}`}`).join('; ') }, current.profileId)
  }, [sessions, results])

  async function start() {
    if (busy || !profileId || !command.trim() || !targets.eligible.length) return
    setBusy(true)
    setNotice('')
    const account = profileId
    const hosts = targets.eligible.map(({ server }) => ({ serverId: server.id, serverName: server.name, host: primaryIpv4(server)! }))
    const cmd = command
    const options = { ...connection }
    try {
      const decision = await confirmAction({
        title: 'Broadcast SSH command', helpSlug: 'terminal', severity: 'destructive', logProfileId: account,
        target: { kind: 'server', name: expression },
        summary: `Run this command in parallel on ${hosts.length} servers: ${cmd}`,
        notes: ['The command text is saved in local History. Do not include secrets.', 'Closing SSH connections does not guarantee remote commands stop.',
          ...(targets.skipped.length || targets.unmatched.length ? [`Skipped: ${targets.skipped.map((s) => `${s.server.name} (${s.reason})`).join(', ') || 'none'}. Unmatched: ${targets.unmatched.join(', ') || 'none'}.`] : [])],
        changes: hosts.map((s) => ({ label: s.serverName, to: `${options.username || 'root'}@${s.host}` })),
        typeToConfirm: hosts.length > 5 ? expression : undefined,
        confirmLabel: 'Run on all targets'
      })
      if (!decision.ok) { setBusy(false); return }
      if (!alive.current) {
        await updateChange(decision.changeId, { outcome: 'failed', detail: 'Broadcast panel closed before launch.' }, account)
        return
      }
      await Promise.all(results.map((r) => r.id ? closeTerminal(r.id) : undefined))
      const current = { changeId: decision.changeId, profileId: account, results: [] as Result[], starting: true, settled: false }
      run.current = current
      setResults([])
      await Promise.all(hosts.map(async (host) => {
        let result: Result
        try {
          const id = await createTerminal({ ...options, ...host, remoteCommand: cmd, cols: 80, rows: 12 })
          result = { name: host.serverName, id }
          if (!alive.current) void closeTerminal(id)
        } catch (error) { result = { name: host.serverName, error: String(error) } }
        current.results.push(result)
        if (alive.current) setResults([...current.results])
      }))
      current.starting = false
      if (alive.current) setResults([...current.results])
    } catch (error) { setNotice(String(error)); setBusy(false) }
  }
  return <section className="h-full overflow-auto p-3 space-y-3 text-xs" aria-label="Broadcast SSH">
    <div className="flex flex-wrap gap-3 items-center"><h2 className="font-bold">Broadcast SSH</h2><button disabled={busy && !run.current} onClick={onClose}>Close broadcast</button></div>
    <p>Parallel remote commands. User, port and key come from the connect bar. Answer authentication prompts in each pane. Command text is saved in History; output is not.</p>
    <label className="block">Targets<input aria-label="Broadcast targets" disabled={busy} className="block w-full rounded bg-[#343a40] p-2" placeholder="wp-*, @web, #123" value={expression} onChange={(e) => setExpression(e.target.value)} /></label>
    <div aria-label="Target preview" className="max-h-28 overflow-auto break-words">
      <p>Eligible ({targets.eligible.length}): {targets.eligible.map((s) => s.server.name).join(', ') || 'none'}</p>
      <p>Skipped ({targets.skipped.length}): {targets.skipped.map((s) => `${s.server.name} (${s.reason})`).join(', ') || 'none'}</p>
      <p>Unmatched: {targets.unmatched.join(', ') || 'none'}</p>
    </div>
    <label className="block">Command<textarea aria-label="Broadcast command" rows={2} maxLength={32768} disabled={busy} className="block w-full rounded bg-[#343a40] p-2 font-mono" value={command} onChange={(e) => setCommand(e.target.value)} /></label>
    <button className="px-3 py-2 bg-rose-700 rounded disabled:opacity-50" disabled={busy || !profileId || !targets.eligible.length || !command.trim()} onClick={() => void start()}>{busy ? 'Broadcast in progress' : 'Run broadcast'}</button>
    {!profileId && <p>Select an account to record broadcast commands in History.</p>}
    {notice && <p role="alert">{notice}</p>}
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      {results.map((r) => {
        const s = sessions.find((s) => s.id === r.id)
        const status = r.error ? 'launch failed' : s?.status === 'exited' ? `exit ${s.exitCode}${s.signal ? `, signal ${s.signal}` : ''}` : 'running / authentication'
        return <div key={r.name + (r.id || '')} className="min-w-0 border border-[#495057] rounded overflow-hidden">
          <div className="p-2 flex flex-wrap justify-between gap-2"><span>{r.name}</span><span className={r.error || (s?.status === 'exited' && (s.exitCode !== 0 || s.signal)) ? 'text-rose-300' : s?.status === 'exited' ? 'text-emerald-300' : 'text-amber-300'}>{status}</span></div>
          {r.error ? <p role="alert" className="p-2 break-words">{r.error}</p> : s && <div className="h-64"><TerminalTab session={s} active={false} /></div>}
        </div>
      })}
    </div>
  </section>
}
