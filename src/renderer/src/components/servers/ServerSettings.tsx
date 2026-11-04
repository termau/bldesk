import React, { useState, useEffect } from 'react'
import {
  Tag,
  Tags,
  HardDrive,
  Cpu,
  Bell,
  MapPin,
  Users,
  AlertTriangle,
  Check,
  Loader2,
  Lock,
  RotateCw,
  Trash2,
  Plus,
  ArrowRightLeft,
  ChevronDown
} from 'lucide-react'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import {
  useServer,
  useRegions,
  useServerThresholdAlerts,
  useAvailableAdvancedFeatures,
  useServerActionWithHandoff,
  type ServerActionBody,
  networkActionMutationKey,
  actionFailureMessage,
  describeApiError,
  ACCEPTED_WITHOUT_ACTION
} from '../../api/queries'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { useIsMutating } from '@tanstack/react-query'
import { useConfirm, type ConfirmRequest } from '../../context/ConfirmContext'
import { updateChange } from '../../lib/changelog'
import { ServerTagsTab } from './ServerTagsTab'
import { ServerAlertBanner, useServerAlertNotice } from './ServerAlertNotice'
import { ServerAlertRules } from './ServerAlertRules'
import type { AlertChange } from '../../lib/thresholdAlerts'

type Server = components['schemas']['Server']
type Disk = components['schemas']['Disk']
type VmMachineType = components['schemas']['VmMachineType']
import { visibleFeatures, mergeHiddenFeatures, formatMachineType } from '../../lib/advancedFeatures'
type VideoDevice = components['schemas']['VideoDevice']
type AdvancedFeature = components['schemas']['AdvancedFeature']

/** The video devices the API reference defines, with its own descriptions of them. */
const VIDEO_DEVICES: Array<{ value: VideoDevice; label: string }> = [
  { value: 'cirrus-logic', label: 'Cirrus Logic GD5446' },
  { value: 'standard', label: 'Standard VGA with VESA 2.0 extensions' },
  { value: 'virtio', label: 'Virtio VGA (800x600)' },
  { value: 'virtio-wide', label: 'Virtio VGA (1600x900)' }
]

interface ServerSettingsProps {
  /** The app's server list — see AGENTS.md rule 8; tabs do not call useServers. */
  servers: any[]
  client: BinaryLaneClient | null
  server: Server
  /** Tags are kept per account profile, on this device. */
  profileId?: string
  /** The tab to open on, when something sends the user to one (the heatmap's alert marker opens Alerts). */
  /** Open on this tab, now or when a later request comes in while Settings is already showing. */
  start?: SettingsStart
}

export type SettingsTab = 'hostname' | 'tags' | 'disks' | 'advanced' | 'alerts' | 'region' | 'partner' | 'danger'

/** A request to open Settings on one tab. Each request is a new object, so asking again for the same tab still counts. */
export interface SettingsStart { tab: SettingsTab }

export const ServerSettings: React.FC<ServerSettingsProps> = ({ client, server: initialServer, servers: allServers, profileId, start }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(start?.tab ?? 'hostname')
  // The alert pill can ask for the Alerts tab while Settings is already open on another one.
  useEffect(() => {
    if (start) setActiveTab(start.tab)
  }, [start])
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Live polling for server state
  const serverQuery = useServer(client, initialServer.id)
  const server = serverQuery.data || initialServer

  const regionsQuery = useRegions(client)
  const alertsQuery = useServerThresholdAlerts(client, server.id)
  const alertNotice = useServerAlertNotice(client, server.id)
  const advancedQuery = useAvailableAdvancedFeatures(client, server.id)

  const actionMutation = useServerActionWithHandoff(client, server.id)
  const { track } = useTrackedActions()
  const confirmAction = useConfirm()
  const mutatingCount = useIsMutating({ mutationKey: networkActionMutationKey(server.id) })
  const busy = mutatingCount > 0 || actionMutation.isPending

  // --- Form States ---
  // Hostname
  const [hostnameInput, setHostnameInput] = useState(server.name || '')
  useEffect(() => {
    setHostnameInput(server.name || '')
  }, [server.name])

  // Disks
  const [newDiskSize, setNewDiskSize] = useState('10')
  const [resizeDiskId, setResizeDiskId] = useState<number | null>(null)
  const [resizeDiskSize, setResizeDiskSize] = useState<string>('')

  // Advanced Features
  const [machineType, setMachineType] = useState<VmMachineType | ''>('')
  const shownFeatures = visibleFeatures(
    (advancedQuery.data?.advanced_features ?? []) as string[],
    server.image?.distribution
  )
  const [processorModel, setProcessorModel] = useState<number>(-1)
  const [videoDevice, setVideoDevice] = useState<VideoDevice>('cirrus-logic')
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([])

  useEffect(() => {
    if (server.advanced_features) {
      setSelectedFeatures(
        (server.advanced_features.enabled_advanced_features || []) as string[]
      )
      if (server.advanced_features.machine_type) {
        setMachineType(server.advanced_features.machine_type)
      }
      if (server.advanced_features.processor_model !== undefined && server.advanced_features.processor_model !== null) {
        setProcessorModel(server.advanced_features.processor_model)
      }
      if (server.advanced_features.video_device) {
        setVideoDevice(server.advanced_features.video_device)
      }
    }
  }, [server.advanced_features])

  // Region
  const [selectedRegion, setSelectedRegion] = useState(server.region?.slug || '')

  // Partner
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>(
    server.partner_id ? String(server.partner_id) : ''
  )

  // Danger Zone - OS Rebuild
  const [rebuildImage, setRebuildImage] = useState<string>('')

  /**
   * Confirm (with what will change), submit, and report. `req` is everything
   * the dialog should show beyond the title and the server: a summary, a
   * before → after table, warnings, and how bad getting it wrong is.
   */
  const executeAction = async (label: string, payload: ServerActionBody, req: Omit<ConfirmRequest, 'title' | 'target'>): Promise<boolean> => {
    const c = await confirmAction({ title: label, helpSlug: 'server-settings#worked-example', target: { kind: 'server', id: server.id, name: server.name }, ...req })
    if (!c.ok) return false
    setErrorMsg(null)
    setNotice(null)
    try {
      const outcome = await actionMutation.mutateAsync(payload)
      switch (outcome.state) {
        case 'completed':
          void updateChange(c.changeId, { outcome: 'completed', actionId: outcome.action.id })
          setNotice(`"${label}" completed successfully.`)
          return true
        case 'handed-off':
          // A rebuild or a region migration legitimately outlasts any sensible
          // UI block. Release the panel and let the toast report the real
          // outcome rather than calling a healthy operation failed.
          track(outcome.action, label, server.name, c.changeId)
          setNotice(`"${label}" is still running on BinaryLane. You will be notified when it finishes.`)
          return true
        case 'accepted':
          // No action to track and nothing known about completion: the entry stays "submitted".
          void updateChange(c.changeId, { outcome: 'submitted', detail: ACCEPTED_WITHOUT_ACTION })
          setNotice(`"${label}" was accepted by BinaryLane. It returned no action to follow, so check the server details for the result.`)
          return true
        case 'awaiting-interaction':
          track(outcome.action, label, server.name, c.changeId)
          setNotice(`"${label}" is waiting for your answer — see the prompt.`)
          return true
        case 'blocked-by-invoice':
          // Tracked as well: paying the invoice may release it, and the toast is
          // then what reports the real outcome.
          track(outcome.action, label, server.name, c.changeId)
          setErrorMsg(
            `"${label}" is blocked by invoice #${outcome.action.blocking_invoice_id}, which requires payment.`
          )
          return false
        case 'errored':
          void updateChange(c.changeId, { outcome: 'errored', actionId: outcome.action.id, detail: actionFailureMessage(label, outcome.action) })
          setErrorMsg(actionFailureMessage(label, outcome.action))
          return false
      }
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setErrorMsg(err.message || `Failed to execute ${label}`)
      return false
    }
  }

  // --- Handlers ---

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hostnameInput.trim() || hostnameInput.trim() === server.name) return
    await executeAction(
      'Rename Server',
      { type: 'rename', name: hostnameInput.trim() },
      { summary: 'Changes the display name in mPanel and the API. The OS hostname inside the server is not touched.', changes: [{ label: 'Name', from: server.name, to: hostnameInput.trim() }] }
    )
  }

  const handleAddDisk = async (e: React.FormEvent) => {
    e.preventDefault()
    const size = parseInt(newDiskSize, 10)
    if (!size || size < 1) return
    await executeAction(
      'Add Disk',
      { type: 'add_disk', size_gigabytes: size },
      { summary: 'Attaches a new, empty secondary disk. It appears as an unformatted block device inside the OS.', changes: [{ label: 'New disk', to: `${size} GB` }] }
    )
  }

  const handleResizeDisk = async (disk: Disk) => {
    const size = parseInt(resizeDiskSize, 10)
    if (!size || size === disk.size_gigabytes) return
    const isShrink = size < disk.size_gigabytes
    const warning = isShrink
      ? `WARNING: Reducing disk size below ${disk.size_gigabytes} GB can cause catastrophic filesystem corruption if the partition was not first shrunk inside the OS.\n\n`
      : ''
    const ok = await executeAction(
      'Resize Disk',
      { type: 'resize_disk', disk_id: disk.id, size_gigabytes: size },
      {
        summary: isShrink ? 'Shrinks the disk at the block level.' : 'Grows the disk. The filesystem inside the OS still has to be extended to use the space.',
        severity: isShrink ? 'destructive' : 'normal',
        notes: warning ? [warning.trim()] : undefined,
        changes: [{ label: disk.description || `Disk #${disk.id}`, from: `${disk.size_gigabytes} GB`, to: `${size} GB` }]
      }
    )
    if (ok) setResizeDiskId(null)
  }

  const handleDeleteDisk = async (disk: Disk) => {
    await executeAction(
      'Delete Disk',
      { type: 'delete_disk', disk_id: disk.id },
      {
        summary: `Permanently deletes the ${disk.size_gigabytes} GB secondary disk "${disk.description || disk.id}". Everything on it is gone.`,
        severity: 'irreversible',
        typeToConfirm: disk.description || String(disk.id),
        changes: [{ label: 'Disk', from: `${disk.description || disk.id} (${disk.size_gigabytes} GB)`, to: undefined }],
        confirmLabel: 'Delete disk'
      }
    )
  }

  // What the Advanced form would change. A row that reads the same either side is not a change, and features are
  // compared as sets (ticking one off and on again gives the same set in another order).
  const advancedChanges = (() => {
    const current = server.advanced_features
    const before = current?.enabled_advanced_features ?? []
    const sameFeatures = before.length === selectedFeatures.length && before.every((f) => selectedFeatures.includes(f))
    const processorLabel = (id: number) => (id === -1 ? 'Host Default (Auto)' : advancedQuery.data?.processor_models?.find((p) => p.id === id)?.name ?? `#${id}`)
    const videoLabel = (v: string) => VIDEO_DEVICES.find((d) => d.value === v)?.label ?? v
    return [
      ...(sameFeatures ? [] : [{ label: 'Features', from: before.join(', ') || undefined, to: selectedFeatures.join(', ') || undefined }]),
      ...(machineType !== (current?.machine_type ?? '')
        ? [{ label: 'Machine type', from: current?.machine_type ? formatMachineType(current.machine_type as string) : 'Default (Automatic)', to: machineType ? formatMachineType(machineType as string) : 'Default (Automatic)' }]
        : []),
      ...(processorModel !== (current?.processor_model ?? -1)
        ? [{ label: 'Processor model', from: processorLabel(current?.processor_model ?? -1), to: processorLabel(processorModel) }]
        : []),
      ...(videoDevice !== (current?.video_device ?? 'cirrus-logic') ? [{ label: 'Video device', from: videoLabel(current?.video_device ?? 'cirrus-logic'), to: videoLabel(videoDevice) }] : [])
    ]
  })()

  const handleSaveAdvanced = async (e: React.FormEvent) => {
    e.preventDefault()
    if (advancedChanges.length === 0) return
    const current = server.advanced_features
    await executeAction(
      'Update Advanced Features',
      {
        type: 'change_advanced_features',
        // The slugs are typed as plain strings (FeatureDescriptor.slug, and the server's own enabled list), not as the spec's
        // AdvancedFeature enum, so this is the one place a cast is needed.
        enabled_advanced_features: mergeHiddenFeatures(
          selectedFeatures,
          (server.advanced_features?.enabled_advanced_features ?? []) as string[],
          shownFeatures
        ) as AdvancedFeature[],
        // Choosing "Default (Automatic)" or "Host Default (Auto)" when the server has a setting is a change, and the
        // reference has a field for it. Leaving the field out keeps what is there, so it would report success and do nothing.
        ...(machineType === '' && current?.machine_type ? { automatic_machine_type: true } : machineType ? { machine_type: machineType } : {}),
        ...(processorModel === -1 && current?.processor_model != null ? { automatic_processor_model: true } : processorModel !== -1 ? { processor_model: processorModel } : {}),
        video_device: videoDevice
      },
      {
        summary: 'Updates the hypervisor-level features. Takes effect on the next reboot.',
        changes: advancedChanges
      }
    )
  }

  // Only the rules the user changed are sent: the request keeps the status and value of anything left out.
  const handleSaveAlerts = (changes: AlertChange[]) =>
    executeAction(
      'Update Threshold Alerts',
      { type: 'change_threshold_alerts', threshold_alerts: changes.map((c) => c.request) },
      { summary: 'Saves the monitoring thresholds BinaryLane alerts on. Only the rules you changed are sent.', changes: changes.map((c) => ({ label: c.name, from: c.from, to: c.to })) }
    )

  const handleMigrateRegion = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRegion || selectedRegion === server.region?.slug) return
    const target = regionsQuery.data?.find((r) => r.slug === selectedRegion)
    const targetName = target?.name || selectedRegion
    await executeAction(
      'Migrate Region',
      { type: 'change_region', region: selectedRegion },
      {
        summary: 'Live-migrates storage and networking to the new region. Expect a brief connectivity pause; the public IP changes if the regions do not share address space.',
        severity: 'destructive',
        changes: [{ label: 'Region', from: server.region?.name || server.region?.slug, to: targetName }],
        confirmLabel: 'Migrate'
      }
    )
  }

  const handleSavePartner = async (e: React.FormEvent) => {
    e.preventDefault()
    const partnerId = selectedPartnerId ? parseInt(selectedPartnerId, 10) : null
    const partnerServer = allServers.find((s) => s.id === partnerId)
    // Name and id, like the new partner. A partner that is not in the servers list keeps just its id.
    const currentPartner = allServers.find((s) => s.id === server.partner_id)
    const from = server.partner_id ? (currentPartner ? `${currentPartner.name} (#${server.partner_id})` : `#${server.partner_id}`) : undefined
    await executeAction(
      'Change Partner Server',
      { type: 'change_partner', partner_server_id: partnerId },
      { summary: 'BinaryLane keeps HA partners on separate physical hypervisors.', changes: [{ label: 'HA partner', from, to: partnerServer ? `${partnerServer.name} (#${partnerId})` : partnerId ? `#${partnerId}` : undefined }] }
    )
  }

  // What `password_reset` does depends on the server (`password_change_supported`, from the reference): where it is
  // supported a new password is generated and emailed to the account address; where it is not, the action only clears
  // the root/administrator password, and a new one is set at the web console. Nothing is emailed then.
  const passwordResetWording = (() => {
    const supported = (server as { password_change_supported?: boolean | null }).password_change_supported
    if (supported === true) {
      return {
        card: 'Generates a new root/administrator password and sends it to your account email.',
        summary: 'Generates a new root/administrator password and emails it to the account address. Anything using the old password stops authenticating.'
      }
    }
    if (supported === false) {
      return {
        card: "Clears the root/administrator password so a new one can be set at the server's web console. No password is emailed.",
        summary: "Clears the root/administrator password, which this server cannot change from here: a new one is set at the server's web console. No password is emailed. Anything using the old password stops authenticating."
      }
    }
    return {
      card: 'Resets the root/administrator password. Depending on the server, a new password is emailed to your account address or the password is cleared to be set at the web console.',
      summary: 'Resets the root/administrator password. Depending on the server, a new password is emailed to the account address or the password is cleared and a new one is set at the web console. Anything using the old password stops authenticating.'
    }
  })()
  const handleResetPassword = async () => {
    await executeAction(
      'Reset Root/Admin Password',
      { type: 'password_reset' },
      { summary: passwordResetWording.summary, severity: 'destructive', confirmLabel: 'Reset password' }
    )
  }

  const handlePowerCycle = async () => {
    await executeAction(
      'Hard Power Cycle',
      { type: 'power_cycle' },
      { summary: 'Cuts power at the hypervisor and starts the server again. Equivalent to pulling the plug: anything unsaved in the guest is lost.', severity: 'destructive', confirmLabel: 'Power cycle' }
    )
  }

  const handleRebuild = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rebuildImage.trim()) return
    await executeAction(
      'Rebuild Server OS',
      { type: 'rebuild', image: rebuildImage.trim() },
      {
        summary: `Erases the disk and reinstalls from image "${rebuildImage.trim()}". Every file on the server is destroyed; the IP addresses are kept.`,
        helpSlug: 'server-settings#rebuild-and-password-reset',
        severity: 'irreversible',
        notes: ['Take a backup first if anything on this server matters.'],
        changes: [{ label: 'Image', from: server.image?.slug || server.image?.name || undefined, to: rebuildImage.trim() }],
        confirmLabel: 'Rebuild'
      }
    )
  }

  // Filter partner candidate servers (same region, not self)
  const partnerCandidates = allServers.filter(
    (s) => s.id !== server.id && s.region?.slug === server.region?.slug
  )

  const navTabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'hostname', label: 'Hostname', icon: <Tag className="w-3.5 h-3.5" /> },
    { id: 'tags', label: 'Tags', icon: <Tags className="w-3.5 h-3.5" /> },
    { id: 'disks', label: 'Disks', icon: <HardDrive className="w-3.5 h-3.5" /> },
    { id: 'advanced', label: 'Advanced', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'alerts', label: 'Alerts', icon: <Bell className="w-3.5 h-3.5" /> },
    { id: 'region', label: 'Region', icon: <MapPin className="w-3.5 h-3.5" /> },
    { id: 'partner', label: 'Partner Server', icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'danger', label: 'Danger Zone', icon: <AlertTriangle className="w-3.5 h-3.5" /> }
  ]

  const inputClass =
    'px-3 py-1.5 text-xs bg-white dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-slate-100 focus:outline-none focus:border-[#017cb6] disabled:opacity-50 transition'
  const primaryBtn =
    'px-3.5 py-1.5 text-xs font-semibold text-white bg-[#017cb6] hover:bg-[#016696] rounded shadow-sm disabled:opacity-50 transition flex items-center gap-1.5'
  const dangerBtn =
    'px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded shadow-sm disabled:opacity-50 transition flex items-center gap-1.5'

  return (
    <div className="space-y-4">
      {/* Mutating / In-progress Action Alert */}
      {busy && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 bg-[#e7f1f6] dark:bg-[#1a2d3d] border border-[#b6d4e7] dark:border-[#24455f] text-[#017cb6] dark:text-[#5bc0de] text-xs rounded flex items-center gap-2"
        >
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
          <span>Applying changes to BinaryLane server... Controls will unlock once verified.</span>
        </div>
      )}

      {/* Success Notification */}
      {notice && !busy && (
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

      {/* Error Alert */}
      {errorMsg && !busy && (
        <div
          role="alert"
          className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="hover:underline flex-shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {/* Mobile Sub-tab Dropdown Selector (Android & Mobile Viewports) */}
      <div className="md:hidden">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#6c757d] dark:text-slate-400 mb-1.5">
          Settings Section
        </label>
        <div className="relative">
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as SettingsTab)}
            aria-label="Settings section"
            className="w-full py-2.5 pl-3 pr-9 text-xs font-semibold bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-sm text-[#017cb6] dark:text-[#5bc0de] focus:outline-none focus:border-[#017cb6] appearance-none cursor-pointer"
          >
            {navTabs.map((tab) => (
              <option key={tab.id} value={tab.id} className="text-[#212529] dark:text-white bg-white dark:bg-[#212529]">
                {tab.label}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-[#6c757d] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* Desktop Sub-tab Navigation Header */}
      <div className="hidden md:flex items-center gap-1 border-b border-[#ced4da] dark:border-[#373b3e] overflow-x-auto pb-0">
        {navTabs.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
                isActive
                  ? 'border-[#017cb6] text-[#017cb6] dark:text-[#5bc0de]'
                  : 'border-transparent text-[#6c757d] hover:text-[#212529] dark:hover:text-slate-200'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* 1. HOSTNAME TAB */}
      {activeTab === 'hostname' && (
        <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-xs font-bold text-[#212529] dark:text-white uppercase tracking-wider">
              Server Display Name
            </h3>
            <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-1 leading-relaxed">
              Your Cloud Server has two distinct names: the name displayed within mPanel (currently{' '}
              <span className="font-semibold text-[#212529] dark:text-slate-200">{server.name}</span>) and the
              hostname configured inside the operating system. With this interface you may change the display label.
            </p>
          </div>

          <form onSubmit={handleRename} className="max-w-md space-y-3 pt-2">
            <div>
              <label className="block text-[11px] font-semibold text-[#495057] dark:text-slate-300 mb-1">
                mPanel Name
              </label>
              <input
                type="text"
                value={hostnameInput}
                onChange={(e) => setHostnameInput(e.target.value)}
                disabled={busy}
                className={`${inputClass} w-full font-mono`}
                placeholder="my-server-name"
                required
              />
            </div>
            <button
              type="submit"
              disabled={busy || !hostnameInput.trim() || hostnameInput.trim() === server.name}
              className={primaryBtn}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Change Name</span>
            </button>
          </form>
        </div>
      )}

      {/* TAGS TAB: local labels, no request */}
      {activeTab === 'tags' && <ServerTagsTab profileId={profileId} server={server} servers={allServers} />}

      {/* 2. DISKS TAB */}
      {activeTab === 'disks' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm overflow-hidden">
            <div className="p-3.5 bg-[#f1f1f1] dark:bg-[#262a2e] border-b border-[#ced4da] dark:border-[#373b3e] flex items-center justify-between">
              <h3 className="font-bold text-xs text-[#495057] dark:text-[#ced4da] flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-[#017cb6]" />
                <span>Attached Block Storage Disks ({server.disks?.length || 0})</span>
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#f8f9fa] dark:bg-[#212529] border-b border-[#ced4da] dark:border-[#373b3e] text-[#6c757d] dark:text-slate-400 font-semibold">
                    <th className="py-2.5 px-4">Disk</th>
                    <th className="py-2.5 px-4">Type</th>
                    <th className="py-2.5 px-4">Size</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
                  {(server.disks || []).map((disk) => {
                    const isEditing = resizeDiskId === disk.id
                    return (
                      <tr key={disk.id} className="hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] transition">
                        <td className="py-3 px-4 font-medium text-[#212529] dark:text-white">
                          <div>
                            <span>{disk.description || `Disk #${disk.id}`}</span>
                            <span className="block text-[11px] font-mono text-[#6c757d] dark:text-slate-400">
                              ID: {disk.id}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                              disk.primary
                                ? 'bg-[#017cb6]/10 text-[#017cb6] dark:text-[#5bc0de] border border-[#017cb6]/20'
                                : 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border border-slate-500/20'
                            }`}
                          >
                            {disk.primary ? 'Primary OS' : 'Secondary'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-medium text-[#212529] dark:text-white">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="5"
                                max="2000"
                                value={resizeDiskSize}
                                onChange={(e) => setResizeDiskSize(e.target.value)}
                                className={`${inputClass} w-24`}
                                disabled={busy}
                              />
                              <span className="text-xs text-[#6c757d]">GB</span>
                            </div>
                          ) : (
                            <span>{disk.size_gigabytes} GB</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleResizeDisk(disk)}
                                disabled={busy || !resizeDiskSize}
                                className={primaryBtn}
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setResizeDiskId(null)}
                                disabled={busy}
                                className="px-2.5 py-1 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => {
                                  setResizeDiskId(disk.id)
                                  setResizeDiskSize(String(disk.size_gigabytes))
                                }}
                                disabled={busy}
                                className="px-2.5 py-1 text-xs text-[#017cb6] hover:underline font-medium"
                              >
                                Resize
                              </button>
                              {!disk.primary && (
                                <button
                                  onClick={() => handleDeleteDisk(disk)}
                                  disabled={busy}
                                  className="text-rose-600 hover:text-rose-700 p-1 transition"
                                  title="Delete secondary disk"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {(!server.disks || server.disks.length === 0) && (
                    <tr>
                      <td colSpan={4} className="py-6 px-4 text-center text-[#6c757d] dark:text-slate-500">
                        No disks reported for this server.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add Secondary Disk Form */}
          <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] p-5 shadow-sm space-y-3">
            <h4 className="text-xs font-bold text-[#212529] dark:text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#017cb6]" />
              <span>Attach New Secondary Disk</span>
            </h4>
            <p className="text-xs text-[#6c757d] dark:text-slate-400">
              Attach an additional block device for databases, partitions, or bulk storage.
            </p>
            <form onSubmit={handleAddDisk} className="flex flex-wrap items-center gap-3 pt-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="5"
                  max="2000"
                  value={newDiskSize}
                  onChange={(e) => setNewDiskSize(e.target.value)}
                  disabled={busy}
                  className={`${inputClass} w-28`}
                  placeholder="Size in GB"
                  required
                />
                <span className="text-xs text-[#6c757d] dark:text-slate-400">GB</span>
              </div>
              <button type="submit" disabled={busy || !newDiskSize} className={primaryBtn}>
                <Plus className="w-3.5 h-3.5" />
                <span>Attach Disk</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 3. ADVANCED TAB */}
      {activeTab === 'advanced' && (
        <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-xs font-bold text-[#212529] dark:text-white uppercase tracking-wider">
              Hypervisor & CPU Features
            </h3>
            <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-1">
              Configure low-level virtualization parameters, CPU instruction flags, and display adapters.
            </p>
          </div>

          <form onSubmit={handleSaveAdvanced} className="space-y-4 pt-2 max-w-xl">
            {/* Machine Type */}
            {advancedQuery.data?.machine_types && advancedQuery.data.machine_types.length > 0 && (
              <div>
                <label className="block text-[11px] font-semibold text-[#495057] dark:text-slate-300 mb-1">
                  VM Machine Type
                </label>
                <select
                  value={machineType}
                  onChange={(e) => setMachineType(e.target.value as VmMachineType)}
                  disabled={busy}
                  className={`${inputClass} w-full`}
                >
                  <option value="">Default (Automatic)</option>
                  {advancedQuery.data.machine_types.map((m) => (
                    <option key={m} value={m}>
                      {formatMachineType(m as string)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Processor Model */}
            {advancedQuery.data?.processor_models && advancedQuery.data.processor_models.length > 0 && (
              <div>
                <label className="block text-[11px] font-semibold text-[#495057] dark:text-slate-300 mb-1">
                  Processor Model
                </label>
                <select
                  value={processorModel}
                  onChange={(e) => setProcessorModel(parseInt(e.target.value, 10))}
                  disabled={busy}
                  className={`${inputClass} w-full`}
                >
                  <option value="-1">Host Default (Auto)</option>
                  {advancedQuery.data.processor_models.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.description ? `— ${p.description}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Video Device */}
            <div>
              <label className="block text-[11px] font-semibold text-[#495057] dark:text-slate-300 mb-1">
                Virtual Video Device Driver
              </label>
              <select
                value={videoDevice}
                onChange={(e) => setVideoDevice(e.target.value as VideoDevice)}
                disabled={busy}
                className={`${inputClass} w-full`}
              >
                {VIDEO_DEVICES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Feature Flags - the customer-facing subset, labelled as the web
                panel labels them. The raw API list also carries operator-level
                switches (local-rtc, qemu-guest-agent, uefi-boot); those stay
                hidden but are preserved on save, see mergeHiddenFeatures. */}
            {shownFeatures.length > 0 && (
              <div className="space-y-2 pt-2">
                <label className="block text-[11px] font-semibold text-[#495057] dark:text-slate-300">
                  Features
                </label>
                <div className="space-y-2">
                  {shownFeatures.map((feat) => {
                    const isChecked = selectedFeatures.includes(feat.slug)
                    return (
                      <label
                        key={feat.slug}
                        className="flex items-start gap-2 text-xs text-[#212529] dark:text-slate-200 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={busy}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedFeatures([...selectedFeatures, feat.slug])
                            } else {
                              setSelectedFeatures(selectedFeatures.filter((f) => f !== feat.slug))
                            }
                          }}
                          className="mt-0.5 shrink-0 rounded border-[#ced4da] text-[#017cb6] focus:ring-0"
                        />
                        <span>
                          <span className="block">{feat.label}</span>
                          <span className="block text-[11px] text-[#6c757d] dark:text-slate-400">{feat.hint}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            <button type="submit" disabled={busy || advancedChanges.length === 0} className={primaryBtn}>
              <Cpu className="w-3.5 h-3.5" />
              <span>Save Advanced Features</span>
            </button>
          </form>
        </div>
      )}


      {/* 4. ALERTS TAB */}
      {activeTab === 'alerts' && alertNotice && <ServerAlertBanner notice={alertNotice} />}
      {activeTab === 'alerts' && (
        <ServerAlertRules
          alerts={alertsQuery.data}
          status={alertsQuery.isError ? 'error' : alertsQuery.isPending ? 'loading' : 'ready'}
          error={alertsQuery.isError ? describeApiError(alertsQuery.error) : null}
          onRetry={() => void alertsQuery.refetch()}
          busy={busy}
          onSave={handleSaveAlerts}
        />
      )}

      {/* 5. REGION TAB */}
      {activeTab === 'region' && (
        <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-xs font-bold text-[#212529] dark:text-white uppercase tracking-wider">
              Data Center Region Migration
            </h3>
            <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-1 leading-relaxed">
              Move this server and its storage to another BinaryLane geographic data center. Your server will be
              live-migrated.
            </p>
          </div>

          <form onSubmit={handleMigrateRegion} className="max-w-md space-y-4 pt-2">
            <div>
              <label className="block text-[11px] font-semibold text-[#495057] dark:text-slate-300 mb-1">
                Current Region
              </label>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#017cb6]" />
                <span className="font-semibold text-xs text-[#212529] dark:text-white">
                  {server.region?.name} ({server.region?.slug?.toUpperCase()})
                </span>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#495057] dark:text-slate-300 mb-1">
                Destination Data Center Region
              </label>
              <select
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                disabled={busy || regionsQuery.isLoading}
                className={`${inputClass} w-full`}
              >
                {(regionsQuery.data || []).map((r) => (
                  <option key={r.slug} value={r.slug}>
                    {r.name} ({r.slug.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={busy || !selectedRegion || selectedRegion === server.region?.slug}
              className={primaryBtn}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Migrate to New Region</span>
            </button>
          </form>
        </div>
      )}

      {/* 6. PARTNER SERVER TAB */}
      {activeTab === 'partner' && (
        <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-xs font-bold text-[#212529] dark:text-white uppercase tracking-wider">
              High Availability Partner Anti-Affinity
            </h3>
            <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-1 leading-relaxed">
              A server&apos;s partner is a second server with the same core purpose (e.g. two web servers behind a load
              balancer). BinaryLane guarantees that partner servers are hosted on separate physical hardware hosts to
              ensure high availability during node maintenance.
            </p>
          </div>

          <form onSubmit={handleSavePartner} className="max-w-md space-y-4 pt-2">
            <div>
              <label className="block text-[11px] font-semibold text-[#495057] dark:text-slate-300 mb-1">
                Partner Server Selection (Same Region: {server.region?.name})
              </label>
              <select
                value={selectedPartnerId}
                onChange={(e) => setSelectedPartnerId(e.target.value)}
                disabled={busy}
                className={`${inputClass} w-full`}
              >
                <option value="">No Partner Server (Independent)</option>
                {partnerCandidates.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name} (#{s.id}) — {s.networks?.v4?.[0]?.ip_address || 'No IP'}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" disabled={busy} className={primaryBtn}>
              <Users className="w-3.5 h-3.5" />
              <span>Update Partner Pairing</span>
            </button>
          </form>
        </div>
      )}

      {/* 7. DANGER ZONE TAB */}
      {activeTab === 'danger' && (
        <div className="space-y-4">
          {/* Power and Password Reset */}
          <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-[#212529] dark:text-white uppercase tracking-wider">
              Administrative & Recovery Operations
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="p-3 bg-[#f8f9fa] dark:bg-[#212529] rounded border border-[#ced4da] dark:border-[#373b3e] flex flex-col justify-between gap-3">
                <div>
                  <span className="font-semibold text-xs text-[#212529] dark:text-white block">
                    Reset Root/Administrator Password
                  </span>
                  <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-1">
                    {passwordResetWording.card}
                  </p>
                </div>
                <button onClick={handleResetPassword} disabled={busy} className={primaryBtn}>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Reset Password</span>
                </button>
              </div>

              <div className="p-3 bg-[#f8f9fa] dark:bg-[#212529] rounded border border-[#ced4da] dark:border-[#373b3e] flex flex-col justify-between gap-3">
                <div>
                  <span className="font-semibold text-xs text-[#212529] dark:text-white block">
                    Hard Power Cycle
                  </span>
                  <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-1">
                    Force an immediate hardware power reset on the physical hypervisor.
                  </p>
                </div>
                <button onClick={handlePowerCycle} disabled={busy} className={primaryBtn}>
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Force Power Cycle</span>
                </button>
              </div>
            </div>
          </div>

          {/* Destructive OS Rebuild */}
          <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-rose-300 dark:border-rose-900/60 p-5 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Danger Zone — OS Rebuild</span>
            </h3>
            <p className="text-xs text-[#6c757d] dark:text-slate-400">
              Rebuilding completely destroys all existing data, disks, and partitions on this virtual machine and installs a clean operating system.
            </p>
            <form onSubmit={handleRebuild} className="flex flex-wrap items-center gap-3 pt-2">
              <input
                type="text"
                value={rebuildImage}
                onChange={(e) => setRebuildImage(e.target.value)}
                disabled={busy}
                className={`${inputClass} w-64`}
                placeholder="Image slug (e.g. ubuntu-24-04-x64)"
                required
              />
              <button type="submit" disabled={busy || !rebuildImage.trim()} className={dangerBtn}>
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Rebuild Operating System</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
