import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ExternalLink, Terminal, Link2, Copy, RotateCw, Power, Play, Radio, ShieldAlert, ShieldCheck } from 'lucide-react'
import { components } from '@shared/api/schema'
import { formatDeepLink } from '@shared/deeplink'
import { primaryIpv4 } from '../../lib/deeplinks'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import type { ServerOperationClass } from '@shared/binarylane-policy'
import { remoteServiceProbeForImage } from '@shared/remote-service'

type ServerResponse = components['schemas']['Server']

export interface ContextMenuState {
  server: ServerResponse
  x: number
  y: number
}

interface ServerContextMenuProps {
  state: ContextMenuState
  onClose: () => void
  onOpen: (server: ServerResponse) => void
  onSsh: (serverId: number, ip: string) => void
  onCopyLink: (serverId: number) => void
  onAction: (serverId: number, type: 'power_on' | 'reboot' | 'power_cycle' | 'shutdown') => void
  actionInProgress: boolean
}

/**
 * Lightweight in-renderer context menu for a server row. Rendered fixed at the
 * click point, nudged back on-screen if it would overflow, closed on outside
 * click / Escape / scroll.
 */
export const ServerContextMenu: React.FC<ServerContextMenuProps> = ({
  state,
  onClose,
  onOpen,
  onSsh,
  onCopyLink,
  onAction,
  actionInProgress
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: state.x, y: state.y })
  const { server } = state
  const ip = primaryIpv4(server)
  const isRunning = server.status === 'active'
  const { serverSafetyLevel, serverActionBlockReason } = useProfileSafety()
  const safetyLevel = serverSafetyLevel(server.id)
  const locked = safetyLevel === 'locked'
  const maintenance = safetyLevel === 'maintenance'
  const supportsNativeSsh = remoteServiceProbeForImage(server.image).kind === 'ssh'
  const remoteBlockReason = serverActionBlockReason(server.id, 'remote-access')
  const rebootBlockReason = serverActionBlockReason(server.id, 'reboot')
  const powerCycleBlockReason = serverActionBlockReason(server.id, 'power-cycle')
  const mutationBlockReason = serverActionBlockReason(server.id, 'mutation')

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { innerWidth, innerHeight } = window
    const r = el.getBoundingClientRect()
    setPos({
      x: state.x + r.width > innerWidth - 8 ? Math.max(8, state.x - r.width) : state.x,
      y: state.y + r.height > innerHeight - 8 ? Math.max(8, innerHeight - r.height - 8) : state.y
    })
  }, [state.x, state.y])

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', onClose, true)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', onClose, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }

  const runServerAction = (operation: ServerOperationClass, fn: () => void) => () => {
    const blockReason = serverActionBlockReason(server.id, operation)
    if (blockReason) return
    onClose()
    fn()
  }

  const item =
    'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[60] w-56 p-1 bg-white dark:bg-[#2b3035] text-[#212529] dark:text-[#f8f9fa] border border-[#ced4da] dark:border-[#373b3e] rounded-md shadow-xl select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[#6c757d] dark:text-slate-400 border-b border-[#ced4da]/60 dark:border-[#373b3e] mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{server.name}</span>
          <span className="font-mono font-normal shrink-0">#{server.id}</span>
          <span
            data-safety-level={safetyLevel}
            data-safety-protected-server={locked ? 'true' : undefined}
            title={locked ? 'Read-only views and diagnostics are allowed; changes and remote access are blocked.' : maintenance ? 'Operational access, firewall rules, diagnostics, power recovery, and a non-replacing temporary backup are allowed; structural changes are blocked.' : 'Normal BLDesk server actions are available.'}
            className={`ml-auto shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
              locked
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                : maintenance
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
            }`}
          >
            {locked ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
            {locked ? 'Read-only' : maintenance ? 'Maintenance' : 'Normal'}
          </span>
        </div>
      </div>

      <button className={item} onClick={run(() => onOpen(server))}>
        <ExternalLink className="w-3.5 h-3.5 text-[#017cb6]" /> Open
      </button>
      {supportsNativeSsh && (
        <button
          className={item}
          disabled={!ip || !!remoteBlockReason}
          title={remoteBlockReason ?? (!ip ? 'No public IPv4 address is available.' : 'Launch SSH as root')}
          onClick={runServerAction('remote-access', () => ip && onSsh(server.id, ip))}
        >
          <Terminal className="w-3.5 h-3.5 text-[#017cb6]" /> SSH as root
        </button>
      )}

      <div className="my-1 border-t border-[#ced4da]/60 dark:border-[#373b3e]" />

      <button className={item} disabled={!ip} onClick={run(() => ip && navigator.clipboard.writeText(ip))}>
        <Copy className="w-3.5 h-3.5" /> Copy IP {ip && <span className="ml-auto font-mono text-[10px] text-[#6c757d]">{ip}</span>}
      </button>
      <button className={item} onClick={run(() => onCopyLink(server.id))} title={formatDeepLink({ kind: 'server', serverId: server.id })}>
        <Link2 className="w-3.5 h-3.5" /> Copy bldesk:// link
      </button>
      <button
        className={item}
        onClick={run(() => navigator.clipboard.writeText(formatDeepLink({ kind: 'console', serverId: server.id })))}
        title={formatDeepLink({ kind: 'console', serverId: server.id })}
      >
        <Radio className="w-3.5 h-3.5" /> Copy console link
      </button>

      <div className="my-1 border-t border-[#ced4da]/60 dark:border-[#373b3e]" />

      {isRunning ? (
        <>
          <button
            className={item}
            disabled={actionInProgress || !!rebootBlockReason}
            title={rebootBlockReason ?? 'Reboot server'}
            onClick={runServerAction('reboot', () => onAction(server.id, 'reboot'))}
          >
            <RotateCw className="w-3.5 h-3.5 text-amber-500" /> Reboot…
          </button>
          <button
            className={item}
            disabled={actionInProgress || !!powerCycleBlockReason}
            title={powerCycleBlockReason ?? 'Hard power cycle server'}
            onClick={runServerAction('power-cycle', () => onAction(server.id, 'power_cycle'))}
          >
            <RotateCw className="w-3.5 h-3.5 text-rose-500" /> Power cycle…
          </button>
          <button
            className={item}
            disabled={actionInProgress || !!mutationBlockReason}
            title={mutationBlockReason ?? 'Shut down server'}
            onClick={runServerAction('mutation', () => onAction(server.id, 'shutdown'))}
          >
            <Power className="w-3.5 h-3.5 text-rose-500" /> Shutdown…
          </button>
        </>
      ) : (
        <button
          className={item}
          disabled={actionInProgress || !!mutationBlockReason}
          title={mutationBlockReason ?? 'Power on server'}
          onClick={runServerAction('mutation', () => onAction(server.id, 'power_on'))}
        >
          <Play className="w-3.5 h-3.5 text-emerald-500" /> Power on…
        </button>
      )}
    </div>
  )
}
