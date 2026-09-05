import { useEffect, useState, useSyncExternalStore } from 'react'
import type { components } from '@shared/api/schema'
import type { LocalSshKey } from '@shared/ipc-types'
import { HelpLink } from '../ui/HelpLink'
import { primaryIpv4 } from '../../lib/deeplinks'
import { launchSsh } from '../../lib/launchSsh'
import { OPEN_SSH_EVENT, prefersNativeTerminal, setPreferNativeTerminal, takePendingSsh, type OpenSshOptions } from '../../lib/openSsh'
import { createTerminal, closeTerminal, initializeTerminals, recallOpenSessions, enableSessionMemory, finalizeSessionMemory, subscribeTerminals, terminalSnapshot, type TerminalSession } from '../../lib/terminalSessions'
import { TerminalTab } from './TerminalTab'
import { BroadcastPanel } from './BroadcastPanel'

const field = 'min-w-0 max-w-full rounded bg-[#343a40] px-2 py-1.5 border border-[#495057]'
export function TerminalView({ servers, profileId, active, onActivate }: {
  servers: components['schemas']['Server'][]; profileId?: string; active: boolean; onActivate: () => void
}) {
  const sessions = useSyncExternalStore(subscribeTerminals, terminalSnapshot)
  const tabs = sessions.filter((s) => !s.broadcast)
  const [selected, setSelected] = useState('')
  const [host, setHost] = useState('')
  const [username, setUsername] = useState('root')
  const [port, setPort] = useState('22')
  const [key, setKey] = useState('')
  const [keys, setKeys] = useState<LocalSshKey[]>([])
  const [native, setNative] = useState(prefersNativeTerminal)
  const [connecting, setConnecting] = useState(false)
  const [connectBar, setConnectBar] = useState(true)
  const [broadcast, setBroadcast] = useState(false)
  const [broadcastOpened, setBroadcastOpened] = useState(false)
  const [error, setError] = useState('')
  const [failedOptions, setFailedOptions] = useState<OpenSshOptions>()
  const [reopen, setReopen] = useState(recallOpenSessions)
  const connection = { username: username || 'root', port: Number(port), privateKeyPath: key || undefined }
  async function connect(options: OpenSshOptions) {
    setError(''); setFailedOptions(undefined); setConnecting(true)
    try {
      const server = servers.find((s) => s.id === options.serverId || primaryIpv4(s) === options.host)
      const id = await createTerminal({ ...options, serverId: options.serverId ?? server?.id, serverName: options.serverName ?? server?.name, cols: 80, rows: 24 })
      setSelected(id); setConnectBar(false); setBroadcast(false)
      if (!reopen.length) enableSessionMemory()
    } catch (error) { setError(String(error)); setFailedOptions(options) }
    finally { setConnecting(false) }
  }
  useEffect(() => {
    void initializeTerminals().then(() => {
      const existing = terminalSnapshot().filter((s) => !s.broadcast)
      if (existing.length) { setReopen([]); setSelected(existing[0].id); enableSessionMemory() }
      else if (!reopen.length) enableSessionMemory()
    }).catch((e) => setError(String(e)))
    void window.bldeskApi.getLocalSshKeys().then(setKeys).catch((e) => setError(String(e)))
  }, [])
  useEffect(() => {
    window.addEventListener('beforeunload', finalizeSessionMemory)
    return () => window.removeEventListener('beforeunload', finalizeSessionMemory)
  }, [])
  useEffect(() => {
    const open = (event: Event) => { event.preventDefault(); onActivate(); void connect((event as CustomEvent<OpenSshOptions>).detail) }
    window.addEventListener(OPEN_SSH_EVENT, open)
    for (const options of takePendingSsh()) { onActivate(); void connect(options) }
    return () => window.removeEventListener(OPEN_SSH_EVENT, open)
  })
  async function close(s: TerminalSession) {
    try { await closeTerminal(s.id); if (selected === s.id) setSelected(tabs.find((t) => t.id !== s.id)?.id || '') }
    catch (e) { setError(String(e)) }
  }
  async function reopenAll() {
    const remembered = reopen
    setReopen([])
    // Host and user are shown for review. Keys and nonstandard ports are never restored.
    await Promise.all(remembered.map((s) => connect(s)))
    enableSessionMemory()
  }
  return <div className="h-full min-h-0 min-w-0 flex flex-col bg-[#212529] text-[#f8f9fa]" data-testid="terminal-view">
    <header className="shrink-0 max-h-[45%] overflow-auto border-b border-[#495057] p-2 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-3"><h1 className="font-bold">Embedded SSH</h1><HelpLink slug="terminal" />
        <button onClick={() => { setConnectBar((v) => !v); setBroadcast(false) }} aria-label="New SSH session">+ Connect</button>
        <button onClick={() => { setBroadcastOpened(true); setBroadcast((v) => !v) }}>Broadcast</button>
        <label className="flex gap-1 items-center"><input type="checkbox" checked={native} onChange={(e) => { setNative(e.target.checked); setPreferNativeTerminal(e.target.checked) }} />Prefer native terminal</label>
      </div>
      {!!reopen.length && <div className="rounded border border-[#017cb6] p-2 space-y-2" aria-label="Reopen SSH sessions">
        <p>Reopen previous SSH tabs? Nothing connects until you choose Reopen. Uses default SSH port/configuration and identities; select a custom key or port in the connect bar instead if needed.</p>
        <ul>{reopen.map((s, i) => <li key={i}>{s.serverName} — {s.username}@{s.host}</li>)}</ul>
        <button disabled={connecting} onClick={() => void reopenAll()} className="mr-3">Reopen {reopen.length} sessions</button>
        <button onClick={() => { setReopen([]); enableSessionMemory() }}>Dismiss</button>
      </div>}
      {connectBar && <form onSubmit={(e) => { e.preventDefault(); void connect({ ...connection, host }) }} className="flex flex-wrap items-end gap-2">
        <label className="min-w-0">Server<select aria-label="SSH server" value="" className={`${field} block w-44`} onChange={(e) => { const s = servers.find((s) => s.id === Number(e.target.value)); if (s) setHost(primaryIpv4(s) || '') }}><option value="">Choose a server…</option>{servers.map((s) => <option key={s.id} value={s.id} disabled={!primaryIpv4(s)}>{s.name}</option>)}</select></label>
        <label>User<input aria-label="SSH user" className={`${field} block w-24`} value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label className="min-w-0">Host<input aria-label="SSH host" className={`${field} block w-44`} value={host} onChange={(e) => setHost(e.target.value)} required /></label>
        <label>Port<input aria-label="SSH port" className={`${field} block w-20`} type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} /></label>
        <label className="min-w-0">Key<select aria-label="SSH key" className={`${field} block w-44`} value={key} onChange={(e) => setKey(e.target.value)}><option value="">Default SSH identities</option>{keys.filter((k) => k.privateKeyPath).map((k) => <option key={k.privateKeyPath} value={k.privateKeyPath}>{k.name}</option>)}</select></label>
        <button disabled={!host || connecting} className="rounded bg-[#017cb6] px-3 py-1.5 disabled:opacity-50" type="submit">Connect in BLDesk</button>
        <button disabled={!host} type="button" className="py-1.5" onClick={() => void launchSsh({ ...connection, host })}>Open in native terminal</button>
      </form>}
      {error && <div role="alert" className="text-rose-300 break-words">{error}{failedOptions && <button className="ml-3 underline" onClick={() => void launchSsh(failedOptions)}>Open in native terminal</button>}</div>}
    </header>
    <div className="shrink-0 flex overflow-x-auto border-b border-[#495057] text-xs" role="tablist" aria-label="SSH sessions">
      {tabs.map((s) => <div key={s.id} className={`shrink-0 flex items-center gap-2 p-2 ${selected === s.id && !broadcast ? 'bg-[#343a40]' : ''}`}>
        <button role="tab" aria-selected={selected === s.id && !broadcast} onClick={() => { setSelected(s.id); setBroadcast(false) }} title={`${s.username}@${s.host}`}>
          <span className={s.status === 'exited' ? 'text-slate-400' : s.status === 'connecting' ? 'text-amber-300' : 'text-emerald-300'}>●</span> {s.serverName} · {s.status === 'exited' ? `exit ${s.exitCode ?? 'unknown'}` : s.status}
        </button><button disabled={s.status === 'connecting'} aria-label={`Close SSH ${s.serverName}`} onClick={() => void close(s)}>×</button>
      </div>)}
    </div>
    <div className="flex-1 min-h-0 relative">
      {tabs.map((s) => <div key={s.id} className={selected === s.id && !broadcast ? 'absolute inset-0' : 'hidden'}><TerminalTab session={s} active={active && selected === s.id && !broadcast} onClose={() => void close(s)} onReconnect={() => {
        void close(s).then(() => connect(s.options ?? { host: s.host, username: s.username, serverId: s.serverId, serverName: s.serverName }))
      }} /></div>)}
      {broadcastOpened && <div className={broadcast ? 'absolute inset-0' : 'hidden'}><BroadcastPanel servers={servers} profileId={profileId} connection={connection} onClose={() => { setBroadcast(false); setBroadcastOpened(false) }} /></div>}
      {!tabs.length && !broadcast && <div className="p-4 text-sm text-[#adb5bd]">Open SSH here, from a server, or with <code>ssh &lt;server&gt;</code> in the palette. Tabs stay connected while you use other views. “Live” means the SSH process is running; authentication may still be required.</div>}
    </div>
  </div>
}
