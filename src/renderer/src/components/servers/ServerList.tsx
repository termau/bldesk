import { HelpLink } from '../ui/HelpLink'
import React, { useState } from 'react'
import { openSsh } from '../../lib/openSsh'
import {
  Server as ServerIcon,
  Play,
  RotateCw,
  Loader2,
  Power,
  Terminal,
  Search,
  Copy,
  Check,
  Plus,
  LayoutGrid,
  List,
  ShieldAlert,
  Link2,
  FileCode2
} from 'lucide-react'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import { useServerActionMutation, useRegions } from '../../api/queries'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { CreateServerModal } from './CreateServerModal'
import { logoForDistribution } from '../../lib/distroHelper'
import { copyDeepLink } from '../../lib/deeplinks'
import { describeActionType } from '../../lib/actionLabels'
import { ServerContextMenu, ContextMenuState } from './ServerContextMenu'
import { VpcBadge } from '../vpcs/VpcBadge'
import { describeStatus, compareByBuildingFirst } from '../../lib/serverStatus'
import { useConfirm } from '../../context/ConfirmContext'
import { updateChange } from '../../lib/changelog'
import { powerActionSummary } from '../../lib/actionLabels'

type ServerResponse = components['schemas']['Server']

interface ServerListProps {
  servers: ServerResponse[]
  isLoading: boolean
  client: BinaryLaneClient | null
  onSelectServer: (server: ServerResponse) => void
  onOpenTerminal: (ip: string) => void
  /** Jump to the Templates tab. */
  onOpenTemplates?: () => void
  /** Called once a create is accepted (the Templates tab applies firewall rules and tags after this). */
  onCreated?: (created: { id?: number; name: string }) => void
}

export const ServerList: React.FC<ServerListProps> = ({
  servers,
  isLoading,
  client,
  onSelectServer,
  onOpenTerminal: _onOpenTerminal,
  onOpenTemplates,
  onCreated
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [regionFilter, setRegionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table')
  const [copiedIp, setCopiedIp] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [actionInProgressServerId, setActionInProgressServerId] = useState<number | null>(null)
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const handleCopyLink = async (serverId: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    await copyDeepLink({ kind: 'server', serverId })
    setCopiedLinkId(serverId)
    setTimeout(() => setCopiedLinkId(null), 1500)
  }

  const handleContextMenu = (server: ServerResponse, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ server, x: e.clientX, y: e.clientY })
  }

  const serverAction = useServerActionMutation(client)
  const { track } = useTrackedActions()

  const handleCopyIp = (ip: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(ip)
    setCopiedIp(ip)
    setTimeout(() => setCopiedIp(null), 1500)
  }

  const confirmAction = useConfirm()
  const handleAction = async (serverId: number, actionType: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (actionInProgressServerId !== null) return
    const target = servers.find((s) => s.id === serverId)
    const c = await confirmAction({
      title: describeActionType(actionType),
      target: { kind: 'server', id: serverId, name: target?.name || `#${serverId}` },
      summary: powerActionSummary(actionType),
      severity: actionType === 'power_off' || actionType === 'power_cycle' ? 'destructive' : 'normal'
    })
    if (!c.ok) return

    setActionInProgressServerId(serverId)
    try {
      const queued = await serverAction.mutateAsync({
        serverId,
        actionPayload: { type: actionType }
      })
      // "Requested" was honest but final — it never said how the action ended.
      // Tracking turns it into a reported outcome.
      if (queued) {
        track(queued, describeActionType(actionType), target?.name, c.changeId)
      }
      window.bldeskApi?.sendNotification?.({
        title: `Server Action: ${actionType}`,
        body: `Action requested successfully for server #${serverId}.`,
        kind: 'action'
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      alert(`Action failed: ${err.message || 'Unknown error'}`)
    } finally {
      setActionInProgressServerId(null)
    }
  }

  const handleOpenSsh = (ip: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const server = servers.find((s) => s.networks?.v4?.some((n) => n.ip_address === ip))
    void openSsh({ host: ip, username: 'root', serverId: server?.id, serverName: server?.name })
  }

  const filteredServers = [...servers].sort(compareByBuildingFirst).filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.networks?.v4 || []).some((net) => net.ip_address.includes(searchTerm)) ||
      (((s as any).tags || []) as string[]).some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase()))

    const matchesRegion = regionFilter === 'all' || s.region?.slug === regionFilter
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter

    return matchesSearch && matchesRegion && matchesStatus
  })

  /*
   * Regions offered by the account, not merely the ones already in use.
   *
   * This was derived from `servers`, so a region with no servers yet - Perth and
   * Singapore here - had no filter option at all, and the order was whatever the
   * server list happened to be in. Seeded from the API and sorted, with the
   * regions actually in use merged in so the filter still works before the
   * regions query resolves.
   */
  const regionsQuery = useRegions(client)
  const availableRegions = React.useMemo(() => {
    const offered = (regionsQuery.data ?? [])
      .filter((r) => r.available !== false)
      .map((r) => r.slug)
      .filter(Boolean)
    const inUse = servers.map((s) => s.region?.slug).filter(Boolean)
    return Array.from(new Set([...offered, ...inUse])).sort() as string[]
  }, [regionsQuery.data, servers])

  return (
    <div className="h-full flex flex-col p-6 space-y-4 overflow-y-auto bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa] pb-bottom-nav">
      {/* Header & Main Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
            <ServerIcon className="w-5 h-5 text-[#017cb6]" />
            <span>Virtual Servers</span>
            <span className="text-xs font-normal text-[#6c757d] dark:text-slate-400 bg-[#e9ecef] dark:bg-[#2b3035] px-2 py-0.5 rounded-full border border-[#ced4da] dark:border-[#373b3e]">
              {filteredServers.length} {filteredServers.length === 1 ? 'server' : 'servers'}
            </span>
          </h1>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-0.5">
            Manage compute instances, view live network routes and launch instant terminals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => onOpenTemplates?.()} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded border border-[#ced4da] dark:border-[#495057] hover:border-[#017cb6]">
            <FileCode2 className="w-4 h-4" /> Templates
          </button>
          {/* View Toggle */}
          <div className="flex items-center bg-[#e9ecef] dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded p-0.5">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded transition ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-[#343a40] text-[#017cb6] shadow-sm'
                  : 'text-[#6c757d] dark:text-slate-400 hover:text-[#212529] dark:hover:text-white'
              }`}
              title="Table View (mPanel style)"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded transition ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-[#343a40] text-[#017cb6] shadow-sm'
                  : 'text-[#6c757d] dark:text-slate-400 hover:text-[#212529] dark:hover:text-white'
              }`}
              title="Grid View"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Server</span>
          </button>
          <HelpLink slug="servers" />
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#2b3035] p-3 rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <div className="relative w-full max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-[#6c757d] dark:text-slate-400" />
            <input
              type="text"
              placeholder="Filter servers by name, IP, or tag..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-[#f8f9fa] pl-9 pr-4 py-2 rounded focus:outline-none focus:border-[#017cb6]"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Region Filter */}
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-[#f8f9fa] px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
          >
            <option value="all">All Regions</option>
            {availableRegions.map((r) => (
              <option key={r} value={r!}>
                {r?.toUpperCase()}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-[#f8f9fa] px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
          >
            <option value="all">All Status</option>
            <option value="active">Active / Running</option>
            <option value="off">Off / Stopped</option>
            <option value="archive">Archive</option>
          </select>
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center p-12 space-y-3 bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e]">
          <div className="w-8 h-8 border-2 border-[#017cb6] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-[#6c757d] dark:text-slate-400">Loading server fleet...</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredServers.length === 0 && (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e]">
          <ServerIcon className="w-10 h-10 text-[#6c757d] dark:text-slate-500 mb-3" />
          <h3 className="text-sm font-semibold text-[#212529] dark:text-white">No servers found</h3>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 max-w-sm mt-1 mb-4">
            {searchTerm || regionFilter !== 'all' || statusFilter !== 'all'
              ? 'Try adjusting your search criteria or filter options.'
              : 'You do not have any virtual servers configured yet in this account.'}
          </p>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="px-4 py-2 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition"
          >
            Deploy New Server
          </button>
        </div>
      )}

      {/* View 1: Authentic PanelSite Table View */}
      {!isLoading && filteredServers.length > 0 && viewMode === 'table' && (
        <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm overflow-x-auto flex-shrink-0">
          <table className="w-full min-w-[580px] text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#f1f1f1] dark:bg-[#262a2e] border-b border-[#ced4da] dark:border-[#373b3e] text-[#495057] dark:text-[#ced4da] font-semibold">
                <th className="py-2.5 px-4">Server</th>
                <th className="py-2.5 px-4">Public IP</th>
                <th className="py-2.5 px-4">Private IP / VPC</th>
                <th className="py-2.5 px-4">Configuration</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
              {filteredServers.map((server) => {
                const publicIps = (server.networks?.v4 || []).filter((n) => n.type === 'public')
                const privateIps = (server.networks?.v4 || []).filter((n) => n.type === 'private')
                const state = describeStatus(server.status)
                const ramGB = (server.memory / 1024).toFixed(0)
                const distroIcon = logoForDistribution(server.image?.distribution)

                return (
                  <tr
                    key={server.id}
                    onClick={() => onSelectServer(server)}
                    onContextMenu={(e) => handleContextMenu(server, e)}
                    className="hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] cursor-pointer transition"
                  >
                    {/* Server Name & Distro */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-sm text-[#017cb6] hover:underline flex items-center gap-1.5">
                        <span
                          title={state.label}
                          className={`w-2 h-2 shrink-0 rounded-full ${state.dot} ${state.busy ? 'animate-pulse' : ''}`}
                        />
                        <span>{server.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-[#6c757d] dark:text-slate-400 mt-1">
                        <img src={distroIcon} alt="" className="w-4 h-4 shrink-0 object-contain" />
                        <span>{server.image?.full_name || server.image?.name || 'Linux'}</span>
                      </div>
                      {server.cancelled_at && (
                        <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                          <ShieldAlert className="w-3 h-3" />
                          <span>Cancelled</span>
                        </div>
                      )}
                    </td>

                    {/* Public IP */}
                    <td className="py-3 px-4">
                      {publicIps.length > 0 ? (
                        publicIps.map((ip) => (
                          <div key={ip.ip_address} className="flex items-center gap-1.5 group/ip mb-1">
                            <span className="font-mono text-xs text-[#212529] dark:text-slate-200">
                              {ip.ip_address}
                            </span>
                            <button
                              onClick={(e) => handleCopyIp(ip.ip_address, e)}
                              className="text-[#6c757d] hover:text-[#017cb6] p-0.5 transition"
                              title="Copy IP"
                            >
                              {copiedIp === ip.ip_address ? (
                                <Check className="w-3 h-3 text-emerald-500" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        ))
                      ) : (
                        <span className="text-[#6c757d] text-[11px]">None</span>
                      )}
                    </td>

                    {/* Private IP / VPC */}
                    <td className="py-3 px-4">
                      {privateIps.length > 0 ? (
                        privateIps.map((ip) => (
                          <div key={ip.ip_address} className="font-mono text-xs text-[#6c757d] dark:text-slate-300">
                            {ip.ip_address}
                          </div>
                        ))
                      ) : (
                        <span className="text-[#6c757d] text-[11px]">None</span>
                      )}
                      {server.vpc_id && (
                        <div className="text-[10px] text-[#017cb6] font-medium mt-0.5">
                          <VpcBadge vpcId={server.vpc_id} client={client} />
                        </div>
                      )}
                    </td>

                    {/* Configuration */}
                    <td className="py-3 px-4">
                      <div className="text-xs text-[#212529] dark:text-slate-200 font-medium">
                        {server.vcpus} vCPU • {ramGB} GB RAM
                      </div>
                      <div className="text-[11px] text-[#6c757d] dark:text-slate-400">
                        {server.disk} GB Disk • {server.region?.name || server.region?.slug?.toUpperCase()}
                      </div>
                    </td>

                    {/* Action Buttons */}
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={(e) => handleCopyLink(server.id, e)}
                          className="p-1.5 text-[#6c757d] hover:text-[#017cb6] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded transition"
                          title="Copy bldesk:// link"
                        >
                          {copiedLinkId === server.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Link2 className="w-3.5 h-3.5" />}
                        </button>
                        {publicIps[0]?.ip_address && (
                          <button
                            onClick={(e) => handleOpenSsh(publicIps[0].ip_address, e)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-[#017cb6] hover:bg-[#016594] text-white rounded text-xs font-medium transition shadow-sm"
                            title="Open SSH"
                          >
                            <Terminal className="w-3 h-3" />
                            <span>SSH</span>
                          </button>
                        )}

                        {actionInProgressServerId === server.id ? (
                          <div className="p-1.5 flex items-center justify-center">
                            <Loader2 className="w-3.5 h-3.5 text-[#017cb6] animate-spin" />
                          </div>
                        ) : state.busy ? (
                          // Mid-build: power controls would be meaningless, and
                          // acting on a half-provisioned server is not something
                          // to offer.
                          <div className="p-1.5 flex items-center justify-center" title="Building">
                            <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
                          </div>
                        ) : server.status === 'active' ? (
                          <>
                            <button
                              onClick={(e) => handleAction(server.id, 'reboot', e)}
                              disabled={actionInProgressServerId !== null}
                              className="p-1.5 text-[#6c757d] hover:text-amber-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded transition disabled:opacity-30"
                              title="Reboot"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleAction(server.id, 'shutdown', e)}
                              disabled={actionInProgressServerId !== null}
                              className="p-1.5 text-[#6c757d] hover:text-rose-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded transition disabled:opacity-30"
                              title="Shutdown"
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={(e) => handleAction(server.id, 'power_on', e)}
                            disabled={actionInProgressServerId !== null}
                            className="flex items-center gap-1 px-2 py-1 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs transition hover:bg-emerald-500/20 disabled:opacity-30"
                            title="Power On"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>On</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* View 2: Grid Cards */}
      {!isLoading && filteredServers.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredServers.map((server) => {
            const primaryIp = server.networks?.v4?.find((n) => n.type === 'public')?.ip_address || server.networks?.v4?.[0]?.ip_address
            const state = describeStatus(server.status)
            const distroIcon = logoForDistribution(server.image?.distribution)
            const ramGB = (server.memory / 1024).toFixed(0)

            return (
              <div
                key={server.id}
                onClick={() => onSelectServer(server)}
                className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-4 shadow-sm hover:border-[#017cb6] transition cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <img src={distroIcon} alt="" className="w-5 h-5 object-contain" />
                      <div>
                        <h3 className="font-bold text-sm text-[#017cb6] hover:underline truncate max-w-[180px]">
                          {server.name}
                        </h3>
                        <span className="text-[11px] text-[#6c757d] dark:text-slate-400 font-mono">
                          #{server.id}
                        </span>
                      </div>
                    </div>
                    <span
                      title={(server as any)._power
                        ? `Power state from ${(server as any)._power.source === 'diagnostic' ? 'a hypervisor check' : 'performance samples'}${(server as any)._apiStatus !== server.status ? ` (API says ${(server as any)._apiStatus})` : ''}`
                        : 'From the API status field, which may not reflect power state'}
                      className={`px-2 py-0.5 text-[10px] font-semibold rounded-full inline-flex items-center gap-1 ${state.pill}`}
                    >
                      {state.busy && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                      {state.label}
                    </span>
                  </div>

                  {/* Specs */}
                  <div className="mt-3 py-2 border-t border-b border-[#ced4da]/60 dark:border-[#373b3e] grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <div className="text-[10px] text-[#6c757d] uppercase">CPU</div>
                      <div className="font-semibold">{server.vcpus} vCPU</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#6c757d] uppercase">RAM</div>
                      <div className="font-semibold">{ramGB} GB</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#6c757d] uppercase">Disk</div>
                      <div className="font-semibold">{server.disk} GB</div>
                    </div>
                  </div>

                  {primaryIp && (
                    <div className="mt-2 flex items-center justify-between text-xs font-mono text-[#6c757d] dark:text-slate-300">
                      <span>{primaryIp}</span>
                      <button
                        onClick={(e) => handleCopyIp(primaryIp, e)}
                        className="text-[#6c757d] hover:text-[#017cb6]"
                      >
                        {copiedIp === primaryIp ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-[#ced4da]/60 dark:border-[#373b3e] flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[11px] text-[#6c757d] dark:text-slate-400">
                    {server.region?.name || server.region?.slug?.toUpperCase()}
                  </span>
                  {primaryIp && (
                    <button
                      onClick={(e) => handleOpenSsh(primaryIp, e)}
                      className="px-2.5 py-1 bg-[#017cb6] hover:bg-[#016594] text-white rounded text-xs font-medium transition flex items-center gap-1"
                    >
                      <Terminal className="w-3 h-3" />
                      <span>SSH</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <ServerContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpen={(s) => onSelectServer(s)}
          onSsh={(ip) => { const server = contextMenu.server; void openSsh({ host: ip, username: 'root', serverId: server.id, serverName: server.name }) }}
          onCopyLink={(id) => handleCopyLink(id)}
          onAction={(id, type) => handleAction(id, type, { stopPropagation: () => {} } as React.MouseEvent)}
          actionInProgress={actionInProgressServerId !== null}
        />
      )}

      {/* Create Server Modal */}
      <CreateServerModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        client={client}
        onCreated={(created) => {
          onCreated?.(created)
          setIsCreateOpen(false)
        }}
      />
    </div>
  )
}
