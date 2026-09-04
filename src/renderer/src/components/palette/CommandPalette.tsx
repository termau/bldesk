import React, { useEffect, useMemo, useRef, useState } from 'react'
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
  Camera,
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
  LockKeyhole,
  Tag,
  LucideIcon
} from 'lucide-react'
import { components } from '@shared/api/schema'
import type { DeepLinkServerSubTab } from '@shared/deeplink'
import { remoteServiceProbeForImage } from '@shared/remote-service'
import { BinaryLaneClient } from '../../api/client'
import { useDomains, useServerActionMutation, describeApiError } from '../../api/queries'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import { copyDeepLink, primaryIpv4 } from '../../lib/deeplinks'
import { launchSsh } from '../../lib/launchSsh'
import { recordChange, updateChange } from '../../lib/changelog'
import { expandGroupRefs, loadGroups, loadTags, saveTags, withTag, allTags } from '../../lib/serverGroups'
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
import type { ServerOperationClass, ServerSafetyLevel } from '@shared/binarylane-policy'

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
  /** Local safety can leave a result visible while making it non-actionable. */
  disabled?: boolean
}

interface Outcome {
  target: string
  ok: boolean
  detail?: string
}

interface Notice {
  text: string
  tone: 'ok' | 'bad'
}

type Stage = 'input' | 'confirm' | 'running' | 'done'

const NAV_ROWS: Array<{ tab: ActiveTab; title: string; icon: LucideIcon }> = [
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

const safetyLabel = (level: ServerSafetyLevel) =>
  level === 'locked' ? 'Read-only' : level === 'maintenance' ? 'Maintenance' : 'Normal'

const safetyDescription = (level: ServerSafetyLevel) =>
  level === 'locked'
    ? 'read-only views and diagnostics allowed; changes and remote access blocked'
    : level === 'maintenance'
      ? 'operational access, firewall rules, diagnostics, power recovery, and a non-replacing temporary backup allowed; structural changes blocked'
      : 'normal BLDesk server actions available'

const serverSubtitleWithSafety = (server: ServerResponse, level: ServerSafetyLevel) =>
  `${serverSubtitle(server)} • ${safetyLabel(level)} — ${safetyDescription(level)}`

function hasPositiveActionId<T extends { id?: unknown }>(action: T | null | undefined): action is T & { id: number } {
  return !!action && Number.isSafeInteger(action.id) && Number(action.id) > 0
}

const operationForVerb = (verb: string): ServerOperationClass | null => {
  if (verb === 'ssh' || verb === 'console') return 'remote-access'
  if (verb === 'reboot') return 'reboot'
  if (verb === 'cycle') return 'power-cycle'
  return VERB_SPECS.find((spec) => spec.verb === verb)?.mutates ? 'mutation' : null
}

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
  const [notice, setNotice] = useState<Notice | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const queryClient = useQueryClient()
  const serverAction = useServerActionMutation(client)
  const { track } = useTrackedActions()
  const { accessMode, serverSafetyLevel, serverActionBlockReason } = useProfileSafety()

  const parsed = useMemo<ParsedCommand | null>(() => parseCommand(query), [query])
  const verb = useMemo(() => detectVerb(query), [query])

  // Domains are only fetched once the user is actually typing a dns command.
  const domainsQuery = useDomains(parsed?.kind === 'dns-add' ? client : null)

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (isOpen) onClose()
        else onOpen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onOpen, onClose])

  // ---------------------------------------------------------------------
  // Command resolution — everything derived from `parsed` and the server list
  // ---------------------------------------------------------------------

  const close = () => onClose()

  const openServer = (s: ServerResponse, subTab?: DeepLinkServerSubTab) => {
    onSelectServer(s)
    if (subTab) onSelectServerSubTab(subTab as ServerSubTab)
    onNavigateTab('servers')
  }

  const sshTo = async (s: ServerResponse) => {
    const remoteService = remoteServiceProbeForImage(s.image)
    if (remoteService.kind === 'rdp') {
      setNotice({ text: `${s.name} uses RDP on TCP 3389; BLDesk does not launch RDP yet.`, tone: 'bad' })
      return
    }
    const blockReason = serverActionBlockReason(s.id, 'remote-access')
    if (blockReason) {
      setNotice({ text: `Blocked locally: ${s.name} — ${blockReason}`, tone: 'bad' })
      return
    }
    const ip = primaryIpv4(s)
    if (!ip) {
      setNotice({ text: `${s.name} has no IPv4 address to SSH to.`, tone: 'bad' })
      return
    }
    rememberCommand(query)
    close()
    await launchSsh({ serverId: s.id, host: ip, username: 'root' })
  }

  const consoleFor = async (s: ServerResponse) => {
    if (!client) return
    const blockReason = serverActionBlockReason(s.id, 'remote-access')
    if (blockReason) {
      setNotice({ text: `Blocked locally: ${s.name} — ${blockReason}`, tone: 'bad' })
      return
    }
    rememberCommand(query)
    try {
      if (!window.bldeskApi?.openRescueConsole) throw new Error('Rescue-console access is unavailable in this build.')
      const result = await window.bldeskApi.openRescueConsole({
        serverId: s.id,
        serverName: s.name
      })
      if (!result.success) throw new Error(result.error || 'Rescue-console access was refused.')
      openServer(s, 'remote-access')
      close()
    } catch (err: any) {
      setNotice({ text: `Could not open the rescue console: ${err?.message || err}`, tone: 'bad' })
    }
  }

  const copyLink = async (s: ServerResponse, subTab?: DeepLinkServerSubTab) => {
    rememberCommand(query)
    const url = await copyDeepLink({ kind: 'server', serverId: s.id, subTab })
    setNotice({ text: `Copied ${url}`, tone: 'ok' })
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
      const needle = q.toLowerCase()
      for (const nav of NAV_ROWS) {
        // The embedded shell accepts an arbitrary host, so it cannot prove that
        // a guarded target is unprotected. Server-bound SSH commands remain.
        if (nav.tab === 'terminal' && accessMode !== 'full') continue
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
        const sub = serverSubtitle(s)
        const safetyLevel = serverSafetyLevel(s.id)
        if (!needle || s.name.toLowerCase().includes(needle) || sub.toLowerCase().includes(needle)) {
          rows.push({
            id: `server-${s.id}`,
            title: s.name,
            subtitle: serverSubtitleWithSafety(s, safetyLevel),
            category: safetyLabel(safetyLevel),
            icon: safetyLevel === 'locked' ? LockKeyhole : safetyLevel === 'maintenance' ? Shield : Server,
            tone: safetyLevel === 'locked' ? 'bad' : safetyLevel === 'maintenance' ? 'skip' : undefined,
            onEnter: () => {
              openServer(s)
              close()
            }
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
          title: 'Type a verb: restart, shutdown, start, snapshot, ssh, open, console, link, dns, tag, go — or ? for help',
          category: 'Tip',
          icon: HelpCircle,
          tone: 'muted',
          onEnter: () => setQuery('? ')
        })
      }
      return { rows, header, primary, plan }
    }

    // --- Help
    if (parsed.kind === 'help') {
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
      const wantsServer = !['go', 'dns', 'help'].includes(parsed.verb)
      const operation = operationForVerb(parsed.verb)
      if (wantsServer && !parsed.problem) {
        for (const s of servers) {
          const safetyLevel = serverSafetyLevel(s.id)
          const blockReason = operation ? serverActionBlockReason(s.id, operation) : null
          rows.push({
            id: `pick-${s.id}`,
            title: `${statusDot(s)} ${s.name}`,
            subtitle: blockReason
              ? `blocked locally — ${blockReason}`
              : serverSubtitleWithSafety(s, safetyLevel),
            category: safetyLabel(safetyLevel),
            icon: safetyLevel === 'locked' ? LockKeyhole : safetyLevel === 'maintenance' ? Shield : Server,
            tone: blockReason ? 'bad' : safetyLevel === 'maintenance' ? 'skip' : undefined,
            fill: blockReason ? undefined : fillTarget(query, s.name),
            onEnter: blockReason ? undefined : () => setQuery(fillTarget(query, s.name)),
            disabled: !!blockReason
          })
        }
        if (rows.length === 0) header = { icon: AlertTriangle, text: `Usage: ${parsed.usage}. ${TARGET_HELP}`, tone: 'muted' }
      }
      return { rows, header, primary, plan }
    }

    // --- Create from template: the Templates tab does the asking; nothing is built from here.
    if (parsed.kind === 'create') {
      if (accessMode === 'observe') {
        const createBlockReason = 'Observe-only safety blocks server creation.'
        header = { icon: AlertTriangle, text: `Blocked locally: ${createBlockReason}`, tone: 'bad' }
        rows.push({
          id: 'create-blocked',
          title: `Create ${parsed.hostname} from “${parsed.template}”`,
          subtitle: 'Switch to Protected mode or Full access to review this server creation.',
          category: 'Safety',
          icon: LockKeyhole,
          tone: 'bad',
          disabled: true
        })
        return { rows, header, primary, plan }
      }
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
      const dnsBlockReason =
        accessMode === 'observe'
          ? 'Observe-only safety blocks DNS changes.'
          : accessMode === 'guarded'
            ? 'Protected mode blocks shared DNS changes that could affect a Read-only or Maintenance server.'
            : null
      if (domainsQuery.isLoading) {
        header = { icon: Loader2, text: 'Loading hosted zones…', tone: 'muted' }
      } else if (!target) {
        header = { icon: AlertTriangle, text: `No hosted zone on this account matches ${parsed.fqdn}.`, tone: 'bad' }
      } else {
        const summary = `${parsed.type} ${target.name === '@' ? target.domain : `${target.name}.${target.domain}`} → ${parsed.value}${
          parsed.priority !== undefined ? ` (priority ${parsed.priority})` : ''
        }`
        header = dnsBlockReason
          ? { icon: AlertTriangle, text: `Blocked locally: ${dnsBlockReason}`, tone: 'bad' }
          : { icon: Globe, text: `Add record in zone ${target.domain}` }
        rows.push({
          id: 'dns',
          title: summary,
          subtitle: dnsBlockReason ?? `name "${target.name}" in ${target.domain}`,
          category: dnsBlockReason ? 'Safety' : 'DNS',
          icon: dnsBlockReason ? LockKeyhole : Globe,
          tone: dnsBlockReason ? 'bad' : 'ok',
          disabled: !!dnsBlockReason
        })
        if (dnsBlockReason) return { rows, header, primary, plan }
        plan = {
          label: `Add ${parsed.type} record`,
          targets: [summary],
          run: async () => {
            if (!client) return [{ target: summary, ok: false, detail: 'No API client' }]
            const changeId = await recordChange({
              label: 'Add DNS record',
              target: { kind: 'domain', name: target.domain },
              severity: 'normal',
              changes: [{ label: `${parsed.type} ${target.name}`, to: parsed.value }],
              summary: `Palette: ${query.trim()}`,
              source: 'palette'
            })
            const { error } = await client.POST('/v2/domains/{domain_name}/records', {
              params: { path: { domain_name: target.domain } },
              body: { type: parsed.type, name: target.name, data: parsed.value, priority: parsed.priority ?? null }
            })
            if (error) {
              void updateChange(changeId, { outcome: 'failed', detail: describeApiError(error) })
              return [{ target: summary, ok: false, detail: describeApiError(error) }]
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
      const verbLabel = parsed.op === 'add' ? `Tag @${parsed.tag}` : `Untag @${parsed.tag}`
      if (matches.length === 0) {
        header = { icon: AlertTriangle, text: `No server matches "${parsed.targets}". ${TARGET_HELP}`, tone: 'bad' }
        return { rows, header, primary, plan }
      }
      const parts = [`${verbLabel} — ${matches.length} server${matches.length === 1 ? '' : 's'}`]
      if (unmatched.length) parts.push(`no match: ${unmatched.join(', ')}`)
      header = { icon: Tag, text: parts.join(' · '), tone: unmatched.length ? 'skip' : 'default' }
      for (const m of matches) {
        const current = loadTags(profileId)[m.server.id] ?? []
        const safetyLevel = serverSafetyLevel(m.server.id)
        rows.push({
          id: `t-${m.server.id}`,
          title: `${statusDot(m.server)} ${m.server.name}`,
          subtitle: `${current.length ? `tags: ${current.map((t) => `@${t}`).join(' ')}` : 'no tags'} • ${safetyLabel(safetyLevel)} — ${safetyDescription(safetyLevel)}`,
          category: safetyLabel(safetyLevel),
          icon: safetyLevel === 'locked' ? LockKeyhole : safetyLevel === 'maintenance' ? Shield : Tag,
          tone: safetyLevel === 'locked' ? 'bad' : safetyLevel === 'maintenance' ? 'skip' : 'ok'
        })
      }
      // Local only, no API call — apply immediately, no review step.
      primary = () => {
        if (!profileId) return
        saveTags(profileId, withTag(loadTags(profileId), matches.map((m) => m.server.id), parsed.tag, parsed.op === 'add'))
        rememberCommand(query)
        setNotice({ text: `${verbLabel}: ${matches.length} server${matches.length === 1 ? '' : 's'}. Use @${parsed.tag} as a target anywhere.`, tone: 'ok' })
        setTimeout(close, 900)
      }
      return { rows, header, primary, plan }
    }

    // --- Single-server verbs: ssh / console / open / link
    if (parsed.kind === 'ssh' || parsed.kind === 'console' || parsed.kind === 'open' || parsed.kind === 'link') {
      const { matches, unmatched } = resolveTargets(parsed.target)
      const act = (s: ServerResponse) => {
        const requiresRemoteAccess = parsed.kind === 'ssh' || parsed.kind === 'console' || (parsed.kind === 'open' && parsed.console)
        const blockReason = requiresRemoteAccess ? serverActionBlockReason(s.id, 'remote-access') : null
        if (blockReason) {
          setNotice({ text: `Blocked locally: ${s.name} — ${blockReason}`, tone: 'bad' })
          return
        }
        switch (parsed.kind) {
          case 'ssh':
            return void sshTo(s)
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
      const requiresRemoteAccess = parsed.kind === 'ssh' || parsed.kind === 'console' || (parsed.kind === 'open' && parsed.console)
      const sshUnavailableReason = (server: ServerResponse): string | null =>
        parsed.kind === 'ssh' && remoteServiceProbeForImage(server.image).kind === 'rdp'
          ? 'RDP on TCP 3389 is this server’s normal remote service; BLDesk does not launch RDP yet.'
          : null
      const accessIssue = (server: ServerResponse): string | null =>
        sshUnavailableReason(server) ?? (requiresRemoteAccess ? serverActionBlockReason(server.id, 'remote-access') : null)
      const blockedMatches = matches.filter((m) => !!accessIssue(m.server))
      const onlyMatchIssue = matches.length === 1 ? accessIssue(matches[0].server) : null
      const onlyMatchUsesRdp = matches.length === 1 && !!sshUnavailableReason(matches[0].server)
      header = {
        icon,
        text:
          onlyMatchIssue
            ? `${onlyMatchUsesRdp ? '' : 'Blocked locally: '}${matches[0].server.name} — ${onlyMatchIssue}`
            : matches.length === 1
              ? `${verbLabel} ${matches[0].server.name}`
              : `${verbLabel}… ${matches.length} servers match — pick one${blockedMatches.length ? ` (${blockedMatches.length} unavailable)` : ''}`,
        tone: blockedMatches.length === matches.length ? 'bad' : unmatched.length || blockedMatches.length ? 'skip' : 'default'
      }
      for (const m of matches) {
        const safetyLevel = serverSafetyLevel(m.server.id)
        const serviceReason = sshUnavailableReason(m.server)
        const blockReason = requiresRemoteAccess ? serverActionBlockReason(m.server.id, 'remote-access') : null
        const unavailableReason = serviceReason ?? blockReason
        rows.push({
          id: `m-${m.server.id}`,
          title: `${statusDot(m.server)} ${m.server.name}`,
          subtitle: unavailableReason
            ? serviceReason ?? `blocked locally — ${blockReason}`
            : serverSubtitleWithSafety(m.server, safetyLevel),
          category: serviceReason ? 'RDP 3389' : safetyLabel(safetyLevel),
          icon: serviceReason ? Network : safetyLevel === 'locked' ? LockKeyhole : safetyLevel === 'maintenance' ? Shield : Server,
          tone: unavailableReason ? 'bad' : safetyLevel === 'maintenance' ? 'skip' : undefined,
          fill: unavailableReason ? undefined : fillTarget(query, m.server.name),
          onEnter: unavailableReason ? undefined : () => act(m.server),
          disabled: !!unavailableReason
        })
      }
      return { rows, header, primary, plan }
    }

    // --- Multi-server mutations: power verbs and snapshot
    if (parsed.kind === 'power' || parsed.kind === 'snapshot') {
      const { matches, unmatched } = resolveTargets(parsed.targets)
      const spec = parsed.kind === 'power' ? POWER_VERBS[parsed.verb] : null
      const label = parsed.kind === 'power' ? spec!.label : `Snapshot${parsed.label ? ` "${parsed.label}"` : ''}`
      const icon = parsed.kind === 'power' ? POWER_ICON[parsed.verb] : Camera
      const { eligible: statusEligible, skipped: statusSkipped } =
        parsed.kind === 'power' ? partitionByStatus(matches, spec!.requires) : { eligible: matches, skipped: [] as Array<TargetMatch & { reason: string }> }
      const operation: ServerOperationClass =
        parsed.kind === 'power' && parsed.verb === 'reboot'
          ? 'reboot'
          : parsed.kind === 'power' && parsed.verb === 'cycle'
            ? 'power-cycle'
            : 'mutation'
      const operationForTarget = (match: TargetMatch): ServerOperationClass =>
        parsed.kind === 'snapshot' && serverSafetyLevel(match.server.id) === 'maintenance'
          ? 'non-replacing-temp-backup'
          : operation
      const safetySkipped: Array<TargetMatch & { reason: string }> = []
      const eligible = statusEligible.filter((match) => {
        const blockReason = serverActionBlockReason(match.server.id, operationForTarget(match))
        if (!blockReason) return true
        safetySkipped.push({ ...match, reason: `blocked locally — ${blockReason}` })
        return false
      })
      const skipped = [...statusSkipped, ...safetySkipped]

      if (matches.length === 0) {
        header = { icon: AlertTriangle, text: `No server matches "${parsed.targets}". ${TARGET_HELP}`, tone: 'bad' }
        return { rows, header, primary, plan }
      }

      const parts = [`${label} — ${eligible.length} server${eligible.length === 1 ? '' : 's'}`]
      if (parsed.kind === 'snapshot' && eligible.length > 0) {
        const maintenanceCount = eligible.filter((match) => serverSafetyLevel(match.server.id) === 'maintenance').length
        const testableCount = eligible.length - maintenanceCount
        if (maintenanceCount) parts.push(`${maintenanceCount} non-replacing`)
        if (testableCount) parts.push(`${testableCount} may rotate oldest if full`)
      }
      if (skipped.length) parts.push(`${skipped.length} skipped`)
      if (unmatched.length) parts.push(`no match: ${unmatched.join(', ')}`)
      header = { icon, text: parts.join(' · '), tone: eligible.length ? (unmatched.length ? 'skip' : 'default') : 'bad' }

      for (const m of eligible) {
        const safetyLevel = serverSafetyLevel(m.server.id)
        rows.push({
          id: `e-${m.server.id}`,
          title: `${statusDot(m.server)} ${m.server.name}`,
          subtitle: serverSubtitleWithSafety(m.server, safetyLevel),
          category: label,
          icon,
          tone: 'ok'
        })
      }
      for (const m of skipped) {
        const safetyLevel = serverSafetyLevel(m.server.id)
        const blockedLocally = m.reason.startsWith('blocked locally')
        rows.push({
          id: `s-${m.server.id}`,
          title: `${statusDot(m.server)} ${m.server.name}`,
          subtitle: blockedLocally ? m.reason : `skipped — ${m.reason}`,
          category: safetyLabel(safetyLevel),
          icon: safetyLevel === 'locked' ? LockKeyhole : safetyLevel === 'maintenance' ? Shield : Server,
          tone: blockedLocally ? 'bad' : 'skip',
          disabled: true
        })
      }

      if (eligible.length > 0) {
        plan = {
          label,
          targets: eligible.map((m) => {
            if (parsed.kind !== 'snapshot') return m.server.name
            return serverSafetyLevel(m.server.id) === 'maintenance'
              ? `${m.server.name} — Maintenance: temporary, replaces nothing`
              : `${m.server.name} — Normal: temporary, may replace the oldest eligible image only if full`
          }),
          run: async () => {
            const results: Outcome[] = []
            // Sequential on purpose: N parallel POSTs to one account is exactly the
            // burst the client's anti-spam layer exists to prevent.
            for (const m of eligible) {
              const currentLevel = serverSafetyLevel(m.server.id)
              const currentOperation: ServerOperationClass =
                parsed.kind === 'snapshot' && currentLevel === 'maintenance'
                  ? 'non-replacing-temp-backup'
                  : operation
              const blockReason = serverActionBlockReason(m.server.id, currentOperation)
              if (blockReason) {
                results.push({ target: m.server.name, ok: false, detail: `Blocked locally: ${blockReason}` })
                continue
              }
              const body: Record<string, unknown> =
                parsed.kind === 'power'
                  ? { type: spec!.type }
                  : {
                      type: 'take_backup',
                      replacement_strategy: currentLevel === 'maintenance' ? 'none' : 'oldest',
                      backup_type: 'temporary',
                      ...(parsed.label ? { label: parsed.label } : {})
                    }
              const summary = parsed.kind === 'snapshot'
                ? currentLevel === 'maintenance'
                  ? `Palette: ${query.trim()}. Creates a temporary backup and replaces nothing; it fails if no temporary slot is free.`
                  : `Palette: ${query.trim()}. Uses a free temporary slot, or replaces the oldest eligible temporary image if every slot is full.`
                : `Palette: ${query.trim()}`
              const changeId = await recordChange({
                label,
                target: { kind: 'server', id: m.server.id, name: m.server.name },
                severity:
                  parsed.kind === 'snapshot'
                    ? currentLevel === 'maintenance' ? 'normal' : 'destructive'
                    : parsed.verb === 'poweroff' || parsed.verb === 'cycle' ? 'destructive' : 'normal',
                summary,
                source: 'palette'
              })
              try {
                const queued = await serverAction.mutateAsync({ serverId: m.server.id, actionPayload: body })
                if (!hasPositiveActionId(queued)) {
                  const detail = 'BinaryLane returned no valid action ID. BLDesk cannot tell whether the request ran; verify the server state before retrying.'
                  void updateChange(changeId, { outcome: 'lost', detail })
                  results.push({ target: m.server.name, ok: false, detail })
                  continue
                }
                track(queued, label, m.server.name, changeId)
                results.push({ target: m.server.name, ok: true, detail: queued.id ? `action #${queued.id}` : undefined })
              } catch (err: any) {
                void updateChange(changeId, { outcome: 'failed', detail: err?.message || String(err) })
                results.push({ target: m.server.name, ok: false, detail: err?.message || String(err) })
              }
            }
            return results
          }
        }
        primary = () => setStage('confirm')
      }
      return { rows, header, primary, plan }
    }

    return { rows, header, primary, plan }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, query, servers, client, profileId, domainsQuery.data, domainsQuery.isLoading, accessMode, serverSafetyLevel, serverActionBlockReason])

  const { rows, header, primary, plan } = resolved

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // ---------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------

  const execute = async () => {
    if (!plan || stage !== 'confirm') return
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (stage === 'running') {
      e.preventDefault()
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
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, rows.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
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
      if (row?.disabled) return
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
        return 'text-[#6c757d] dark:text-slate-500 hover:bg-[#f8f9fa] dark:hover:bg-[#32383e]'
      case 'bad':
        return 'text-rose-600 dark:text-rose-400'
      case 'muted':
        return 'text-[#6c757d] dark:text-slate-400'
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
          ? 'bg-black/[0.03] dark:bg-white/[0.04] text-[#6c757d] dark:text-slate-400 border-transparent'
          : 'bg-[#017cb6]/10 text-[#015f8c] dark:text-[#5fc3f0] border-[#017cb6]/30'

  const HeaderIcon = header?.icon

  return (
    <div
      onClick={stage === 'running' ? undefined : close}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 overlay-safe bg-black/60 backdrop-blur-sm animate-in fade-in duration-100"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Search / command input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#ced4da] dark:border-[#373b3e] bg-[#f8f9fa] dark:bg-[#212529]">
          {verb ? <Zap className="w-4 h-4 text-[#f1ca00]" /> : <Search className="w-4 h-4 text-[#017cb6]" />}
          <input
            ref={inputRef}
            autoFocus
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Search, or type a command: restart wp-*, ssh jumpbox, snapshot db …"
            value={query}
            disabled={stage === 'running'}
            readOnly={stage === 'confirm' || stage === 'done'}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-sm font-mono text-[#212529] dark:text-white placeholder-[#6c757d] placeholder:font-sans focus:outline-none disabled:opacity-60"
          />
          <kbd className="px-2 py-0.5 text-[10px] bg-black/10 dark:bg-black/40 text-[#6c757d] dark:text-slate-300 rounded border border-[#ced4da] dark:border-[#373b3e] font-mono">
            ESC
          </kbd>
        </div>

        {/* Command header strip */}
        {header && stage === 'input' && HeaderIcon && (
          <div className={`flex items-center gap-2 px-4 py-2 text-xs border-b ${headerTone(header.tone)}`}>
            <HeaderIcon className={`w-3.5 h-3.5 flex-shrink-0 ${header.icon === Loader2 ? 'animate-spin' : ''}`} />
            <span className="truncate">{header.text}</span>
            {primary && (
              <span className="ml-auto flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider opacity-80 flex-shrink-0">
                <CornerDownLeft className="w-3 h-3" /> {plan ? 'review' : 'apply'}
              </span>
            )}
          </div>
        )}

        {notice && (
          <div
            className={`px-4 py-2 text-xs border-b truncate ${
              notice.tone === 'bad'
                ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* Confirm stage */}
        {(stage === 'confirm' || stage === 'running') && plan && (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#212529] dark:text-white">
              {stage === 'running' ? <Loader2 className="w-4 h-4 animate-spin text-[#017cb6]" /> : <AlertTriangle className="w-4 h-4 text-[#f1ca00]" />}
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
            {stage === 'confirm' && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => void execute()}
                  className="px-3 py-1.5 rounded bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-semibold flex items-center gap-1.5"
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
                <span className="font-normal text-xs text-[#6c757d] dark:text-slate-400"> — progress is tracked in the toasts</span>
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
          <div className="max-h-80 overflow-y-auto p-2 space-y-1">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#6c757d]">
                {parsed ? 'Nothing to act on yet.' : 'No matching commands or cloud resources found.'}
              </div>
            ) : (
              rows.map((item, idx) => {
                const Icon = item.icon
                const isSelected = idx === selectedIndex
                const actionable = !item.disabled && (!!item.onEnter || !!primary)
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (item.disabled) return
                      if (item.onEnter) item.onEnter()
                      else primary?.()
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    aria-disabled={item.disabled || undefined}
                    className={`flex items-center justify-between p-2.5 rounded text-xs transition ${actionable ? 'cursor-pointer' : item.disabled ? 'cursor-not-allowed' : 'cursor-default'} ${item.disabled ? 'opacity-80' : ''} ${toneClass(item.tone, isSelected)}`}
                  >
                    <div className="flex items-center gap-3 truncate">
                      <div className={`p-1.5 rounded ${isSelected ? 'bg-white/20 text-white' : 'bg-black/[0.05] dark:bg-white/[0.06] text-[#017cb6]'}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <div className={`truncate ${item.tone === 'muted' ? 'font-normal' : 'font-semibold'}`}>{item.title}</div>
                        {item.subtitle && (
                          <div className={`text-[11px] truncate ${isSelected ? 'text-white/80' : 'text-[#6c757d] dark:text-slate-400'}`}>{item.subtitle}</div>
                        )}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ml-2 flex-shrink-0 ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-black/[0.05] dark:bg-black/30 text-[#6c757d]'
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
        <div className="px-4 py-2 bg-[#f1f1f1] dark:bg-[#262a2e] border-t border-[#ced4da] dark:border-[#373b3e] text-[11px] text-[#6c757d] flex items-center justify-between">
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
          <span className="font-semibold text-[#017cb6]">{verb ? 'BLDesk Command Engine' : 'Type ? for commands'}</span>
        </div>
      </div>
    </div>
  )
}
