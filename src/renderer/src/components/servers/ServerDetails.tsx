import React, { useState, useEffect } from 'react'
import {
  ArrowLeft,
  Link2,
  Play,
  RotateCw,
  Power,
  Terminal,
  Activity,
  Cpu,
  HardDrive,
  Radio,
  Key,
  Copy,
  Check,
  Globe,
  Loader2,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import { LocalSshKey } from '@shared/ipc-types'
import { FirewallManager } from '../firewall/FirewallManager'
import { BackupManager } from '../backups/BackupManager'
import { ServerNetwork } from './ServerNetwork'
import { ServerSettings } from './ServerSettings'
import { ServerUsage } from './ServerUsage'
import {
  useServerMetrics,
  useServerUserData,
  useVpcs,
  useServerActionMutation,
  useServerDiagnosticMutation,
  useCancelServerMutation
} from '../../api/queries'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { logoForDistribution } from '../../lib/distroHelper'
import { remoteServiceProbeForImage } from '@shared/remote-service'
import { VpcBadge } from '../vpcs/VpcBadge'
import { describeStatus } from '../../lib/serverStatus'
import { useReachability, ReachabilityChip } from './ReachabilityBadge'
import { ChangePlanPanel } from './ChangePlanPanel'
import { launchSsh } from '../../lib/launchSsh'
import { copyDeepLink } from '../../lib/deeplinks'
import { describeActionType } from '../../lib/actionLabels'
import { ServerSubTab } from '../layout/Sidebar'
import { useConfirm, type ConfirmRequest } from '../../context/ConfirmContext'
import { updateChange } from '../../lib/changelog'
import { powerActionSummary } from '../../lib/actionLabels'
import { imageSupportsUserData, templateFromServer, type ServerTemplate } from '../../lib/serverTemplates'
import { describeApiError } from '../../api/queries'
import { useProfileSafety } from '../../context/ProfileSafetyContext'

type ServerResponse = components['schemas']['Server']

interface ServerDetailsProps {
  server: ServerResponse
  client: BinaryLaneClient | null
  profileId?: string
  activeSubTab?: ServerSubTab
  /** Change sub-tab from inside the view, e.g. "check firewall rules". */
  onSelectSubTab?: (tab: ServerSubTab) => void
  onBack: () => void
  onOpenTerminal?: (ip: string) => void
  /** The app's server list, forwarded to the Firewall sub-tab (see FirewallManagerProps.servers). */
  servers?: any[]
  /** Hands a whole-server capture (plan, image, VPC, firewall rules, user data) to the Templates tab. */
  onSaveAsTemplate?: (draft: ServerTemplate) => void
}

/**
 * These probe the guest, not the hypervisor: `ping` pings the VPS itself and
 * `uptime` returns the VPS's own uptime. Host node uptime is a different value
 * entirely, and already on the server object as `host.uptime_ms`.
 */
const DIAGNOSTIC_LABELS: Record<string, string> = {
  ping: 'VPS ping',
  uptime: 'VPS uptime',
  is_running: 'Power state'
}

const isDiagnostic = (actionType: string): boolean => actionType in DIAGNOSTIC_LABELS

/** A diagnostic trigger that shows a spinner and a verb while its action runs. */
const DiagnosticButton: React.FC<{
  label: string
  busyLabel: string
  active: boolean
  disabled: boolean
  title?: string
  onClick: () => void
}> = ({ label, busyLabel, active, disabled, title, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-busy={active}
    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] hover:border-[#017cb6] text-xs font-medium rounded transition disabled:opacity-50"
  >
    {active && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#017cb6]" />}
    {active ? busyLabel : label}
  </button>
)

/**
 * Keep server data visible while making mutation-heavy child panels genuinely
 * read-only. The main-process broker remains the authority; this boundary is a
 * visible, keyboard-safe first line of defence for the renderer.
 */
const SafetyBoundary: React.FC<{ reason: string | null; children: React.ReactNode }> = ({ reason, children }) => {
  if (!reason) return <>{children}</>

  const stopBlockedInteraction = (event: React.SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      data-safety-action-boundary="blocked"
      title={reason}
      aria-disabled="true"
      onClickCapture={stopBlockedInteraction}
      onSubmitCapture={stopBlockedInteraction}
      onChangeCapture={stopBlockedInteraction}
      className="space-y-3 [&_button]:pointer-events-none [&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none"
    >
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-semibold">Changes unavailable</div>
          <div>{reason} Read-only details remain visible.</div>
        </div>
      </div>
      <fieldset disabled title={reason} aria-disabled="true" className="m-0 min-w-0 border-0 p-0">
        {children}
      </fieldset>
    </div>
  )
}

/** Render a millisecond uptime as "12 days, 4 hours". */
function formatUptime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  if (!days && !hours) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  return parts.join(', ')
}

/**
 * A completed diagnostic reports its answer in `result_data` — except ping,
 * which leaves it null and signals success purely by reaching `completed`. So
 * the absence of a value is not the absence of an answer, and this says so
 * rather than printing "null".
 */
function describeDiagnostic(
  actionType: string,
  action: { result_data?: string | null; started_at?: string | null; completed_at?: string | null }
): string {
  const label = DIAGNOSTIC_LABELS[actionType] ?? actionType
  const output = action.result_data?.trim()
  if (output) return `${label}: ${output}`

  let took = ''
  if (action.started_at && action.completed_at) {
    const ms = new Date(action.completed_at).getTime() - new Date(action.started_at).getTime()
    if (Number.isFinite(ms) && ms >= 0) took = ` (${(ms / 1000).toFixed(1)}s)`
  }
  return `${label} completed successfully${took}.`
}

export const ServerDetails: React.FC<ServerDetailsProps> = ({
  server,
  client,
  profileId,
  activeSubTab = 'overview',
  onSelectSubTab,
  onBack,
  servers: allServers,
  onSaveAsTemplate
}) => {
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  /** `ok` drives the styling — a failed diagnostic must not read as an answer. */
  const [diagnosticResult, setDiagnosticResult] = useState<{ text: string; ok: boolean } | null>(null)
  const [localKeys, setLocalKeys] = useState<LocalSshKey[]>([])
  const [selectedKeyPath, setSelectedKeyPath] = useState<string>('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [isOpeningConsole, setIsOpeningConsole] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { serverSafetyLevel, serverActionBlockReason } = useProfileSafety()
  const safetyLevel = serverSafetyLevel(server.id)
  const lockedServer = safetyLevel === 'locked'
  const maintenanceServer = safetyLevel === 'maintenance'
  const remoteBlockReason = serverActionBlockReason(server.id, 'remote-access')
  const rebootBlockReason = serverActionBlockReason(server.id, 'reboot')
  const powerCycleBlockReason = serverActionBlockReason(server.id, 'power-cycle')
  const diagnosticBlockReason = serverActionBlockReason(server.id, 'diagnostic')
  const firewallBlockReason = serverActionBlockReason(server.id, 'firewall')
  const mutationBlockReason = serverActionBlockReason(server.id, 'mutation')
  const firewallServers = React.useMemo(() => {
    const candidates = allServers ?? [server]
    const allowed = candidates.filter((candidate) => !serverActionBlockReason(candidate.id, 'firewall'))
    return allowed.length > 0 ? allowed : [server]
  }, [allServers, server, serverActionBlockReason])
  const actionableServers = React.useMemo(() => {
    if (mutationBlockReason) return [server]
    const candidates = allServers ?? [server]
    const allowed = candidates.filter((candidate) => !serverActionBlockReason(candidate.id, 'mutation'))
    return allowed.length > 0 ? allowed : [server]
  }, [mutationBlockReason, allServers, server, serverActionBlockReason])

  const captureTemplate = async () => {
    if (!client || !onSaveAsTemplate) return
    setCapturing(true)
    setCaptureError(null)
    try {
      const fw = await client.GET('/v2/servers/{server_id}/advanced_firewall_rules', { params: { path: { server_id: server.id } } })
      if (fw.error) throw new Error(describeApiError(fw.error))
      const vpcName = server.vpc_id ? ((vpcsForCapture as any[]).find((v) => v.id === server.vpc_id)?.name as string | undefined) : undefined
      onSaveAsTemplate(templateFromServer(server, { firewallRules: (fw.data as any)?.firewall_rules ?? [], userData: userDataQuery.data ?? null, vpcName }))
    } catch (err: any) {
      setCaptureError(err?.message || 'Could not read the server’s firewall rules.')
    } finally {
      setCapturing(false)
    }
  }

  const handleCopyLink = async () => {
    await copyDeepLink({ kind: 'server', serverId: server.id, subTab: activeSubTab })
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 1500)
  }

  useEffect(() => {
    if (remoteBlockReason) {
      setLocalKeys([])
      setSelectedKeyPath('')
      return
    }
    if (window.bldeskApi?.getLocalSshKeys) {
      window.bldeskApi
        .getLocalSshKeys()
        .then((keys) => {
          if (Array.isArray(keys)) {
            setLocalKeys(keys)
            const defaultKey = keys.find((k) => k.privateKeyPath)
            if (defaultKey?.privateKeyPath) {
              setSelectedKeyPath(defaultKey.privateKeyPath)
            }
          }
        })
        .catch(() => setLocalKeys([]))
    }
  }, [remoteBlockReason])

  const metricsQuery = useServerMetrics(client, server.id)
  const userDataQuery = useServerUserData(client, server.id)
  const vpcsForCapture = useVpcs(client).data ?? []
  const serverAction = useServerActionMutation(client)
  const diagnosticAction = useServerDiagnosticMutation(client, server.id)
  const cancelServer = useCancelServerMutation(client)
  const { track } = useTrackedActions()

  const publicV4 = server.networks?.v4?.find((v) => v.type === 'public')?.ip_address
  // A private/VPC address can still be useful for local checks and SSH when
  // this computer can route to it. Keep it separate so no private address is
  // ever presented as the server's public IPv4.
  const connectionV4 = publicV4 || server.networks?.v4?.[0]?.ip_address

  const primaryV6 = server.networks?.v6?.[0]?.ip_address
  const isRunning = server.status === 'active'
  const state = describeStatus(server.status)
  const remoteServiceProbe = remoteServiceProbeForImage(server.image)
  const reach = useReachability(
    diagnosticBlockReason ? undefined : connectionV4,
    remoteServiceProbe.port,
    client,
    server.id,
    profileId,
    remoteServiceProbe.label
  )
  const distroIcon = logoForDistribution(server.image?.distribution)
  const ramGB = (server.memory / 1024).toFixed(0)

  const handleLaunchSsh = () => {
    const blockReason = serverActionBlockReason(server.id, 'remote-access')
    if (blockReason || !connectionV4) return
    launchSsh({
      serverId: server.id,
      host: connectionV4,
      username: 'root',
      privateKeyPath: selectedKeyPath || undefined
    })
  }

  const handleCopySshCommand = () => {
    const blockReason = serverActionBlockReason(server.id, 'remote-access')
    if (blockReason || !connectionV4) return
    handleCopy(`ssh root@${connectionV4}`)
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedText(text)
    setTimeout(() => setCopiedText(null), 1500)
  }

  const confirmAction = useConfirm()
  /**
   * `confirm` lets a caller enrich the shared dialog - Change Plan passes a
   * before/after table, which is the whole point of reviewing a resize. Without
   * it the third argument from ChangePlanPanel.onApply would be accepted and
   * silently dropped, quietly losing the change table added in #20.
   */
  const handleAction = async (
    actionType: string,
    customPayload: any = {},
    confirm: Partial<Pick<ConfirmRequest, 'summary' | 'changes' | 'notes' | 'severity' | 'typeToConfirm'>> = {}
  ) => {
    const operation = isDiagnostic(actionType)
      ? 'diagnostic'
      : actionType === 'reboot'
        ? 'reboot'
        : actionType === 'power_cycle'
          ? 'power-cycle'
          : 'mutation'
    const blockReason = serverActionBlockReason(server.id, operation)
    if (blockReason) return
    // Diagnostics change nothing; asking "are you sure?" before a ping is noise.
    let changeId: string | undefined
    if (!isDiagnostic(actionType)) {
      const c = await confirmAction({
        title: describeActionType(actionType),
        target: { kind: 'server', id: server.id, name: server.name },
        summary: powerActionSummary(actionType),
        severity: actionType === 'power_off' || actionType === 'power_cycle' ? 'destructive' : 'normal',
        ...confirm
      })
      if (!c.ok) return
      changeId = c.changeId
    }
    setActionInProgress(actionType)
    setActionError(null)
    try {
      // Diagnostics are awaited, because their answer only exists once the
      // action completes. Everything else is handed to the tracker, so the
      // panel is not held while a rebuild runs.
      if (isDiagnostic(actionType)) {
        setDiagnosticResult(null)
        const completed = await diagnosticAction.mutateAsync({ type: actionType, ...customPayload })
        setDiagnosticResult({ text: describeDiagnostic(actionType, completed), ok: true })
        return
      }

      const res = await serverAction.mutateAsync({
        serverId: server.id,
        actionPayload: { type: actionType, ...customPayload }
      })
      if (!res) {
        void updateChange(changeId, {
          outcome: 'failed',
          detail: 'BinaryLane returned no action record, so BLDesk cannot track whether the request ran.'
        })
        return
      }
      window.bldeskApi?.sendNotification?.({
        title: `Server Action: ${describeActionType(actionType)}`,
        body: `Action initiated successfully.`
      })
      track(res, describeActionType(actionType), server.name, changeId)
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err?.message })
      if (isDiagnostic(actionType)) {
        setDiagnosticResult({
          text: `${DIAGNOSTIC_LABELS[actionType]} failed: ${err.message || 'Unknown error'}`,
          ok: false
        })
      } else {
        setActionError(`Action failed: ${err.message || 'Unknown error'}`)
      }
    } finally {
      setActionInProgress(null)
    }
  }

  /**
   * Cancel goes through the shared dialog like everything else - irreversible,
   * so the hostname must be typed - with the reason picker ConfirmRequest now
   * carries. Confirming records the History entry; the outcome is written back
   * either way, because once the server is gone there is nothing left to ask.
   */
  const handleCancelServer = async (): Promise<void> => {
    const blockReason = serverActionBlockReason(server.id, 'mutation')
    if (blockReason) return
    const monthly = server.size?.price_monthly
    const c = await confirmAction({
      title: 'Cancel server',
      target: { kind: 'server', id: server.id, name: server.name },
      summary:
        'Destroys the server and everything on it. The service is cancelled within five minutes and an invoice is generated for usage to date. Backups and snapshots attached to it go with it.',
      severity: 'irreversible',
      notes: [
        'There is no undo - BinaryLane keeps no copy of a cancelled server.',
        ...(typeof monthly === 'number' && monthly > 0
          ? [`This server currently bills at $${monthly.toFixed(2)}/month.`]
          : [])
      ],
      changes: [
        { label: 'Plan', from: server.size_slug, to: undefined },
        { label: 'Public IPv4', from: server.networks?.v4?.find((n) => n.type === 'public')?.ip_address, to: undefined }
      ],
      reason: {
        label: 'Why are you cancelling?',
        options: [
          'No longer required',
          'Too expensive',
          'Moving to another provider',
          'Performance did not meet expectations',
          'Technical issues',
          'Created by mistake / testing',
          'Other'
        ],
        requireDetailFor: ['Other']
      },
      confirmLabel: 'Cancel server'
    })
    if (!c.ok) return
    try {
      await cancelServer.mutateAsync({ serverId: server.id, reason: c.reason })
      void updateChange(c.changeId, {
        outcome: 'completed',
        detail: 'BinaryLane accepted the cancellation; the server is removed within minutes.'
      })
      onBack()
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err?.message })
      setActionError(`Failed to cancel the server: ${err?.message || 'unknown error'}`)
    }
  }

  const handleLaunchRescueConsole = async () => {
    const blockReason = serverActionBlockReason(server.id, 'remote-access')
    if (blockReason) return
    if (isOpeningConsole) return
    setIsOpeningConsole(true)
    try {
      if (!window.bldeskApi?.openRescueConsole) throw new Error('Rescue-console access is unavailable in this build.')
      const result = await window.bldeskApi.openRescueConsole({
        serverId: server.id,
        serverName: server.name
      })
      if (!result.success) throw new Error(result.error || 'Rescue-console access was refused.')
    } catch (error: any) {
      setActionError(`Could not open the rescue console: ${error?.message || error}`)
    } finally {
      setIsOpeningConsole(false)
    }
  }

  const sample = metricsQuery.data?.average

  return (
    <div className="h-full flex flex-col bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa] overflow-y-auto select-text pb-bottom-nav">
      {/* 1. Authentic PanelSite ServerHeader */}
      <div className="p-4 bg-white dark:bg-[#2b3035] border-b border-[#ced4da] dark:border-[#373b3e] shadow-sm sticky top-0 z-20">
        {/*
          * Top-aligned, not centred: the reachability message under the action
          * buttons can wrap to two or three lines, and with `items-center` the
          * whole left column - the server name included - slid downwards as soon
          * as a probe reported a problem. Nothing in the header should move
          * because something beside it grew.
          */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          {/* Header Info */}
          <div>
            <div className="flex items-center gap-2">
              <button
                onClick={onBack}
                className="md:hidden text-xs text-[#017cb6] hover:underline flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Servers</span>
              </button>
              <h1 className="text-lg font-bold text-[#212529] dark:text-white flex items-center gap-2">
                <img src={distroIcon} alt="" className="w-5 h-5 object-contain" />
                <span><span className="text-[#6c757d] dark:text-slate-400 font-normal">Server:</span> {server.name}</span>
                <span
                  title={(server as any)._power
                        ? `Power state from ${(server as any)._power.source === 'diagnostic' ? 'a hypervisor check' : 'performance samples'}${(server as any)._apiStatus !== server.status ? ` (API says ${(server as any)._apiStatus})` : ''}`
                        : 'From the API status field, which may not reflect power state'}
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded-full inline-flex items-center gap-1 ${state.pill}`}
                 >
                   {state.busy && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                   {state.label}
                 </span>
                 <span
                   data-safety-level={safetyLevel}
                   data-safety-protected-server={lockedServer ? 'true' : undefined}
                   title={lockedServer ? 'Read-only views and diagnostics are allowed; changes and remote access are blocked.' : maintenanceServer ? 'Operational access, firewall rules, diagnostics, power recovery, and a non-replacing temporary backup are allowed; structural changes are blocked.' : 'Normal BLDesk server actions are available.'}
                   className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                     lockedServer
                       ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                       : maintenanceServer
                         ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                         : 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                   }`}
                 >
                   {lockedServer ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                   {lockedServer ? 'Read-only' : maintenanceServer ? 'Maintenance' : 'Normal'}
                 </span>
               </h1>
            </div>

            {/* Breadcrumb Specs */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#6c757d] dark:text-slate-400 mt-1">
              <span className="font-mono text-[#212529] dark:text-slate-200">{connectionV4 || 'No IPv4 address'}</span>
              <span>•</span>
              <span className="font-mono">#{server.id}</span>
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-[#6c757d] hover:text-[#017cb6] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition"
                title="Copy bldesk:// link to this server"
              >
                {linkCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Link2 className="w-3 h-3" />}
                <span>{linkCopied ? 'Copied' : 'Copy link'}</span>
              </button>
              <span>•</span>
              <span>{server.region?.name || server.region?.slug?.toUpperCase()}</span>
              <span>•</span>
              <span>{server.vcpus} vCPUs / {ramGB} GB RAM / {server.disk} GB Disk</span>
              <span>•</span>
              <span>{server.image?.full_name || server.image?.name}</span>
            </div>
          </div>

          {/* Quick Action Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Leads the cluster: the buttons beside it are only worth
                clicking if the port answers from here. */}
            {!diagnosticBlockReason && (
              <ReachabilityChip r={reach} ip={connectionV4} onOpenFirewall={() => onSelectSubTab?.('firewall')} />
            )}
            {remoteBlockReason && (
              <span
                title={remoteBlockReason}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Remote access blocked
              </span>
            )}
            {remoteServiceProbe.kind === 'ssh' && (
              <>
                {/* SSH Key Selector */}
                <div className="flex items-center gap-1 bg-[#f8f9fa] dark:bg-[#212529] px-2 py-1 border border-[#ced4da] dark:border-[#373b3e] rounded">
                  <Key className="w-3.5 h-3.5 text-[#f1ca00] flex-shrink-0" />
                  <select
                    value={selectedKeyPath}
                    onChange={(e) => setSelectedKeyPath(e.target.value)}
                    disabled={!!remoteBlockReason || !connectionV4}
                    className="bg-transparent text-xs text-[#212529] dark:text-slate-200 focus:outline-none cursor-pointer max-w-[120px]"
                  >
                    <option value="">Default Key</option>
                    {localKeys.map((k) => (
                      <option key={k.name} value={k.privateKeyPath || ''} className="bg-white dark:bg-[#2b3035]">
                        {k.name}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleLaunchSsh}
                  disabled={!!remoteBlockReason || !connectionV4}
                  title={remoteBlockReason ?? (!connectionV4 ? 'No IPv4 address is available' : 'Launch SSH')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Launch SSH</span>
                </button>
              </>
            )}

            <button
              onClick={handleLaunchRescueConsole}
              disabled={isOpeningConsole || !!remoteBlockReason}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 rounded transition disabled:opacity-50"
              title={remoteBlockReason ?? 'Open Out-of-Band Rescue VNC / Serial Console'}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Console</span>
            </button>

            {state.busy ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Building…</span>
              </span>
            ) : isRunning ? (
              <>
                <button
                  onClick={() => handleAction('reboot')}
                  disabled={!!actionInProgress || !!rebootBlockReason}
                  className="p-1.5 text-[#6c757d] hover:text-amber-500 hover:bg-[#e9ecef] dark:hover:bg-[#343a40] rounded transition border border-[#ced4da] dark:border-[#373b3e] disabled:cursor-not-allowed disabled:opacity-50"
                  title={rebootBlockReason ?? 'Reboot'}
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleAction('power_cycle')}
                  disabled={!!actionInProgress || !!powerCycleBlockReason}
                  className="p-1.5 text-[#6c757d] hover:text-rose-500 hover:bg-[#e9ecef] dark:hover:bg-[#343a40] rounded transition border border-[#ced4da] dark:border-[#373b3e] disabled:cursor-not-allowed disabled:opacity-50"
                  title={powerCycleBlockReason ?? 'Hard power cycle'}
                  aria-label="Power cycle"
                >
                  <RotateCw className="w-3.5 h-3.5 stroke-[2.75]" />
                </button>
                <button
                  onClick={() => handleAction('shutdown')}
                  disabled={!!actionInProgress || !!mutationBlockReason}
                  className="p-1.5 text-[#6c757d] hover:text-rose-500 hover:bg-[#e9ecef] dark:hover:bg-[#343a40] rounded transition border border-[#ced4da] dark:border-[#373b3e] disabled:cursor-not-allowed disabled:opacity-50"
                  title={mutationBlockReason ?? 'Graceful Shutdown'}
                >
                  <Power className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <button
                onClick={() => handleAction('power_on')}
                disabled={!!actionInProgress || !!mutationBlockReason}
                title={mutationBlockReason ?? 'Power on server'}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/60 rounded transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Power On</span>
              </button>
            )}
          </div>

        </div>
      </div>

      {mutationBlockReason && (
        <div
          role="status"
          data-safety-level={safetyLevel}
          className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{lockedServer ? 'Read-only server.' : maintenanceServer ? 'Maintenance server.' : 'Server changes are unavailable.'}</strong>{' '}
            {maintenanceServer
              ? 'Operational access, firewall rules, diagnostics, power recovery, and a non-replacing temporary backup are allowed. Structural changes stay blocked.'
              : lockedServer
                ? 'Read-only views, ping, uptime, and running-state checks are allowed. Remote access and every change stay blocked.'
                : mutationBlockReason}
          </span>
        </div>
      )}

      {actionError && (
        <div role="alert" className="mx-6 mt-4 flex items-center justify-between gap-3 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="font-semibold hover:underline">Dismiss</button>
        </div>
      )}

      {diagnosticResult && (
        <div
          className={`mx-6 mt-4 p-3 border text-xs rounded flex items-center justify-between ${
            diagnosticResult.ok
              ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300'
              : 'bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-400'
          }`}
        >
          <span>{diagnosticResult.text}</span>
          <button onClick={() => setDiagnosticResult(null)} className="text-[#017cb6] hover:underline text-xs">
            Dismiss
          </button>
        </div>
      )}

      {/* 2. SubTab Viewport */}
      <div className="p-6 space-y-6">
        {/* OVERVIEW TAB */}
        {activeSubTab === 'overview' && (
          <div className="space-y-6">
            {/* Real-time Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-[#2b3035] p-4 rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm">
                <div className="flex items-center justify-between text-xs text-[#6c757d] dark:text-slate-400">
                  <span>CPU Usage</span>
                  <Cpu className="w-4 h-4 text-[#017cb6]" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[#212529] dark:text-white">
                    {sample ? `${sample.cpu_usage_percent.toFixed(1)}%` : '—'}
                  </span>
                  <span className="text-xs text-[#6c757d] dark:text-slate-400">{server.vcpus} vCPU</span>
                </div>
              </div>

              <div className="bg-white dark:bg-[#2b3035] p-4 rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm">
                <div className="flex items-center justify-between text-xs text-[#6c757d] dark:text-slate-400">
                  <span>Memory</span>
                  <Activity className="w-4 h-4 text-[#017cb6]" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[#212529] dark:text-white">
                    {sample && server.memory > 0
                      ? `${((sample.memory_usage_bytes / (server.memory * 1024 * 1024)) * 100).toFixed(1)}%`
                      : '—'}
                  </span>
                  <span className="text-xs text-[#6c757d] dark:text-slate-400">{ramGB} GB allocated</span>
                </div>
              </div>

              <div className="bg-white dark:bg-[#2b3035] p-4 rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm">
                <div className="flex items-center justify-between text-xs text-[#6c757d] dark:text-slate-400">
                  <span>Disk Storage</span>
                  <HardDrive className="w-4 h-4 text-[#017cb6]" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[#212529] dark:text-white">{server.disk} GB</span>
                  <span className="text-xs text-[#6c757d] dark:text-slate-400">NVMe High IOPS</span>
                </div>
              </div>

              <div className="bg-white dark:bg-[#2b3035] p-4 rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm">
                <div className="flex items-center justify-between text-xs text-[#6c757d] dark:text-slate-400">
                  <span>Network Status</span>
                  <Globe className="w-4 h-4 text-[#017cb6]" />
                </div>
                {/*
                  * This was the literal string "Online", shown for every server in
                  * every state - so it claimed a stopped or still-provisioning
                  * server was online. It reports the API's provisioning status,
                  * which is the only thing actually known here; it is not a
                  * reachability probe, so it says "Reported" rather than implying
                  * the server was pinged.
                  */}
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    className={`text-2xl font-bold ${
                      server.status === 'active'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : server.status === 'new'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-[#6c757d] dark:text-slate-400'
                    }`}
                  >
                    {server.status === 'active' ? 'Online' : state.label}
                  </span>
                  <span className="text-xs text-[#6c757d] dark:text-slate-400">
                    {publicV4 ? '1 Gbps uplink' : 'no public address'}
                  </span>
                </div>
              </div>
            </div>

            {/* Server Information & Network DefTable Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* DefTable 1: Server Info */}
              <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-[#f1f1f1] dark:bg-[#262a2e] border-b border-[#ced4da] dark:border-[#373b3e] font-semibold text-xs text-[#495057] dark:text-[#ced4da]">
                  Server Information
                </div>
                <div className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e] text-xs">
                  <div className="flex py-2.5 px-4">
                    <span className="w-32 text-[#6c757d] dark:text-slate-400">Server ID</span>
                    <span className="font-mono text-[#212529] dark:text-white font-medium">#{server.id}</span>
                  </div>
                  <div className="flex py-2.5 px-4">
                    <span className="w-32 text-[#6c757d] dark:text-slate-400">Hostname</span>
                    <span className="text-[#212529] dark:text-white font-medium">{server.name}</span>
                  </div>
                  <div className="flex py-2.5 px-4">
                    <span className="w-32 text-[#6c757d] dark:text-slate-400">Data Centre</span>
                    <span className="text-[#212529] dark:text-white font-medium">
                      {server.region?.name} ({server.region?.slug?.toUpperCase()})
                    </span>
                  </div>
                  <div className="flex py-2.5 px-4">
                    <span className="w-32 text-[#6c757d] dark:text-slate-400">Operating System</span>
                    <span className="text-[#212529] dark:text-white font-medium">
                      {server.image?.full_name || server.image?.name}
                    </span>
                  </div>
                  <div className="flex py-2.5 px-4">
                    <span className="w-32 text-[#6c757d] dark:text-slate-400">Created At</span>
                    <span className="text-[#212529] dark:text-white">
                      {server.created_at ? new Date(server.created_at).toLocaleDateString() : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* DefTable 2: Network & Addressing */}
              <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-[#f1f1f1] dark:bg-[#262a2e] border-b border-[#ced4da] dark:border-[#373b3e] font-semibold text-xs text-[#495057] dark:text-[#ced4da]">
                  Network & Addressing
                </div>
                <div className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e] text-xs">
                  <div className="flex items-center justify-between py-2.5 px-4">
                    <span className="w-32 text-[#6c757d] dark:text-slate-400">Public IPv4</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[#212529] dark:text-white font-medium">{publicV4 || '—'}</span>
                      {publicV4 && (
                        <button
                          onClick={() => handleCopy(publicV4)}
                          className="text-[#6c757d] hover:text-[#017cb6]"
                        >
                          {copiedText === publicV4 ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {primaryV6 && (
                    <div className="flex items-center justify-between py-2.5 px-4">
                      <span className="w-32 text-[#6c757d] dark:text-slate-400">Public IPv6</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[#212529] dark:text-white truncate max-w-[200px]">
                          {primaryV6}
                        </span>
                        <button
                          onClick={() => handleCopy(primaryV6)}
                          className="text-[#6c757d] hover:text-[#017cb6]"
                        >
                          {copiedText === primaryV6 ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between py-2.5 px-4">
                    <span className="w-32 text-[#6c757d] dark:text-slate-400">VPC Network</span>
                    <span className="text-[#212529] dark:text-white font-medium">
                      {server.vpc_id ? <VpcBadge vpcId={server.vpc_id} client={client} /> : 'Default Public Bridge'}
                    </span>
                  </div>

                  {remoteServiceProbe.kind === 'ssh' && (
                    <div className="flex items-center justify-between py-2.5 px-4">
                      <span className="w-32 text-[#6c757d] dark:text-slate-400">SSH Connect</span>
                      {connectionV4 ? (
                        <button
                          onClick={handleCopySshCommand}
                          disabled={!!remoteBlockReason}
                          title={remoteBlockReason ?? 'Copy SSH command'}
                          className="flex items-center gap-1.5 text-xs text-[#017cb6] hover:underline font-mono disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span>ssh root@{connectionV4}</span>
                          <Copy className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-[#6c757d] dark:text-slate-400">Unavailable</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* USAGE & METRICS TAB */}
        {activeSubTab === 'usage' && <ServerUsage client={client} server={server} />}

        {activeSubTab === 'cloud-init' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-[#2b3035] p-5 rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-bold text-[#212529] dark:text-white">Cloud-init user data</h3>
                  <p className="text-xs text-[#6c757d] dark:text-slate-400">Image support: {imageSupportsUserData(server.image) ? 'Yes' : 'No'}</p>
                </div>
                <div className="flex gap-2">
                  <button disabled={!userDataQuery.data} onClick={() => userDataQuery.data && handleCopy(userDataQuery.data)} className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs disabled:opacity-40"><Copy className="w-3.5 h-3.5" />Copy</button>
                  <button disabled={capturing || !onSaveAsTemplate} onClick={() => void captureTemplate()} className="px-3 py-1.5 rounded bg-[#017cb6] text-white text-xs disabled:opacity-40">{capturing ? 'Capturing…' : 'Save server as template'}</button>
                </div>
              </div>
              <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mb-3">A template captures this server’s plan, image, region, VPC, firewall rules and user data, so the next one is a fill-in-the-blanks. It opens in the Templates tab for you to review and name.</p>
              {captureError && <p className="text-xs text-rose-600 mb-3">{captureError}</p>}
              {userDataQuery.isLoading ? <p className="text-xs text-[#6c757d]">Loading…</p> : userDataQuery.isError ? <p className="text-xs text-rose-600">Could not read stored user data.</p> : userDataQuery.data ? <textarea readOnly value={userDataQuery.data} rows={20} spellCheck={false} className="w-full px-3 py-2 text-xs font-mono rounded border bg-[#f8f9fa] dark:bg-[#212529] border-[#ced4da] dark:border-[#495057]" /> : <p className="text-xs text-[#6c757d]">This server has no stored user data.</p>}
            </div>
          </div>
        )}

        {/* REMOTE ACCESS TAB */}
        {activeSubTab === 'remote-access' && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-[#2b3035] p-5 rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm">
              <h3 className="text-sm font-bold text-[#212529] dark:text-white mb-2">
                {remoteServiceProbe.kind === 'ssh' ? 'Native Terminal & SSH Keys' : 'Remote Access'}
              </h3>
              <p className="text-xs text-[#6c757d] dark:text-slate-400 mb-4">
                {remoteServiceProbe.kind === 'ssh'
                  ? 'Launch an instant SSH connection in your macOS/Windows terminal using your hardware-vault keys.'
                  : 'This Windows server uses RDP on TCP 3389. BLDesk checks its reachability; connect with your RDP client or use the out-of-band rescue console here.'}
              </p>
              <div className="flex items-center gap-3">
                {remoteServiceProbe.kind === 'ssh' && (
                  <button
                    onClick={handleLaunchSsh}
                    disabled={!!remoteBlockReason || !connectionV4}
                    title={remoteBlockReason ?? (!connectionV4 ? 'No IPv4 address is available' : 'Launch SSH')}
                    className="px-4 py-2 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition flex items-center gap-2 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Terminal className="w-4 h-4" />
                    <span>Launch Terminal Now</span>
                  </button>
                )}
                <button
                  onClick={handleLaunchRescueConsole}
                  disabled={isOpeningConsole || !!remoteBlockReason}
                  title={remoteBlockReason ?? 'Open Out-of-Band Rescue VNC / Serial Console'}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium rounded transition flex items-center gap-2 shadow-sm disabled:opacity-50"
                >
                  <Radio className="w-4 h-4" />
                  <span>Open Out-of-Band Rescue VNC</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* BACKUPS TAB */}
        {activeSubTab === 'backups' && (
          <div className="bg-white dark:bg-[#2b3035] p-5 rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm">
            <BackupManager
              key={`server-backups-${server.id}`}
              client={client}
              initialServerId={server.id}
              servers={allServers ?? [server]}
            />
          </div>
        )}

        {/* NETWORK TAB */}
        {activeSubTab === 'network' && (
          <ServerNetwork client={client} server={server} mutationBlockReason={mutationBlockReason} />
        )}

        {/* FIREWALL TAB */}
        {activeSubTab === 'firewall' && (
          <div className="bg-white dark:bg-[#2b3035] p-5 rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm">
            <FirewallManager
              client={client}
              initialServerId={server.id}
              profileId={profileId}
              servers={firewallServers}
              mutationBlockReason={firewallBlockReason}
            />
          </div>
        )}

        {/* SETTINGS TAB */}

        {activeSubTab === 'settings' && (
          <ServerSettings
            client={client}
            server={server}
            servers={actionableServers}
            mutationBlockReason={mutationBlockReason}
            powerCycleBlockReason={powerCycleBlockReason}
          />
        )}

        {/* RECOVERY TAB */}
        {activeSubTab === 'change-plan' && (
          <SafetyBoundary reason={mutationBlockReason}>
            <div className="p-4 sm:p-6">
              <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] p-4 sm:p-5 shadow-sm space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-[#212529] dark:text-white uppercase tracking-wider">Change Plan</h3>
                  <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-1">
                    Moves the server to a different plan. The server restarts to apply the change.
                  </p>
                </div>
                <ChangePlanPanel
                  client={client}
                  server={server}
                  busy={actionInProgress !== null || !!mutationBlockReason}
                  onApply={(payload, summary, changes, confirm) =>
                    void handleAction('resize', payload, {
                      // A resize restarts the server; releasing addresses escalates it further (see ChangePlanPanel).
                      summary: `${summary}. The server restarts to apply it.`,
                      severity: 'destructive',
                      changes,
                      ...confirm
                    })
                  }
                />
              </div>
            </div>
          </SafetyBoundary>
        )}

        {activeSubTab === 'cancel' && (
          <SafetyBoundary reason={mutationBlockReason}>
            <div className="p-4 sm:p-6">
              <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-rose-300 dark:border-rose-900 p-4 sm:p-5 shadow-sm space-y-3">
                <h3 className="text-xs font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wider">
                  Cancel Server
                </h3>
                <p className="text-xs text-[#495057] dark:text-slate-300">
                  Cancels the Cloud Server service. It is cancelled within five minutes, after which an invoice is
                  generated for usage to date. The server and its data are destroyed and cannot be recovered.
                </p>
                <button
                  type="button"
                  onClick={() => void handleCancelServer()}
                  disabled={!!actionInProgress || !!mutationBlockReason}
                  title={mutationBlockReason ?? 'Cancel server'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-rose-600 text-white disabled:opacity-40"
                >
                  <span>Cancel Server</span>
                </button>
              </div>
            </div>
          </SafetyBoundary>
        )}

        {activeSubTab === 'recovery' && (
          <div className="bg-white dark:bg-[#2b3035] p-5 rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-[#212529] dark:text-white">Emergency Recovery & Rescue</h3>
              <p className="text-xs text-[#6c757d] dark:text-slate-400">
                Run diagnostics against the VPS or boot into rescue mode.
              </p>

            {/* The host node is already on the server object, so this needs no
                request. Shown beside the VPS diagnostics because the two used to
                be conflated: the `uptime` action returns the guest's uptime, not
                the hypervisor's, and they are routinely weeks apart. */}
              {server.host && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs p-2.5 rounded bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e]">
                  <span className="text-[#495057] dark:text-[#adb5bd]">
                    Host node{' '}
                    <span className="font-mono font-medium text-[#212529] dark:text-white">
                      {server.host.display_name || '—'}
                    </span>
                  </span>
                  {typeof server.host.uptime_ms === 'number' && (
                    <span className="text-[#495057] dark:text-[#adb5bd]">
                      Host uptime{' '}
                      <span className="font-medium text-[#212529] dark:text-white">
                        {formatUptime(server.host.uptime_ms)}
                      </span>
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <DiagnosticButton
                  label="VPS Ping Check"
                  busyLabel="Pinging..."
                  active={actionInProgress === 'ping'}
                  disabled={!!actionInProgress || !!diagnosticBlockReason}
                  title={diagnosticBlockReason ?? "Ask BinaryLane to send an ICMP ping to this server's public interface. A failed check can mean ICMP is blocked, not that the server is off."}
                  onClick={() => handleAction('ping')}
                />
                <DiagnosticButton
                  label="VPS Uptime"
                  busyLabel="Checking..."
                  active={actionInProgress === 'uptime'}
                  disabled={!!actionInProgress || !!diagnosticBlockReason}
                  title={diagnosticBlockReason ?? "Read the VPS's continuous uptime; this is not a network reachability test."}
                  onClick={() => handleAction('uptime')}
                />
                <DiagnosticButton
                  label="Running State"
                  busyLabel="Checking..."
                  active={actionInProgress === 'is_running'}
                  disabled={!!actionInProgress || !!diagnosticBlockReason}
                  title={diagnosticBlockReason ?? 'Ask BinaryLane whether the VM is running. A running VM can still be unreachable or unresponsive.'}
                  onClick={() => handleAction('is_running')}
                />
                <button
                  onClick={() => handleAction('enable_rescue_mode')}
                  disabled={!!actionInProgress || !!mutationBlockReason}
                  title={mutationBlockReason ?? 'Boot into rescue mode'}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/40 text-amber-700 dark:text-amber-400 text-xs font-medium rounded hover:bg-amber-500/20 transition disabled:opacity-50"
                >
                  {actionInProgress === 'enable_rescue_mode' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {actionInProgress === 'enable_rescue_mode' ? 'Enabling...' : 'Boot into Rescue Mode'}
                </button>
              </div>
          </div>
        )}
      </div>
    </div>
  )
}
