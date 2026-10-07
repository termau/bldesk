import { LoadError } from '../ui/LoadError'
import { HelpLink } from '../ui/HelpLink'
import React, { useState } from 'react'
import { openServerSsh } from '../../lib/openServerSsh'
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
import { describeStatus, compareServersForList, ARCHIVE_HINT } from '../../lib/serverStatus'
import { useConfirm } from '../../context/ConfirmContext'
import { updateChange } from '../../lib/changelog'
import { powerActionSummary } from '../../lib/actionLabels'
import { notifyFailure } from '../../lib/failures'
import { colorOf, tagsOf } from '../../lib/serverGroups'
import { completeTagToken, liveTagCounts, matchesTagFilter, matchesTagPrefixes, parseTagSearch, tagSuggestions } from '../../lib/tags'
import { TagChip, TagDot, TagOverflowChip } from '../tags/TagChip'
import { TagFilter } from './TagFilter'
import { FILTER_CONTROL, FilterShell } from './FilterControl'
import { usePhoneLayout } from '../../lib/usePhoneLayout'
import { useTagEditor } from '../tags/TagEditor'
import { useTagState } from '../tags/useTagState'

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
  profileId?: string
  /** The server-list read failed; `hasData` says the list on screen is a saved one. */
  loadError?: { message?: string; hasData: boolean; isFetching: boolean; onRetry: () => void } | null
}

export const ServerList: React.FC<ServerListProps> = ({
  servers,
  isLoading,
  client,
  onSelectServer,
  onOpenTerminal: _onOpenTerminal,
  onOpenTemplates,
  onCreated,
  profileId,
  loadError
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [regionFilter, setRegionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  /** Tags ticked in the tag filter, and whether a server needs any or all of them. */
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [tagMode, setTagMode] = useState<'any' | 'all'>('any')
  const [searchFocused, setSearchFocused] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const [suggestionsHidden, setSuggestionsHidden] = useState(false)
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
  const { tags, colors } = useTagState(profileId)
  const tagEditor = useTagEditor(profileId, servers)
  // On a phone (the narrow layout, or the Android app) the chips here are only labels: a double-click is not something
  // a finger does, so tags are edited in the server's own Settings > Tags.
  const phone = usePhoneLayout()

  const handleCopyIp = (ip: string, e: React.MouseEvent, key = ip) => {
    e.stopPropagation()
    navigator.clipboard.writeText(ip)
    setCopiedIp(key)
    setTimeout(() => setCopiedIp(null), 1500)
  }

  const confirmAction = useConfirm()
  const handleAction = async (serverId: number, actionType: 'power_on' | 'power_off' | 'power_cycle' | 'reboot' | 'shutdown', e: React.MouseEvent) => {
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
      notifyFailure('Action failed', err)
    } finally {
      setActionInProgressServerId(null)
    }
  }

  const handleOpenSsh = (server: ServerResponse, e: React.MouseEvent) => {
    e.stopPropagation()
    void openServerSsh(server)
  }

  /*
   * Tags are local to this device and profile (the API has none), so they come from the tag store. Only tags on
   * servers still in the list are offered, with the count of those servers.
   */
  const tagOptions = React.useMemo(() => liveTagCounts(tags, new Set(servers.map((s) => s.id))), [tags, servers])
  // Ticked tags that were renamed, removed or lost their last server drop out of the selection: a filter on a tag nobody
  // has would show nothing and the tag is no longer in the list to untick.
  React.useEffect(() => {
    if (isLoading || servers.length === 0) return
    const still = tagFilter.filter((t) => tagOptions.some((o) => o.tag === t))
    if (still.length !== tagFilter.length) setTagFilter(still)
  }, [tagFilter, tagOptions, isLoading, servers.length])

  /*
   * Two namespaces, always explicit. Plain text in the search is for servers: name, address or #id, never a tag. A word
   * starting with @ is for tags: @word matches tags that start with word, several @ words must all match, and none of
   * it is compared with a server name. Plain text and @ words are ANDed (wp @wordpress).
   */
  const { plain: plainSearch, tagPrefixes } = parseTagSearch(searchTerm)
  const filteredServers = [...servers].sort(compareServersForList).filter((s) => {
    const query = plainSearch.toLowerCase()
    const own = tagsOf(tags, s.id)
    const matchesSearch =
      !query ||
      s.name.toLowerCase().includes(query) ||
      (s.networks?.v4 || []).some((net) => net.ip_address.includes(plainSearch)) ||
      (/^#\d+$/.test(query) && s.id === Number(query.slice(1)))

    const matchesRegion = regionFilter === 'all' || s.region?.slug === regionFilter
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter
    const matchesTag = matchesTagFilter(own, tagFilter, tagMode)

    return matchesSearch && matchesTagPrefixes(own, tagPrefixes) && matchesRegion && matchesStatus && matchesTag
  })

  // While the last word is an @ word, offer the tags in use that start with it.
  const suggestions = searchFocused && !suggestionsHidden ? tagSuggestions(searchTerm, tagOptions) : []
  const completeSuggestion = (tag: string) => {
    setSearchTerm(completeTagToken(searchTerm, tag))
    setActiveSuggestion(0)
  }

  const MAX_LIST_TAGS = 3
  /** A server's tags as chips, the first few and a "+N" for the rest; null when it has none. */
  const renderTags = (serverId: number) => {
    const own = tagsOf(tags, serverId)
    if (own.length === 0) return null
    return (
      <span className="inline-flex flex-wrap items-center gap-1 min-w-0 font-normal">
        {own.slice(0, MAX_LIST_TAGS).map((t) => (
          <TagChip
            key={t}
            tag={t}
            color={colorOf(colors, t)}
            className="max-w-[9rem]"
            onEdit={profileId && !phone ? (el) => tagEditor.open(t, el, serverId) : undefined}
          />
        ))}
        {own.length > MAX_LIST_TAGS && <TagOverflowChip tags={own.slice(MAX_LIST_TAGS)} />}
      </span>
    )
  }

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
      {loadError && <LoadError what="server list" hasData={loadError.hasData} message={loadError.message} isFetching={loadError.isFetching} onRetry={loadError.onRetry} />}

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
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-controls="server-search-suggestions"
              aria-autocomplete="list"
              aria-activedescendant={suggestions.length > 0 ? `server-search-suggestion-${activeSuggestion}` : undefined}
              placeholder="Filter by name or IP, or @tag..."
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="search"
              aria-label="Filter servers by name or IP, or by @tag"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setActiveSuggestion(0)
                setSuggestionsHidden(false)
              }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={(e) => {
                if (suggestions.length === 0) return
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActiveSuggestion((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  completeSuggestion(suggestions[Math.min(activeSuggestion, suggestions.length - 1)].tag)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setSuggestionsHidden(true)
                }
              }}
              className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-[#f8f9fa] pl-9 pr-4 py-2 rounded focus:outline-none focus:border-[#017cb6]"
            />
            {suggestions.length > 0 && (
              <ul
                id="server-search-suggestions"
                role="listbox"
                aria-label="Tags"
                className="absolute z-30 left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto rounded border border-[#ced4da] dark:border-[#495057] bg-white dark:bg-[#2b3035] shadow-lg py-1 text-xs"
              >
                {suggestions.map((t, i) => (
                  <li
                    key={t.tag}
                    id={`server-search-suggestion-${i}`}
                    role="option"
                    aria-selected={i === activeSuggestion}
                    // mousedown, not click: the box keeps focus, so the list is still there to take the click
                    onMouseDown={(e) => {
                      e.preventDefault()
                      completeSuggestion(t.tag)
                    }}
                    onMouseEnter={() => setActiveSuggestion(i)}
                    className={`flex items-center gap-2 px-3 ${phone ? 'min-h-[44px]' : 'py-1.5'} cursor-pointer ${i === activeSuggestion ? 'bg-[#017cb6]/10' : ''}`}
                  >
                    <TagDot color={colorOf(colors, t.tag)} />
                    <span className="truncate flex-1 min-w-0">@{t.tag}</span>
                    <span className="text-[#6c757d] dark:text-slate-400 shrink-0">{t.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Region Filter */}
          <FilterShell>
            <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className={`appearance-none ${FILTER_CONTROL}`}>
              <option value="all">All Regions</option>
              {availableRegions.map((r) => (
                <option key={r} value={r!}>
                  {r?.toUpperCase()}
                </option>
              ))}
            </select>
          </FilterShell>

          {/* Status Filter */}
          <FilterShell>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`appearance-none ${FILTER_CONTROL}`}>
              <option value="all">All Status</option>
              <option value="active">Active / Running</option>
              <option value="off">Off / Stopped</option>
              <option value="archive" title={ARCHIVE_HINT}>Archive</option>
            </select>
          </FilterShell>

          {/* Tag Filter (local tags): tick boxes in a list, with Any | All */}
          <TagFilter
            options={tagOptions.map((t) => ({ ...t, color: colorOf(colors, t.tag) }))}
            selected={tagFilter}
            onChange={setTagFilter}
            mode={tagMode}
            onModeChange={setTagMode}
          />
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
      {!isLoading && !loadError && filteredServers.length === 0 && (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e]">
          <ServerIcon className="w-10 h-10 text-[#6c757d] dark:text-slate-500 mb-3" />
          <h3 className="text-sm font-semibold text-[#212529] dark:text-white">No servers found</h3>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 max-w-sm mt-1 mb-4">
            {searchTerm || regionFilter !== 'all' || statusFilter !== 'all' || tagFilter.length > 0
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

      {/* View 1: table view, laid out like mPanel's */}
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
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <div className="font-bold text-sm text-[#017cb6] hover:underline flex items-center gap-1.5">
                          <span
                            title={state.hint ? `${state.label}: ${state.hint}` : state.label}
                            className={`w-2 h-2 shrink-0 rounded-full ${state.dot} ${state.busy ? 'animate-pulse' : ''}`}
                          />
                          <span>{server.name}</span>
                        </div>
                        {renderTags(server.id)}
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
                        {(
                          <button
                            onClick={(e) => handleOpenSsh(server, e)}
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
        // The cards of a row stretch to the tallest one (the grid's default), so a row of cards is one height. The footer (region
        // and SSH) stays pinned to the bottom of its card, as it did: in the tallest card of a row it is 8px under the last address
        // row, and in a shorter card the extra space sits between that row and the footer's divider.
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredServers.map((server) => {
            // What the table's Public IP and Private IP / VPC columns list, in rows. The first public IPv4 (the one this tile
            // always showed) comes first, as it does in the server's Overview; any other public ones are its secondary
            // addresses. The private ones follow in one row, called "VPC IP" for a server in a VPC and "Private IP" for one
            // that is not, with the VPC's name on its own line under them, as the table shows it under its private address. "Public IP:" is always
            // there, with the table's "None" when the server has no public address; a server in a VPC always has its private
            // row, with "None" if no private address is listed. Otherwise a row with nothing in it is left out.
            const publicIps = (server.networks?.v4 || []).filter((n) => n.type === 'public')
            const secondaryIps = publicIps.slice(1)
            const privateIps = (server.networks?.v4 || []).filter((n) => n.type === 'private')
            const inVpc = !!server.vpc_id
            const addressRows = [
              { kind: 'public', label: 'Public IP:', ips: publicIps.slice(0, 1) },
              { kind: 'secondary', label: secondaryIps.length > 1 ? 'Secondary IPs:' : 'Secondary IP:', ips: secondaryIps },
              { kind: 'private', label: `${inVpc ? 'VPC IP' : 'Private IP'}${privateIps.length > 1 ? 's' : ''}:`, ips: privateIps }
            ].filter((row) => row.kind === 'public' || row.ips.length > 0 || (row.kind === 'private' && inVpc))
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
                      title={state.hint ?? ((server as any)._power
                        ? `Power state from ${(server as any)._power.source === 'diagnostic' ? 'a hypervisor check' : 'performance samples'}${(server as any)._apiStatus !== server.status ? ` (API says ${(server as any)._apiStatus})` : ''}`
                        : 'From the API status field, which may not reflect power state')}
                      className={`px-2 py-0.5 text-[10px] font-semibold rounded-full inline-flex items-center gap-1 ${state.pill}`}
                    >
                      {state.busy && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                      {state.label}
                    </span>
                  </div>

                  {tagsOf(tags, server.id).length > 0 && <div className="mt-2">{renderTags(server.id)}</div>}

                  {/* Specs */}
                  <div className="mt-2 py-2 border-t border-b border-[#ced4da]/60 dark:border-[#373b3e] grid grid-cols-3 gap-2 text-center text-xs">
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

                  {/* One row per kind of address, divided as the card's own sections are: every divider in the card has 8px of space
                      above and below it (py-2 here, as in the specs block above and the footer below). The footer's divider is the
                      one exception, in a card shorter than the tallest in its row: the extra space is above it, since the footer is
                      pinned to the bottom. A row's addresses wrap to the card's width, each with its copy button beside it. */}
                  <div className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e] text-xs font-mono text-[#6c757d] dark:text-slate-300">
                    {addressRows.map((row) => (
                      <div key={row.kind} className="py-2">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="font-sans text-[11px] -mr-2 dark:text-slate-400">{row.label}</span>
                          {row.ips.length === 0 ? (
                            <span className="font-sans text-[11px] text-[#6c757d]">None</span>
                          ) : (
                            row.ips.map((ip) => {
                              // Keyed by server too: a private address can be the same on two servers.
                              const copyKey = `${server.id}:${ip.ip_address}`
                              return (
                                <div key={ip.ip_address} className="flex items-center gap-1.5">
                                  <span>{ip.ip_address}</span>
                                  <button
                                    onClick={(e) => handleCopyIp(ip.ip_address, e, copyKey)}
                                    // On a phone the button's touch area grows without moving anything (the padding is taken back by the margin).
                                    // It grows sideways more than up and down: wrapped addresses are 20 px apart, so a taller area would overlap the next line's.
                                    className={`text-[#6c757d] hover:text-[#017cb6] ${phone ? 'px-2 py-1 -mx-2 -my-1' : ''}`}
                                    title={`Copy ${ip.ip_address}`}
                                    aria-label={`Copy ${ip.ip_address}`}
                                  >
                                    {copiedIp === copyKey ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                  </button>
                                </div>
                              )
                            })
                          )}
                        </div>
                        {row.kind === 'private' && inVpc && (
                          // The same component as the table's Private IP / VPC column: the network's icon and name, "VPC #id" until it
                          // is known. It is on its own line under the addresses, in the same row (no divider), at the row's left edge
                          // under its label, and a long name is cut with an ellipsis at the card's width.
                          <div className="mt-1 flex min-w-0 font-sans font-medium text-[#017cb6]">
                            <VpcBadge vpcId={server.vpc_id} client={client} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-[#ced4da]/60 dark:border-[#373b3e] flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[11px] text-[#6c757d] dark:text-slate-400">
                    {server.region?.name || server.region?.slug?.toUpperCase()}
                  </span>
                  {(
                    <button
                      onClick={(e) => handleOpenSsh(server, e)}
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
          onSsh={() => { void openServerSsh(contextMenu.server) }}
          onCopyLink={(id) => handleCopyLink(id)}
          onAction={(id, type) => handleAction(id, type, { stopPropagation: () => {} } as React.MouseEvent)}
          actionInProgress={actionInProgressServerId !== null}
        />
      )}

      {/* The editor a tag chip opens: placed by the chip, so it is drawn here, outside the scrolling table */}
      {tagEditor.element}

      {/* Create Server Modal */}
      <CreateServerModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        client={client}
        profileId={profileId}
        onCreated={(created) => {
          onCreated?.(created)
          setIsCreateOpen(false)
        }}
      />
    </div>
  )
}
