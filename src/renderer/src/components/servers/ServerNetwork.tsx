import React, { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  Cable,
  Check,
  Copy,
  Globe,
  Loader2,
  Network as NetworkIcon,
  Pencil,
  Plus,
  Shield,
  Trash2,
  X
} from 'lucide-react'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import { useIsMutating } from '@tanstack/react-query'
import {
  NetworkActionPayload,
  networkActionMutationKey,
  useNetworkActionMutation,
  useServer,
  useVpcs
} from '../../api/queries'
import { useConfirm } from '../../context/ConfirmContext'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import { updateChange } from '../../lib/changelog'
import { SafetyPolicyBadge } from '../ui/SafetyPolicyBadge'

type Server = components['schemas']['Server']
type Network = components['schemas']['Network']

interface ServerNetworkProps {
  client: BinaryLaneClient | null
  server: Server
  /** Keep reads and copy controls usable while disabling BinaryLane writes. */
  mutationBlockReason?: string | null
}

// ---------------------------------------------------------------------------
// Small presentational helpers (kept local: nothing else in the app needs them yet)
// ---------------------------------------------------------------------------

const Card: React.FC<{ title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  action,
  children
}) => (
  <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm overflow-hidden">
    <div className="px-4 py-3 bg-[#f1f1f1] dark:bg-[#262a2e] border-b border-[#ced4da] dark:border-[#373b3e] flex items-center justify-between gap-3">
      <h3 className="font-semibold text-xs text-[#495057] dark:text-[#ced4da] flex items-center gap-2">
        <span className="text-[#017cb6]">{icon}</span>
        <span>{title}</span>
      </h3>
      {action}
    </div>
    {children}
  </div>
)

const Row: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <div className="flex items-start justify-between gap-4 py-2.5 px-4 text-xs">
    <div className="w-44 flex-shrink-0">
      <div className="text-[#6c757d] dark:text-slate-400">{label}</div>
      {hint && <div className="text-[10px] text-[#adb5bd] dark:text-slate-500 mt-0.5 leading-snug">{hint}</div>}
    </div>
    <div className="flex-1 min-w-0 flex items-center justify-end gap-2 text-[#212529] dark:text-white">{children}</div>
  </div>
)

const Switch: React.FC<{ checked: boolean; disabled?: boolean; disabledReason?: string | null; onChange: (next: boolean) => void; label: string }> = ({
  checked,
  disabled,
  disabledReason,
  onChange,
  label
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    title={disabledReason ?? undefined}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed ${
      checked ? 'bg-[#017cb6]' : 'bg-[#ced4da] dark:bg-[#495057]'
    }`}
  >
    <span
      className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition ${
        checked ? 'translate-x-[18px]' : 'translate-x-0.5'
      }`}
    />
  </button>
)

const Badge: React.FC<{ tone: 'public' | 'private' | 'warn' | 'muted'; children: React.ReactNode }> = ({ tone, children }) => {
  const tones = {
    public: 'bg-[#017cb6]/10 text-[#017cb6] border-[#017cb6]/30',
    private: 'bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/30',
    warn: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
    muted: 'bg-[#e9ecef] dark:bg-[#343a40] text-[#6c757d] dark:text-slate-400 border-[#ced4da] dark:border-[#373b3e]'
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${tones[tone]}`}>
      {children}
    </span>
  )
}

const CopyButton: React.FC<{ text: string; copied: string | null; onCopy: (t: string) => void }> = ({ text, copied, onCopy }) => (
  <button onClick={() => onCopy(text)} className="text-[#6c757d] hover:text-[#017cb6]" title="Copy" aria-label={`Copy ${text}`}>
    {copied === text ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
  </button>
)

const inputClass =
  'px-2 py-1 text-xs font-mono rounded border border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#212529] text-[#212529] dark:text-white focus:outline-none focus:border-[#017cb6] min-w-0'

const primaryBtn =
  'px-3 py-1.5 text-xs font-medium rounded transition border text-white bg-[#017cb6] border-[#017cb6] hover:bg-[#016594] disabled:opacity-50 disabled:cursor-not-allowed'
const subtleBtn =
  'px-2.5 py-1 text-xs font-medium rounded transition border text-[#017cb6] bg-[#017cb6]/10 border-[#017cb6]/30 hover:bg-[#017cb6]/20 disabled:opacity-50 disabled:cursor-not-allowed'

/** Inline "value → pencil → input + save/cancel" editor for a single string field. */
const InlineEdit: React.FC<{
  value: string
  placeholder: string
  disabled?: boolean
  disabledReason?: string | null
  mono?: boolean
  onSave: (next: string) => void
  onClear?: () => void
}> = ({ value, placeholder, disabled, disabledReason, mono = true, onSave, onClear }) => {
  const [editing, setEditing] = useState(false)
  // Seeded when the editor opens, never resynced while open: the server query polls every
  // 10s and must not clobber what the user is typing.
  const [draft, setDraft] = useState(value)

  if (!editing) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className={`${mono ? 'font-mono' : ''} truncate ${value ? '' : 'text-[#adb5bd] dark:text-slate-500 italic'}`}>
          {value || placeholder}
        </span>
        <button
          onClick={() => {
            setDraft(value)
            setEditing(true)
          }}
          disabled={disabled}
          className="text-[#6c757d] hover:text-[#017cb6] disabled:opacity-50"
          title={disabledReason ?? 'Edit'}
          aria-label={`Edit ${placeholder}`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        {value && onClear && (
          <button
            onClick={onClear}
            disabled={disabled}
            className="text-[#6c757d] hover:text-rose-500 disabled:opacity-50"
            title={disabledReason ?? 'Clear'}
            aria-label={`Clear ${placeholder}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    )
  }

  // While another action is in flight the editor stays open but inert, so a save can't be
  // silently dropped by the parent's busy guard.
  const commit = () => {
    if (disabled) return
    const next = draft.trim()
    setEditing(false)
    if (next && next !== value) onSave(next)
  }

  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
      <input
        autoFocus
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        placeholder={placeholder}
        className={`${inputClass} flex-1 max-w-[280px] disabled:opacity-50`}
      />
      <button
        onClick={commit}
        disabled={disabled}
        className="text-emerald-600 hover:text-emerald-500 disabled:opacity-50"
        title="Save"
        aria-label="Save"
      >
        <Check className="w-4 h-4" />
      </button>
      <button onClick={() => setEditing(false)} className="text-[#6c757d] hover:text-rose-500" title="Cancel" aria-label="Cancel">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const ServerNetwork: React.FC<ServerNetworkProps> = ({ client, server: initialServer, mutationBlockReason = null }) => {
  // The `server` prop is a snapshot from the list; poll the real thing so edits show up.
  const serverQuery = useServer(client, initialServer.id)
  const server: Server = serverQuery.data || initialServer
  const vpcsQuery = useVpcs(client)
  const action = useNetworkActionMutation(client, server.id)
  const { resourceActionBlockReason, resourceSafetyLevel } = useProfileSafety()

  const [copied, setCopied] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [vpcChoice, setVpcChoice] = useState<string>(server.vpc_id ? String(server.vpc_id) : '')
  const [vpcChoiceDirty, setVpcChoiceDirty] = useState(false)
  const [newNameserver, setNewNameserver] = useState('')

  // Follow background changes to the server's VPC — unless the user has picked something
  // they haven't submitted yet. If the server catches up to that pick (e.g. a move that
  // timed out here but completed remotely), the selection is no longer "unsubmitted".
  useEffect(() => {
    const current = server.vpc_id ? String(server.vpc_id) : ''
    if (!vpcChoiceDirty) {
      setVpcChoice(current)
    } else if (vpcChoice === current) {
      setVpcChoiceDirty(false)
    }
  }, [server.vpc_id, vpcChoice, vpcChoiceDirty])

  const networks = server.networks
  const v4 = networks?.v4 ?? []
  const v6 = networks?.v6 ?? []
  const publicV4 = v4.filter((n) => n.type === 'public')
  const privateV4 = v4.filter((n) => n.type === 'private')
  const ipv6Enabled = v6.length > 0
  const reverseNameservers = networks?.ipv6_reverse_nameservers ?? []
  const vpcs = vpcsQuery.data ?? []
  const currentVpc = server.vpc_id ? vpcs.find((v) => v.id === server.vpc_id) : undefined
  // Count from the mutation cache, not just this hook instance: an action started before a
  // tab switch is still running when the tab remounts, and must still block new submissions.
  const mutatingElsewhere = useIsMutating({ mutationKey: networkActionMutationKey(server.id) })
  const busy = action.isPending || mutatingElsewhere > 0
  const mutationControlsDisabled = busy || !!mutationBlockReason

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 1500)
  }

  // Synchronous re-entry lock: `action.isPending` only flips after a render, so two clicks in the
  // same tick (or a click during the confirm dialog of another) could otherwise both submit.
  const confirmAction = useConfirm()
  const inFlight = useRef(false)
  const mutationBlockReasonRef = useRef<string | null>(mutationBlockReason)
  mutationBlockReasonRef.current = mutationBlockReason
  const resourceActionBlockReasonRef = useRef(resourceActionBlockReason)
  resourceActionBlockReasonRef.current = resourceActionBlockReason
  const currentVpcIdRef = useRef<number | null>(server.vpc_id ?? null)
  currentVpcIdRef.current = server.vpc_id ?? null

  const vpcMembershipBlockReason = (
    targetVpcId: number | null,
    currentVpcId = server.vpc_id ?? null,
    getResourceReason = resourceActionBlockReason,
    serverReason = mutationBlockReason
  ): string | null => {
    if (targetVpcId !== null) {
      const targetReason = getResourceReason('vpc', targetVpcId, 'maintenance')
      if (targetReason) return targetReason
    }
    if (serverReason) return serverReason
    return currentVpcId !== null && currentVpcId !== targetVpcId
      ? getResourceReason('vpc', currentVpcId, 'maintenance')
      : null
  }

  const currentVpcAddressBlockReason = (
    currentVpcId = server.vpc_id ?? null,
    getResourceReason = resourceActionBlockReason,
    serverReason = mutationBlockReason
  ): string | null => {
    if (serverReason) return serverReason
    return currentVpcId !== null
      ? getResourceReason('vpc', currentVpcId, 'maintenance')
      : 'The server is no longer attached to a VPC.'
  }

  const selectedTargetVpc = vpcChoice
    ? vpcs.find((vpc) => String(vpc.id) === vpcChoice)
    : undefined
  const unresolvedTargetVpc = vpcChoice !== '' && !selectedTargetVpc
  const selectedMoveBlockReason = unresolvedTargetVpc
    ? 'The selected VPC is no longer available. Choose a current destination.'
    : vpcMembershipBlockReason(selectedTargetVpc?.id ?? null)
  const currentVpcMutationBlockReason = server.vpc_id
    ? currentVpcAddressBlockReason()
    : null
  const currentVpcAddressBlockReasonNow = (): string | null => currentVpcAddressBlockReason(
    currentVpcIdRef.current,
    resourceActionBlockReasonRef.current,
    mutationBlockReasonRef.current
  )
  const vpcMembershipBlockReasonNow = (targetVpcId: number | null): string | null => vpcMembershipBlockReason(
    targetVpcId,
    currentVpcIdRef.current,
    resourceActionBlockReasonRef.current,
    mutationBlockReasonRef.current
  )

  /**
   * Confirm, run, poll, and report — every mutation on this tab goes through here.
   * Resolves true only when BinaryLane reported the action completed.
   */
  const run = async (
    label: string,
    payload: NetworkActionPayload,
    confirmText: string,
    extraBlockReason?: () => string | null
  ): Promise<boolean> => {
    const blockReason = (): string | null => extraBlockReason?.() ?? mutationBlockReasonRef.current
    const initialBlockReason = blockReason()
    if (initialBlockReason) {
      setError(initialBlockReason)
      return false
    }
    if (inFlight.current || busy) return false
    inFlight.current = true
    try {
      const c = await confirmAction({
        title: label,
        target: { kind: 'server', id: server.id, name: server.name },
        summary: confirmText,
        severity: 'normal'
      })
      if (!c.ok) return false
      const latestBlockReason = blockReason()
      if (latestBlockReason) {
        void updateChange(c.changeId, {
          outcome: 'failed',
          detail: `Blocked locally before the request was sent: ${latestBlockReason}`
        })
        setError(latestBlockReason)
        return false
      }
      setError(null)
      setNotice(null)
      setPending(label)
      try {
        const done = await action.mutateAsync(payload)
        void updateChange(c.changeId, { outcome: 'completed', actionId: done?.id })
      } catch (err) {
        void updateChange(c.changeId, { outcome: 'failed', detail: err instanceof Error ? err.message : String(err) })
        throw err
      }
      setNotice(`${label} — done.`)
      window.bldeskApi?.sendNotification?.({ title: `Network: ${server.name}`, body: `${label} completed.` })
      return true
    } catch (err: any) {
      setError(`${label} failed: ${err?.message || 'Unknown error'}`)
      return false
    } finally {
      setPending(null)
      inFlight.current = false
    }
  }

  const renderNetworkRow = (n: Network, family: 'v4' | 'v6') => {
    const isPrivate = n.type === 'private'
    return (
      <tr key={`${family}-${n.ip_address}`} className="align-top">
        <td className="py-2.5 px-4 whitespace-nowrap">
          <Badge tone={isPrivate ? 'private' : 'public'}>{n.type}</Badge>
          <span className="ml-1.5 text-[10px] text-[#6c757d] dark:text-slate-500 uppercase">{family}</span>
        </td>
        <td className="py-2.5 px-4">
          <div className="flex items-center gap-2 font-mono text-[#212529] dark:text-white">
            <span className="truncate max-w-[260px]" title={n.ip_address}>
              {n.ip_address}
            </span>
            {n.netmask !== null && n.netmask !== undefined && (
              <span className="text-[#6c757d] dark:text-slate-500" title="Netmask">
                {typeof n.netmask === 'number' || /^\d{1,3}$/.test(String(n.netmask))
                  ? `/${n.netmask}`
                  : `mask ${n.netmask}`}
              </span>
            )}
            <CopyButton text={n.ip_address} copied={copied} onCopy={handleCopy} />
          </div>
          {isPrivate && family === 'v4' && server.vpc_id && (
            <div className="mt-1 text-[10px] text-[#6c757d] dark:text-slate-500 flex items-center gap-1">
              <span>Change address:</span>
              <InlineEdit
                value=""
                placeholder="new private IPv4"
                disabled={busy || !!currentVpcMutationBlockReason}
                disabledReason={currentVpcMutationBlockReason}
                onSave={(next) =>
                  run(
                    `Change VPC IPv4 ${n.ip_address} → ${next}`,
                    { type: 'change_vpc_ipv4', current_ipv4_address: n.ip_address, new_ipv4_address: next },
                    `Change this server's private VPC address from ${n.ip_address} to ${next}? Existing connections on the old address will drop.`,
                    currentVpcAddressBlockReasonNow
                  )
                }
              />
            </div>
          )}
        </td>
        <td className="py-2.5 px-4 font-mono text-[#495057] dark:text-[#ced4da] whitespace-nowrap">{n.gateway || '—'}</td>
        <td className="py-2.5 px-4 min-w-[220px]">
          {!isPrivate && family === 'v4' ? (
            <InlineEdit
              value={n.reverse_name || ''}
              placeholder="no reverse DNS"
              disabled={mutationControlsDisabled}
              disabledReason={mutationBlockReason}
              onSave={(next) =>
                run(
                  `Set reverse DNS for ${n.ip_address}`,
                  { type: 'change_reverse_name', ipv4_address: n.ip_address, reverse_name: next },
                  `Set the reverse DNS (PTR) for ${n.ip_address} to "${next}"? Mail servers and other hosts will see this name for connections from this address.`
                )
              }
              onClear={() =>
                run(
                  `Clear reverse DNS for ${n.ip_address}`,
                  { type: 'change_reverse_name', ipv4_address: n.ip_address, reverse_name: null },
                  `Clear the custom reverse DNS name for ${n.ip_address}?`
                )
              }
            />
          ) : (
            <span className="font-mono text-[#495057] dark:text-[#ced4da] truncate block max-w-[260px]" title={n.reverse_name || ''}>
              {n.reverse_name || <span className="text-[#adb5bd] dark:text-slate-500">—</span>}
            </span>
          )}
        </td>
        <td className="py-2.5 px-4 font-mono text-[#495057] dark:text-[#ced4da] whitespace-nowrap">{n.nat_target || '—'}</td>
      </tr>
    )
  }

  return (
    <div className="space-y-6">
      {/* Status strips */}
      {mutationBlockReason && (
        <div
          role="status"
          data-safety-mutation-controls="blocked"
          className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs rounded flex items-start gap-2"
        >
          <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span><strong>Read-only network view.</strong> {mutationBlockReason} Addresses, status, and copy controls remain available.</span>
        </div>
      )}
      {pending && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300 text-xs rounded flex items-center gap-2"
        >
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
          <span>
            <span className="font-semibold">{pending}</span> — waiting for BinaryLane to apply the change…
          </span>
        </div>
      )}
      {!pending && mutatingElsewhere > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300 text-xs rounded flex items-center gap-2"
        >
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
          <span>A network change started earlier is still being applied — controls are locked until it finishes.</span>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="hover:underline flex-shrink-0">
            Dismiss
          </button>
        </div>
      )}
      {notice && !pending && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs rounded flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 flex-shrink-0" />
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice(null)} className="hover:underline flex-shrink-0">
            Dismiss
          </button>
        </div>
      )}
      {/* Top Status & DDoS Protection Overview */}
      <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] p-3.5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${networks?.recent_ddos ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-[#212529] dark:text-white">Edge DDoS Protection</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                networks?.recent_ddos
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${networks?.recent_ddos ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'}`} />
                {networks?.recent_ddos ? 'Active Attack Mitigation' : 'Active & Protected'}
              </span>
            </div>
            <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5">
              {networks?.recent_ddos
                ? 'BinaryLane hardware edge filters recently intercepted and scrubbed volumetric attack traffic targeting this server.'
                : 'Continuous hardware edge packet inspection and volumetric traffic scrubbing enabled.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto text-xs text-[#6c757d] dark:text-slate-400">
          <div className="text-right">
            <span className="text-[10px] block uppercase tracking-wider text-[#adb5bd] dark:text-slate-500">Primary MAC</span>
            <span className="font-mono text-xs text-[#212529] dark:text-slate-200">{networks?.mac_address || '—'}</span>
          </div>
        </div>
      </div>

      {/* 1. Interfaces */}
      <Card
        title="Network Interfaces"
        icon={<NetworkIcon className="w-4 h-4" />}
        action={
          serverQuery.isFetching ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#6c757d]" />
          ) : (
            <span className="text-[10px] text-[#6c757d] dark:text-slate-500">
              {v4.length + v6.length} address{v4.length + v6.length === 1 ? '' : 'es'}
            </span>
          )
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-[#6c757d] dark:text-slate-400 border-b border-[#ced4da]/60 dark:border-[#373b3e]">
                <th className="py-2 px-4 font-medium">Type</th>
                <th className="py-2 px-4 font-medium">Address</th>
                <th className="py-2 px-4 font-medium">Gateway</th>
                <th className="py-2 px-4 font-medium">Reverse DNS</th>
                <th className="py-2 px-4 font-medium">NAT target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
              {v4.map((n) => renderNetworkRow(n, 'v4'))}
              {v6.map((n) => renderNetworkRow(n, 'v6'))}
              {v4.length + v6.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 px-4 text-center text-[#6c757d] dark:text-slate-500">
                    No network interfaces reported for this server.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[#ced4da]/60 dark:border-[#373b3e] divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
          <Row label="MAC address" hint="Primary interface. Needed for ARP entries, VPC DHCP reservations and MAC-based licensing.">
            <span className="font-mono">{networks?.mac_address || '—'}</span>
            {networks?.mac_address && <CopyButton text={networks.mac_address} copied={copied} onCopy={handleCopy} />}
          </Row>
        </div>
      </Card>

      {/* 2. IPv6 */}
      <Card title="IPv6" icon={<Globe className="w-4 h-4" />}>
        <div className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
          <Row label="IPv6 connectivity" hint={ipv6Enabled ? 'A /64 is routed to this server.' : 'Enable to allocate a public IPv6 range.'}>
            <span className="text-[#6c757d] dark:text-slate-400">{ipv6Enabled ? 'Enabled' : 'Disabled'}</span>
            <Switch
              checked={ipv6Enabled}
              disabled={mutationControlsDisabled}
              disabledReason={mutationBlockReason}
              label="Toggle IPv6"
              onChange={(next) =>
                run(
                  next ? 'Enable IPv6' : 'Disable IPv6',
                  { type: 'change_ipv6', enabled: next },
                  next
                    ? `Enable IPv6 on ${server.name}? The server will be assigned a public IPv6 range.`
                    : `Disable IPv6 on ${server.name}? All IPv6 addresses will be removed and anything relying on them will stop working.`
                )
              }
            />
          </Row>
          {ipv6Enabled && (
            <Row
              label="IPv6 reverse nameservers"
              hint="Delegates reverse DNS for this server's IPv6 range to your own nameservers. Overrides the account-level list."
            >
              <div className="flex flex-col items-end gap-1.5 w-full">
                {reverseNameservers.length === 0 && (
                  <span className="text-[#adb5bd] dark:text-slate-500 italic">None — account-level nameservers apply</span>
                )}
                {reverseNameservers.map((ns) => (
                  <div key={ns} className="flex items-center gap-2">
                    <span className="font-mono">{ns}</span>
                    <button
                      disabled={mutationControlsDisabled}
                      title={mutationBlockReason ?? 'Remove'}
                      onClick={() =>
                        run(
                          `Remove reverse nameserver ${ns}`,
                          { type: 'change_ipv6_reverse_nameservers', ipv6_reverse_nameservers: reverseNameservers.filter((x) => x !== ns) },
                          `Remove ${ns} from this server's IPv6 reverse nameservers?`
                        )
                      }
                      className="text-[#6c757d] hover:text-rose-500 disabled:opacity-50"
                      aria-label={`Remove reverse nameserver ${ns}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const ns = newNameserver.trim()
                    if (!ns || reverseNameservers.includes(ns)) return
                    run(
                      `Add reverse nameserver ${ns}`,
                      { type: 'change_ipv6_reverse_nameservers', ipv6_reverse_nameservers: [...reverseNameservers, ns] },
                      `Add ${ns} as an IPv6 reverse nameserver for ${server.name}? Reverse DNS for this server's IPv6 range will be delegated to it.`
                    ).then((ok) => {
                      // Keep the typed value if the user cancelled the confirm or the action failed.
                      if (ok) setNewNameserver('')
                    })
                  }}
                >
                  <input
                    value={newNameserver}
                    onChange={(e) => setNewNameserver(e.target.value)}
                    placeholder="ns1.example.com"
                    disabled={mutationControlsDisabled}
                    title={mutationBlockReason ?? undefined}
                    className={`${inputClass} w-48`}
                  />
                  <button
                    type="submit"
                    disabled={mutationControlsDisabled || !newNameserver.trim()}
                    className={subtleBtn}
                    title={mutationBlockReason ?? 'Add nameserver'}
                    aria-label="Add reverse nameserver"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            </Row>
          )}
        </div>
      </Card>

      {/* 3. Port blocking & filtering */}
      <Card title="Port Blocking & Filtering" icon={<Shield className="w-4 h-4" />}>
        <div className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
          <Row
            label="Default port blocking"
            hint="Blocks outgoing SSH, SMTP and Remote Desktop (TCP 22, 25 and 3389) at BinaryLane's edge, so a compromised server can't be used for spam or brute-force attacks. Independent of the server firewall rules."
          >
            <span className="text-[#6c757d] dark:text-slate-400">{networks?.port_blocking ? 'Enabled' : 'Disabled'}</span>
            <Switch
              checked={!!networks?.port_blocking}
              disabled={mutationControlsDisabled}
              disabledReason={mutationBlockReason}
              label="Toggle default port blocking"
              onChange={(next) =>
                run(
                  next ? 'Enable port blocking' : 'Disable port blocking',
                  { type: 'change_port_blocking', enabled: next },
                  next
                    ? `Enable port blocking on ${server.name}? Outgoing connections on TCP 22, 25 and 3389 will be blocked at BinaryLane's edge — outbound mail from this server will stop.`
                    : `Disable port blocking on ${server.name}? Outgoing SSH, SMTP and RDP (TCP 22, 25, 3389) will be allowed; a compromised server could then be used for spam or brute-force attacks.`
                )
              }
            />
          </Row>
          <Row
            label="Source / destination check"
            hint="When on, the server can only send and receive packets addressed to its own IPs. Read-only — managed by BinaryLane support."
          >
            <span className="text-[#6c757d] dark:text-slate-400">
              {networks?.source_and_destination_check === null || networks?.source_and_destination_check === undefined
                ? 'Not reported'
                : networks.source_and_destination_check
                  ? 'Enabled'
                  : 'Disabled'}
            </span>
          </Row>
        </div>
      </Card>

      {/* 4. VPC */}
      <Card
        title="Virtual Private Cloud"
        icon={<Cable className="w-4 h-4" />}
        action={
          server.vpc_id ? (
            <span className="flex items-center gap-1.5">
              <Badge tone="private">VPC #{server.vpc_id}</Badge>
              <SafetyPolicyBadge
                scope="resource"
                resourceKind="vpc"
                resourceId={server.vpc_id}
                resourceLabel={currentVpc?.name || `VPC #${server.vpc_id}`}
              />
            </span>
          ) : (
            <Badge tone="muted">Public network</Badge>
          )
        }
      >
        <div className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
          <Row label="Current network">
            {server.vpc_id ? (
              <span>
                <span className="font-medium">{currentVpc?.name || `VPC #${server.vpc_id}`}</span>
                {currentVpc?.ip_range && <span className="ml-2 font-mono text-[#6c757d] dark:text-slate-400">{currentVpc.ip_range}</span>}
              </span>
            ) : (
              <span className="text-[#6c757d] dark:text-slate-400">Default public network for {server.region?.name || 'this region'}</span>
            )}
          </Row>
          <Row label="Move server" hint="Moves the private interface to another VPC, or back to the public network. Brief connectivity loss.">
            <select
              value={vpcChoice}
              disabled={mutationControlsDisabled || vpcsQuery.isLoading}
              title={mutationBlockReason ?? undefined}
              onChange={(e) => {
                setVpcChoice(e.target.value)
                setVpcChoiceDirty(e.target.value !== (server.vpc_id ? String(server.vpc_id) : ''))
              }}
              aria-label="Destination network"
              className={`${inputClass} font-sans w-56`}
            >
              <option value="">Public network (no VPC)</option>
              {vpcs.map((v) => (
                <option
                  key={v.id}
                  value={String(v.id)}
                  disabled={!!resourceActionBlockReason('vpc', v.id, 'maintenance')}
                >
                  {v.name} — {v.ip_range}
                  {resourceSafetyLevel('vpc', v.id) === 'locked'
                    ? ' — Read-only'
                    : resourceSafetyLevel('vpc', v.id) === 'maintenance'
                      ? ' — Maintenance'
                      : ''}
                </option>
              ))}
            </select>
            <button
              disabled={busy || !!selectedMoveBlockReason || vpcChoice === (server.vpc_id ? String(server.vpc_id) : '')}
              title={selectedMoveBlockReason ?? 'Move server'}
              onClick={() => {
                const target = vpcChoice ? vpcs.find((v) => String(v.id) === vpcChoice) : undefined
                if (vpcChoice && !target) {
                  setError('The selected VPC is no longer available. Choose a current destination.')
                  return
                }
                const dest = target ? `VPC "${target.name}" (${target.ip_range})` : 'the public network'
                run(
                  `Move to ${target ? target.name : 'public network'}`,
                  { type: 'change_network', vpc_id: target ? target.id : null },
                  `Move ${server.name} to ${dest}? Its private IP will change and existing private connections will drop.`,
                  () => vpcMembershipBlockReasonNow(target?.id ?? null)
                ).then((ok) => {
                  if (ok) setVpcChoiceDirty(false)
                })
              }}
              className={primaryBtn}
            >
              <span className="flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5" />
                Move
              </span>
            </button>
          </Row>
          {server.vpc_id && (
            <Row
              label="Separate private interface"
              hint="Adds a second NIC dedicated to VPC traffic instead of sharing the primary interface."
            >
              <span className="text-[#6c757d] dark:text-slate-400">
                {networks?.separate_private_network_interface ? 'Enabled' : 'Disabled'}
              </span>
              <Switch
                checked={!!networks?.separate_private_network_interface}
                disabled={mutationControlsDisabled}
                disabledReason={mutationBlockReason}
                label="Toggle separate private network interface"
                onChange={(next) =>
                  run(
                    next ? 'Enable separate private interface' : 'Disable separate private interface',
                    { type: 'change_separate_private_network_interface', enabled: next },
                    `${next ? 'Add' : 'Remove'} the dedicated private network interface on ${server.name}? The server's network configuration inside the OS may need updating.`
                  )
                }
              />
            </Row>
          )}
          {server.vpc_id && privateV4.length === 0 && (
            <Row label="Private address">
              <span className="text-[#adb5bd] dark:text-slate-500 italic">No private IPv4 reported yet</span>
            </Row>
          )}
          {!server.vpc_id && (
            <Row label="Private address">
              <span className="text-[#adb5bd] dark:text-slate-500 italic">
                Join a VPC to get a private IPv4; change it from the interfaces table above.
              </span>
            </Row>
          )}
        </div>
      </Card>

      {publicV4.length === 0 && (
        <p className="text-[11px] text-[#6c757d] dark:text-slate-500 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          This server has no public IPv4 address; reverse DNS editing applies to public addresses only.
        </p>
      )}
    </div>
  )
}
