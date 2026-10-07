import { HelpLink } from '../ui/HelpLink'
import React, { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  Plus,
  RotateCcw,
  HardDrive,
  Loader2,
  Server,
  Disc,
  Clock,
  Download,
  RefreshCw
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Modal } from '../ui/Modal'
import { BinaryLaneClient } from '../../api/client'
import {
  readServerBackups,
  useServerBackups,
  useServerActions,
  useTakeBackupMutation,
  useRestoreBackupMutation,
  useToggleAutomatedBackupsMutation,
  useAttachBackupMutation,
  useDetachBackupMutation,
  useImageDownloadMutation,
  useServerActionWithHandoff,
  actionFailureMessage,
  ACCEPTED_WITHOUT_ACTION,
  type ServerActionBody
} from '../../api/queries'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { useConfirm } from '../../context/ConfirmContext'
import { recordChange, updateChange } from '../../lib/changelog'
import type { FieldChange } from '../../lib/diff'
import { availableBackupSlots, BACKUP_SLOT_LABELS, describeBackup, replacedByOldest } from '../../lib/backupSlots'
import { notifyFailure } from '../../lib/failures'
import {
  FORMATTERS,
  changedFields,
  formatDayOfMonth,
  formatHour,
  formatWeekday,
  optionsFor,
  readBackupSchedule,
  scheduleBodyFields,
  scheduleDraft,
  scheduleFields,
  setScheduleEdit,
  type ScheduleEdits,
  type ScheduleField
} from '../../lib/backupSchedule'

/** What the confirmation's table calls each field, and what the form's label adds to it. */
const SCHEDULE_NAMES: Record<ScheduleField, string> = {
  hour: 'Hour of the day',
  dayOfWeek: 'Day of the week',
  dayOfMonth: 'Day of the month'
}
const SCHEDULE_HINTS: Record<ScheduleField, string> = {
  hour: 'Australia/Sydney time, approximate',
  dayOfWeek: 'for weekly backups',
  dayOfMonth: 'for monthly backups'
}

interface BackupManagerProps {
  /** The app's server list — see AGENTS.md rule 8; tabs do not call useServers. */
  servers: any[]
  client: BinaryLaneClient | null
  initialServerId?: number | null
}

export const BackupManager: React.FC<BackupManagerProps> = ({ client, initialServerId, servers }) => {

  const [selectedServerId, setSelectedServerId] = useState<number | null>(
    initialServerId || (servers.length > 0 ? servers[0].id : null)
  )

  /*
   * Mounted inside a server's own page (`initialServerId` given), this is that
   * server's backups and nothing else. The account-wide Backups page passes no
   * id, and there the picker is the whole point.
   *
   * Previously the picker showed in both, so from a server's Backups tab you
   * could switch to another server while every other piece of chrome - the
   * sidebar, the header, the tab you are standing in - still named the first
   * one. Restore and Take Backup did correctly follow the picker rather than
   * the page, so nothing was ever performed on the wrong server, but the only
   * thing telling you which server you were about to overwrite was the name in
   * the confirm dialog.
   */
  const pinnedServerId = initialServerId ?? null
  const activeServerId = pinnedServerId ?? selectedServerId ?? (servers.length > 0 ? servers[0].id : null)
  const activeServer = servers.find((s) => s.id === activeServerId)

  // Queries for current server
  const backupsQuery = useServerBackups(client, activeServerId)
  const actionsQuery = useServerActions(client, activeServerId)

  // Mutations
  const queryClient = useQueryClient()
  const takeBackupMutation = useTakeBackupMutation(client)
  const restoreBackupMutation = useRestoreBackupMutation(client, activeServerId)
  const { track } = useTrackedActions()
  const toggleAutomatedBackups = useToggleAutomatedBackupsMutation(client, activeServerId)
  const attachBackupMutation = useAttachBackupMutation(client, activeServerId)
  const detachBackupMutation = useDetachBackupMutation(client, activeServerId)
  const downloadMutation = useImageDownloadMutation(client)
  const scheduleMutation = useServerActionWithHandoff(client, activeServerId)

  // Form & Action states
  const [isTakingBackup, setIsTakingBackup] = useState(false)
  const [backupLabel, setBackupLabel] = useState('')
  const [selectedSlot, setSelectedSlot] = useState('temporary')
  const [actionProcessingId, setActionProcessingId] = useState<number | null>(null)
  // The schedule form: open, and the values it is showing. `changing` covers the confirmation and the request.
  const [isChangingSchedule, setIsChangingSchedule] = useState(false)
  const [changing, setChanging] = useState(false)
  const changingRef = useRef(false)
  // Only what the user has chosen in the form. The rest is the schedule the server reports now (`draft`, below), so it follows
  // the 15-second refresh of the server list instead of being a copy taken when the form opened.
  const [edits, setEdits] = useState<ScheduleEdits>({})

  const backups = backupsQuery.data || []
  const actions = actionsQuery.data || []

  // The choice belongs to the server it was made for: a replacement picked on one server named a backup the next server
  // does not have, and the form then showed "Temporary" while submit sent that backup's id to the new server.
  useEffect(() => {
    setSelectedSlot('temporary')
    setBackupLabel('')
    setIsChangingSchedule(false)
  }, [activeServerId])
  // And it only counts while the form can still show it (the backup may have been deleted, or the plan changed).
  const slotOptions = [...availableBackupSlots(activeServer?.selected_size_options), ...backups.map((b) => `replace:${b.id}`)] as string[]
  const chosenSlot = slotOptions.includes(selectedSlot) ? selectedSlot : (slotOptions[0] ?? 'temporary')

  const activeBackupAction = actions.find(
    (a) =>
      a.status === 'in-progress' &&
      (a.type === 'take_backup' || a.type === 'restore' || a.type?.includes('backup'))
  )

  // The schedule is the server's daily backups (what enabling and disabling automated backups add and remove), not the
  // backups it holds: one on-demand backup does not make a manual-only server "Enabled". With no options to read, the
  // API's next scheduled backup stands in.
  const isAutoBackupEnabled = activeServer?.selected_size_options
    ? (activeServer.selected_size_options.daily_backups ?? 0) > 0
    : !!activeServer?.next_backup_window
  // Weekly or monthly retention without a daily one is a schedule too, just not the daily ones this banner switches:
  // "Disabled" would be untrue, and enabling two daily backups is for a server with no backups.
  const weeklyOrMonthlyOnly =
    !isAutoBackupEnabled &&
    ((activeServer?.selected_size_options?.weekly_backups ?? 0) > 0 || (activeServer?.selected_size_options?.monthly_backups ?? 0) > 0)

  // When the server's scheduled backups run, from the app's server list (`backup_settings`). Only what applies to what the
  // server keeps is shown and changed: nothing while it keeps no daily, weekly or monthly backups, the weekday only with weekly
  // ones and the day of the month only with monthly ones (see lib/backupSchedule.ts).
  const schedule = readBackupSchedule(activeServer)
  const shownFields = scheduleFields(activeServer?.selected_size_options)
  const draft = schedule ? scheduleDraft(schedule, edits) : null
  const changedNow = schedule && draft ? changedFields(schedule, draft, shownFields) : []

  // One take at a time, from the submit until the request is sent or the dialog is cancelled. A second submit would send
  // the same request again, which the client refuses, leaving a failed History entry and a failure message. Meanwhile the form
  // cannot be closed, like every form while its request runs: closing it would not stop the take.
  const [taking, setTaking] = useState(false)
  const takingRef = useRef(false)
  const handleTakeBackup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeServerId || takingRef.current) return
    takingRef.current = true
    setTaking(true)
    try {
      await takeBackup()
    } finally {
      takingRef.current = false
      setTaking(false)
    }
  }

  // Take a manual backup
  const takeBackup = async () => {
    if (!activeServerId) return

    // The backups list has no polling, so a backup locked elsewhere since it loaded would be named as replaceable.
    // Read it again before asking, and trust only that read: `fresh` is null when it failed, and a take with no list to
    // check is asked about anyway, because nothing says no backup is replaced. The read, the dialog and the request are
    // all for `activeServerId` as it was at submit, even if the page shows another server by the time they happen.
    const fresh = await readServerBackups(queryClient, client, activeServerId).catch(() => null)

    let replacementStrategy: 'oldest' | 'specified' = 'oldest'
    let backupType: 'daily' | 'weekly' | 'monthly' | 'temporary' | undefined = 'temporary'
    let backupIdToReplace: number | undefined

    if (chosenSlot.startsWith('replace:')) {
      replacementStrategy = 'specified'
      backupType = undefined
      backupIdToReplace = Number(chosenSlot.split(':')[1])
    } else {
      backupType = (chosenSlot as any) || 'temporary'
      replacementStrategy = 'oldest'
    }

    // What this take will replace, when it will (or, for a temporary slot, may) replace something.
    // A locked or attached backup is never replaced, so naming one would be untrue.
    const specified = replacementStrategy === 'specified'
    const attachedId = activeServer?.attached_backup?.id
    const chosen = fresh?.find((b) => b.id === backupIdToReplace)
    const replaced =
      fresh === null
        ? null
        : specified
          ? chosen && !chosen.backup_info?.locked && chosen.id !== attachedId
            ? { backup: chosen, certain: true }
            : null
          : replacedByOldest(backupType ?? 'temporary', activeServer?.selected_size_options, fresh, attachedId)
    // A specified replacement is sent with the type of the backup it replaces. A backup's type never changes, so when
    // there is no fresh read the list on screen (where the backup was picked) still gives it.
    const picked = backups.find((b) => b.id === backupIdToReplace)
    const newType = backupType ?? (chosen ?? picked)?.backup_info?.type
    const named = (b: { id: number; name?: string | null }) => `${b.name ?? 'Backup'} (#${b.id})`
    const toNew = newType ? `New ${newType} backup` : 'New backup'

    // What to ask, if anything. With no fresh list it cannot name a backup, so it says what it cannot tell.
    let ask: { summary: string; change?: FieldChange } | null = null
    if (fresh === null) {
      ask = specified
        ? {
            summary:
              "Couldn't read this server's backups, so BLDesk can't check whether the backup you chose can still be replaced. If it can, this backup replaces it and the replaced backup will no longer be available.",
            change: { label: 'Backup you chose', from: picked ? `${named(picked)}, ${describeBackup(picked)}` : `Backup #${backupIdToReplace}`, to: toNew }
          }
        : {
            summary:
              "Couldn't read this server's backups, so BLDesk can't say which one would be replaced if no slot is free. A backup that is replaced will no longer be available."
          }
    } else if (replaced) {
      ask = {
        summary: specified
          ? 'This backup replaces the backup you chose. The replaced backup will no longer be available.'
          : replaced.certain
            ? `No ${backupType} slot is free, so this backup replaces the oldest ${backupType} backup that is not locked or attached. The replaced backup will no longer be available.`
            : 'If this server has no free temporary slot, this backup replaces its oldest temporary backup that is not locked or attached. The replaced backup will no longer be available.',
        change: {
          label: replaced.certain ? 'Replaced backup' : 'Replaced if no slot is free',
          from: `${named(replaced.backup)}, ${describeBackup(replaced.backup)}`,
          to: toNew
        }
      }
    }

    let changeId: string | undefined
    if (ask) {
      const c = await confirmAction({
        title: 'Take Backup',
        helpSlug: 'backups#take-backup',
        target: { kind: 'server', id: activeServerId, name: activeServer?.name || `#${activeServerId}` },
        summary: ask.summary,
        severity: 'destructive',
        changes: [...(ask.change ? [ask.change] : []), ...(backupLabel.trim() ? [{ label: 'Label', to: backupLabel.trim() }] : [])]
      })
      if (!c.ok) return
      changeId = c.changeId
    } else {
      changeId = await recordChange({
        label: 'Take Backup',
        target: { kind: 'server', id: activeServerId, name: activeServer?.name || `#${activeServerId}` },
        severity: 'normal',
        summary: backupLabel.trim() ? `Label "${backupLabel.trim()}"` : undefined,
        source: 'ui'
      })
    }
    try {
      const queued = await takeBackupMutation.mutateAsync({
        serverId: activeServerId,
        label: backupLabel.trim() || undefined,
        backupType: newType,
        replacementStrategy,
        backupIdToReplace
      })
      // A backup of a 40 GB disk runs for minutes and reports rich progress
      // while it does. Tracking it means the user learns whether it landed,
      // instead of only that it started.
      if (queued) track(queued, 'Take Backup', activeServer?.name, changeId)
      window.bldeskApi?.sendNotification?.({
        title: 'Backup Initiated',
        body: `Backup started for server #${activeServerId}.`
      })
      setIsTakingBackup(false)
      setBackupLabel('')
      setSelectedSlot('temporary')
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err.message })
      notifyFailure('Backup failed', err)
    }
  }

  const confirmAction = useConfirm()
  // Restore from a backup image
  const handleRestore = async (imageId: number, name: string) => {
    if (!activeServerId) return
    const c = await confirmAction({
      title: 'Restore from backup',
      helpSlug: 'backups#worked-example',
      target: { kind: 'server', id: activeServerId, name: activeServer?.name || `#${activeServerId}` },
      summary: `Overwrites the server's current disk with image "${name}" (#${imageId}). Everything written since that image was taken is lost.`,
      severity: 'irreversible',
      changes: [{ label: 'Disk contents', from: 'current', to: `${name} (#${imageId})` }],
      notes: ['Take a backup first if the current state might be needed again.'],
      confirmLabel: 'Restore'
    })
    if (!c.ok) return

    setActionProcessingId(imageId)
    try {
      const queued = await restoreBackupMutation.mutateAsync(imageId)
      // A restore overwrites the disk and runs for a while. "Initiated" was true
      // but the user was never told whether it actually landed.
      if (queued) track(queued, `Restore from "${name}"`, activeServer?.name, c.changeId)
      window.bldeskApi?.sendNotification?.({
        title: 'Restore Initiated',
        body: `Server #${activeServerId} is restoring from image #${imageId}.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      notifyFailure('Restore failed', err)
    } finally {
      setActionProcessingId(null)
    }
  }

  // Attach disk image as secondary read-only drive
  const handleAttach = async (imageId: number, name: string) => {
    if (!activeServerId) return
    setActionProcessingId(imageId)
    let changeId: string | undefined
    try {
      changeId = await recordChange({
        label: `Attach "${name}"`,
        target: { kind: 'server', id: activeServerId, name: activeServer?.name || `#${activeServerId}` },
        severity: 'normal',
        summary: 'Mount the image as a read-only secondary drive.',
        source: 'ui'
      })
      const queued = await attachBackupMutation.mutateAsync(imageId)
      if (queued) track(queued, `Attach "${name}"`, activeServer?.name, changeId)
      // Was "Backup Attached" / "mounted as secondary drive" at queue time,
      // which is a claim about something that had not happened yet. The toast
      // reports the mount when BinaryLane actually confirms it.
      window.bldeskApi?.sendNotification?.({
        title: 'Attach Requested',
        body: `Mounting "${name}" as a secondary drive.`
      })
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err.message })
      notifyFailure('Attach failed', err)
    } finally {
      setActionProcessingId(null)
    }
  }

  // Download a backup disk image
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
      notifyFailure(`Download failed for "${name}"`, err)
    } finally {
      setActionProcessingId(null)
    }
  }

  // Detach secondary drive
  const handleDetach = async () => {
    if (!activeServerId) return
    let changeId: string | undefined
    try {
      changeId = await recordChange({
        label: 'Detach Secondary Drive',
        target: { kind: 'server', id: activeServerId, name: activeServer?.name || `#${activeServerId}` },
        severity: 'normal',
        source: 'ui'
      })
      const queued = await detachBackupMutation.mutateAsync()
      if (queued) track(queued, 'Detach Secondary Drive', activeServer?.name, changeId)
      window.bldeskApi?.sendNotification?.({
        title: 'Detach Requested',
        body: `Unmounting the secondary backup drive.`
      })
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err.message })
      notifyFailure('Detach failed', err)
    }
  }

  // Change when the server's scheduled backups run: confirm the rows that change, send only those, and record the outcome in
  // History. The form stays open when the request fails, so what was chosen is not lost. This action is one that readQueuedAction
  // (api/queries.ts) says the API answers with 202 and no action to follow, which useServerActionWithHandoff reports as `accepted`.
  const handleChangeSchedule = async (e: React.FormEvent) => {
    e.preventDefault()
    // One change at a time, from the submit until the request is sent or the confirmation is cancelled: a second submit would
    // send the same request again. The ref answers at once, before the state has re-rendered.
    if (!activeServerId || !schedule || !draft || changingRef.current || changedNow.length === 0) return
    const serverId = activeServerId
    changingRef.current = true
    setChanging(true)
    try {
      const c = await confirmAction({
        title: 'Change backup schedule',
        helpSlug: 'backups#backup-schedule',
        target: { kind: 'server', id: serverId, name: activeServer?.name || `#${serverId}` },
        summary: "Changes when BinaryLane runs this server's scheduled backups. The hour is approximate, and the days are Australia/Sydney calendar days.",
        severity: 'normal',
        changes: changedNow.map((f) => ({ label: SCHEDULE_NAMES[f], from: FORMATTERS[f](schedule[f]), to: FORMATTERS[f](draft[f]) }))
      })
      if (!c.ok) return
      const label = 'Change Backup Schedule'
      const body: ServerActionBody = { type: 'change_backup_schedule', ...scheduleBodyFields(draft, changedNow) }
      try {
        const outcome = await scheduleMutation.mutateAsync(body)
        switch (outcome.state) {
          case 'completed':
            void updateChange(c.changeId, { outcome: 'completed', actionId: outcome.action.id })
            break
          case 'handed-off':
          case 'awaiting-interaction':
            track(outcome.action, label, activeServer?.name, c.changeId)
            break
          case 'accepted':
            void updateChange(c.changeId, { outcome: 'submitted', detail: ACCEPTED_WITHOUT_ACTION })
            break
          case 'blocked-by-invoice':
            track(outcome.action, label, activeServer?.name, c.changeId)
            notifyFailure('Schedule update blocked', new Error(`"${label}" is blocked by invoice #${outcome.action.blocking_invoice_id}, which requires payment.`))
            return
          case 'errored': {
            const detail = actionFailureMessage(label, outcome.action)
            void updateChange(c.changeId, { outcome: 'errored', actionId: outcome.action.id, detail })
            notifyFailure('Schedule update failed', new Error(detail))
            return
          }
        }
        window.bldeskApi?.sendNotification?.({
          title: 'Schedule Change Requested',
          body: `Changing when the backups of server #${serverId} run.`
        })
        setIsChangingSchedule(false)
      } catch (err: any) {
        void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
        notifyFailure('Schedule update failed', err)
      }
    } finally {
      changingRef.current = false
      setChanging(false)
    }
  }

  // Toggle Automated Backups
  const handleToggleAuto = async () => {
    if (!activeServerId) return
    const enable = !isAutoBackupEnabled
    const c = await confirmAction({
      title: enable ? 'Enable automated backups' : 'Remove daily backups',
      target: { kind: 'server', id: activeServerId, name: activeServer?.name || `#${activeServerId}` },
      summary: enable
        ? 'BinaryLane takes daily backups on the server\'s schedule.'
        : 'Changes the server\'s options to remove its daily backups. This is not a pause: BinaryLane removes them, including any you took with Take Backup into a daily slot, and does not ask again.',
      severity: enable ? 'normal' : 'destructive',
      notes: enable
        ? undefined
        : [
            'BinaryLane does this only when the server has the two daily backups that enabling automated backups creates.',
            'Temporary backups you took with Take Backup are not removed.'
          ],
      changes: [{ label: 'Automated backups', from: enable ? 'off' : 'on', to: enable ? 'on' : 'off' }]
    })
    if (!c.ok) return

    try {
      const queued = await toggleAutomatedBackups.mutateAsync(enable)
      if (queued) track(queued, enable ? 'Enable Automated Backups' : 'Remove Daily Backups', activeServer?.name, c.changeId)
      window.bldeskApi?.sendNotification?.({
        title: 'Schedule Change Requested',
        body: `${enable ? 'Enabling automated backups' : 'Removing the daily backups'} for server #${activeServerId}.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      notifyFailure('Schedule update failed', err)
    }
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      {/* Header & Target Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
            <Archive className="w-5 h-5 text-[#017cb6]" />
            <span>Server Backups</span>
          </h1>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-0.5">
            Take an on-demand point-in-time backup, or mount a backup image as a live secondary drive for file recovery.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!pinnedServerId && (
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
          )}

          <button
            onClick={() => setIsTakingBackup(true)}
            disabled={!activeServerId || takeBackupMutation.isPending || taking}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm disabled:opacity-50"
          >
            {takeBackupMutation.isPending || taking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>Take Backup</span>
          </button>
          <HelpLink slug="backups" />
        </div>
      </div>

      {/* Automated Backup Schedule Banner */}
      {activeServer && (
        <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3 min-w-0 flex-1 basis-60">
            <div className="w-9 h-9 flex-shrink-0 rounded bg-[#017cb6]/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-[#017cb6]" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#212529] dark:text-white flex items-center gap-2">
                <span>Automated Daily Backups</span>
                <span
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                    isAutoBackupEnabled
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                  }`}
                >
                  {isAutoBackupEnabled ? 'Enabled' : weeklyOrMonthlyOnly ? 'No daily' : 'Disabled'}
                </span>
              </div>
              <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5">
                {isAutoBackupEnabled
                  ? "BinaryLane takes automated daily backups. The Backup Schedule below shows when they run. Weekly and monthly backups are set in the Backups section of the server's Change Plan."
                  : weeklyOrMonthlyOnly
                    ? "This server keeps weekly or monthly backups and no daily ones. Daily, weekly and monthly backups are set in the Backups section of the server's Change Plan."
                    : "Automated backups are currently turned off for this server. The button enables daily backups and keeps two of them; weekly and monthly backups are set in the Backups section of the server's Change Plan."}
              </p>
            </div>
          </div>

          {!weeklyOrMonthlyOnly && <button
            onClick={handleToggleAuto}
            disabled={toggleAutomatedBackups.isPending}
            className={`px-3 py-1.5 text-xs font-medium rounded transition border whitespace-nowrap ${
              isAutoBackupEnabled
                ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800'
                : 'text-[#017cb6] bg-[#017cb6]/10 border-[#017cb6]/30 hover:bg-[#017cb6]/20'
            }`}
          >
            {isAutoBackupEnabled ? 'Remove Daily Backups' : 'Enable Daily Backups'}
          </button>}
        </div>
      )}

      {/* Backup schedule: when the server's scheduled backups run */}
      {activeServer && shownFields.length > 0 && (
        <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="min-w-0 flex-1 basis-60">
            <div className="text-xs font-bold text-[#212529] dark:text-white">Backup Schedule</div>
            {schedule ? (
              <div className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5 space-y-0.5">
                <p>Backups run at about {formatHour(schedule.hour)}, Australia/Sydney time.</p>
                {shownFields.includes('dayOfWeek') && <p>Weekly backups run on {formatWeekday(schedule.dayOfWeek)}.</p>}
                {shownFields.includes('dayOfMonth') && <p>Monthly backups run on the {formatDayOfMonth(schedule.dayOfMonth)}.</p>}
              </div>
            ) : (
              <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5">BinaryLane did not report when this server's backups run.</p>
            )}
          </div>
          {schedule && (
            <button
              onClick={() => {
                setEdits({})
                setIsChangingSchedule(true)
              }}
              className="px-3 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition whitespace-nowrap shadow-sm"
            >
              Change Schedule
            </button>
          )}
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
                  ? 'Backup in Progress...'
                  : activeBackupAction.type === 'restore'
                  ? 'Restoring Disk Image...'
                  : 'Backup Task in Progress...'}
              </h4>
              <p className="text-[11px] text-[#6c757d] dark:text-slate-400">
                The hypervisor is actively creating your backup. It will appear in the table below automatically once ready.
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-blue-100 dark:bg-blue-900/60 text-[#017cb6] dark:text-blue-300 animate-pulse flex-shrink-0">
            Capturing Image
          </span>
        </div>
      )}

      {/* Backups list */}
      <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-sm overflow-hidden flex flex-col flex-shrink-0">
        <div className="p-3.5 bg-[#f1f1f1] dark:bg-[#262a2e] border-b border-[#ced4da] dark:border-[#373b3e] flex items-center justify-between">
          <h3 className="font-bold text-xs text-[#495057] dark:text-[#ced4da] flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[#017cb6]" />
            <span>Available Disk Images for {activeServer?.name || `Server #${activeServerId}`}</span>
          </h3>
          <button
            onClick={handleDetach}
            disabled={detachBackupMutation.isPending}
            className="text-[11px] text-[#6c757d] hover:text-amber-500 hover:underline"
            title="Unmount secondary drive"
          >
            Detach Secondary Backup Disk
          </button>
        </div>

        {backupsQuery.isLoading && (
          <div className="p-12 text-center text-xs text-[#6c757d]">
            <Loader2 className="w-6 h-6 animate-spin text-[#017cb6] mx-auto mb-2" />
            <span>Querying disk images...</span>
          </div>
        )}

        {backupsQuery.isError && (
          <div
            role="alert"
            className="m-3.5 flex items-start gap-2 p-3 rounded-lg border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
            <div className="flex-1 min-w-0 space-y-2">
              <p className="font-semibold break-words">
                {backupsQuery.data ? "Couldn't refresh this server's backups." : "Couldn't read this server's backups."}
              </p>
              <p className="break-words line-clamp-3">{backupsQuery.error?.message}</p>
              {backupsQuery.data && <p>The list below is from the last successful load.</p>}
              <button
                onClick={() => void backupsQuery.refetch()}
                disabled={backupsQuery.isFetching}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition shadow-sm disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${backupsQuery.isFetching ? 'animate-spin' : ''}`} />
                <span>Retry</span>
              </button>
            </div>
          </div>
        )}

        {!backupsQuery.isLoading && !backupsQuery.isError && backups.length === 0 && (
          <div className="p-12 text-center text-xs text-[#6c757d] space-y-2">
            <Disc className="w-8 h-8 text-[#6c757d]/50 mx-auto" />
            <div className="font-semibold text-[#212529] dark:text-white">No Backups Found</div>
            <p className="text-[#6c757d] max-w-sm mx-auto text-[11px]">
              Take a backup before making configuration changes, so there is something to roll back to.
            </p>
            <button
              onClick={() => setIsTakingBackup(true)}
              className="mt-2 px-3.5 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition shadow-sm"
            >
              Take First Backup
            </button>
          </div>
        )}

        {!backupsQuery.isLoading && backups.length > 0 && (
          /* The row is wider than a phone - the actions alone need ~250px - so
             it scrolls sideways rather than being clipped with Download, Mount
             and Restore unreachable. `min-w-max` stops the table squashing
             columns into unreadable slivers instead of scrolling. */
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-xs border-collapse">
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
              {backups.map((img) => {
                const isProcessing = actionProcessingId === img.id
                return (
                  <tr key={img.id} className="hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#017cb6]">{img.name || `Image #${img.id}`}</div>
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
                        {img.type || 'backup'}
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
                          disabled={isProcessing}
                          className="px-2.5 py-1 text-[11px] font-medium text-[#212529] dark:text-slate-200 bg-[#f1f1f1] dark:bg-[#343a40] hover:bg-[#e9ecef] rounded transition flex items-center gap-1"
                          title="Mount as secondary drive to extract files"
                        >
                          {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <HardDrive className="w-3 h-3" />}
                          <span>Mount</span>
                        </button>
                        <button
                          onClick={() => handleRestore(img.id, img.name)}
                          disabled={isProcessing}
                          className="px-2.5 py-1 text-[11px] font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 rounded transition border border-rose-200 dark:border-rose-800 flex items-center gap-1"
                          title="Restore server back to this point in time"
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
          </div>
        )}
      </div>

      {/* Backup schedule dialog */}
      {isChangingSchedule && schedule && draft && (
        <Modal
          title="Change Backup Schedule"
          size="sm"
          onClose={() => setIsChangingSchedule(false)}
          // While the confirmation is open and the request is sent the form cannot be closed, like every form while its request runs.
          busy={scheduleMutation.isPending || changing}
          as="form"
          onSubmit={handleChangeSchedule}
          footer={
            <div className="flex justify-end gap-2 p-4 text-xs">
              <button
                type="button"
                onClick={() => setIsChangingSchedule(false)}
                disabled={scheduleMutation.isPending || changing}
                className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={scheduleMutation.isPending || changing || changedNow.length === 0}
                className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {(scheduleMutation.isPending || changing) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Change Schedule</span>
              </button>
            </div>
          }
        >
          <div className="p-5 space-y-4 text-xs">
            <p className="text-[#6c757d] dark:text-slate-400">
              Sets when BinaryLane runs the scheduled backups of {activeServer?.name}. The hour and the days are in Australia/Sydney time, whichever region the server is in.
            </p>
            {shownFields.map((field) => (
              <div key={field}>
                <label className="block font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  {SCHEDULE_NAMES[field]} <span className="font-normal text-[#6c757d] dark:text-slate-400">({SCHEDULE_HINTS[field]})</span>
                </label>
                <select
                  value={draft[field]}
                  onChange={(e) => setEdits((prev) => setScheduleEdit(prev, field, Number(e.target.value), schedule))}
                  className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
                >
                  {optionsFor(field, schedule[field]).map((n) => (
                    <option key={n} value={n}>
                      {FORMATTERS[field](n)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Take Backup dialog */}
      {isTakingBackup && (
        <Modal
          title="Take Backup"
          size="sm"
          onClose={() => setIsTakingBackup(false)}
          // While the backups are checked and the request is sent the form cannot be closed, like every form while its
          // request runs: closing it would not stop the take.
          busy={takeBackupMutation.isPending || taking}
          as="form"
          onSubmit={handleTakeBackup}
          footer={
            <div className="flex justify-end gap-2 p-4 text-xs">
              <button
                type="button"
                onClick={() => setIsTakingBackup(false)}
                disabled={takeBackupMutation.isPending || taking}
                className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={takeBackupMutation.isPending || taking}
                className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {(takeBackupMutation.isPending || taking) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Take Backup</span>
              </button>
            </div>
          }
        >
          <div className="p-5 space-y-4 text-xs">
            <p className="text-[#6c757d] dark:text-slate-400">
              Captures a full point-in-time image of the active disk drive for {activeServer?.name}.
            </p>

            <div>
              <label className="block font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                Backup Slot / Retention
              </label>
              <select
                value={chosenSlot}
                onChange={(e) => setSelectedSlot(e.target.value)}
                className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
              >
                {availableBackupSlots(activeServer?.selected_size_options).map((slot) => (
                  <option key={slot} value={slot}>
                    {slot === 'temporary' ? BACKUP_SLOT_LABELS.temporary : `${BACKUP_SLOT_LABELS[slot]} Backup Slot`}
                  </option>
                ))}
                {backups.length > 0 && (
                  <optgroup label="Replace Existing Image">
                    {backups.map((img) => (
                      <option key={img.id} value={`replace:${img.id}`}>
                        Replace: {img.name} (#{img.id})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div>
              <label className="block font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                Backup Name / Description (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Pre-upgrade Docker backup"
                value={backupLabel}
                onChange={(e) => setBackupLabel(e.target.value)}
                className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
