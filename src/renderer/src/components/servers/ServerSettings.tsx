import React, { useState, useEffect } from 'react'
import {
  Tag,
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
  useServers,
  useServerThresholdAlerts,
  useAvailableAdvancedFeatures,
  useServerActionWithHandoff,
  networkActionMutationKey,
  actionFailureMessage,
  useCancelServerMutation
} from '../../api/queries'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { useIsMutating } from '@tanstack/react-query'
import { useConfirm, type ConfirmRequest } from '../../context/ConfirmContext'
import { recordChange, updateChange } from '../../lib/changelog'

type Server = components['schemas']['Server']
type Disk = components['schemas']['Disk']
type ThresholdAlertRequest = components['schemas']['ThresholdAlertRequest']
type ThresholdAlertType = components['schemas']['ThresholdAlertType']
type VmMachineType = components['schemas']['VmMachineType']
import { visibleFeatures, mergeHiddenFeatures, formatMachineType } from '../../lib/advancedFeatures'
import { CancelServerDialog } from './CancelServerDialog'
import { ChangePlanPanel } from './ChangePlanPanel'
type VideoDevice = components['schemas']['VideoDevice']

interface ServerSettingsProps {
  client: BinaryLaneClient | null
  server: Server
  /** Called once the server is gone, so the detail view can step back to the list. */
  onCancelled?: () => void
}

type SettingsTab = 'hostname' | 'plan' | 'disks' | 'advanced' | 'alerts' | 'region' | 'partner' | 'danger'

export const ServerSettings: React.FC<ServerSettingsProps> = ({ client, server: initialServer, onCancelled }) => {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('hostname')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Live polling for server state
  const serverQuery = useServer(client, initialServer.id)
  const server = serverQuery.data || initialServer

  const regionsQuery = useRegions(client)
  const serversQuery = useServers(client)
  const alertsQuery = useServerThresholdAlerts(client, server.id)
  const advancedQuery = useAvailableAdvancedFeatures(client, server.id)

  const actionMutation = useServerActionWithHandoff(client, server.id)
  const cancelServer = useCancelServerMutation(client)
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

  // Threshold Alerts
  const [alertForm, setAlertForm] = useState<Record<ThresholdAlertType, { enabled: boolean; value: number }>>({
    cpu: { enabled: false, value: 90 },
    'memory-used': { enabled: false, value: 90 },
    'storage-used': { enabled: false, value: 90 },
    'network-incoming': { enabled: false, value: 100 },
    'network-outgoing': { enabled: false, value: 100 },
    'data-transfer-used': { enabled: false, value: 80 },
    'storage-requests': { enabled: false, value: 1000 },
    'locked-backup-slots': { enabled: false, value: 1 }
  })

  useEffect(() => {
    if (alertsQuery.data && alertsQuery.data.length > 0) {
      setAlertForm((prev) => {
        const next = { ...prev }
        alertsQuery.data.forEach((alert) => {
          if (alert.alert_type) {
            next[alert.alert_type] = {
              enabled: !!alert.enabled,
              value: alert.value ?? prev[alert.alert_type]?.value ?? 90
            }
          }
        })
        return next
      })
    }
  }, [alertsQuery.data])

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
  const executeAction = async (label: string, payload: any, req: Omit<ConfirmRequest, 'title' | 'target'>): Promise<boolean> => {
    const c = await confirmAction({ title: label, target: { kind: 'server', id: server.id, name: server.name }, ...req })
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
      { type: 'add_disk', size },
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
      { type: 'resize_disk', disk_id: disk.id, size },
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

  const handleSaveAdvanced = async (e: React.FormEvent) => {
    e.preventDefault()
    await executeAction(
      'Update Advanced Features',
      {
        type: 'change_advanced_features',
        enabled_advanced_features: mergeHiddenFeatures(
          selectedFeatures,
          (server.advanced_features?.enabled_advanced_features ?? []) as string[],
          shownFeatures
        ),
        machine_type: machineType || undefined,
        processor_model: processorModel === -1 ? undefined : processorModel,
        video_device: videoDevice
      },
      { summary: 'Updates the hypervisor-level features. Takes effect on the next reboot.', changes: [{ label: 'Features', from: (server.advanced_features?.enabled_advanced_features ?? []).join(', ') || undefined, to: selectedFeatures.join(', ') || undefined }] }
    )
  }

  const handleSaveAlerts = async (e: React.FormEvent) => {
    e.preventDefault()
    const requests: ThresholdAlertRequest[] = (Object.keys(alertForm) as ThresholdAlertType[]).map((type) => ({
      alert_type: type,
      enabled: alertForm[type].enabled,
      value: alertForm[type].value
    }))
    await executeAction(
      'Update Threshold Alerts',
      { type: 'change_threshold_alerts', threshold_alerts: requests },
      { summary: 'Saves the monitoring thresholds BinaryLane alerts on.', changes: requests.map((r) => ({ label: r.alert_type, to: r.enabled ? `on at ${r.value}` : 'off' })) }
    )
  }

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
    const partnerServer = serversQuery.data?.find((s) => s.id === partnerId)
    await executeAction(
      'Change Partner Server',
      { type: 'change_partner', partner_id: partnerId },
      { summary: 'BinaryLane keeps HA partners on separate physical hypervisors.', changes: [{ label: 'HA partner', from: server.partner_id ? `#${server.partner_id}` : undefined, to: partnerServer ? `${partnerServer.name} (#${partnerId})` : undefined }] }
    )
  }

  const handleResetPassword = async () => {
    await executeAction(
      'Reset Root/Admin Password',
      { type: 'password_reset' },
      { summary: 'Generates a new root/administrator password and emails it to the account address. Anything using the old password stops authenticating.', severity: 'destructive', confirmLabel: 'Reset password' }
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
        severity: 'irreversible',
        notes: ['Take a backup first if anything on this server matters.'],
        changes: [{ label: 'Image', from: server.image?.slug || server.image?.name || undefined, to: rebuildImage.trim() }],
        confirmLabel: 'Rebuild'
      }
    )
  }

  // Filter partner candidate servers (same region, not self)
  const partnerCandidates = (serversQuery.data || []).filter(
    (s) => s.id !== server.id && s.region?.slug === server.region?.slug
  )

  const navTabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'hostname', label: 'Hostname', icon: <Tag className="w-3.5 h-3.5" /> },
    { id: 'plan', label: 'Change Plan', icon: <ArrowRightLeft className="w-3.5 h-3.5" /> },
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

      {/* 2. DISKS TAB */}
      {activeTab === 'plan' && (
        <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-xs font-bold text-[#212529] dark:text-white uppercase tracking-wider">Change Plan</h3>
            <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-1">
              Moves the server to a different plan. The server restarts to apply the change.
            </p>
          </div>
          <ChangePlanPanel
            client={client}
            server={server}
            busy={busy}
            onApply={(payload, summary, changes) =>
              void executeAction('Change Plan', payload, {
                summary: `${summary}. The server restarts to apply it.`,
                severity: 'destructive',
                changes,
                confirmLabel: 'Change plan'
              })
            }
          />
        </div>
      )}

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
                <option value="cirrus-logic">Cirrus Logic (Default Standard)</option>
                <option value="vga">VGA (Standard)</option>
                <option value="qxl">QXL (SPICE High Performance)</option>
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

            <button type="submit" disabled={busy} className={primaryBtn}>
              <Cpu className="w-3.5 h-3.5" />
              <span>Save Advanced Features</span>
            </button>
          </form>
        </div>
      )}

      <CancelServerDialog
        isOpen={cancelOpen}
        serverName={server.name}
        monthlyPrice={server.size?.price_monthly}
        busy={cancelServer.isPending}
        error={cancelError}
        onCancel={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          setCancelError(null)
          // The dialog is bespoke (it needs the reason field) so it does not
          // go through useConfirm — record the change here instead. This is
          // the one entry History most needs: the server will not exist to
          // ask afterwards.
          const changeId = await recordChange({
            label: 'Cancel server',
            target: { kind: 'server', id: server.id, name: server.name },
            severity: 'irreversible',
            summary: `Reason: ${reason}`,
            changes: [
              { label: 'Plan', from: server.size_slug, to: undefined },
              { label: 'Public IPv4', from: server.networks?.v4?.find((n) => n.type === 'public')?.ip_address, to: undefined }
            ],
            source: 'ui'
          })
          try {
            await cancelServer.mutateAsync({ serverId: server.id, reason })
            void updateChange(changeId, { outcome: 'completed', detail: 'BinaryLane accepted the cancellation; the server is removed within minutes.' })
            setCancelOpen(false)
            onCancelled?.()
          } catch (err: any) {
            void updateChange(changeId, { outcome: 'failed', detail: err?.message })
            setCancelError(err?.message || 'Failed to cancel the server.')
          }
        }}
      />

      {/* 4. ALERTS TAB */}
      {activeTab === 'alerts' && (
        <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm overflow-hidden">
          <div className="p-3.5 bg-[#f1f1f1] dark:bg-[#262a2e] border-b border-[#ced4da] dark:border-[#373b3e] flex items-center justify-between">
            <div>
              <h3 className="font-bold text-xs text-[#495057] dark:text-[#ced4da] flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#017cb6]" />
                <span>Monitoring & Threshold Alert Rules</span>
              </h3>
              <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5">
                BinaryLane automatically sends email notifications when sustained resource usage crosses these limits.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveAlerts} className="p-5 space-y-4">
            <div className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
              {/* CPU */}
              <div className="py-3 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold text-[#212529] dark:text-white">CPU Utilization Alert</span>
                  <span className="block text-[11px] text-[#6c757d] dark:text-slate-400">Triggered on sustained high processor load</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={alertForm.cpu.value}
                    disabled={busy || !alertForm.cpu.enabled}
                    onChange={(e) =>
                      setAlertForm({
                        ...alertForm,
                        cpu: { ...alertForm.cpu, value: parseInt(e.target.value, 10) || 0 }
                      })
                    }
                    className={`${inputClass} w-20 text-right`}
                  />
                  <span className="text-xs text-[#6c757d]">%</span>
                  <input
                    type="checkbox"
                    checked={alertForm.cpu.enabled}
                    disabled={busy}
                    onChange={(e) =>
                      setAlertForm({
                        ...alertForm,
                        cpu: { ...alertForm.cpu, enabled: e.target.checked }
                      })
                    }
                    className="rounded border-[#ced4da] text-[#017cb6]"
                  />
                </div>
              </div>

              {/* Memory */}
              <div className="py-3 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold text-[#212529] dark:text-white">Memory Usage Alert</span>
                  <span className="block text-[11px] text-[#6c757d] dark:text-slate-400">Triggered on sustained RAM exhaustion</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={alertForm['memory-used'].value}
                    disabled={busy || !alertForm['memory-used'].enabled}
                    onChange={(e) =>
                      setAlertForm({
                        ...alertForm,
                        'memory-used': {
                          ...alertForm['memory-used'],
                          value: parseInt(e.target.value, 10) || 0
                        }
                      })
                    }
                    className={`${inputClass} w-20 text-right`}
                  />
                  <span className="text-xs text-[#6c757d]">%</span>
                  <input
                    type="checkbox"
                    checked={alertForm['memory-used'].enabled}
                    disabled={busy}
                    onChange={(e) =>
                      setAlertForm({
                        ...alertForm,
                        'memory-used': { ...alertForm['memory-used'], enabled: e.target.checked }
                      })
                    }
                    className="rounded border-[#ced4da] text-[#017cb6]"
                  />
                </div>
              </div>

              {/* Storage */}
              <div className="py-3 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold text-[#212529] dark:text-white">Primary Storage Used Alert</span>
                  <span className="block text-[11px] text-[#6c757d] dark:text-slate-400">Triggered when disk capacity is nearly full</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={alertForm['storage-used'].value}
                    disabled={busy || !alertForm['storage-used'].enabled}
                    onChange={(e) =>
                      setAlertForm({
                        ...alertForm,
                        'storage-used': {
                          ...alertForm['storage-used'],
                          value: parseInt(e.target.value, 10) || 0
                        }
                      })
                    }
                    className={`${inputClass} w-20 text-right`}
                  />
                  <span className="text-xs text-[#6c757d]">%</span>
                  <input
                    type="checkbox"
                    checked={alertForm['storage-used'].enabled}
                    disabled={busy}
                    onChange={(e) =>
                      setAlertForm({
                        ...alertForm,
                        'storage-used': { ...alertForm['storage-used'], enabled: e.target.checked }
                      })
                    }
                    className="rounded border-[#ced4da] text-[#017cb6]"
                  />
                </div>
              </div>

              {/* Data Transfer */}
              <div className="py-3 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold text-[#212529] dark:text-white">Monthly Data Transfer Used Alert</span>
                  <span className="block text-[11px] text-[#6c757d] dark:text-slate-400">Triggered when monthly bandwidth quota reaches threshold</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={alertForm['data-transfer-used'].value}
                    disabled={busy || !alertForm['data-transfer-used'].enabled}
                    onChange={(e) =>
                      setAlertForm({
                        ...alertForm,
                        'data-transfer-used': {
                          ...alertForm['data-transfer-used'],
                          value: parseInt(e.target.value, 10) || 0
                        }
                      })
                    }
                    className={`${inputClass} w-20 text-right`}
                  />
                  <span className="text-xs text-[#6c757d]">%</span>
                  <input
                    type="checkbox"
                    checked={alertForm['data-transfer-used'].enabled}
                    disabled={busy}
                    onChange={(e) =>
                      setAlertForm({
                        ...alertForm,
                        'data-transfer-used': {
                          ...alertForm['data-transfer-used'],
                          enabled: e.target.checked
                        }
                      })
                    }
                    className="rounded border-[#ced4da] text-[#017cb6]"
                  />
                </div>
              </div>
            </div>

            <button type="submit" disabled={busy} className={primaryBtn}>
              <Bell className="w-3.5 h-3.5" />
              <span>Save Alert Thresholds</span>
            </button>
          </form>
        </div>
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
                disabled={busy || serversQuery.isLoading}
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
          {/* Cancel - the only irreversible, untrackable action in the app */}
          <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-rose-300 dark:border-rose-900 p-5 shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wider">Cancel Server</h3>
            <p className="text-xs text-[#495057] dark:text-slate-300">
              Cancels the Cloud Server service. It is cancelled within five minutes, after which an invoice is generated
              for usage to date. The server and its data are destroyed and cannot be recovered.
            </p>
            <button
              type="button"
              onClick={() => {
                setCancelError(null)
                setCancelOpen(true)
              }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-rose-600 text-white disabled:opacity-40"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Cancel Server</span>
            </button>
          </div>

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
                    Generates a new root password and sends it to your account email.
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
