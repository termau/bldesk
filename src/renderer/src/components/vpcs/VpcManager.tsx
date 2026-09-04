import React, { useRef, useState } from 'react'
import {
  Network,
  Plus,
  Server,
  Loader2,
  ShieldAlert,
  UserPlus,
  Unlink,
  Trash2,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import { useVpcs } from '../../api/queries'
import { useConfirm } from '../../context/ConfirmContext'
import { recordChange, updateChange } from '../../lib/changelog'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { describeApiError } from '../../api/queries'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import { SafetyPolicyBadge } from '../ui/SafetyPolicyBadge'

type ServerResponse = components['schemas']['Server']

interface VpcManagerProps {
  /** The app's server list — see AGENTS.md rule 8; tabs do not call useServers. */
  servers: any[]
  client: BinaryLaneClient | null
  onSelectServer?: (server: ServerResponse) => void
}

export const VpcManager: React.FC<VpcManagerProps> = ({ client, onSelectServer, servers }) => {
  const queryClient = useQueryClient()
  const [isCreating, setIsCreating] = useState(false)
  const [vpcName, setVpcName] = useState('')
  const [ipRange, setIpRange] = useState('10.240.0.0/16')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Attach Server Modal States
  const [attachModalVpc, setAttachModalVpc] = useState<any | null>(null)
  const [selectedServerToAttach, setSelectedServerToAttach] = useState<number | null>(null)
  const [isAttaching, setIsAttaching] = useState(false)
  const [actionServerId, setActionServerId] = useState<number | null>(null)

  const vpcsQuery = useVpcs(client)
  const confirmAction = useConfirm()
  const { track } = useTrackedActions()
  const { collectionMutationBlockReason, resourceActionBlockReason, serverActionBlockReason } = useProfileSafety()
  const collectionMutationBlockReasonRef = useRef(collectionMutationBlockReason)
  const resourceActionBlockReasonRef = useRef(resourceActionBlockReason)
  const serverActionBlockReasonRef = useRef(serverActionBlockReason)
  collectionMutationBlockReasonRef.current = collectionMutationBlockReason
  resourceActionBlockReasonRef.current = resourceActionBlockReason
  serverActionBlockReasonRef.current = serverActionBlockReason
  const collectionBlockReason = collectionMutationBlockReason()

  const vpcs = vpcsQuery.data || []

  const reportBlocked = (reason: string): void => {
    setActionError(`Blocked locally: ${reason}`)
  }

  const vpcMembershipBlockReason = (
    vpcId: unknown,
    serverId: unknown,
    getResourceReason = resourceActionBlockReason,
    getServerReason = serverActionBlockReason
  ): string | null => {
    const targetReason = getResourceReason('vpc', vpcId, 'maintenance')
    if (targetReason) return targetReason
    const serverReason = getServerReason(serverId, 'mutation')
    if (serverReason) return serverReason

    // Moving a server out of another VPC touches that source relationship too.
    const sourceVpcId = servers.find((server) => server.id === serverId)?.vpc_id
    return sourceVpcId && sourceVpcId !== vpcId
      ? getResourceReason('vpc', sourceVpcId, 'maintenance')
      : null
  }

  const selectedAttachBlockReason = attachModalVpc && selectedServerToAttach
    ? vpcMembershipBlockReason(attachModalVpc.id, selectedServerToAttach)
    : null

  // Create new VPC
  const handleCreateVpc = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client) return
    const blockReason = collectionMutationBlockReasonRef.current()
    if (blockReason) {
      reportBlocked(blockReason)
      return
    }

    setActionError(null)
    setIsSubmitting(true)
    const changeId = await recordChange({
      label: 'Create VPC',
      target: { kind: 'vpc', name: vpcName.trim() },
      severity: 'normal',
      changes: [{ label: 'IP range', to: ipRange.trim() }],
      source: 'ui'
    })
    try {
      const currentBlockReason = collectionMutationBlockReasonRef.current()
      if (currentBlockReason) throw new Error(`Blocked locally: ${currentBlockReason}`)
      const { error } = await client.POST('/v2/vpcs', {
        body: {
          name: vpcName.trim(),
          ip_range: ipRange.trim()
        }
      })
      if (error) throw new Error(describeApiError(error))
      void updateChange(changeId, { outcome: 'completed' })
      setIsCreating(false)
      setVpcName('')
      vpcsQuery.refetch()
      window.bldeskApi?.sendNotification?.({
        title: 'VPC Created',
        body: `Virtual Private Cloud "${vpcName}" created successfully.`
      })
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Failed to create VPC: ${err.message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Attach / Move Server to VPC
  const handleAttachServer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client || !attachModalVpc || !selectedServerToAttach) return
    const blockReason = vpcMembershipBlockReason(
      attachModalVpc.id,
      selectedServerToAttach,
      resourceActionBlockReasonRef.current,
      serverActionBlockReasonRef.current
    )
    if (blockReason) {
      reportBlocked(blockReason)
      return
    }

    setActionError(null)
    setIsAttaching(true)
    const targetServerName = servers.find((s) => s.id === selectedServerToAttach)?.name || String(selectedServerToAttach)
    const changeId = await recordChange({
      label: 'Attach to VPC',
      target: { kind: 'server', id: selectedServerToAttach, name: String(targetServerName) },
      severity: 'normal',
      changes: [{ label: 'VPC', to: attachModalVpc.name }],
      source: 'ui'
    })
    try {
      const currentBlockReason = vpcMembershipBlockReason(
        attachModalVpc.id,
        selectedServerToAttach,
        resourceActionBlockReasonRef.current,
        serverActionBlockReasonRef.current
      )
      if (currentBlockReason) throw new Error(`Blocked locally: ${currentBlockReason}`)
      const { data, error } = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: selectedServerToAttach } },
        body: {
          type: 'change_network',
          vpc_id: attachModalVpc.id
        }
      })
      if (error) throw new Error(describeApiError(error))
      if (data?.action) track(data.action, 'Attach to VPC', String(targetServerName), changeId)
      else void updateChange(changeId, { outcome: 'completed' })

      window.bldeskApi?.sendNotification?.({
        title: 'Server Attached to VPC',
        body: `Moved "${targetServerName}" into VPC "${attachModalVpc.name}".`
      })

      setAttachModalVpc(null)
      setSelectedServerToAttach(null)
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      queryClient.invalidateQueries({ queryKey: ['vpcs'] })
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Failed to attach server: ${err.message}`)
    } finally {
      setIsAttaching(false)
    }
  }

  // Detach / Remove Server from VPC
  const handleDetachServer = async (vpcId: number, serverId: number, serverName: string) => {
    if (!client) return
    const blockReason = vpcMembershipBlockReason(
      vpcId,
      serverId,
      resourceActionBlockReasonRef.current,
      serverActionBlockReasonRef.current
    )
    if (blockReason) {
      reportBlocked(blockReason)
      return
    }
    setActionError(null)
    const c = await confirmAction({
      title: 'Detach from VPC',
      target: { kind: 'server', id: serverId, name: serverName },
      summary: 'The server leaves its private network and reverts to the default public network. Anything reaching it over its VPC address will stop working.',
      severity: 'destructive',
      confirmLabel: 'Detach'
    })
    if (!c.ok) return

    setActionServerId(serverId)
    try {
      const currentBlockReason = vpcMembershipBlockReason(
        vpcId,
        serverId,
        resourceActionBlockReasonRef.current,
        serverActionBlockReasonRef.current
      )
      if (currentBlockReason) throw new Error(`Blocked locally: ${currentBlockReason}`)
      const { data, error } = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: serverId } },
        body: {
          type: 'change_network',
          vpc_id: null as any
        }
      })
      if (error) throw new Error(describeApiError(error))
      if (data?.action) track(data.action, 'Detach from VPC', serverName, c.changeId)
      else void updateChange(c.changeId, { outcome: 'completed' })

      window.bldeskApi?.sendNotification?.({
        title: 'Server Detached from VPC',
        body: `Detached "${serverName}" from private network.`
      })

      queryClient.invalidateQueries({ queryKey: ['servers'] })
      queryClient.invalidateQueries({ queryKey: ['vpcs'] })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Failed to detach server: ${err.message}`)
    } finally {
      setActionServerId(null)
    }
  }

  // Delete VPC
  const handleDeleteVpc = async (vpcId: number, vpcName: string) => {
    if (!client) return
    const blockReason = resourceActionBlockReasonRef.current('vpc', vpcId, 'destructive')
    if (blockReason) {
      reportBlocked(blockReason)
      return
    }
    setActionError(null)
    const c = await confirmAction({
      title: 'Delete VPC',
      target: { kind: 'vpc', id: vpcId, name: vpcName },
      summary: 'The private network and its address range are removed. There is no undo.',
      severity: 'irreversible',
      confirmLabel: 'Delete VPC'
    })
    if (!c.ok) return

    try {
      const currentBlockReason = resourceActionBlockReasonRef.current('vpc', vpcId, 'destructive')
      if (currentBlockReason) throw new Error(`Blocked locally: ${currentBlockReason}`)
      const { error } = await client.DELETE('/v2/vpcs/{vpc_id}', {
        params: { path: { vpc_id: vpcId } }
      })
      if (error) throw new Error(describeApiError(error))
      void updateChange(c.changeId, { outcome: 'completed' })
      vpcsQuery.refetch()
      window.bldeskApi?.sendNotification?.({
        title: 'VPC Deleted',
        body: `VPC #${vpcId} deleted.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Failed to delete VPC: ${err.message}`)
    }
  }

  // Servers available to attach (not already in this specific VPC)
  const getAttachableServers = (vpcId: number) => {
    return servers.filter(
      (s) => s.vpc_id !== vpcId && !vpcMembershipBlockReason(vpcId, s.id)
    )
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
            <Network className="w-5 h-5 text-[#017cb6]" />
            <span>Virtual Private Clouds (VPCs)</span>
          </h1>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-0.5">
            Isolated layer-2 private networks across BinaryLane data centres.
          </p>
        </div>

        <button
          onClick={() => {
            if (collectionBlockReason) return reportBlocked(collectionBlockReason)
            setActionError(null)
            setIsCreating(true)
          }}
          disabled={!!collectionBlockReason}
          title={collectionBlockReason ?? 'Create VPC (starts Normal)'}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          <span>Create VPC</span>
        </button>
      </div>

      {collectionBlockReason && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{collectionBlockReason} Existing VPCs remain visible and follow their own saved tier.</span>
        </div>
      )}

      {actionError && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="font-semibold hover:underline">Dismiss</button>
        </div>
      )}

      {/* Loading state */}
      {vpcsQuery.isLoading && (
        <div className="flex flex-col items-center justify-center p-12 space-y-3 bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e]">
          <Loader2 className="w-8 h-8 text-[#017cb6] animate-spin" />
          <p className="text-xs text-[#6c757d] dark:text-slate-400">Loading VPC networks...</p>
        </div>
      )}

      {/* Empty State */}
      {!vpcsQuery.isLoading && vpcs.length === 0 && (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e]">
          <Network className="w-10 h-10 text-[#6c757d] dark:text-slate-500 mb-3" />
          <h3 className="text-sm font-semibold text-[#212529] dark:text-white">No VPC Networks</h3>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 max-w-sm mt-1 mb-4">
            Connect multiple virtual servers privately on an isolated 10Gbps backend network.
          </p>
          <button
            onClick={() => {
              if (collectionBlockReason) return reportBlocked(collectionBlockReason)
              setActionError(null)
              setIsCreating(true)
            }}
            disabled={!!collectionBlockReason}
            title={collectionBlockReason ?? 'Create VPC (starts Normal)'}
            className="px-4 py-2 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create Your First VPC
          </button>
        </div>
      )}

      {/* VPC Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {vpcs.map((vpc) => {
          const vpcServers = servers.filter((s) => s.vpc_id === vpc.id)
          const attachableServers = getAttachableServers(vpc.id)
          const membershipBlockReason = resourceActionBlockReason('vpc', vpc.id, 'maintenance')
          const deleteBlockReason = resourceActionBlockReason('vpc', vpc.id, 'destructive')

          return (
            <div
              key={vpc.id}
              className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm flex flex-col justify-between overflow-hidden"
            >
              {/* Header */}
              <div className="p-4 border-b border-[#ced4da] dark:border-[#373b3e] bg-[#f1f1f1] dark:bg-[#262a2e] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded bg-[#017cb6]/10 flex items-center justify-center">
                    <Network className="w-4 h-4 text-[#017cb6]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-[#212529] dark:text-white">{vpc.name}</h3>
                      <SafetyPolicyBadge
                        scope="resource"
                        resourceKind="vpc"
                        resourceId={vpc.id}
                        resourceLabel={vpc.name}
                      />
                    </div>
                    <span className="text-[11px] text-[#6c757d] dark:text-slate-400 font-mono">
                      #{vpc.id} • {vpc.ip_range}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleDeleteVpc(vpc.id, vpc.name)}
                  disabled={!!deleteBlockReason}
                  className="text-[#6c757d] hover:text-rose-500 p-1.5 rounded transition disabled:cursor-not-allowed disabled:opacity-40"
                  title={deleteBlockReason ?? 'Delete VPC'}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Members */}
              <div className="p-4 flex-1">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-[#495057] dark:text-[#ced4da]">
                    Attached Members ({vpcServers.length})
                  </h4>
                  <button
                    onClick={() => {
                      setActionError(null)
                      setAttachModalVpc(vpc)
                      if (attachableServers.length > 0) {
                        setSelectedServerToAttach(attachableServers[0].id)
                      }
                    }}
                    disabled={!!membershipBlockReason || attachableServers.length === 0}
                    title={membershipBlockReason ?? (attachableServers.length === 0 ? 'No server in this account is eligible to move into this VPC.' : 'Attach an eligible server')}
                    className="flex items-center gap-1 text-xs text-[#017cb6] hover:underline font-medium disabled:cursor-not-allowed disabled:opacity-45 disabled:no-underline"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Attach Server</span>
                  </button>
                </div>

                {vpcServers.length === 0 ? (
                  <div className="p-4 bg-[#f8f9fa] dark:bg-[#212529] rounded border border-dashed border-[#ced4da] dark:border-[#373b3e] text-center text-xs text-[#6c757d] dark:text-slate-400">
                    No servers connected to this VPC yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {vpcServers.map((s) => {
                      const privateIp = s.networks?.v4?.find((n: any) => n.type === 'private')?.ip_address || 'Assigning IP...'
                      const isDetaching = actionServerId === s.id
                      const detachBlockReason = vpcMembershipBlockReason(vpc.id, s.id)

                      return (
                        <div
                          key={s.id}
                          className="flex items-center justify-between p-2.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded hover:border-[#017cb6] transition"
                        >
                          <div
                            onClick={() => onSelectServer && onSelectServer(s)}
                            className="flex items-center gap-2 cursor-pointer flex-1"
                          >
                            <Server className="w-3.5 h-3.5 text-[#017cb6]" />
                            <div>
                              <div className="text-xs font-bold text-[#017cb6] hover:underline">
                                {s.name}
                              </div>
                              <div className="text-[11px] font-mono text-[#6c757d] dark:text-slate-400">
                                Private: {privateIp}
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={() => handleDetachServer(vpc.id, s.id, s.name)}
                            disabled={isDetaching || !!detachBlockReason}
                            className="p-1.5 text-[#6c757d] hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition disabled:cursor-not-allowed disabled:opacity-40"
                            title={detachBlockReason ?? 'Detach from VPC'}
                          >
                            {isDetaching ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#017cb6]" /> : <Unlink className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Create VPC Modal */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overlay-safe bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#ced4da] dark:border-[#373b3e] pb-3">
              <h2 className="text-base font-bold text-[#212529] dark:text-white">Create Virtual Private Cloud</h2>
              <button onClick={() => setIsCreating(false)} className="text-[#6c757d] hover:text-[#212529] dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionError && (
              <div role="alert" className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                {actionError}
              </div>
            )}

            <form onSubmit={handleCreateVpc} className="space-y-4">
              {collectionBlockReason && (
                <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  {collectionBlockReason}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  VPC Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production Cluster VPC"
                  value={vpcName}
                  onChange={(e) => setVpcName(e.target.value)}
                  className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  Subnet CIDR Range
                </label>
                <input
                  type="text"
                  required
                  placeholder="10.240.0.0/16"
                  value={ipRange}
                  onChange={(e) => setIpRange(e.target.value)}
                  className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded font-mono focus:outline-none focus:border-[#017cb6]"
                />
                <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-1">
                  Standard private range: 10.240.0.0/16, 172.16.0.0/16, etc.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !!collectionBlockReason}
                  title={collectionBlockReason ?? 'Create network (starts Normal)'}
                  className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create Network</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attach Server Modal */}
      {attachModalVpc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overlay-safe bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#ced4da] dark:border-[#373b3e] pb-3">
              <h2 className="text-base font-bold text-[#212529] dark:text-white">Attach Server to VPC</h2>
              <button onClick={() => setAttachModalVpc(null)} className="text-[#6c757d] hover:text-[#212529] dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionError && (
              <div role="alert" className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                {actionError}
              </div>
            )}

            <form onSubmit={handleAttachServer} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  Select Server to Connect
                </label>
                {getAttachableServers(attachModalVpc.id).length === 0 ? (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs rounded">
                    No server is eligible to move into this VPC. Servers are either already attached or blocked by their safety tier.
                  </div>
                ) : (
                  <select
                    value={selectedServerToAttach || ''}
                    onChange={(e) => setSelectedServerToAttach(Number(e.target.value))}
                    className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
                  >
                    {getAttachableServers(attachModalVpc.id).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (#{s.id}) {s.vpc_id ? `[Currently in VPC #${s.vpc_id}]` : '[Public Default]'}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAttachModalVpc(null)}
                  className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAttaching || !selectedServerToAttach || !!selectedAttachBlockReason}
                  title={selectedAttachBlockReason ?? 'Attach server to VPC'}
                  className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  {isAttaching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Attach to {attachModalVpc.name}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
