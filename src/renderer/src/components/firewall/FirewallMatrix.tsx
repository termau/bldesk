import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Grid3x3, Info, Loader2, Plus, RefreshCw, ShieldAlert, Tag, Trash2, Users, X } from 'lucide-react'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import { apiFailure, fetchFirewallRules, mapLimitNullable, useFleetFirewalls } from '../../api/queries'
import { useConfirm } from '../../context/ConfirmContext'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { recordChange, updateChange } from '../../lib/changelog'
import { diffLines, describeFirewallRule, type DiffLine } from '../../lib/diff'
import { ruleCount, toRuleRequest } from '../../lib/firewallRules'
import { primaryIpv4 } from '../../lib/deeplinks'
import { auditServer, buildMatrix, publicAddressesOf, worstLevel, type AuditFlag, type FwRule } from '../../lib/firewallMatrix'
import { GROUPS_EVENT, allTags, colorOf, effectiveGroups, loadGroups, loadTagColors, loadTags, newGroup, resolveGroup, saveGroups, saveTags, tagsOf, withTag, type ServerGroup, type TagColorMap, type TagMap } from '../../lib/serverGroups'
import { TagChip } from '../tags/TagChip'
import { useTagEditor } from '../tags/TagEditor'
import { usePhoneLayout } from '../../lib/usePhoneLayout'
import { isComposing } from '../../lib/ime'
import { matchServers } from '../../lib/commands'

type ServerResponse = components['schemas']['Server']

interface Props {
  client: BinaryLaneClient | null
  servers: ServerResponse[]
  profileId?: string
  /** Jump to the single-server view for this server. */
  onSelectServer: (serverId: number) => void
}

const LEVEL_CLASS = {
  red: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/40',
  info: 'bg-sky-500/10 text-sky-800 dark:text-sky-200 border-sky-500/30'
} as const

/**
 * Servers down the side, rule signatures across the top, allow / deny /
 * absent per cell (FEATURES.md #2). The audit answers "which box still has
 * SSH open to the world" without reading 33 rule lists. "Copy ruleset" writes
 * one server's list to many, each behind its own diff and each logged.
 */
export const FirewallMatrix: React.FC<Props> = ({ client, servers, profileId, onSelectServer }) => {
  const confirmAction = useConfirm()
  const { track } = useTrackedActions()

  // --- Groups
  const [groups, setGroups] = useState<ServerGroup[]>(() => loadGroups(profileId))
  const [tags, setTags] = useState<TagMap>(() => loadTags(profileId))
  const [tagColors, setTagColors] = useState<TagColorMap>(() => loadTagColors(profileId))
  const tagEditor = useTagEditor(profileId, servers)
  // On a phone the tags here are only shown: they are added, renamed, coloured and removed in the server's Settings, Tags.
  const phone = usePhoneLayout()
  const [groupId, setGroupId] = useState<string>('all')
  const [isNewGroupOpen, setIsNewGroupOpen] = useState(false)
  /** Row whose tag editor is open. */
  const [tagEditId, setTagEditId] = useState<number | null>(null)
  useEffect(() => {
    setGroups(loadGroups(profileId))
    setTags(loadTags(profileId))
    setTagColors(loadTagColors(profileId))
    setGroupId('all')
    const onChange = () => {
      setGroups(loadGroups(profileId))
      setTags(loadTags(profileId))
      setTagColors(loadTagColors(profileId))
    }
    window.addEventListener(GROUPS_EVENT, onChange)
    return () => window.removeEventListener(GROUPS_EVENT, onChange)
  }, [profileId])

  // Saved groups plus one per tag in use, so a tag is a group without ceremony.
  const allGroups = useMemo(() => effectiveGroups(groups, tags), [groups, tags])
  /** A saved group named like a tag also includes the servers with that tag, and the list says so. */
  const tagNames = useMemo(() => new Set(allTags(tags).map((t) => t.tag)), [tags])
  const activeGroup = allGroups.find((g) => g.id === groupId)
  const scoped = useMemo(() => (activeGroup ? resolveGroup(activeGroup, servers, tags) : servers), [activeGroup, servers, tags])

  const setServerTag = (serverId: number, tag: string, present: boolean) => {
    if (!profileId) return
    saveTags(profileId, withTag(tags, [serverId], tag, present))
  }
  const scopedIds = useMemo(() => scoped.map((s) => s.id), [scoped])

  // --- Data
  const fleet = useFleetFirewalls(client, scopedIds)
  const rulesByServer = fleet.data ?? new Map<number, FwRule[] | null>()
  const accountAddresses = useMemo(() => {
    const set = new Set<string>()
    for (const s of servers) for (const n of s.networks?.v4 ?? []) if (n.ip_address) set.add(n.ip_address)
    return set
  }, [servers])

  const matrix = useMemo(() => buildMatrix(rulesByServer), [rulesByServer])
  const audits = useMemo(() => {
    const m = new Map<number, AuditFlag[]>()
    // A server the fleet read has not answered about yet is still loading, not unreadable: only an answer of null is.
    for (const s of scoped) m.set(s.id, rulesByServer.has(s.id) ? auditServer(rulesByServer.get(s.id) ?? null, accountAddresses, publicAddressesOf(s)) : [])
    return m
  }, [scoped, rulesByServer, accountAddresses])

  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const rows = useMemo(() => {
    const list = onlyFlagged ? scoped.filter((s) => (audits.get(s.id)?.length ?? 0) > 0) : scoped
    // Red first, then amber, then the rest in list order.
    const rank = (s: ServerResponse) => ({ red: 0, amber: 1, info: 2 }[worstLevel(audits.get(s.id) ?? []) ?? 'info'] ?? 3)
    return [...list].sort((a, b) => rank(a) - rank(b))
  }, [scoped, audits, onlyFlagged])

  const summary = useMemo(() => {
    let red = 0
    let noRules = 0
    let unreadable = 0
    let ssh = 0
    for (const s of scoped) {
      const f = audits.get(s.id) ?? []
      if (f.some((x) => x.level === 'red')) red++
      if (f.some((x) => x.code === 'no-rules')) noRules++
      if (f.some((x) => x.code === 'unreadable')) unreadable++
      if (f.some((x) => x.code === 'ssh-world')) ssh++
    }
    return { red, noRules, unreadable, ssh }
  }, [scoped, audits])

  // --- Copy ruleset
  const [copyOpen, setCopyOpen] = useState(false)
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [targetIds, setTargetIds] = useState<Set<number>>(new Set())
  const [copying, setCopying] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  const sourceRules = sourceId != null ? (rulesByServer.get(sourceId) ?? null) : null
  // A copy replaces a server's whole list, so a server whose rules could not be
  // read (null) has no "before" to diff against and is never written to.
  const readable = (id: number) => !!rulesByServer.get(id)
  const targets = scoped.filter((s) => targetIds.has(s.id) && s.id !== sourceId && readable(s.id))

  const toggleTarget = (id: number) =>
    setTargetIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleCopy = async () => {
    if (!client || sourceId == null || !sourceRules || targets.length === 0 || copying) return
    const source = servers.find((s) => s.id === sourceId)

    // The fleet read can be a minute old, and a copy replaces each target's whole list: a rule added to a target since
    // would be removed by a diff that never showed it. So the source and every target are read again now, and the diff
    // and the write are built from those reads. A server that cannot be read now is not written to.
    setCopying(true)
    setCopyError(null)
    const ids = [sourceId, ...targets.map((t) => t.id)]
    const reads = await mapLimitNullable(ids, 4, (id) => fetchFirewallRules(client, id))
    const now = new Map<number, FwRule[] | null>(ids.map((id, i) => [id, reads[i]]))
    setCopying(false)
    const sourceNow = now.get(sourceId)
    if (!sourceNow) {
      setCopyError(`Couldn't read the firewall rules on ${source?.name ?? sourceId}. Nothing was changed: a copy needs its current rules first.`)
      return
    }
    // A copy of no rules would clear every selected server's list, which is Disable firewall on each and is confirmed as such.
    if (sourceNow.length === 0) {
      setCopyError(`${source?.name ?? sourceId} has no rules, so copying it would remove every rule on the selected servers. Nothing was changed. Disable the firewall on a server from its own Firewall tab if that is what you want.`)
      return
    }
    const readNow = targets.filter((t) => now.get(t.id))
    const unreadable = targets.filter((t) => !now.get(t.id))
    if (readNow.length === 0) {
      setCopyError(`Couldn't read the firewall rules on ${unreadable.map((t) => t.name).join(', ')}. Nothing was changed: a copy replaces a server's whole list, so it needs the current one first.`)
      return
    }
    const outgoing = sourceNow.map(toRuleRequest)
    const after = outgoing.map(describeFirewallRule)

    // One combined preview: a heading line per target, then that target's diff.
    const combined: DiffLine[] = []
    const perTarget = new Map<number, DiffLine[]>()
    for (const t of readNow) {
      const before = now.get(t.id)!.map(describeFirewallRule)
      const d = diffLines(before, after)
      perTarget.set(t.id, d)
      combined.push({ kind: 'same', text: `── ${t.name} (#${t.id}) ──` }, ...d)
    }
    const unchanged = readNow.filter((t) => !perTarget.get(t.id)?.some((l) => l.kind !== 'same'))

    const c = await confirmAction({
      title: 'Copy firewall rules',
      helpSlug: 'firewall#copy-a-ruleset',
      target: { kind: 'server', name: `${readNow.length} server${readNow.length === 1 ? '' : 's'}` },
      summary: `Replaces the rule list on each selected server with the ${ruleCount(after.length)} from ${source?.name ?? sourceId}.${
        unchanged.length ? ` ${unchanged.length} already match and will be skipped.` : ''
      }${unreadable.length ? ` ${unreadable.length} could not be read just now and will not be written to: ${unreadable.map((t) => t.name).join(', ')}.` : ''}`,
      severity: 'destructive',
      notes: ['Each server is written separately and recorded separately in History, so a failure on one does not affect the others.'],
      diff: combined,
      confirmLabel: `Write to ${readNow.length - unchanged.length} server${readNow.length - unchanged.length === 1 ? '' : 's'}`,
      log: false
    })
    if (!c.ok) return

    setCopying(true)
    const failures: string[] = unreadable.map((t) => `${t.name}: couldn't read its rules just now, so nothing was written.`)
    for (const t of readNow) {
      if (unchanged.includes(t)) continue
      const changeId = await recordChange({
        label: 'Copy firewall rules',
        target: { kind: 'server', id: t.id, name: t.name },
        severity: 'destructive',
        summary: `From ${source?.name ?? sourceId}`,
        diff: perTarget.get(t.id),
        source: 'ui'
      })
      try {
        const { data, error, response } = await client.POST('/v2/servers/{server_id}/actions', {
          params: { path: { server_id: t.id } },
          body: { type: 'change_advanced_firewall_rules', firewall_rules: outgoing }
        })
        if (error || !response.ok) throw apiFailure(error, response)
        if (data?.action) track(data.action, 'Copy firewall rules', t.name, changeId)
        else void updateChange(changeId, { outcome: 'completed' })
      } catch (err: any) {
        void updateChange(changeId, { outcome: 'failed', detail: err?.message || String(err) })
        failures.push(`${t.name}: ${err?.message || err}`)
      }
    }
    setCopying(false)
    if (failures.length) setCopyError(failures.join('\n'))
    else {
      setCopyOpen(false)
      setTargetIds(new Set())
    }
    void fleet.refetch()
  }

  // --- Groups CRUD
  const handleCreateGroup = (name: string, pattern: string) => {
    if (!profileId || !name.trim()) return
    const g = newGroup(name, pattern)
    saveGroups(profileId, [...groups, g])
    setGroupId(g.id)
    setIsNewGroupOpen(false)
  }
  const handleDeleteGroup = async (g: ServerGroup) => {
    if (!profileId) return
    const r = await confirmAction({
      title: 'Delete group',
      target: { kind: 'account', name: `@${g.name}` },
      summary: 'Removes the saved group. Servers are not affected.',
      severity: 'destructive',
      log: false,
      confirmLabel: 'Delete group'
    })
    if (!r.ok) return
    saveGroups(profileId, groups.filter((x) => x.id !== g.id))
    setGroupId('all')
  }

  const scroller = useRef<HTMLDivElement>(null)
  const scrollBy = (dir: -1 | 1) => scroller.current?.scrollBy({ left: dir * Math.max(240, scroller.current.clientWidth * 0.6), behavior: 'smooth' })

  const cellClass = (state: 'accept' | 'drop' | 'mixed' | undefined) =>
    state === 'accept'
      ? 'text-emerald-600 dark:text-emerald-400'
      : state === 'drop'
        ? 'text-rose-600 dark:text-rose-400'
        : state === 'mixed'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-[#ced4da] dark:text-[#495057]'

  return (
    // Fills the rest of the Firewall page so the matrix below scrolls in its own box, header row and server columns pinned.
    <div className="flex-1 min-h-0 flex flex-col space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 bg-white dark:bg-[#2b3035] px-3 py-1.5 border border-[#ced4da] dark:border-[#373b3e] rounded shadow-sm">
          <Users className="w-3.5 h-3.5 text-fg-link" />
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="bg-transparent text-xs text-[#212529] dark:text-white focus-ring rounded cursor-pointer max-w-[200px]"
          >
            <option value="all" className="bg-white dark:bg-[#2b3035]">
              All servers ({servers.length})
            </option>
            {allGroups.map((g) => (
              <option key={g.id} value={g.id} className="bg-white dark:bg-[#2b3035]">
                @{g.name} ({resolveGroup(g, servers, tags).length}){g.id.startsWith('tag_') ? ' · tag' : tagNames.has(g.name.toLowerCase()) ? ' · group + tag' : ''}
              </option>
            ))}
          </select>
          {activeGroup && !activeGroup.id.startsWith('tag_') && (
            <button onClick={() => handleDeleteGroup(activeGroup)} title="Delete this group" className="text-fg-muted hover:text-rose-500">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={() => setIsNewGroupOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" /> New group
        </button>
        <label className="flex items-center gap-1.5 text-xs text-[#495057] dark:text-slate-300 ml-1">
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Only flagged
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              setCopyOpen((v) => !v)
              setCopyError(null)
            }}
            disabled={scoped.length < 2}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded shadow-sm disabled:opacity-40"
          >
            <Copy className="w-3.5 h-3.5" /> Copy ruleset…
          </button>
          <button
            onClick={() => void fleet.refetch()}
            disabled={fleet.isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded shadow-sm disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${fleet.isFetching ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* New group */}
      {isNewGroupOpen && <NewGroupForm servers={servers} tags={tags} onSave={handleCreateGroup} onClose={() => setIsNewGroupOpen(false)} />}

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2.5 py-1 rounded border border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#2b3035]">
          {scoped.length} server{scoped.length === 1 ? '' : 's'} · {matrix.columns.length} distinct rule{matrix.columns.length === 1 ? '' : 's'}
        </span>
        {summary.ssh > 0 && (
          <span className={`px-2.5 py-1 rounded border ${LEVEL_CLASS.red} flex items-center gap-1`}>
            <ShieldAlert className="w-3.5 h-3.5" /> SSH open to the world on {summary.ssh}
          </span>
        )}
        {summary.red - summary.ssh > 0 && (
          <span className={`px-2.5 py-1 rounded border ${LEVEL_CLASS.red}`}>{summary.red - summary.ssh} more with admin ports open</span>
        )}
        {summary.noRules > 0 && (
          <span className={`px-2.5 py-1 rounded border ${LEVEL_CLASS.amber} flex items-center gap-1`}>
            <AlertTriangle className="w-3.5 h-3.5" /> {summary.noRules} with no rules at all
          </span>
        )}
        {summary.unreadable > 0 && (
          <span className={`px-2.5 py-1 rounded border ${LEVEL_CLASS.amber}`}>{summary.unreadable} could not be read</span>
        )}
        {fleet.isLoading && (
          <span className="px-2.5 py-1 text-fg-muted flex items-center gap-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading rules…
          </span>
        )}
      </div>

      {/* Copy panel */}
      {copyOpen && (
        <div className="p-3 bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded text-xs space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-fg-muted">Copy the rules of</span>
            <select
              value={sourceId ?? ''}
              onChange={(e) => setSourceId(Number(e.target.value) || null)}
              className="px-2 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded focus-ring"
            >
              <option value="">choose a source…</option>
              {scoped.map((s) => {
                // undefined = the fleet read has not answered yet; null = it answered and this server could not be read.
                const r = rulesByServer.get(s.id)
                return (
                  <option key={s.id} value={s.id} disabled={r == null}>
                    {s.name} ({r === null ? 'unreadable' : r === undefined ? 'loading' : ruleCount(r.length)})
                  </option>
                )
              })}
            </select>
            <span className="text-fg-muted">to:</span>
            <button onClick={() => setTargetIds(new Set(scoped.filter((s) => s.id !== sourceId && readable(s.id)).map((s) => s.id)))} className="underline text-fg-link">
              everyone {activeGroup ? `in @${activeGroup.name}` : ''}
            </button>
            <button onClick={() => setTargetIds(new Set())} className="underline text-fg-muted">
              none
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {scoped
              .filter((s) => s.id !== sourceId)
              .map((s) => (
                <label
                  key={s.id}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded border ${readable(s.id) ? 'cursor-pointer' : 'cursor-not-allowed'} ${
                    targets.includes(s) ? 'border-[#017cb6] bg-[#017cb6]/10' : 'border-[#ced4da] dark:border-[#373b3e]'
                  }`}
                >
                  <input type="checkbox" className={readable(s.id) ? '' : 'opacity-60'} checked={targets.includes(s)} disabled={!readable(s.id)} onChange={() => toggleTarget(s.id)} />
                  <span className={`font-mono ${readable(s.id) ? '' : 'opacity-60'}`}>{s.name}</span>
                  {/* Not dimmed with the rest: it is the only explanation for the disabled box. */}
                  {rulesByServer.get(s.id) === null && <span className="text-fg-muted">unreadable</span>}
                </label>
              ))}
          </div>
          {copyError && <pre className="text-rose-600 dark:text-rose-400 whitespace-pre-wrap">{copyError}</pre>}
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleCopy()}
              disabled={copying || sourceId == null || !sourceRules || targets.length === 0}
              className="px-3 py-1.5 rounded bg-[#017cb6] hover:bg-[#016594] text-white font-semibold disabled:opacity-40 flex items-center gap-1.5"
            >
              {copying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
              Review diff for {targets.length} server{targets.length === 1 ? '' : 's'}…
            </button>
            <button onClick={() => setCopyOpen(false)} className="px-3 py-1.5 rounded border border-[#ced4da] dark:border-[#373b3e]">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Matrix — the container owns both scrolls; the horizontal scrollbar is
          forced visible because macOS hides overlay scrollbars until you move,
          which made 47 columns look like 12. */}
      {matrix.columns.length > 0 && (
        <div className="flex items-center gap-2 text-[0.6875rem] text-fg-muted dark:text-slate-400 -mb-2">
          <span>{matrix.columns.length} rule columns — Shift + wheel, drag the bar, or</span>
          <button onClick={() => scrollBy(-1)} className="p-0.5 rounded border border-[#ced4da] dark:border-[#373b3e] hover:bg-white dark:hover:bg-[#32383e]" title="Scroll left">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => scrollBy(1)} className="p-0.5 rounded border border-[#ced4da] dark:border-[#373b3e] hover:bg-white dark:hover:bg-[#32383e]" title="Scroll right">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <span>Server and Audit stay put.</span>
        </div>
      )}
      <div ref={scroller} className={`${rows.length > 3 ? 'flex-initial min-h-[12rem]' : 'flex-shrink-0'} bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg overflow-x-scroll overflow-y-auto [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-track]:bg-[#f1f1f1] dark:[&::-webkit-scrollbar-track]:bg-[#212529] [&::-webkit-scrollbar-thumb]:bg-[#adb5bd] dark:[&::-webkit-scrollbar-thumb]:bg-[#495057] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#017cb6]`}>
        <table className="text-xs border-collapse min-w-full">
          <thead>
            <tr className="bg-[#f8f9fa] dark:bg-[#212529]">
              <th className="sticky left-0 top-0 z-30 bg-[#f8f9fa] dark:bg-[#212529] shadow-[inset_0_-1px_0_#ced4da] dark:shadow-[inset_0_-1px_0_#373b3e] text-left px-3 py-2 font-semibold border-b border-r border-[#ced4da] dark:border-[#373b3e] w-[220px] min-w-[220px] max-w-[220px]">
                Server
              </th>
              <th className="sticky left-[220px] top-0 z-30 bg-[#f8f9fa] dark:bg-[#212529] shadow-[inset_0_-1px_0_#ced4da] dark:shadow-[inset_0_-1px_0_#373b3e] px-3 py-2 font-semibold border-b border-r border-[#ced4da] dark:border-[#373b3e] text-left min-w-[260px] max-w-[340px]">
                Audit
              </th>
              {matrix.columns.map((c) => (
                <th
                  key={c.sig}
                  title={`${c.sig}${c.description ? ` — ${c.description}` : ''} · on ${c.count} server${c.count === 1 ? '' : 's'}`}
                  className="sticky top-0 z-20 bg-[#f8f9fa] dark:bg-[#212529] shadow-[inset_0_-1px_0_#ced4da] dark:shadow-[inset_0_-1px_0_#373b3e] px-2 py-2 font-medium border-b border-[#ced4da] dark:border-[#373b3e] text-center align-bottom whitespace-nowrap"
                >
                  <div className="font-mono text-[0.6875rem] text-[#212529] dark:text-white">
                    {c.protocol} {c.ports}
                  </div>
                  <div className="text-[0.625rem] text-fg-muted font-normal">← {c.source}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const row = matrix.cells.get(s.id)
              const rules = rulesByServer.get(s.id)
              const flags = audits.get(s.id) ?? []
              const level = worstLevel(flags)
              return (
                <tr key={s.id} className="border-t border-[#ced4da]/60 dark:border-[#373b3e] hover:bg-[#f8f9fa] dark:hover:bg-[#32383e]">
                  {/* Exactly 220px wide, because the Audit column sticks at left-[220px]: a wider Server column (a long name, larger
                      text) would slide under it on horizontal scroll. The inner width is definite so a long name cannot raise the
                      column's minimum; the name and address line truncate and the name keeps its full text in the tooltip. */}
                  <td className="sticky left-0 z-10 bg-white dark:bg-[#2b3035] px-3 py-1.5 border-r border-[#ced4da] dark:border-[#373b3e] w-[220px] min-w-[220px] max-w-[220px]">
                    <div className="w-[calc(220px-1.5rem)]">
                      <button onClick={() => onSelectServer(s.id)} title={s.name} className="inline-flex items-center max-w-full text-left hover:underline">
                        <span className={`inline-block shrink-0 w-1.5 h-1.5 rounded-full mr-2 ${level === 'red' ? 'bg-rose-500' : level === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                        <span className="font-semibold truncate">{s.name}</span>
                      </button>
                      <div className="text-[0.625rem] text-fg-muted font-mono pl-3.5 truncate">
                        {primaryIpv4(s) ?? '—'} · {rules === null ? 'unreadable' : rules === undefined ? 'loading' : ruleCount(rules.length)}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 pl-3.5 mt-1">
                        {tagsOf(tags, s.id).map((t) => (
                          <TagChip
                            key={t}
                            tag={t}
                            color={colorOf(tagColors, t)}
                            className="max-w-[min(9rem,100%)]"
                            onEdit={profileId && !phone ? (el) => tagEditor.open(t, el, s.id) : undefined}
                            onRemove={phone ? undefined : () => setServerTag(s.id, t, false)}
                          />
                        ))}
                        {phone ? null : tagEditId === s.id ? (
                          <TagInput onAdd={(tag) => setServerTag(s.id, tag, true)} onClose={() => setTagEditId(null)} />
                        ) : (
                          <button
                            onClick={() => setTagEditId(s.id)}
                            title="Add a tag"
                            className="text-[0.625rem] px-1.5 py-0.5 rounded border border-dashed border-[#ced4da] dark:border-[#495057] text-fg-muted hover:border-[#017cb6] hover:text-fg-link flex items-center gap-0.5"
                          >
                            <Tag className="w-2.5 h-2.5" />+
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="sticky left-[220px] z-10 bg-white dark:bg-[#2b3035] px-3 py-1.5 border-r border-[#ced4da] dark:border-[#373b3e] min-w-[260px] max-w-[340px] align-top">
                    <div className="flex flex-wrap gap-1">
                      {flags.length === 0 && rules && rules.length > 0 && <span className="text-[0.625rem] text-emerald-600 dark:text-emerald-400">no findings</span>}
                      {flags.map((f, i) => (
                        <span key={i} className={`text-[0.625rem] px-1.5 py-0.5 rounded border ${LEVEL_CLASS[f.level]} flex items-center gap-1 whitespace-nowrap`}>
                          {f.level === 'info' ? <Info className="w-3 h-3" /> : f.level === 'red' ? <ShieldAlert className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                          {f.text}
                        </span>
                      ))}
                    </div>
                  </td>
                  {matrix.columns.map((c) => {
                    const state = row?.get(c.sig)
                    return (
                      <td key={c.sig} className={`text-center px-2 py-1.5 font-mono ${cellClass(state)}`} title={state ? `${state} ${c.sig}` : 'absent'}>
                        {state === 'accept' ? <Check className="w-3.5 h-3.5 inline" /> : state === 'drop' ? <X className="w-3.5 h-3.5 inline" /> : state === 'mixed' ? '±' : '·'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={matrix.columns.length + 2} className="px-3 py-8 text-center text-fg-muted">
                  {onlyFlagged ? (fleet.isLoading ? 'Reading rules…' : 'Nothing flagged.') : 'No servers in this group.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[0.6875rem] text-fg-muted dark:text-slate-400 flex items-center gap-1.5">
        <Grid3x3 className="w-3.5 h-3.5" /> Columns are rule signatures (protocol, ports, source). <Check className="w-3 h-3 text-emerald-500" /> accept ·{' '}
        <X className="w-3 h-3 text-rose-500" /> drop · ± both · dot absent. Rules evaluate first-match, so order still matters inside a server; the single-server view shows it.
      </p>
      {tagEditor.element}
    </div>
  )
}

// The two text inputs keep their own state, so typing re-renders the input and not every cell of the matrix.
const NewGroupForm: React.FC<{
  servers: ServerResponse[]
  tags: TagMap
  onSave: (name: string, pattern: string) => void
  onClose: () => void
}> = ({ servers, tags, onSave, onClose }) => {
  const [newName, setNewName] = useState('')
  const [newPattern, setNewPattern] = useState('')
  const previewCount = useMemo(() => (newPattern.trim() ? matchServers(servers, newPattern).matches.length : 0), [servers, newPattern])
  return (
    <div className="flex flex-wrap items-end gap-2 p-3 bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded text-xs">
      <label className="space-y-1">
        <span className="block text-fg-muted">Name</span>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value.replace(/[@,\s]/g, ''))}
          placeholder="web"
          className="px-2 py-1.5 font-mono bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded focus:outline-none focus:border-[#017cb6] w-36"
        />
      </label>
      <label className="space-y-1 flex-1 min-w-[220px]">
        <span className="block text-fg-muted">Members (palette targets: glob, #id, IP prefix, comma list). Servers tagged with the group's name are members too.</span>
        <input
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          placeholder="wp-web-*,wp-ha-lb"
          className="w-full px-2 py-1.5 font-mono bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded focus:outline-none focus:border-[#017cb6]"
        />
      </label>
      <span className="text-fg-muted pb-2">{newPattern.trim() ? `${previewCount} match` : ''}</span>
      <button
        onClick={() => onSave(newName, newPattern)}
        disabled={!newName.trim() || (previewCount === 0 && !Object.values(tags).some((l) => l.includes(newName.trim().toLowerCase())))}
        className="px-3 py-1.5 rounded bg-[#017cb6] hover:bg-[#016594] text-white font-semibold disabled:opacity-40"
      >
        Save @{newName || 'group'}
      </button>
      <button onClick={onClose} className="p-1.5 text-fg-muted hover:text-[#212529] dark:hover:text-white">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

const TagInput: React.FC<{ onAdd: (tag: string) => void; onClose: () => void }> = ({ onAdd, onClose }) => {
  const [tagInput, setTagInput] = useState('')
  return (
    <input
      autoFocus
      value={tagInput}
      onChange={(e) => setTagInput(e.target.value)}
      onKeyDown={(e) => {
        // Enter that confirms an IME composition is not a submit.
        if (isComposing(e)) return
        if (e.key === 'Enter' && tagInput.trim()) {
          onAdd(tagInput)
          setTagInput('')
        } else if (e.key === 'Escape') {
          onClose()
        }
      }}
      onBlur={onClose}
      placeholder="tag ↵"
      className="w-20 px-1.5 py-0.5 text-[0.625rem] font-mono bg-[#f8f9fa] dark:bg-[#212529] border border-[#017cb6] rounded focus-ring"
    />
  )
}
