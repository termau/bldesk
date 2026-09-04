import React, { useState } from 'react'
import {
  Archive,
  Plus,
  RotateCcw,
  HardDrive,
  Loader2,
  Server,
  Disc,
  Clock,
  Download,
  X,
  ShieldCheck,
  AlertTriangle,
  RefreshCw
} from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import {
  useServerBackups,
  useServerSnapshots,
  useServerActions,
  useTakeBackupMutation,
  useRestoreBackupMutation,
  useToggleAutomatedBackupsMutation,
  useAttachBackupMutation,
  useDetachBackupMutation,
  useImageDownloadMutation
} from '../../api/queries'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { useConfirm } from '../../context/ConfirmContext'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import { updateChange } from '../../lib/changelog'
import { availableBackupSlots, BACKUP_SLOT_LABELS } from '../../lib/backupSlots'
import { Modal } from '../ui/Modal'
import { SafetyPolicyBadge } from '../ui/SafetyPolicyBadge'

interface BackupManagerProps {
  /** The app's server list — see AGENTS.md rule 8; tabs do not call useServers. */
  servers: any[]
  client: BinaryLaneClient | null
  initialServerId?: number | null
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : 'Unknown read error.'
}

function hasPositiveActionId<T extends { id?: unknown }>(action: T | null | undefined): action is T & { id: number } {
  return !!action && Number.isSafeInteger(action.id) && Number(action.id) > 0
}

export const BackupManager: React.FC<BackupManagerProps> = ({ client, initialServerId, servers }) => {

  const [selectedServerId, setSelectedServerId] = useState<number | null>(
    initialServerId || (servers.length > 0 ? servers[0].id : null)
  )

  const activeServerId = selectedServerId || (servers.length > 0 ? servers[0].id : null)
  const activeServer = servers.find((s) => s.id === activeServerId)

  // Queries for current server
  const backupsQuery = useServerBackups(client, activeServerId)
  const snapshotsQuery = useServerSnapshots(client, activeServerId)
  const actionsQuery = useServerActions(client, activeServerId)

  // Mutations
  const takeBackupMutation = useTakeBackupMutation(client, activeServerId)
  const restoreBackupMutation = useRestoreBackupMutation(client, activeServerId)
  const { track } = useTrackedActions()
  const toggleAutomatedBackups = useToggleAutomatedBackupsMutation(client, activeServerId)
  const attachBackupMutation = useAttachBackupMutation(client, activeServerId)
  const detachBackupMutation = useDetachBackupMutation(client, activeServerId)
  const downloadMutation = useImageDownloadMutation(client)
  const { serverSafetyLevel, serverActionBlockReason } = useProfileSafety()

  // Form & Action states
  const [isTakingSnapshot, setIsTakingSnapshot] = useState(false)
  const [snapshotLabel, setSnapshotLabel] = useState('')
  const [selectedSlot, setSelectedSlot] = useState('temporary')
  const [actionProcessingId, setActionProcessingId] = useState<number | null>(null)
  const [operationMessage, setOperationMessage] = useState<string | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)

  const backups = backupsQuery.data || []
  const snapshots = snapshotsQuery.data || []
  const actions = actionsQuery.data || []

  const activeBackupAction = actions.find(
    (a) =>
      a.status === 'in-progress' &&
      (a.type === 'take_backup' || a.type === 'restore' || a.type?.includes('backup'))
  )

  const allImages = [...snapshots, ...backups]
  const nextBackupWindow = (activeServer as any)?.next_backup_window
  // `backup_ids` means only that images exist; an on-demand temporary image is
  // not evidence that a nightly schedule is enabled. Missing schedule data is
  // unknown, not safely equivalent to either on or off.
  const isAutoBackupEnabled: boolean | null =
    !activeServer || nextBackupWindow === undefined ? null : nextBackupWindow !== null
  const autoBackupStatusLabel =
    isAutoBackupEnabled === null ? 'Unknown' : isAutoBackupEnabled ? 'Enabled' : 'Disabled'
  const attachedBackupValue = (activeServer as any)?.attached_backup
  const attachedBackupIdValue = Number(attachedBackupValue?.id)
  const attachedBackupId =
    Number.isSafeInteger(attachedBackupIdValue) && attachedBackupIdValue > 0 ? attachedBackupIdValue : null
  const attachmentState: 'unknown' | 'none' | 'attached' =
    !activeServer || attachedBackupValue === undefined
      ? 'unknown'
      : attachedBackupValue === null
        ? 'none'
        : attachedBackupId !== null
          ? 'attached'
          : 'unknown'
  const attachedBackupImage = attachedBackupId === null ? null : allImages.find((image) => Number(image.id) === attachedBackupId)
  const attachedBackupDescription =
    attachmentState === 'unknown'
      ? 'Unknown — refresh required'
      : attachmentState === 'none'
        ? 'None'
        : `${attachedBackupImage?.name || 'Backup image'} (#${attachedBackupId})`
  const imageReadFailures = [
    backupsQuery.isError ? `Backups: ${readableError(backupsQuery.error)}` : null,
    snapshotsQuery.isError ? `Snapshots: ${readableError(snapshotsQuery.error)}` : null
  ].filter((message): message is string => !!message)
  const actionReadFailure = actionsQuery.isError
    ? `Action status: ${readableError(actionsQuery.error)}`
    : null
  const readFailures = [...imageReadFailures, ...(actionReadFailure ? [actionReadFailure] : [])]
  const readRetrying = backupsQuery.isFetching || snapshotsQuery.isFetching || actionsQuery.isFetching
  const activeSafetyLevel = activeServerId ? serverSafetyLevel(activeServerId) : 'locked'
  const isMaintenance = activeSafetyLevel === 'maintenance'
  const mutationBlockReason = activeServerId
    ? serverActionBlockReason(activeServerId, 'mutation')
    : 'Select a server first.'
  const takeBackupBlockReason = activeServerId
    ? serverActionBlockReason(
        activeServerId,
        isMaintenance ? 'non-replacing-temp-backup' : 'mutation'
      )
    : 'Select a server first.'

  const reportBlocked = (reason: string | null): boolean => {
    if (!reason) return false
    setOperationMessage(reason)
    return true
  }

  const reportUntrackableAction = (changeId: string | undefined, requestLabel: string): string => {
    const detail = `${requestLabel} returned without a valid action ID. BLDesk cannot tell whether it ran; verify the server and backup list before retrying.`
    void updateChange(changeId, { outcome: 'lost', detail })
    setOperationMessage(detail)
    return detail
  }

  const confirmAction = useConfirm()

  // Take a manual backup. Maintenance deliberately has one fixed, non-
  // replacing shape; the privileged transport validates the same shape again.
  const handleTakeSnapshot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeServerId) return

    const serverId = activeServerId
    const serverName = activeServer?.name || `#${serverId}`
    const level = serverSafetyLevel(serverId)
    const maintenanceRequest = level === 'maintenance'
    const operation = maintenanceRequest ? 'non-replacing-temp-backup' : 'mutation'
    if (reportBlocked(serverActionBlockReason(serverId, operation))) return

    let replacementStrategy: 'none' | 'oldest' | 'specified' = maintenanceRequest ? 'none' : 'oldest'
    let backupType: 'daily' | 'weekly' | 'monthly' | 'temporary' | undefined = 'temporary'
    let backupIdToReplace: number | undefined

    if (!maintenanceRequest && selectedSlot.startsWith('replace:')) {
      replacementStrategy = 'specified'
      backupType = undefined
      backupIdToReplace = Number(selectedSlot.split(':')[1])
      if (!Number.isSafeInteger(backupIdToReplace) || Number(backupIdToReplace) <= 0) {
        setSnapshotError('The selected replacement image is invalid. Choose the image again.')
        return
      }
    } else if (!maintenanceRequest) {
      backupType = (selectedSlot as 'daily' | 'weekly' | 'monthly' | 'temporary') || 'temporary'
    }

    const label = snapshotLabel.trim().slice(0, 250)
    const replacementDescription =
      replacementStrategy === 'none'
        ? 'None — fail if no temporary slot is available'
        : replacementStrategy === 'specified'
          ? `Image #${backupIdToReplace}`
          : `Oldest eligible ${backupType || 'selected'} image, only if no free slot is available`
    const retentionDescription =
      backupType === 'temporary'
        ? 'Temporary — retained for up to 7 days'
        : backupType
          ? BACKUP_SLOT_LABELS[backupType]
          : 'Existing image slot'

    setSnapshotError(null)
    setIsTakingSnapshot(false)
    const c = await confirmAction({
      title: maintenanceRequest ? 'Take safe temporary backup' : 'Take backup',
      target: { kind: 'server', id: serverId, name: serverName },
      summary: maintenanceRequest
        ? 'Creates an on-demand temporary image without replacing any existing image.'
        : 'Creates a point-in-time image using the selected retention and replacement policy.',
      severity: replacementStrategy === 'none' ? 'normal' : 'destructive',
      changes: [
        { label: 'Retention', to: retentionDescription },
        { label: 'Replacement', to: replacementDescription },
        ...(label ? [{ label: 'Label', to: label }] : [])
      ],
      notes: maintenanceRequest
        ? [
            'Temporary backups are retained for at most seven days.',
            'If no temporary slot is available, the request fails; BLDesk will not replace another image.',
            'Backup capture may affect guest I/O. Any account charge is determined by the service, not assumed to be zero.'
          ]
        : replacementStrategy === 'none'
          ? ['If the selected slot is unavailable, the request fails without replacing another image.']
          : ['The selected replacement policy can overwrite an existing image.'],
      confirmLabel: 'Take Backup'
    })
    if (!c.ok) {
      setIsTakingSnapshot(true)
      return
    }

    const changedReason = serverActionBlockReason(serverId, operation)
    if (changedReason) {
      void updateChange(c.changeId, { outcome: 'failed', detail: `Blocked locally after confirmation: ${changedReason}` })
      setOperationMessage(changedReason)
      return
    }

    try {
      const queued = await takeBackupMutation.mutateAsync({
        label: label || undefined,
        backupType,
        replacementStrategy,
        backupIdToReplace
      })
      if (hasPositiveActionId(queued)) {
        track(queued, 'Take Backup', serverName, c.changeId)
      } else {
        reportUntrackableAction(c.changeId, 'The backup request')
      }
      void window.bldeskApi?.sendNotification?.({
        title: hasPositiveActionId(queued) ? 'Backup request accepted' : 'Backup outcome unknown',
        body: hasPositiveActionId(queued)
          ? `Tracking the backup for ${serverName} until BinaryLane reports its outcome.`
          : `Check ${serverName}'s backup list before retrying; no valid action ID was returned.`
      })
      setSnapshotLabel('')
      setSelectedSlot('temporary')
      if (hasPositiveActionId(queued)) setOperationMessage(null)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      void updateChange(c.changeId, { outcome: 'failed', detail })
      setSnapshotError(`Backup request failed: ${detail}`)
      setIsTakingSnapshot(true)
    }
  }

  // Restore snapshot
  const handleRestore = async (imageId: number, name: string) => {
    if (!activeServerId) return
    if (reportBlocked(serverActionBlockReason(activeServerId, 'mutation'))) return
    const serverId = activeServerId
    const serverName = activeServer?.name || `#${serverId}`
    const c = await confirmAction({
      title: 'Restore from backup',
      target: { kind: 'server', id: serverId, name: serverName },
      summary: `Overwrites the server's current disk with image "${name}" (#${imageId}). Everything written since that image was taken is lost.`,
      severity: 'irreversible',
      changes: [{ label: 'Disk contents', from: 'current', to: `${name} (#${imageId})` }],
      notes: ['Take a snapshot first if the current state might be needed again.'],
      confirmLabel: 'Restore'
    })
    if (!c.ok) return
    const changedReason = serverActionBlockReason(serverId, 'mutation')
    if (changedReason) {
      void updateChange(c.changeId, { outcome: 'failed', detail: `Blocked locally after confirmation: ${changedReason}` })
      setOperationMessage(changedReason)
      return
    }

    setActionProcessingId(imageId)
    try {
      const queued = await restoreBackupMutation.mutateAsync(imageId)
      if (hasPositiveActionId(queued)) {
        track(queued, `Restore from "${name}"`, serverName, c.changeId)
      } else {
        reportUntrackableAction(c.changeId, 'The restore request')
      }
      window.bldeskApi?.sendNotification?.({
        title: hasPositiveActionId(queued) ? 'Restore request accepted' : 'Restore outcome unknown',
        body: hasPositiveActionId(queued)
          ? `Tracking the restore of ${serverName} from image #${imageId}.`
          : `Verify ${serverName} before retrying; no valid action ID was returned.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setOperationMessage(`Restore failed: ${err.message}`)
    } finally {
      setActionProcessingId(null)
    }
  }

  // Attach disk image as secondary read-only drive
  const handleAttach = async (imageId: number, name: string) => {
    if (!activeServerId) return
    if (reportBlocked(serverActionBlockReason(activeServerId, 'mutation'))) return
    const serverId = activeServerId
    const serverName = activeServer?.name || `#${serverId}`
    if (attachmentState === 'unknown') {
      setOperationMessage('The current secondary-drive attachment is unknown. Refresh the server before mounting another image.')
      return
    }
    if (attachedBackupId === imageId) {
      setOperationMessage(`${name} (#${imageId}) is already the reported secondary backup drive.`)
      return
    }
    const c = await confirmAction({
      title: 'Attach backup image',
      target: { kind: 'server', id: serverId, name: serverName },
      summary: `Mounts "${name}" (#${imageId}) as a read-only secondary drive.`,
      severity: 'normal',
      changes: [{ label: 'Secondary drive', from: attachedBackupDescription, to: `${name} (#${imageId})` }],
      confirmLabel: 'Attach Image'
    })
    if (!c.ok) return
    const changedReason = serverActionBlockReason(serverId, 'mutation')
    if (changedReason) {
      void updateChange(c.changeId, { outcome: 'failed', detail: `Blocked locally after confirmation: ${changedReason}` })
      setOperationMessage(changedReason)
      return
    }
    setActionProcessingId(imageId)
    try {
      const queued = await attachBackupMutation.mutateAsync(imageId)
      if (hasPositiveActionId(queued)) {
        track(queued, `Attach "${name}"`, serverName, c.changeId)
      } else {
        reportUntrackableAction(c.changeId, 'The attach request')
      }
      window.bldeskApi?.sendNotification?.({
        title: hasPositiveActionId(queued) ? 'Attach request accepted' : 'Attach outcome unknown',
        body: hasPositiveActionId(queued)
          ? `Tracking the request to mount "${name}" on ${serverName}.`
          : `Verify ${serverName} before retrying; no valid action ID was returned.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setOperationMessage(`Attach failed: ${err.message}`)
    } finally {
      setActionProcessingId(null)
    }
  }

  // Download snapshot / backup disk image
  const handleDownload = async (imageId: number, name: string) => {
    if (!activeServerId) return
    setActionProcessingId(imageId)
    try {
      // history: n/a — generates a download link; nothing on BinaryLane changes
      const link = await downloadMutation.mutateAsync(imageId)
      const downloadUrl = link?.disks?.[0]?.compressed_url || link?.disks?.[0]?.raw_url
      if (!downloadUrl) {
        throw new Error('No download URL returned for this image.')
      }
      window.open(downloadUrl, '_blank')
    } catch (err: any) {
      setOperationMessage(`Download failed for "${name}": ${err.message}`)
    } finally {
      setActionProcessingId(null)
    }
  }

  // Detach secondary drive
  const handleDetach = async () => {
    if (!activeServerId) return
    if (reportBlocked(serverActionBlockReason(activeServerId, 'mutation'))) return
    const serverId = activeServerId
    const serverName = activeServer?.name || `#${serverId}`
    if (attachmentState !== 'attached' || attachedBackupId === null) {
      setOperationMessage('No secondary backup drive is reported as attached. Refresh before trying again.')
      return
    }
    const c = await confirmAction({
      title: 'Detach secondary backup drive',
      target: { kind: 'server', id: serverId, name: serverName },
      summary: `Unmounts ${attachedBackupDescription}, the currently reported secondary backup image.`,
      severity: 'normal',
      changes: [{ label: 'Secondary drive', from: attachedBackupDescription, to: 'None' }],
      confirmLabel: 'Detach Drive'
    })
    if (!c.ok) return
    const changedReason = serverActionBlockReason(serverId, 'mutation')
    if (changedReason) {
      void updateChange(c.changeId, { outcome: 'failed', detail: `Blocked locally after confirmation: ${changedReason}` })
      setOperationMessage(changedReason)
      return
    }
    try {
      const queued = await detachBackupMutation.mutateAsync()
      if (hasPositiveActionId(queued)) {
        track(queued, 'Detach Secondary Drive', serverName, c.changeId)
      } else {
        reportUntrackableAction(c.changeId, 'The detach request')
      }
      window.bldeskApi?.sendNotification?.({
        title: hasPositiveActionId(queued) ? 'Detach request accepted' : 'Detach outcome unknown',
        body: hasPositiveActionId(queued)
          ? `Tracking the request to unmount ${attachedBackupDescription} from ${serverName}.`
          : `Verify ${serverName} before retrying; no valid action ID was returned.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setOperationMessage(`Detach failed: ${err.message}`)
    }
  }

  // Toggle Automated Backups
  const handleToggleAuto = async () => {
    if (!activeServerId) return
    if (reportBlocked(serverActionBlockReason(activeServerId, 'mutation'))) return
    const serverId = activeServerId
    const serverName = activeServer?.name || `#${serverId}`
    if (isAutoBackupEnabled === null) {
      setOperationMessage('The current automated-backup schedule is unknown. Refresh the server before changing it.')
      return
    }
    const enable = !isAutoBackupEnabled
    const c = await confirmAction({
      title: `${enable ? 'Enable' : 'Disable'} automated backups`,
      target: { kind: 'server', id: serverId, name: serverName },
      summary: enable ? 'BinaryLane takes a nightly backup on the server\'s schedule.' : 'Nightly backups stop. Existing backups are kept until they age out.',
      severity: enable ? 'normal' : 'destructive',
      changes: [{ label: 'Automated backups', from: enable ? 'off' : 'on', to: enable ? 'on' : 'off' }]
    })
    if (!c.ok) return
    const changedReason = serverActionBlockReason(serverId, 'mutation')
    if (changedReason) {
      void updateChange(c.changeId, { outcome: 'failed', detail: `Blocked locally after confirmation: ${changedReason}` })
      setOperationMessage(changedReason)
      return
    }

    try {
      const queued = await toggleAutomatedBackups.mutateAsync(enable)
      if (hasPositiveActionId(queued)) {
        track(queued, `${enable ? 'Enable' : 'Disable'} Automated Backups`, serverName, c.changeId)
      } else {
        reportUntrackableAction(c.changeId, 'The schedule-change request')
      }
      window.bldeskApi?.sendNotification?.({
        title: hasPositiveActionId(queued) ? 'Schedule change accepted' : 'Schedule outcome unknown',
        body: hasPositiveActionId(queued)
          ? `Tracking the request to ${enable ? 'enable' : 'disable'} automated backups for ${serverName}.`
          : `Verify ${serverName} before retrying; no valid action ID was returned.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setOperationMessage(`Schedule update failed: ${err.message}`)
    }
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      {/* Header & Target Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
            <Archive className="w-5 h-5 text-[#017cb6]" />
            <span>Server Backups & Disk Snapshots</span>
            <SafetyPolicyBadge scope="server" serverId={activeServerId} />
          </h1>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-0.5">
            Create on-demand point-in-time snapshots or mount backup images as live secondary drives for file recovery.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white dark:bg-[#2b3035] px-3 py-1.5 border border-[#ced4da] dark:border-[#373b3e] rounded shadow-sm">
            <Server className="w-3.5 h-3.5 text-[#017cb6]" />
            <select
              value={activeServerId || ''}
              onChange={(e) => setSelectedServerId(Number(e.target.value))}
              className="bg-transparent text-xs text-[#212529] dark:text-white focus:outline-none cursor-pointer max-w-[160px]"
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id} className="bg-white dark:bg-[#2b3035]">
                  {s.name} (#{s.id})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => {
              if (reportBlocked(takeBackupBlockReason)) return
              setSnapshotError(null)
              setIsTakingSnapshot(true)
            }}
            disabled={!activeServerId || takeBackupMutation.isPending || !!takeBackupBlockReason}
            title={takeBackupBlockReason || (isMaintenance ? 'Create a non-replacing temporary backup' : 'Take a backup')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm disabled:opacity-50"
          >
            {takeBackupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>Take Snapshot</span>
          </button>
        </div>
      </div>

      {operationMessage && (
        <div className="flex items-start gap-2 rounded border border-amber-400/50 bg-amber-500/10 px-3.5 py-3 text-xs text-amber-800 dark:text-amber-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="flex-1">{operationMessage}</span>
          <button
            type="button"
            onClick={() => setOperationMessage(null)}
            aria-label="Dismiss message"
            className="text-amber-700 hover:text-amber-950 dark:text-amber-300 dark:hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {readFailures.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-3.5 py-3 text-xs text-rose-800 dark:text-rose-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              {imageReadFailures.length > 0
                ? 'Backup information is incomplete — BLDesk will not treat it as an empty list.'
                : 'Backup action status could not be refreshed.'}
            </div>
            <ul className="mt-1 space-y-0.5 break-words">
              {readFailures.map((failure, index) => <li key={`${index}-${failure}`}>{failure}</li>)}
            </ul>
          </div>
          <button
            type="button"
            disabled={readRetrying}
            onClick={() => {
              void Promise.all([
                backupsQuery.refetch(),
                snapshotsQuery.refetch(),
                actionsQuery.refetch()
              ])
            }}
            className="inline-flex flex-shrink-0 items-center gap-1 rounded border border-rose-500/40 px-2 py-1 font-semibold hover:bg-rose-500/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${readRetrying ? 'animate-spin' : ''}`} />
            Retry
          </button>
        </div>
      )}

      {isMaintenance && (
        <div className="flex items-start gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-3 text-xs text-emerald-800 dark:text-emerald-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <div className="font-semibold">Maintenance protection</div>
            <div className="mt-0.5 opacity-90">
              You can create a temporary backup that replaces nothing. Restore, mount, detach, and schedule changes remain blocked.
            </div>
          </div>
        </div>
      )}

      {/* Automated Backup Schedule Banner */}
      {activeServer && (
        <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-[#017cb6]/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-[#017cb6]" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#212529] dark:text-white flex items-center gap-2">
                <span>Automated Nightly Backups</span>
                <span
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                    isAutoBackupEnabled === null
                      ? 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border border-slate-500/30'
                      : isAutoBackupEnabled
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                  }`}
                >
                  {autoBackupStatusLabel}
                </span>
              </div>
              <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5">
                {isAutoBackupEnabled === null
                  ? 'The API did not report whether an automated backup is scheduled. Refresh before changing it.'
                  : isAutoBackupEnabled
                  ? 'BinaryLane captures an automated delta snapshot nightly during your scheduled maintenance window.'
                  : 'Automated backups are currently turned off for this server.'}
              </p>
            </div>
          </div>

          <button
            onClick={handleToggleAuto}
            disabled={toggleAutomatedBackups.isPending || !!mutationBlockReason || isAutoBackupEnabled === null}
            title={mutationBlockReason || (isAutoBackupEnabled === null
              ? 'Schedule state is unknown; refresh before changing it.'
              : `${isAutoBackupEnabled ? 'Disable' : 'Enable'} automated backups`)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition border ${
              isAutoBackupEnabled
                ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800'
                : 'text-[#017cb6] bg-[#017cb6]/10 border-[#017cb6]/30 hover:bg-[#017cb6]/20'
            }`}
          >
              {isAutoBackupEnabled === null
                ? 'Schedule State Unknown'
                : isAutoBackupEnabled
                  ? 'Disable Schedule'
                  : 'Enable Nightly Backups'}
          </button>
        </div>
      )}

      {/* Active In-Progress Action Banner */}
      {activeBackupAction && (
        <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg p-3.5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-[#017cb6] animate-spin flex-shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-[#212529] dark:text-white">
                {activeBackupAction.type === 'take_backup'
                  ? 'Disk Snapshot in Progress...'
                  : activeBackupAction.type === 'restore'
                  ? 'Restoring Disk Image...'
                  : 'Backup Task in Progress...'}
              </h4>
              <p className="text-[11px] text-[#6c757d] dark:text-slate-400">
                The hypervisor is actively creating your snapshot. It will appear in the table below automatically once ready.
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-blue-100 dark:bg-blue-900/60 text-[#017cb6] dark:text-blue-300 animate-pulse flex-shrink-0">
            Capturing Image
          </span>
        </div>
      )}

      {/* Snapshots & Backups List */}
      <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-sm overflow-hidden flex flex-col flex-shrink-0">
        <div className="p-3.5 bg-[#f1f1f1] dark:bg-[#262a2e] border-b border-[#ced4da] dark:border-[#373b3e] flex items-center justify-between">
          <h3 className="font-bold text-xs text-[#495057] dark:text-[#ced4da] flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[#017cb6]" />
            <span>Available Disk Images for {activeServer?.name || `Server #${activeServerId}`}</span>
          </h3>
          <button
            onClick={handleDetach}
            disabled={detachBackupMutation.isPending || !!mutationBlockReason || attachmentState !== 'attached'}
            className="text-[11px] text-[#6c757d] hover:text-amber-500 hover:underline"
            title={mutationBlockReason || (attachmentState !== 'attached'
              ? attachmentState === 'unknown'
                ? 'Secondary-drive attachment state is unknown; refresh before changing it.'
                : 'No secondary backup drive is reported as attached.'
              : `Unmount ${attachedBackupDescription}`)}
          >
            Detach Secondary Backup Disk
          </button>
        </div>

        {(backupsQuery.isLoading || snapshotsQuery.isLoading) && (
          <div className="p-12 text-center text-xs text-[#6c757d]">
            <Loader2 className="w-6 h-6 animate-spin text-[#017cb6] mx-auto mb-2" />
            <span>Querying disk snapshots from storage array...</span>
          </div>
        )}

        {!backupsQuery.isLoading &&
          !snapshotsQuery.isLoading &&
          imageReadFailures.length > 0 &&
          allImages.length === 0 && (
            <div className="p-12 text-center text-xs text-rose-700 dark:text-rose-300 space-y-2">
              <AlertTriangle className="w-8 h-8 mx-auto opacity-70" />
              <div className="font-semibold">Disk image list unavailable</div>
              <p className="text-[#6c757d] dark:text-slate-400 max-w-sm mx-auto text-[11px]">
                One or more image sources failed to load, so BLDesk cannot safely say that this server has no backups.
              </p>
            </div>
          )}

        {!backupsQuery.isLoading &&
          !snapshotsQuery.isLoading &&
          imageReadFailures.length === 0 &&
          allImages.length === 0 && (
          <div className="p-12 text-center text-xs text-[#6c757d] space-y-2">
            <Disc className="w-8 h-8 text-[#6c757d]/50 mx-auto" />
            <div className="font-semibold text-[#212529] dark:text-white">No Snapshots Found</div>
            <p className="text-[#6c757d] max-w-sm mx-auto text-[11px]">
              Take an instant snapshot before making configuration updates to ensure full rollback capabilities.
            </p>
            <button
              onClick={() => {
                if (reportBlocked(takeBackupBlockReason)) return
                setSnapshotError(null)
                setIsTakingSnapshot(true)
              }}
              disabled={!!takeBackupBlockReason}
              title={takeBackupBlockReason || 'Take a backup'}
              className="mt-2 px-3.5 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition shadow-sm disabled:opacity-50"
            >
              Take First Snapshot
            </button>
          </div>
        )}

        {!backupsQuery.isLoading && !snapshotsQuery.isLoading && allImages.length > 0 && (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#f8f9fa] dark:bg-[#212529] border-b border-[#ced4da] dark:border-[#373b3e] text-[#6c757d]">
                <th className="py-2.5 px-4">Name / Label</th>
                <th className="py-2.5 px-4">Created Date</th>
                <th className="py-2.5 px-4">Min Disk Size</th>
                <th className="py-2.5 px-4">Type</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
              {allImages.map((img) => {
                const isProcessing = actionProcessingId === img.id
                return (
                  <tr key={img.id} className="hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#017cb6]">{img.name || `Snapshot #${img.id}`}</div>
                      <div className="text-[11px] text-[#6c757d] dark:text-slate-400 font-mono">#{img.id}</div>
                    </td>
                    <td className="py-3 px-4 text-[#6c757d] dark:text-slate-300">
                      {img.created_at ? new Date(img.created_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium text-[#212529] dark:text-white">
                      {img.min_disk_size || activeServer?.disk || 20} GB
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#017cb6]/10 text-[#017cb6] uppercase">
                        {img.type || 'snapshot'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleDownload(img.id, img.name)}
                          disabled={isProcessing}
                          className="px-2.5 py-1 text-[11px] font-medium text-[#212529] dark:text-slate-200 bg-[#f1f1f1] dark:bg-[#343a40] hover:bg-[#e9ecef] rounded transition flex items-center gap-1"
                          title="Download compressed disk image"
                        >
                          <Download className="w-3 h-3" />
                          <span>Download</span>
                        </button>
                        <button
                          onClick={() => handleAttach(img.id, img.name)}
                          disabled={isProcessing || !!mutationBlockReason || attachmentState === 'unknown' || attachedBackupId === Number(img.id)}
                          className="px-2.5 py-1 text-[11px] font-medium text-[#212529] dark:text-slate-200 bg-[#f1f1f1] dark:bg-[#343a40] hover:bg-[#e9ecef] rounded transition flex items-center gap-1"
                          title={mutationBlockReason || (attachmentState === 'unknown'
                            ? 'Secondary-drive attachment state is unknown; refresh before changing it.'
                            : attachedBackupId === Number(img.id)
                              ? 'This image is already the reported secondary drive.'
                              : `Mount as secondary drive (currently: ${attachedBackupDescription})`)}
                        >
                          {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <HardDrive className="w-3 h-3" />}
                          <span>Mount</span>
                        </button>
                        <button
                          onClick={() => handleRestore(img.id, img.name)}
                          disabled={isProcessing || !!mutationBlockReason}
                          className="px-2.5 py-1 text-[11px] font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 rounded transition border border-rose-200 dark:border-rose-800 flex items-center gap-1"
                          title={mutationBlockReason || 'Restore server back to this point in time'}
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Restore</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Take Snapshot Modal */}
      {isTakingSnapshot && (
        <Modal
          title={isMaintenance ? 'Create Safe Temporary Backup' : 'Create Disk Snapshot'}
          icon={Archive}
          onClose={() => !takeBackupMutation.isPending && setIsTakingSnapshot(false)}
          busy={takeBackupMutation.isPending}
          as="form"
          onSubmit={handleTakeSnapshot}
          size="sm"
          footer={
            <div className="flex justify-end gap-2 p-4">
              <button
                type="button"
                onClick={() => setIsTakingSnapshot(false)}
                disabled={takeBackupMutation.isPending}
                className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={takeBackupMutation.isPending || !!takeBackupBlockReason}
                className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {takeBackupMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Review Backup</span>
              </button>
            </div>
          }
        >
          <div className="space-y-4 p-5 text-xs">
              <p className="text-[#6c757d] dark:text-slate-400">
                Captures a full point-in-time image of the active disk drive for {activeServer?.name}.
              </p>

              <div>
                <label className="block font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  Backup Slot / Retention
                </label>
                {isMaintenance ? (
                  <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-800 dark:text-emerald-200">
                    Temporary backup · retained for up to 7 days · replaces nothing
                  </div>
                ) : (
                  <select
                    value={selectedSlot}
                    onChange={(e) => setSelectedSlot(e.target.value)}
                    className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
                  >
                    {availableBackupSlots(activeServer?.selected_size_options).map((slot) => (
                      <option key={slot} value={slot}>
                        {slot === 'temporary' ? 'Temporary Snapshot (Retained for up to 7 days)' : `${BACKUP_SLOT_LABELS[slot]} Backup Slot`}
                      </option>
                    ))}
                    {allImages.length > 0 && (
                      <optgroup label="Replace Existing Image">
                        {allImages.map((img) => (
                          <option key={img.id} value={`replace:${img.id}`}>
                            Replace: {img.name} (#{img.id})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>

              <div>
                <label className="block font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  Snapshot Name / Description (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Pre-upgrade Docker backup"
                  value={snapshotLabel}
                  onChange={(e) => setSnapshotLabel(e.target.value)}
                  maxLength={250}
                  className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
                />
                <div className="mt-1 text-right text-[10px] text-[#6c757d]">{snapshotLabel.length}/250</div>
              </div>

              {snapshotError && (
                <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-700 dark:text-rose-300">
                  {snapshotError}
                </div>
              )}

              {takeBackupBlockReason && (
                <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
                  {takeBackupBlockReason}
                </div>
              )}

              {isMaintenance && (
                <div className="text-[11px] leading-relaxed text-[#6c757d] dark:text-slate-400">
                  If no temporary slot is available, BinaryLane will reject the request. No existing image may be replaced.
                </div>
              )}
          </div>
        </Modal>
      )}
    </div>
  )
}
