import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Search,
  Server,
  Globe,
  Receipt,
  Terminal,
  Network,
  Shield,
  Layers,
  Zap,
  Power,
  RotateCw,
  Play,
  Archive,
  Radio,
  Link2,
  ExternalLink,
  History,
  HelpCircle,
  AlertTriangle,
  Check,
  X,
  Loader2,
  CornerDownLeft,
  Tag,
  LucideIcon
} from 'lucide-react'
import { components } from '@shared/api/schema'
import type { DeepLinkServerSubTab } from '@shared/deeplink'
import { BinaryLaneClient } from '../../api/client'
import { useDomains, useServerActionMutation, type ServerActionBody, apiFailure, fetchServerBackups, mapLimitNullable } from '../../api/queries'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { copyDeepLink, primaryIpv4 } from '../../lib/deeplinks'
import { openServerSsh } from '../../lib/openServerSsh'
import { searchHelp } from '../../lib/help'
import { openHelp } from '../../lib/helpNavigation'
import { recordChange, updateChange } from '../../lib/changelog'
import { describeBackup, replacedByOldest, TEMPORARY_BACKUP_TERMS } from '../../lib/backupSlots'
import { colorOf, expandGroupRefs, loadGroups, loadTagColors, loadTags, saveTags, withTag, allTags, normaliseTag, tagServerCount, tagsOf } from '../../lib/serverGroups'
import { completeTagToken, liveTagCounts, matchesTagPrefixes, parseTagSearch, tagSuggestions } from '../../lib/tags'
import { TagChip } from '../tags/TagChip'
import {
  POWER_VERBS,
  TARGET_HELP,
  VERB_SPECS,
  detectVerb,
  loadRecentCommands,
  matchServers,
  parseCommand,
  partitionByStatus,
  rememberCommand,
  resolveDnsTarget,
  verbsMatching,
  type ParsedCommand,
  type TargetMatch
} from '../../lib/commands'
import type { ActiveTab, ServerSubTab } from '../layout/Sidebar'
import { notifyFailure } from '../../lib/failures'
import { isComposing } from '../../lib/ime'
import { holdLayer, isTopLayer, layerCount } from '../../lib/dialogLayer'

type ServerResponse = components['schemas']['Server']

interface CommandPaletteProps {
  isOpen: boolean
  /** Cmd/Ctrl+K toggles: the palette owns the shortcut so it works from any view. */
  onOpen: () => void
  onClose: () => void
  servers: ServerResponse[]
  client: BinaryLaneClient | null
  /** Active account — groups and tags are stored per profile. */
  profileId?: string
  onSelectServer: (server: ServerResponse) => void
  onSelectServerSubTab: (tab: ServerSubTab) => void
  onNavigateTab: (tab: ActiveTab) => void
  /** `create <hostname> from <template>` — the Templates tab prompts for variables and opens the create form. */
  onCreateFromTemplate?: (template: string, hostname: string) => void
}

type Tone = 'default' | 'ok' | 'skip' | 'bad' | 'muted'

interface Row {
  id: string
  title: string
  subtitle?: string
  category: string
  icon: LucideIcon
  tone?: Tone
  /** Enter on this row. Absent → Enter runs the command-level primary action. */
  onEnter?: () => void
  /** Tab on this row replaces the query with this text. */
  fill?: string
  /** Drawn in place of `title` (a tag row shows its coloured chip); `title` still names the row. */
  titleNode?: React.ReactNode
}

interface Outcome {
  target: string
  ok: boolean
  detail?: string
}

type Stage = 'input' | 'confirm' | 'running' | 'done'

const NAV_ROWS: Array<{ tab: ActiveTab; title: string; icon: LucideIcon }> = [
  { tab: 'help', title: 'Help & Ask BinaryLane', icon: HelpCircle },
  { tab: 'servers', title: 'Go to Virtual Servers', icon: Server },
  { tab: 'vpcs', title: 'Go to VPC Networks', icon: Network },
  { tab: 'firewall', title: 'Go to Firewall Rules', icon: Shield },
  { tab: 'loadbalancers', title: 'Go to Load Balancers', icon: Layers },
  { tab: 'terminal', title: 'Open Embedded SSH Shell', icon: Terminal },
  { tab: 'dns', title: 'Manage DNS Domains & Records', icon: Globe },
  { tab: 'billing', title: 'View Billing & Invoices', icon: Receipt }
]

const POWER_ICON: Record<keyof typeof POWER_VERBS, LucideIcon> = {
  reboot: RotateCw,
  shutdown: Power,
  poweroff: Power,
  start: Play,
  cycle: RotateCw
}

const serverSubtitle = (s: ServerResponse) =>
  `${primaryIpv4(s) || 'No IP'} • ${s.region?.name || s.region?.slug} • ${s.vcpus} vCPU / ${(s.memory / 1024).toFixed(0)} GB`

const statusDot = (s: ServerResponse) => (s.status === 'active' ? '●' : s.status === 'off' ? '○' : '◌')

/** Rewrite the target token (the first word after the verb) with a concrete server name. */
function fillTarget(query: string, name: string): string {
  const parts = query.trim().split(/\s+/)
  if (parts.length <= 1) return `${parts[0] ?? ''} ${name} `
  parts[1] = name
  return parts.join(' ') + (parts.length === 2 ? ' ' : '')
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onOpen,
  onClose,
  servers,
  client,
  profileId,
  onSelectServer,
  onSelectServerSubTab,
  onNavigateTab,
  onCreateFromTemplate
}) => {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [stage, setStage] = useState<Stage>('input')
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [replaceLines, setReplaceLines] = useState<string[]>([])
  /** The backup each server's take may replace, by server id: recorded in History with the run. */
  const replaceMap = useRef(new Map<number, string>())
  const checkRun = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const ids = useId()
  const listId = `${ids}-list`
  const optionId = (idx: number) => `${ids}-opt-${idx}`
  // What had focus when it opened, read while rendering (the input's autoFocus takes focus before an effect runs).
  const opener = useRef<Element | null | undefined>(undefined)
  if (isOpen && opener.current === undefined) opener.current = document.activeElement

  const queryClient = useQueryClient()
  const serverAction = useServerActionMutation(client)
  const { track } = useTrackedActions()

  const parsed = useMemo<ParsedCommand | null>(() => parseCommand(query), [query])
  const verb = useMemo(() => detectVerb(query), [query])

  // Domains are only fetched once the user is actually typing a dns command.
  const domainsQuery = useDomains(parsed?.kind === 'dns-add' ? client : null)

  // A backup check that is still running when the review is left has nothing to report to, and what it found belongs to
  // that review alone: the next one, whatever its command, starts without it.
  useEffect(() => {
    if (stage === 'input') {
      checkRun.current++
      setChecking(false)
      setReplaceLines([])
      replaceMap.current = new Map()
    }
  }, [stage])

  // Reset when (re)opened so a half-typed destructive command never survives a close.
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setStage('input')
      setOutcomes([])
      setNotice(null)
    }
  }, [isOpen])

  // While open, the page behind it is inert; on closing, focus goes back to what opened it, unless a command has put it
  // somewhere since.
  useEffect(() => {
    if (!isOpen) return
    const release = overlayRef.current ? holdLayer(overlayRef.current) : () => {}
    return () => {
      release()
      const back = opener.current
      opener.current = undefined
      const now = document.activeElement
      if (back instanceof HTMLElement && back.isConnected && (!now || now === document.body)) back.focus()
    }
  }, [isOpen])

  // A stage change can take away the focused control (Run, Done): focus stays in the palette, on its input.
  useEffect(() => {
    if (!isOpen) return
    if (!overlayRef.current?.contains(document.activeElement)) inputRef.current?.focus()
  }, [isOpen, stage])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (isOpen) onClose()
        // A dialog owns the keyboard while it is open. A palette raised over it sits under its backdrop, and its Enter
        // would be heard by the dialog as well. The phone's navigation drawer is the same: anything holding the page
        // inert (lib/dialogLayer.ts) keeps it shut.
        else if (layerCount() === 0) onOpen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onOpen, onClose])

  // ---------------------------------------------------------------------
  // Command resolution — everything derived from `parsed` and the server list
  // ---------------------------------------------------------------------

  const close = () => onClose()

  /*
   * Escape that the panel does not hear, because it is not typed in the palette: Android's Back sends it to the document
   * (lib/androidBack.ts), and focus can be on a notification above the palette. It does what Escape does in the panel:
   * back from the review to the command, and closed otherwise; nothing while a command runs (data-dismissible is then
   * "false", so Back does nothing either). One the panel has handled is already answered (defaultPrevented).
   */
  const onEscape = useRef<() => void>(() => {})
  onEscape.current = () => {
    if (stage === 'confirm') setStage('input')
    else if (stage !== 'running') close()
  }
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isComposing(e) || !isTopLayer(overlayRef.current)) return
      e.preventDefault()
      onEscape.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])

  /**
   * `backup` sends replacement_strategy `oldest`: with no free temporary slot,
   * BinaryLane replaces the oldest temporary backup that is not locked or
   * attached. The palette only has each server's backup ids, so before the review
   * can be confirmed it reads the backups of every server that holds any (the read
   * the Backups tab makes), four at a time so a large selection is not a burst of
   * requests, and names the one that would go.
   */
  const checkReplacements = async (targets: ServerResponse[]) => {
    if (!client) return
    const run = ++checkRun.current
    setChecking(true)
    setReplaceLines([])
    replaceMap.current = new Map()
    const found = await mapLimitNullable(
      targets.filter((s) => s.backup_ids?.length),
      4,
      async (s) => {
        // The review was left while this one waited its turn: nothing is left to report to.
        if (run !== checkRun.current) return null
        try {
          const backups = await fetchServerBackups(client, s.id)
          const hit = replacedByOldest('temporary', undefined, backups, s.attached_backup?.id)
          if (!hit) return null
          const what = `${hit.backup.name ?? 'Backup'} (#${hit.backup.id}), ${describeBackup(hit.backup)}`
          replaceMap.current.set(s.id, what)
          return `${s.name}: ${what}`
        } catch {
          return `${s.name}: could not list its backups, so BLDesk cannot say which would be replaced`
        }
      }
    )
    if (run !== checkRun.current) return
    setReplaceLines(found.filter((l): l is string => !!l))
    setChecking(false)
  }

  const openServer = (s: ServerResponse, subTab?: DeepLinkServerSubTab) => {
    onSelectServer(s)
    if (subTab) onSelectServerSubTab(subTab as ServerSubTab)
    onNavigateTab('servers')
  }

  const sshTo = async (s: ServerResponse, native = false) => {
    rememberCommand(query)
    close()
    await openServerSsh(s, profileId, native)
  }

  const consoleFor = async (s: ServerResponse) => {
    if (!client) return
    rememberCommand(query)
    openServer(s, 'remote-access')
    close()
    try {
      const { data, error, response } = await client.GET('/v2/servers/{server_id}/console', {
        params: { path: { server_id: s.id } }
      })
      if (error || !response.ok) throw apiFailure(error, response)
      const url = data?.console?.browser || data?.console?.iframe
      if (!url) throw new Error('BinaryLane returned no console URL.')
      const opened = await window.bldeskApi?.openRescueConsole?.({
        serverId: s.id,
        serverName: s.name,
        url,
        width: data?.console?.width || 1024,
        height: data?.console?.height || 768
      })
      if (opened && !opened.success) throw new Error(opened.error || 'The console window did not open.')
    } catch (err: any) {
      notifyFailure(`Couldn't open a rescue console for ${s.name}`, err)
    }
  }

  const copyLink = async (s: ServerResponse, subTab?: DeepLinkServerSubTab) => {
    rememberCommand(query)
    const url = await copyDeepLink({ kind: 'server', serverId: s.id, subTab })
    setNotice(`Copied ${url}`)
    setTimeout(close, 700)
  }

  /**
   * matchServers, with `@group` / `@tag` references expanded first. Groups and
   * tags are read fresh each time so a tag added a moment ago works at once.
   */
  const resolveTargets = (expression: string) => {
    const groups = loadGroups(profileId)
    const tags = loadTags(profileId)
    const { expression: expanded, unknownGroups } = expandGroupRefs(expression, groups, servers, tags)
    const r = expanded ? matchServers(servers, expanded) : { matches: [], unmatched: [] as string[] }
    return { matches: r.matches, unmatched: [...r.unmatched, ...unknownGroups] }
  }

  /**
   * Rows and the Enter behaviour for the current query. Kept as one derivation
   * so the preview the user confirms is the same object the executor runs on.
   */
  const resolved = useMemo(() => {
    const q = query.trim()
    const rows: Row[] = []
    let header: { icon: LucideIcon; text: string; tone?: Tone } | null = null
    let primary: (() => void) | null = null
    /** The targets a confirm will act on, in order. */
    let plan: { label: string; run: () => Promise<Outcome[]>; targets: string[] } | null = null

    // --- No verb: the noun palette (recent, verb suggestions, navigation, servers)
    if (!parsed) {
      if (!q) {
        for (const cmd of loadRecentCommands()) {
          rows.push({
            id: `recent-${cmd}`,
            title: cmd,
            category: 'Recent',
            icon: History,
            fill: cmd,
            onEnter: () => setQuery(cmd.endsWith(' ') ? cmd : `${cmd} `)
          })
        }
      }
      // Suggest verbs while the first word is being typed.
      if (!q.includes(' ')) {
        for (const spec of q ? verbsMatching(q) : []) {
          rows.push({
            id: `verb-${spec.verb}`,
            title: spec.usage,
            subtitle: spec.summary,
            category: 'Command',
            icon: Zap,
            fill: `${spec.usage.split(' ')[0]} `,
            onEnter: () => setQuery(`${spec.usage.split(' ')[0]} `)
          })
        }
      }
      // Two namespaces, always explicit: plain text lists servers by name (or address), never by tag; a word starting
      // with @ lists servers by tag, @word matching tags that start with word, and several @ words must all match.
      const { plain, tagPrefixes } = parseTagSearch(q)
      const byTag = tagPrefixes.length > 0
      const needle = (byTag ? plain : q).toLowerCase()
      const tagMap = byTag ? loadTags(profileId) : null
      if (tagMap) {
        // The tags being typed come first, as rows to choose: the same list, order and prefix rule as the Servers
        // search's @ suggestions. Choosing one completes the word and lists its servers; it runs nothing. A tag typed in
        // full has nothing left to complete, so it has no row of its own and its servers are listed straight away.
        const typed = query.trimStart()
        const colours = loadTagColors(profileId)
        for (const t of tagSuggestions(typed, liveTagCounts(tagMap, new Set(servers.map((s) => s.id))), Infinity)) {
          const complete = completeTagToken(typed, t.tag)
          rows.push({
            id: `tag-row-${t.tag}`,
            title: `@${t.tag}`,
            titleNode: <TagChip tag={t.tag} color={colorOf(colours, t.tag)} size="md" />,
            subtitle: `${t.count} ${t.count === 1 ? 'server' : 'servers'}`,
            category: 'Tags',
            icon: Tag,
            fill: complete,
            onEnter: () => setQuery(complete)
          })
        }
      }
      for (const nav of byTag ? [] : NAV_ROWS) {
        if (!needle || nav.title.toLowerCase().includes(needle) || nav.tab.includes(needle)) {
          rows.push({
            id: `nav-${nav.tab}`,
            title: nav.title,
            category: 'Navigation',
            icon: nav.icon,
            onEnter: () => {
              onNavigateTab(nav.tab)
              close()
            }
          })
        }
      }
      for (const s of servers) {
        if (tagMap && !matchesTagPrefixes(tagsOf(tagMap, s.id), tagPrefixes)) continue
        const sub = serverSubtitle(s)
        if (!needle || s.name.toLowerCase().includes(needle) || sub.toLowerCase().includes(needle)) {
          rows.push({
            id: `server-${s.id}`,
            title: s.name,
            subtitle: sub,
            category: 'Servers',
            icon: Server,
            onEnter: () => {
              openServer(s)
              close()
            }
          })
        }
      }
      if (byTag) {
        const words = tagPrefixes.join('') === '' ? 'with a tag' : `tagged ${tagPrefixes.map((p) => `@${p}`).join(' ')}`
        header = { icon: Tag, text: `Servers ${words} (${rows.filter((r) => r.category === 'Servers').length})`, tone: 'default' }
      } else if (q && !q.includes(' ')) {
        // Plain text that is also a tag's name: one separate row says so and rewrites the query on Enter. The server
        // rows above are still only the servers whose name matches.
        const inUse = allTags(loadTags(profileId)).find((t) => t.tag === q.toLowerCase())
        const n = inUse ? tagServerCount(loadTags(profileId), inUse.tag, new Set(servers.map((s) => s.id))) : 0
        if (inUse && n > 0) {
          rows.push({
            id: `tag-${inUse.tag}`,
            title: `Tag @${inUse.tag} · ${n} ${n === 1 ? 'server' : 'servers'}`,
            subtitle: `Press Enter to list the servers with this tag. Plain text finds servers by name only.`,
            category: 'Tags',
            icon: Tag,
            fill: `@${inUse.tag}`,
            onEnter: () => setQuery(`@${inUse.tag}`)
          })
        }
      }
      if (!q) {
        const tagList = allTags(loadTags(profileId))
        if (tagList.length) {
          rows.push({
            id: 'tags',
            title: `Groups: ${tagList.map((t) => `@${t.tag} (${t.count})`).join('  ')}`,
            subtitle: 'Use as a target, e.g. restart @web',
            category: 'Tags',
            icon: Tag,
            tone: 'muted'
          })
        }
        rows.push({
          id: 'help',
          title: 'Type a verb: restart, shutdown, start, backup, ssh, open, console, link, dns, tag, go — or ? for help',
          category: 'Tip',
          icon: HelpCircle,
          tone: 'muted',
          onEnter: () => setQuery('? ')
        })
      }
      return { rows, header, primary, plan }
    }

    // --- Help
    if (parsed.kind === 'ask') {
      header = { icon: HelpCircle, text: 'Ask about published BinaryLane articles. Leave out account details.' }
      rows.push({ id: 'ask-binarylane', title: parsed.query, category: 'Help', icon: HelpCircle,
        onEnter: () => { openHelp({ query: parsed.query, ask: true }); close() } })
      return { rows, header, primary, plan }
    }
    if (parsed.kind === 'help') {
      if (parsed.query) {
        header = { icon: HelpCircle, text: 'Help for BLDesk' }
        for (const hit of searchHelp(parsed.query).slice(0, 20)) rows.push({
          id: `help-page-${hit.page.slug}`, title: hit.page.title, subtitle: hit.page.summary,
          category: 'Help', icon: HelpCircle,
          onEnter: () => { openHelp({ slug: hit.page.slug, heading: hit.heading }); close() }
        })
        return { rows, header, primary, plan }
      }
      header = { icon: HelpCircle, text: 'Commands. Targets accept names, globs (wp-*), #id, IPv4 prefixes, and comma lists.' }
      for (const spec of VERB_SPECS.filter((s) => s.verb !== 'help')) {
        rows.push({
          id: `help-${spec.verb}`,
          title: spec.usage,
          subtitle: spec.summary,
          category: spec.mutates ? 'Action' : 'Navigate',
          icon: spec.mutates ? Zap : ExternalLink,
          fill: `${spec.usage.split(' ')[0]} `,
          onEnter: () => setQuery(`${spec.usage.split(' ')[0]} `)
        })
      }
      return { rows, header, primary, plan }
    }

    // --- Verb typed, arguments not yet valid: show usage, offer servers to fill in
    if (parsed.kind === 'incomplete') {
      header = {
        icon: AlertTriangle,
        text: parsed.problem ?? `Usage: ${parsed.usage}`,
        tone: parsed.problem ? 'bad' : 'muted'
      }
      const wantsServer = !['go', 'dns', 'help', 'ask'].includes(parsed.verb)
      if (wantsServer && !parsed.problem) {
        for (const s of servers) {
          rows.push({
            id: `pick-${s.id}`,
            title: `${statusDot(s)} ${s.name}`,
            subtitle: serverSubtitle(s),
            category: 'Target',
            icon: Server,
            fill: fillTarget(query, s.name),
            onEnter: () => setQuery(fillTarget(query, s.name))
          })
        }
        if (rows.length === 0) header = { icon: AlertTriangle, text: `Usage: ${parsed.usage}. ${TARGET_HELP}`, tone: 'muted' }
      }
      return { rows, header, primary, plan }
    }

    // --- Create from template: the Templates tab does the asking; nothing is built from here.
    if (parsed.kind === 'create') {
      header = { icon: ExternalLink, text: `New server ${parsed.hostname} from “${parsed.template}”` }
      primary = () => {
        rememberCommand(query)
        onCreateFromTemplate?.(parsed.template, parsed.hostname)
        close()
      }
      rows.push({ id: 'create', title: `Fill in the template's variables, then review the create form`, category: 'Create', icon: ExternalLink, onEnter: primary })
      return { rows, header, primary, plan }
    }

    // --- Navigation
    if (parsed.kind === 'go') {
      header = { icon: ExternalLink, text: `Go to ${parsed.tab}` }
      primary = () => {
        rememberCommand(query)
        onNavigateTab(parsed.tab as ActiveTab)
        close()
      }
      rows.push({ id: 'go', title: `Open the ${parsed.tab} tab`, category: 'Navigate', icon: ExternalLink, onEnter: primary })
      return { rows, header, primary, plan }
    }

    // --- DNS add
    if (parsed.kind === 'dns-add') {
      const zones = domainsQuery.data ?? []
      const target = resolveDnsTarget(zones, parsed.fqdn)
      if (domainsQuery.isLoading) {
        header = { icon: Loader2, text: 'Loading hosted zones…', tone: 'muted' }
      } else if (!target) {
        header = { icon: AlertTriangle, text: `No hosted zone on this account matches ${parsed.fqdn}.`, tone: 'bad' }
      } else {
        const summary = `${parsed.type} ${target.name === '@' ? target.domain : `${target.name}.${target.domain}`} → ${parsed.value}${
          parsed.priority !== undefined ? ` (priority ${parsed.priority})` : ''
        }`
        header = { icon: Globe, text: `Add record in zone ${target.domain}` }
        rows.push({ id: 'dns', title: summary, subtitle: `name "${target.name}" in ${target.domain}`, category: 'DNS', icon: Globe, tone: 'ok' })
        plan = {
          label: `Add ${parsed.type} record`,
          targets: [summary],
          run: async () => {
            if (!client) return [{ target: summary, ok: false, detail: 'No API client' }]
            const changeId = await recordChange({
              label: 'Add DNS record',
              target: { kind: 'domain', name: target.domain },
              severity: 'normal',
              changes: [{ label: `${parsed.type} ${target.name}`, to: parsed.priority !== undefined ? `${parsed.priority} ${parsed.value}` : parsed.value }],
              summary: `Palette: ${query.trim()}`,
              source: 'palette'
            })
            const { error, response } = await client.POST('/v2/domains/{domain_name}/records', {
              params: { path: { domain_name: target.domain } },
              body: { type: parsed.type, name: target.name, data: parsed.value, priority: parsed.priority ?? null }
            })
            if (error || !response.ok) {
              const detail = apiFailure(error, response).message
              void updateChange(changeId, { outcome: 'failed', detail })
              return [{ target: summary, ok: false, detail }]
            }
            void updateChange(changeId, { outcome: 'completed' })
            void queryClient.invalidateQueries({ queryKey: ['domainRecords', target.domain] })
            return [{ target: summary, ok: true }]
          }
        }
        primary = () => setStage('confirm')
      }
      return { rows, header, primary, plan }
    }

    // --- Tags (local): tag add web wp-* / tag remove web #101
    if (parsed.kind === 'tag') {
      const { matches, unmatched } = resolveTargets(parsed.targets)
      // Show the name that will be stored: spaces and other characters are dropped, so `"my tag"` is `@mytag`.
      const tagName = normaliseTag(parsed.tag)
      if (!tagName) {
        header = { icon: AlertTriangle, text: `"${parsed.tag}" has no usable characters. A tag is letters, numbers, dots, dashes and underscores.`, tone: 'bad' }
        return { rows, header, primary, plan }
      }
      const verbLabel = parsed.op === 'add' ? `Tag @${tagName}` : `Untag @${tagName}`
      if (matches.length === 0) {
        header = { icon: AlertTriangle, text: `No server matches "${parsed.targets}". ${TARGET_HELP}`, tone: 'bad' }
        return { rows, header, primary, plan }
      }
      const parts = [`${verbLabel} — ${matches.length} server${matches.length === 1 ? '' : 's'}`]
      if (unmatched.length) parts.push(`no match: ${unmatched.join(', ')}`)
      header = { icon: Tag, text: parts.join(' · '), tone: unmatched.length ? 'skip' : 'default' }
      for (const m of matches) {
        const current = loadTags(profileId)[m.server.id] ?? []
        rows.push({
          id: `t-${m.server.id}`,
          title: `${statusDot(m.server)} ${m.server.name}`,
          subtitle: current.length ? `tags: ${current.map((t) => `@${t}`).join(' ')}` : 'no tags',
          category: verbLabel,
          icon: Tag,
          tone: 'ok'
        })
      }
      // Local only, no API call — apply immediately, no review step.
      primary = () => {
        if (!profileId) return
        saveTags(profileId, withTag(loadTags(profileId), matches.map((m) => m.server.id), tagName, parsed.op === 'add'))
        rememberCommand(query)
        setNotice(`${verbLabel}: ${matches.length} server${matches.length === 1 ? '' : 's'}. Use @${tagName} as a target anywhere.`)
        setTimeout(close, 900)
      }
      return { rows, header, primary, plan }
    }

    // --- Single-server verbs: ssh / console / open / link
    if (parsed.kind === 'ssh' || parsed.kind === 'console' || parsed.kind === 'open' || parsed.kind === 'link') {
      const { matches, unmatched } = resolveTargets(parsed.target)
      const act = (s: ServerResponse) => {
        switch (parsed.kind) {
          case 'ssh':
            return void sshTo(s, parsed.native)
          case 'console':
            return void consoleFor(s)
          case 'open':
            if (parsed.console) return void consoleFor(s)
            rememberCommand(query)
            openServer(s, parsed.subTab)
            return close()
          case 'link':
            return void copyLink(s, parsed.subTab)
        }
      }
      const verbLabel =
        parsed.kind === 'ssh'
          ? 'SSH as root to'
          : parsed.kind === 'console' || (parsed.kind === 'open' && parsed.console)
            ? 'Open rescue console for'
            : parsed.kind === 'open'
              ? `Open${parsed.subTab ? ` ${parsed.subTab} of` : ''}`
              : `Copy${parsed.subTab ? ` ${parsed.subTab}` : ''} link for`
      const icon = parsed.kind === 'ssh' ? Terminal : parsed.kind === 'link' ? Link2 : parsed.kind === 'console' || parsed.console ? Radio : ExternalLink

      if (matches.length === 0) {
        header = { icon: AlertTriangle, text: `No server matches "${parsed.target}". ${TARGET_HELP}`, tone: 'bad' }
        return { rows, header, primary, plan }
      }
      header = {
        icon,
        text: matches.length === 1 ? `${verbLabel} ${matches[0].server.name}` : `${verbLabel}… ${matches.length} servers match — pick one`,
        tone: unmatched.length ? 'skip' : 'default'
      }
      for (const m of matches) {
        rows.push({
          id: `m-${m.server.id}`,
          title: `${statusDot(m.server)} ${m.server.name}`,
          subtitle: serverSubtitle(m.server),
          category: 'Target',
          icon: Server,
          fill: fillTarget(query, m.server.name),
          onEnter: () => act(m.server)
        })
      }
      return { rows, header, primary, plan }
    }

    // --- Multi-server mutations: power verbs and backup
    if (parsed.kind === 'power' || parsed.kind === 'backup') {
      const { matches, unmatched } = resolveTargets(parsed.targets)
      const spec = parsed.kind === 'power' ? POWER_VERBS[parsed.verb] : null
      const label = parsed.kind === 'power' ? spec!.label : `Backup${parsed.label ? ` "${parsed.label}"` : ''}`
      const icon = parsed.kind === 'power' ? POWER_ICON[parsed.verb] : Archive
      const { eligible, skipped } =
        parsed.kind === 'power' ? partitionByStatus(matches, spec!.requires) : { eligible: matches, skipped: [] as Array<TargetMatch & { reason: string }> }

      if (matches.length === 0) {
        header = { icon: AlertTriangle, text: `No server matches "${parsed.targets}". ${TARGET_HELP}`, tone: 'bad' }
        return { rows, header, primary, plan }
      }

      const parts = [`${label} — ${eligible.length} server${eligible.length === 1 ? '' : 's'}`]
      if (skipped.length) parts.push(`${skipped.length} skipped`)
      if (unmatched.length) parts.push(`no match: ${unmatched.join(', ')}`)
      header = { icon, text: parts.join(' · '), tone: eligible.length ? (unmatched.length ? 'skip' : 'default') : 'bad' }

      for (const m of eligible) {
        rows.push({ id: `e-${m.server.id}`, title: `${statusDot(m.server)} ${m.server.name}`, subtitle: serverSubtitle(m.server), category: label, icon, tone: 'ok' })
      }
      for (const m of skipped) {
        rows.push({ id: `s-${m.server.id}`, title: `${statusDot(m.server)} ${m.server.name}`, subtitle: `skipped — ${m.reason}`, category: 'Skip', icon: Server, tone: 'skip' })
      }

      if (eligible.length > 0) {
        const body: ServerActionBody =
          parsed.kind === 'power'
            ? { type: spec!.type }
            : { type: 'take_backup', replacement_strategy: 'oldest', backup_type: 'temporary', label: parsed.label || undefined }
        plan = {
          label,
          targets: eligible.map((m) => m.server.name),
          run: async () => {
            const results: Outcome[] = []
            // Sequential on purpose: N parallel POSTs to one account is exactly the
            // burst the client's anti-spam layer exists to prevent.
            for (const m of eligible) {
              const replaces = parsed.kind === 'backup' ? replaceMap.current.get(m.server.id) : undefined
              const changeId = await recordChange({
                label,
                target: { kind: 'server', id: m.server.id, name: m.server.name },
                severity: replaces || (parsed.kind === 'power' && (parsed.verb === 'poweroff' || parsed.verb === 'cycle')) ? 'destructive' : 'normal',
                changes: replaces ? [{ label: 'Replaced if no slot is free', from: replaces, to: 'New temporary backup' }] : undefined,
                summary: `Palette: ${query.trim()}`,
                source: 'palette'
              })
              try {
                const queued = await serverAction.mutateAsync({ serverId: m.server.id, actionPayload: body })
                if (queued) track(queued, label, m.server.name, changeId)
                results.push({ target: m.server.name, ok: true, detail: queued?.id ? `action #${queued.id}` : undefined })
              } catch (err: any) {
                void updateChange(changeId, { outcome: 'failed', detail: err?.message || String(err) })
                results.push({ target: m.server.name, ok: false, detail: err?.message || String(err) })
              }
            }
            return results
          }
        }
        primary = () => {
          setStage('confirm')
          if (parsed.kind === 'backup') void checkReplacements(eligible.map((m) => m.server))
        }
      }
      return { rows, header, primary, plan }
    }

    return { rows, header, primary, plan }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, query, servers, client, profileId, domainsQuery.data, domainsQuery.isLoading])

  const { rows, header, primary, plan } = resolved

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // The arrow keys bring the chosen row into view; the pointer choosing one does not scroll the list under it.
  const arrowed = useRef(false)
  useEffect(() => {
    if (!arrowed.current) return
    arrowed.current = false
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // ---------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------

  const execute = async () => {
    if (!plan || stage !== 'confirm' || checking) return
    setStage('running')
    setOutcomes([])
    try {
      const results = await plan.run()
      setOutcomes(results)
      if (results.some((r) => r.ok)) rememberCommand(query)
    } catch (err: any) {
      setOutcomes([{ target: plan.label, ok: false, detail: err?.message || String(err) }])
    } finally {
      setStage('done')
    }
  }

  // On the panel, so Escape and Enter work wherever focus is in it. A focused button keeps its own Enter and Space.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (stage === 'running') {
      e.preventDefault()
      return
    }
    // Mid-composition, Enter, Escape and the arrows belong to the input method.
    if (isComposing(e)) return
    if (e.key === 'Enter' && e.target instanceof HTMLButtonElement) return
    // Tab stays in the palette (it is a completion key in the input when the row has one; Shift+Tab never is).
    if (e.key === 'Tab' && (e.shiftKey || !(stage === 'input' && rows[selectedIndex]?.fill))) {
      const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled])')).filter((el) => el.getClientRects().length > 0)
      const at = items.indexOf(document.activeElement as HTMLElement)
      e.preventDefault()
      items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus()
      return
    }
    if (stage === 'confirm') {
      if (e.key === 'Enter') {
        e.preventDefault()
        void execute()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setStage('input')
      }
      return
    }
    if (stage === 'done') {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault()
        close()
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      arrowed.current = true
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, rows.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      arrowed.current = true
      setSelectedIndex((prev) => (prev - 1 + rows.length) % Math.max(1, rows.length))
    } else if (e.key === 'Tab') {
      const fill = rows[selectedIndex]?.fill
      if (fill) {
        e.preventDefault()
        setQuery(fill)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[selectedIndex]
      if (row?.onEnter) row.onEnter()
      else if (primary) primary()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  if (!isOpen) return null

  const toneClass = (tone: Tone | undefined, selected: boolean) => {
    if (selected) return 'bg-[#017cb6] text-white shadow-sm'
    switch (tone) {
      case 'ok':
        return 'text-[#212529] dark:text-slate-200 hover:bg-[#f8f9fa] dark:hover:bg-[#32383e]'
      case 'skip':
        return 'text-fg-muted dark:text-slate-500 hover:bg-[#f8f9fa] dark:hover:bg-[#32383e]'
      case 'bad':
        return 'text-rose-600 dark:text-rose-400'
      case 'muted':
        return 'text-fg-muted dark:text-slate-400'
      default:
        return 'hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] text-[#212529] dark:text-slate-200'
    }
  }

  const headerTone = (tone: Tone | undefined) =>
    tone === 'bad'
      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
      : tone === 'skip'
        ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/30'
        : tone === 'muted'
          ? 'bg-black/[0.03] dark:bg-white/[0.04] text-fg-muted dark:text-slate-400 border-transparent'
          : 'bg-[#017cb6]/10 text-[#015f8c] dark:text-[#5fc3f0] border-[#017cb6]/30'

  const HeaderIcon = header?.icon

  return (
    <div
      ref={overlayRef}
      onClick={stage === 'running' ? undefined : close}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 overlay-safe bg-black/60 backdrop-blur-sm animate-in fade-in duration-100"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        // Escape, and so Android's Back, closes it or steps back from the review, but not while a command runs.
        data-dismissible={stage === 'running' ? 'false' : 'true'}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-xl bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Search / command input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529]">
          {verb ? <Zap className="w-4 h-4 text-[#f1ca00]" /> : <Search className="w-4 h-4 text-fg-link" />}
          <input
            ref={inputRef}
            autoFocus
            type="text"
            role="combobox"
            aria-label="Search or type a command"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={stage === 'input' && rows.length > 0}
            aria-activedescendant={stage === 'input' && rows[selectedIndex] ? optionId(selectedIndex) : undefined}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Search, or type a command: restart wp-*, ssh jumpbox, backup db …"
            value={query}
            // Read-only rather than disabled while it runs, so the input keeps focus and the keys still reach the palette.
            readOnly={stage !== 'input'}
            onChange={(e) => setQuery(e.target.value)}
            className={`w-full bg-transparent text-sm font-mono text-[#212529] dark:text-white placeholder-[#6c757d] placeholder:font-sans outline-none rounded-sm ${stage === 'running' ? 'opacity-60' : ''}`}
          />
          <kbd className="px-2 py-0.5 text-[0.625rem] bg-black/10 dark:bg-black/40 text-fg-muted dark:text-slate-300 rounded border border-[#ced4da] dark:border-[#373b3e] font-mono">
            ESC
          </kbd>
        </div>

        {/* Command header strip */}
        {header && stage === 'input' && HeaderIcon && (
          <div className={`flex items-center gap-2 px-4 py-2 text-xs border-b ${headerTone(header.tone)}`}>
            <HeaderIcon className={`w-3.5 h-3.5 flex-shrink-0 ${header.icon === Loader2 ? 'animate-spin' : ''}`} />
            <span className="truncate">{header.text}</span>
            {primary && (
              <span className="ml-auto flex items-center gap-1 text-[0.625rem] uppercase font-bold tracking-wider opacity-80 flex-shrink-0">
                <CornerDownLeft className="w-3 h-3" /> {plan ? 'review' : 'apply'}
              </span>
            )}
          </div>
        )}

        {/* The review, the run and its outcome take the results list's place; this says so to a screen reader. */}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {stage === 'confirm' && plan
            ? `Confirm: ${plan.label} on ${plan.targets.length} ${plan.targets.length === 1 ? 'target' : 'targets'}. Enter runs it, Escape goes back.`
            : stage === 'running' && plan
              ? `Submitting: ${plan.label} on ${plan.targets.length} ${plan.targets.length === 1 ? 'target' : 'targets'}`
              : stage === 'done'
                ? `${outcomes.filter((o) => o.ok).length} of ${outcomes.length} submitted`
                : (notice ?? '')}
        </div>

        {notice && (
          <div className="px-4 py-2 text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-b border-emerald-500/30 truncate">{notice}</div>
        )}

        {/* Confirm stage */}
        {(stage === 'confirm' || stage === 'running') && plan && (
          <div className="p-4 space-y-3 max-h-[calc(100vh-8rem)] overflow-y-auto">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#212529] dark:text-white">
              {stage === 'running' ? <Loader2 className="w-4 h-4 animate-spin text-fg-link" /> : <AlertTriangle className="w-4 h-4 text-[#f1ca00]" />}
              <span>
                {stage === 'running' ? 'Submitting' : 'Confirm'}: {plan.label} on {plan.targets.length} {plan.targets.length === 1 ? 'target' : 'targets'}
              </span>
            </div>
            <ul className="max-h-56 overflow-y-auto text-xs font-mono space-y-1 pl-1">
              {plan.targets.map((t) => (
                <li key={t} className="text-[#212529] dark:text-slate-200">
                  › {t}
                </li>
              ))}
            </ul>
            {parsed?.kind === 'backup' && (
              <p className="text-xs text-fg-muted dark:text-slate-400">{TEMPORARY_BACKUP_TERMS}</p>
            )}
            {checking && <p className="text-xs text-fg-muted dark:text-slate-400">Checking which backups would be replaced…</p>}
            {replaceLines.length > 0 && (
              <div className="p-2.5 rounded border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-xs leading-relaxed space-y-1">
                <p>If a server has no free temporary slot, BinaryLane replaces its oldest temporary backup that is not locked or attached, and the replaced backup will no longer be available. The backup that would be replaced on each server is listed below.</p>
                <ul className="max-h-40 overflow-y-auto font-mono space-y-0.5">
                  {replaceLines.map((l) => (
                    <li key={l} className="break-words">
                      › {l}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {stage === 'confirm' && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => void execute()}
                  disabled={checking}
                  className="px-3 py-1.5 rounded bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <CornerDownLeft className="w-3 h-3" /> Run
                </button>
                <button
                  onClick={() => setStage('input')}
                  className="px-3 py-1.5 rounded bg-black/[0.06] dark:bg-white/[0.08] hover:bg-black/[0.1] dark:hover:bg-white/[0.14] text-[#212529] dark:text-slate-200 text-xs font-semibold"
                >
                  Esc · Back
                </button>
              </div>
            )}
          </div>
        )}

        {/* Outcome stage */}
        {stage === 'done' && (
          <div className="p-4 space-y-3">
            <div className="text-sm font-semibold text-[#212529] dark:text-white">
              {outcomes.filter((o) => o.ok).length} of {outcomes.length} submitted
              {outcomes.some((o) => o.ok) && (
                <span className="font-normal text-xs text-fg-muted dark:text-slate-400"> — progress is tracked in the toasts</span>
              )}
            </div>
            <ul className="max-h-56 overflow-y-auto text-xs font-mono space-y-1">
              {outcomes.map((o, i) => (
                <li key={i} className={`flex items-start gap-2 ${o.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-400'}`}>
                  {o.ok ? <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
                  <span className="break-all">
                    {o.target}
                    {o.detail ? <span className="opacity-70"> — {o.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <button
              onClick={close}
              className="px-3 py-1.5 rounded bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-semibold"
            >
              Done
            </button>
          </div>
        )}

        {/* Results list */}
        {stage === 'input' && (
          <div ref={listRef} id={listId} role={rows.length > 0 ? 'listbox' : undefined} aria-label="Results" className="max-h-80 overflow-y-auto p-2 space-y-1">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-xs text-fg-muted">
                {parsed ? 'Nothing to act on yet.' : 'No matching commands or cloud resources found.'}
              </div>
            ) : (
              rows.map((item, idx) => {
                const Icon = item.icon
                const isSelected = idx === selectedIndex
                const actionable = !!item.onEnter || !!primary
                return (
                  <div
                    key={item.id}
                    id={optionId(idx)}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={actionable ? undefined : true}
                    onClick={() => (item.onEnter ? item.onEnter() : primary?.())}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`flex items-center justify-between p-2.5 rounded text-xs transition ${actionable ? 'cursor-pointer' : 'cursor-default'} ${toneClass(item.tone, isSelected)}`}
                  >
                    <div className="flex items-center gap-3 truncate">
                      <div className={`p-1.5 rounded ${isSelected ? 'bg-white/20 text-white' : 'bg-black/[0.05] dark:bg-white/[0.06] text-fg-link'}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <div className={`truncate ${item.tone === 'muted' ? 'font-normal' : 'font-semibold'}`}>
                          {item.titleNode ? (
                            // on the blue selected row the chip sits on a plate of the surface colour it was made to read on
                            isSelected ? <span className="inline-flex rounded-full bg-white dark:bg-[#2b3035] p-0.5">{item.titleNode}</span> : item.titleNode
                          ) : (
                            item.title
                          )}
                        </div>
                        {item.subtitle && (
                          <div className={`text-[0.6875rem] truncate ${isSelected ? 'text-white/80' : 'text-fg-muted dark:text-slate-400'}`}>{item.subtitle}</div>
                        )}
                      </div>
                    </div>
                    <span
                      className={`text-[0.625rem] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ml-2 flex-shrink-0 ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-black/[0.05] dark:bg-black/30 text-fg-muted'
                      }`}
                    >
                      {item.category}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-2 bg-[#f1f1f1] dark:bg-[#262a2e] border-t border-[#ced4da] dark:border-[#373b3e] text-[0.6875rem] text-fg-muted flex items-center justify-between">
          <div className="flex items-center gap-3">
            {stage === 'confirm' ? (
              <>
                <span>↵ Run</span>
                <span>Esc Back</span>
              </>
            ) : stage === 'done' ? (
              <span>↵ / Esc Close</span>
            ) : (
              <>
                <span>↑↓ Navigate</span>
                <span>↵ {plan ? 'Review' : primary ? 'Apply' : 'Select'}</span>
                {rows[selectedIndex]?.fill && <span>⇥ Fill</span>}
                <span>Esc Close</span>
              </>
            )}
          </div>
          <span className="font-semibold text-fg-link">{verb ? 'BLDesk Command Engine' : 'Type ? for commands'}</span>
        </div>
      </div>
    </div>
  )
}
