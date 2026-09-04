import React, { useRef, useState } from 'react'
import {
  Layers,
  Plus,
  Server,
  Loader2,
  UserPlus,
  Unlink,
  Trash2,
  X,
  AlertCircle,
  Copy,
  Check,
  Activity,
  ArrowRightLeft
} from 'lucide-react'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import {
  useLoadBalancers,
  useRegions,
  useAddServerToLoadBalancerMutation,
  useRemoveServerFromLoadBalancerMutation,
  useCreateLoadBalancerMutation,
  useDeleteLoadBalancerMutation
} from '../../api/queries'
import { useConfirm } from '../../context/ConfirmContext'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import { recordChange, updateChange } from '../../lib/changelog'
import { SafetyPolicyBadge } from '../ui/SafetyPolicyBadge'

type ServerResponse = components['schemas']['Server']

interface LoadBalancerManagerProps {
  /** The app's server list — see AGENTS.md rule 8; tabs do not call useServers. */
  servers: any[]
  client: BinaryLaneClient | null
  onSelectServer?: (server: ServerResponse) => void
}

export const LoadBalancerManager: React.FC<LoadBalancerManagerProps> = ({
  servers,
  client,
  onSelectServer
}) => {
  const [copiedIp, setCopiedIp] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // Create Form State
  const [lbName, setLbName] = useState('')
  const [lbRegion, setLbRegion] = useState('syd')
  const [entryProtocol, setEntryProtocol] = useState<'http' | 'https'>('http')
  const [selectedServerIds, setSelectedServerIds] = useState<number[]>([])
  const [createError, setCreateError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Add Server to Pool Modal State
  const [attachModalLb, setAttachModalLb] = useState<any | null>(null)
  const [selectedServerToAttach, setSelectedServerToAttach] = useState<number | null>(null)
  const [actionServerId, setActionServerId] = useState<number | null>(null)

  const {
    collectionMutationBlockReason,
    resourceActionBlockReason,
    serverActionBlockReason,
    openSafetySettings
  } = useProfileSafety()
  const collectionMutationBlockReasonRef = useRef(collectionMutationBlockReason)
  const resourceActionBlockReasonRef = useRef(resourceActionBlockReason)
  const serverActionBlockReasonRef = useRef(serverActionBlockReason)
  collectionMutationBlockReasonRef.current = collectionMutationBlockReason
  resourceActionBlockReasonRef.current = resourceActionBlockReason
  serverActionBlockReasonRef.current = serverActionBlockReason
  const collectionBlockReason = collectionMutationBlockReason()

  const recordBlocked = (reason: string, changeId?: string): void => {
    setActionError(`Blocked locally: ${reason}`)
    if (changeId) {
      void updateChange(changeId, {
        outcome: 'failed',
        detail: `Blocked locally before the request was sent: ${reason}`
      })
    }
  }

  const createBlockReason = (
    getCollectionReason = collectionMutationBlockReason,
    getServerReason = serverActionBlockReason
  ): string | null => {
    const collectionReason = getCollectionReason()
    if (collectionReason) return collectionReason
    for (const serverId of selectedServerIds) {
      const serverReason = getServerReason(serverId, 'mutation')
      if (serverReason) return serverReason
    }
    return null
  }

  const membershipBlockReason = (
    loadBalancerId: unknown,
    serverId: unknown,
    getResourceReason = resourceActionBlockReason,
    getServerReason = serverActionBlockReason
  ): string | null => getResourceReason('load-balancer', loadBalancerId, 'maintenance')
    ?? getServerReason(serverId, 'mutation')

  const selectedCreateBlockReason = createBlockReason()
  const selectedAttachBlockReason = attachModalLb && selectedServerToAttach
    ? membershipBlockReason(attachModalLb.id, selectedServerToAttach)
    : null

  const lbsQuery = useLoadBalancers(client)
  const regionsQuery = useRegions(client)

  const addServerMutation = useAddServerToLoadBalancerMutation(client)
  const removeServerMutation = useRemoveServerFromLoadBalancerMutation(client)
  const createLbMutation = useCreateLoadBalancerMutation(client)
  const deleteLbMutation = useDeleteLoadBalancerMutation(client)

  const loadBalancers = lbsQuery.data || []
  const regions = regionsQuery.data || []

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedIp(text)
    setTimeout(() => setCopiedIp(null), 1500)
  }

  const handleToggleCreateServer = (serverId: number) => {
    setSelectedServerIds((prev) =>
      prev.includes(serverId) ? prev.filter((id) => id !== serverId) : [...prev, serverId]
    )
  }

  const handleCreateLb = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)

    const initialBlockReason = createBlockReason(
      collectionMutationBlockReasonRef.current,
      serverActionBlockReasonRef.current
    )
    if (initialBlockReason) {
      setCreateError(`Blocked locally: ${initialBlockReason}`)
      return
    }

    if (!lbName.trim()) {
      setCreateError('Please enter a valid hostname / name for the load balancer.')
      return
    }

    const changeId = await recordChange({
      label: 'Create load balancer',
      target: { kind: 'loadbalancer', name: lbName.trim() },
      severity: 'normal',
      changes: [
        { label: 'Region', to: lbRegion },
        { label: 'Entry protocol', to: entryProtocol },
        { label: 'Backends', to: selectedServerIds.map((id) => servers.find((s) => s.id === id)?.name || `#${id}`).join(', ') || undefined }
      ],
      source: 'ui'
    })
    const currentBlockReason = createBlockReason(
      collectionMutationBlockReasonRef.current,
      serverActionBlockReasonRef.current
    )
    if (currentBlockReason) {
      recordBlocked(currentBlockReason, changeId)
      setCreateError(`Blocked locally: ${currentBlockReason}`)
      return
    }
    try {
      await createLbMutation.mutateAsync({
        name: lbName.trim(),
        region: lbRegion === 'anycast' ? undefined : lbRegion,
        forwarding_rules: [
          {
            entry_protocol: entryProtocol
          }
        ],
        server_ids: selectedServerIds
      })
      void updateChange(changeId, { outcome: 'completed' })

      window.bldeskApi?.sendNotification?.({
        title: 'Load Balancer Created',
        body: `Load balancer "${lbName}" provisioned successfully.`
      })

      setIsCreating(false)
      setLbName('')
      setSelectedServerIds([])
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err.message })
      setCreateError(err.message || 'Failed to create load balancer.')
    }
  }

  const handleAttachServer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!attachModalLb || !selectedServerToAttach) return
    const initialBlockReason = membershipBlockReason(
      attachModalLb.id,
      selectedServerToAttach,
      resourceActionBlockReasonRef.current,
      serverActionBlockReasonRef.current
    )
    if (initialBlockReason) {
      recordBlocked(initialBlockReason)
      return
    }

    const sName = servers.find((s) => s.id === selectedServerToAttach)?.name || String(selectedServerToAttach)
    const changeId = await recordChange({
      label: 'Add to load balancer',
      target: { kind: 'loadbalancer', id: attachModalLb.id, name: attachModalLb.name },
      severity: 'normal',
      changes: [{ label: 'Backend', to: sName }],
      source: 'ui'
    })
    const currentBlockReason = membershipBlockReason(
      attachModalLb.id,
      selectedServerToAttach,
      resourceActionBlockReasonRef.current,
      serverActionBlockReasonRef.current
    )
    if (currentBlockReason) {
      recordBlocked(currentBlockReason, changeId)
      return
    }
    try {
      await addServerMutation.mutateAsync({
        loadBalancerId: attachModalLb.id,
        serverId: selectedServerToAttach
      })
      void updateChange(changeId, { outcome: 'completed' })

      window.bldeskApi?.sendNotification?.({
        title: 'Backend Pool Updated',
        body: `Added "${sName}" to ${attachModalLb.name}.`
      })

      setAttachModalLb(null)
      setSelectedServerToAttach(null)
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Failed to add load balancer target: ${err.message || 'Unknown error'}`)
    }
  }

  const confirmAction = useConfirm()
  const handleRemoveServer = async (lbId: number, lbName: string, serverId: number, serverName: string) => {
    const initialBlockReason = membershipBlockReason(
      lbId,
      serverId,
      resourceActionBlockReasonRef.current,
      serverActionBlockReasonRef.current
    )
    if (initialBlockReason) {
      recordBlocked(initialBlockReason)
      return
    }
    const c = await confirmAction({
      title: 'Remove from load balancer',
      target: { kind: 'loadbalancer', id: lbId, name: lbName },
      summary: `${serverName} (#${serverId}) stops receiving traffic from ${lbName}.`,
      severity: 'destructive',
      changes: [{ label: 'Backend', from: serverName, to: undefined }],
      confirmLabel: 'Remove'
    })
    if (!c.ok) return
    const currentBlockReason = membershipBlockReason(
      lbId,
      serverId,
      resourceActionBlockReasonRef.current,
      serverActionBlockReasonRef.current
    )
    if (currentBlockReason) {
      recordBlocked(currentBlockReason, c.changeId)
      return
    }

    setActionServerId(serverId)
    try {
      await removeServerMutation.mutateAsync({
        loadBalancerId: lbId,
        serverId
      })
      void updateChange(c.changeId, { outcome: 'completed' })

      window.bldeskApi?.sendNotification?.({
        title: 'Backend Member Removed',
        body: `Removed "${serverName}" from ${lbName}.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Failed to remove load balancer target: ${err.message || 'Unknown error'}`)
    } finally {
      setActionServerId(null)
    }
  }

  const handleDeleteLb = async (lbId: number, name: string) => {
    const initialBlockReason = resourceActionBlockReasonRef.current('load-balancer', lbId, 'destructive')
    if (initialBlockReason) {
      recordBlocked(initialBlockReason)
      return
    }
    const c = await confirmAction({
      title: 'Delete load balancer',
      target: { kind: 'loadbalancer', id: lbId, name },
      summary: 'Traffic distribution stops immediately and the load balancer\'s address is released. There is no undo.',
      severity: 'irreversible',
      confirmLabel: 'Delete load balancer'
    })
    if (!c.ok) return
    const currentBlockReason = resourceActionBlockReasonRef.current('load-balancer', lbId, 'destructive')
    if (currentBlockReason) {
      recordBlocked(currentBlockReason, c.changeId)
      return
    }

    try {
      await deleteLbMutation.mutateAsync(lbId)
      void updateChange(c.changeId, { outcome: 'completed' })
      window.bldeskApi?.sendNotification?.({
        title: 'Load Balancer Deleted',
        body: `Deleted Load Balancer #${lbId}.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Failed to delete load balancer: ${err.message || 'Unknown error'}`)
    }
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-[#017cb6]" />
            <span>High-Availability Load Balancers</span>
          </h1>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-0.5">
            Distribute incoming HTTP/HTTPS/TCP traffic across backend virtual servers with health checks.
          </p>
        </div>

        <button
          onClick={() => {
            if (collectionBlockReason) {
              recordBlocked(collectionBlockReason)
              return
            }
            setIsCreating(true)
          }}
          disabled={!!collectionBlockReason}
          title={collectionBlockReason ?? 'Deploy load balancer (starts Normal)'}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="w-4 h-4" />
          <span>Deploy Load Balancer</span>
        </button>
      </div>

      {actionError && (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          {actionError.startsWith('Blocked locally:') && (
            <button type="button" onClick={() => openSafetySettings()} className="shrink-0 font-semibold underline underline-offset-2">
              Review safety
            </button>
          )}
          <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss message" className="shrink-0 opacity-70 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Loading State */}
      {lbsQuery.isLoading && (
        <div className="flex flex-col items-center justify-center p-12 space-y-3 bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e]">
          <Loader2 className="w-8 h-8 text-[#017cb6] animate-spin" />
          <p className="text-xs text-[#6c757d] dark:text-slate-400">Loading load balancers...</p>
        </div>
      )}

      {/* Empty State */}
      {!lbsQuery.isLoading && loadBalancers.length === 0 && (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e]">
          <Layers className="w-10 h-10 text-[#6c757d] dark:text-slate-500 mb-3" />
          <h3 className="text-sm font-semibold text-[#212529] dark:text-white">No Load Balancers Deployed</h3>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 max-w-sm mt-1 mb-4">
            Create high-availability reverse proxy endpoints to distribute load and perform health monitoring across multiple servers.
          </p>
            <button
              onClick={() => {
                if (collectionBlockReason) {
                  recordBlocked(collectionBlockReason)
                  return
                }
                setIsCreating(true)
              }}
              disabled={!!collectionBlockReason}
              title={collectionBlockReason ?? 'Deploy load balancer (starts Normal)'}
            className="px-4 py-2 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            Deploy Load Balancer
          </button>
        </div>
      )}

      {/* Load Balancers List */}
      <div className="space-y-6">
        {loadBalancers.map((lb) => {
          const lbServerIds = lb.server_ids || []
          const memberServers = servers.filter((s) => lbServerIds.includes(s.id))
          const attachableServers = servers.filter(
            (s) => !lbServerIds.includes(s.id) && !serverActionBlockReason(s.id, 'mutation')
          )
          const isActive = lb.status === 'active'
          const maintenanceBlockReason = resourceActionBlockReason('load-balancer', lb.id, 'maintenance')
          const deleteBlockReason = resourceActionBlockReason('load-balancer', lb.id, 'destructive')

          return (
            <div
              key={lb.id}
              className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="p-4 border-b border-[#ced4da] dark:border-[#373b3e] bg-[#f1f1f1] dark:bg-[#262a2e] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-[#017cb6]/10 flex items-center justify-center">
                    <Layers className="w-4 h-4 text-[#017cb6]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-[#212529] dark:text-white font-mono">{lb.name}</h3>
                      <SafetyPolicyBadge
                        scope="resource"
                        resourceKind="load-balancer"
                        resourceId={lb.id}
                        resourceLabel={lb.name}
                      />
                      <span
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                          isActive
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {lb.status || 'Active'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5">
                      <span>#{lb.id}</span>
                      <span>•</span>
                      <span>Region: {lb.region?.name || lb.region?.slug?.toUpperCase() || 'Global Anycast'}</span>
                    </div>
                  </div>
                </div>

                {/* VIP Address & Delete */}
                <div className="flex items-center gap-3">
                  {lb.ip && (
                    <div className="flex items-center gap-1.5 bg-white dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] px-2.5 py-1 rounded text-xs">
                      <span className="text-[10px] text-[#6c757d] uppercase font-bold">VIP</span>
                      <span className="font-mono text-[#212529] dark:text-slate-200">{lb.ip}</span>
                      <button
                        onClick={() => handleCopy(lb.ip!)}
                        className="text-[#6c757d] hover:text-[#017cb6] ml-1"
                        title="Copy VIP IP"
                      >
                        {copiedIp === lb.ip ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  )}

                  <button
                    onClick={() => handleDeleteLb(lb.id, lb.name)}
                    disabled={!!deleteBlockReason}
                    className="p-1.5 text-[#6c757d] hover:text-rose-500 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition disabled:cursor-not-allowed disabled:opacity-40"
                    title={deleteBlockReason ?? 'Delete Load Balancer'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Body: Forwarding Rules & Backend Pool */}
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Forwarding Rules */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-[#495057] dark:text-[#ced4da] flex items-center gap-1.5">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-[#017cb6]" />
                    <span>Forwarding Rules</span>
                  </h4>
                  <div className="bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded p-3 text-xs space-y-1.5">
                    {(lb.forwarding_rules || []).map((rule: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between font-mono text-[11px]">
                        <span className="text-[#017cb6] uppercase font-bold">
                          {rule.entry_protocol}:{rule.entry_port || (rule.entry_protocol === 'https' ? 443 : 80)}
                        </span>
                        <span className="text-[#6c757d]">➔</span>
                        <span className="text-[#212529] dark:text-slate-200 uppercase font-medium">
                          {rule.target_protocol || rule.entry_protocol}:{rule.target_port || (rule.target_protocol === 'https' ? 443 : 80)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Backend Pool Members */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-[#495057] dark:text-[#ced4da] flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-[#017cb6]" />
                      <span>Backend Target Pool ({memberServers.length})</span>
                    </h4>
                    <button
                      onClick={() => {
                        setAttachModalLb(lb)
                        if (attachableServers.length > 0) {
                          setSelectedServerToAttach(attachableServers[0].id)
                        }
                      }}
                      disabled={!!maintenanceBlockReason || attachableServers.length === 0}
                      title={maintenanceBlockReason ?? (attachableServers.length === 0 ? 'No Normal server is available to add.' : 'Add load balancer target')}
                      className="text-xs text-[#017cb6] hover:underline font-medium flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>Add Target</span>
                    </button>
                  </div>

                  {memberServers.length === 0 ? (
                    <div className="p-3 bg-[#f8f9fa] dark:bg-[#212529] border border-dashed border-[#ced4da] dark:border-[#373b3e] rounded text-center text-xs text-[#6c757d]">
                      No servers in pool. Traffic will fail health checks.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {memberServers.map((s) => {
                        const sIp = s.networks?.v4?.find((n: any) => n.type === 'public')?.ip_address || s.networks?.v4?.[0]?.ip_address
                        const isRemoving = actionServerId === s.id
                        const removeBlockReason = membershipBlockReason(lb.id, s.id)

                        return (
                          <div
                            key={s.id}
                            className="flex items-center justify-between p-2 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded"
                          >
                            <div
                              onClick={() => onSelectServer && onSelectServer(s)}
                              className="flex items-center gap-2 cursor-pointer flex-1"
                            >
                              <Server className="w-3 h-3 text-[#017cb6]" />
                              <span className="text-xs font-medium text-[#017cb6] hover:underline">{s.name}</span>
                              <span className="text-[10px] text-[#6c757d] font-mono">({sIp})</span>
                            </div>

                            <button
                              onClick={() => handleRemoveServer(lb.id, lb.name, s.id, s.name)}
                              disabled={isRemoving || !!removeBlockReason}
                              className="text-[#6c757d] hover:text-rose-500 p-1 rounded disabled:cursor-not-allowed disabled:opacity-40"
                              title={removeBlockReason ?? 'Remove from pool'}
                            >
                              {isRemoving ? <Loader2 className="w-3 h-3 animate-spin text-[#017cb6]" /> : <Unlink className="w-3 h-3" />}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Create Load Balancer Modal */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overlay-safe bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#ced4da] dark:border-[#373b3e] pb-3">
              <h2 className="text-base font-bold text-[#212529] dark:text-white">Deploy High-Availability Load Balancer</h2>
              <button onClick={() => setIsCreating(false)} className="text-[#6c757d] hover:text-[#212529] dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {createError && (
              <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateLb} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  Load Balancer Name / FQDN
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. app-lb.production"
                  value={lbName}
                  onChange={(e) => setLbName(e.target.value)}
                  className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                    Region
                  </label>
                  <select
                    value={lbRegion}
                    onChange={(e) => setLbRegion(e.target.value)}
                    className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
                  >
                    <option value="anycast">Global Anycast</option>
                    {regions.map((r) => (
                      <option key={r.slug} value={r.slug}>
                        {r.name} ({r.slug.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                    Default Protocol
                  </label>
                  <select
                    value={entryProtocol}
                    onChange={(e) => setEntryProtocol(e.target.value as any)}
                    className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
                  >
                    <option value="http">HTTP (Port 80)</option>
                    <option value="https">HTTPS (Port 443)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  Select Initial Pool Servers
                </label>
                <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded">
                  {servers.map((s) => {
                    const serverBlockReason = serverActionBlockReason(s.id, 'mutation')
                    return (
                      <label
                        key={s.id}
                        title={serverBlockReason ?? 'Include this server as an initial backend'}
                        className="flex items-center gap-2 cursor-pointer text-xs p-1 hover:bg-[#e9ecef] dark:hover:bg-[#343a40] rounded has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45"
                      >
                        <input
                          type="checkbox"
                          checked={selectedServerIds.includes(s.id)}
                          onChange={() => handleToggleCreateServer(s.id)}
                          disabled={!!serverBlockReason}
                          className="rounded border-[#ced4da] text-[#017cb6] focus:ring-0"
                        />
                        <span className="font-medium text-[#212529] dark:text-white">{s.name}</span>
                        <span className="text-[10px] text-[#6c757d] font-mono">#{s.id}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#ced4da] dark:border-[#373b3e]">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLbMutation.isPending || !!selectedCreateBlockReason}
                  title={selectedCreateBlockReason ?? 'Provision load balancer (starts Normal)'}
                  className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {createLbMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Provision Load Balancer</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attach Modal */}
      {attachModalLb && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overlay-safe bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#ced4da] dark:border-[#373b3e] pb-3">
              <h2 className="text-base font-bold text-[#212529] dark:text-white">Add Server to Pool</h2>
              <button onClick={() => setAttachModalLb(null)} className="text-[#6c757d] hover:text-[#212529] dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAttachServer} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  Select Server
                </label>
                <select
                  value={selectedServerToAttach || ''}
                  onChange={(e) => setSelectedServerToAttach(Number(e.target.value))}
                  className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
                >
                  {servers
                    .filter((s) => !(attachModalLb.server_ids || []).includes(s.id) && !serverActionBlockReason(s.id, 'mutation'))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (#{s.id})
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#ced4da] dark:border-[#373b3e]">
                <button
                  type="button"
                  onClick={() => setAttachModalLb(null)}
                  className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addServerMutation.isPending || !selectedServerToAttach || !!selectedAttachBlockReason}
                  title={selectedAttachBlockReason ?? 'Add load balancer target'}
                  className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  {addServerMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Add Target</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
