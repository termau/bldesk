import { useRef, useState, type FormEvent } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { components } from '@shared/api/schema'
import type { BinaryLaneClient } from '../../api/client'
import { apiFailure, readServerBackups, useImportImageMutation } from '../../api/queries'
import { useConfirm } from '../../context/ConfirmContext'
import { useTrackedActions } from '../../context/ActionTrackerContext'
import { updateChange } from '../../lib/changelog'
import { notifyFailure } from '../../lib/failures'
import { availableBackupSlots, describeBackup, replaceableBackups, type BackupSlot, type ExistingBackup } from '../../lib/backupSlots'
import { IMPORT_STRATEGIES, IMPORT_TEMPORARY_TERMS, importSourceSummary, planImageImport, readImportState, submitImageImport, type ImportStrategy } from '../../lib/backupImport'
import { HelpLink } from '../ui/HelpLink'
import { Modal } from '../ui/Modal'

interface Props {
  client: BinaryLaneClient
  server: components['schemas']['Server']
  backups: ExistingBackup[]
  onClose: () => void
}

const fieldClass = 'w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-[#212529] dark:text-white text-xs px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]'
const labelClass = 'block font-medium mb-1 text-[#495057] dark:text-[#ced4da]'

export function ImportImageModal({ client, server, backups, onClose }: Props) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [slot, setSlot] = useState<BackupSlot>('temporary')
  const [strategy, setStrategy] = useState<ImportStrategy>('none')
  const [replacementId, setReplacementId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const queryClient = useQueryClient()
  const confirmAction = useConfirm()
  const mutation = useImportImageMutation(client)
  const { track } = useTrackedActions()
  const slots = availableBackupSlots(server.selected_size_options)
  const replacements = replaceableBackups(backups, server.attached_backup?.id)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    let changeId: string | undefined
    try {
      // Pin the target and draft before waiting; background refreshes must not redirect the import.
      const draft = { url, label, slot, strategy, replacementId }
      const source = importSourceSummary(url)
      const fresh = await readServerBackups(queryClient, client, server.id)
      const current = await readImportState(() => client.GET('/v2/servers/{server_id}', { params: { path: { server_id: server.id } } }))
      if (current.error || !current.response.ok) throw apiFailure(current.error, current.response)
      if (!current.data?.server) throw new Error('Could not read this server. Try again before importing.')
      const plan = planImageImport(draft, current.data.server.selected_size_options, fresh, current.data.server.attached_backup?.id)
      const automatic = strategy === 'oldest' || strategy === 'newest'
      const mayReplace = strategy !== 'none'
      const importedSlot = strategy === 'specified' ? plan.replaced?.backup_info?.type : slot
      const summary = strategy === 'specified'
        ? 'Downloads an image into the selected backup slot, replacing the image you chose. The replaced image will no longer be available. This does not restore or attach the imported image.'
        : automatic
          ? `Downloads an image into a ${slot} slot. If no slot is free when processed, BinaryLane replaces the ${strategy} unlocked and unattached image of this type. The replaced image will no longer be available. This does not restore or attach the imported image.`
          : 'Downloads an image into a free backup slot without replacing an existing image. This does not restore or attach the imported image.'
      const c = await confirmAction({
        title: 'Import Image', helpSlug: 'backups#import-image',
        target: { kind: 'server', id: server.id, name: current.data.server.name },
        summary, severity: mayReplace ? 'destructive' : 'normal', confirmLabel: 'Import Image',
        changes: [
          { label: 'Server', to: `${current.data.server.name} (#${server.id})` },
          { label: 'Image URL', to: source },
          { label: 'Slot', to: importedSlot ?? 'Selected image slot' },
          { label: 'Replacement', to: IMPORT_STRATEGIES[strategy] },
          ...(plan.replaced ? [{ label: automatic ? 'Candidate image' : 'Replaced image', from: `${plan.replaced.name ?? 'Image'} (#${plan.replaced.id}), ${describeBackup(plan.replaced)}`, to: 'Imported image' }] : []),
          ...(label.trim() ? [{ label: 'Label', to: label.trim() }] : [])
        ],
        notes: [
          ...(importedSlot === 'temporary' ? [IMPORT_TEMPORARY_TERMS] : []),
          ...(automatic ? ['The replacement candidate can change before BinaryLane processes this request.'] : [])
        ]
      })
      if (!c.ok) return
      changeId = c.changeId
      const result = await submitImageImport(() => mutation.mutateAsync({ serverId: server.id, body: plan.body }))
      if (result.kind === 'failed') throw result.error
      if (result.kind === 'queued') track(result.action, 'Import Image', current.data.server.name, changeId)
      else {
        void updateChange(changeId, { detail: result.detail })
        void queryClient.invalidateQueries({ queryKey: ['serverBackups', server.id] })
        void queryClient.invalidateQueries({ queryKey: ['serverActions', server.id] })
        notifyFailure('Import outcome unknown', result.detail)
      }
      onClose()
    } catch (error) {
      if (changeId) void updateChange(changeId, { outcome: 'failed', detail: error instanceof Error ? error.message : String(error) })
      notifyFailure('Image import failed', error)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Modal title="Import Image" icon={Upload} size="sm" as="form" onSubmit={submit} busy={busy} onClose={onClose}
      headerRight={<HelpLink slug="backups#import-image" />}
      footer={<div className="flex justify-end gap-2 p-4 text-xs">
        <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 text-fg-muted disabled:opacity-50">Cancel</button>
        <button type="submit" disabled={busy || !url.trim() || (strategy === 'specified' && !replacementId)}
          className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white font-medium rounded flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Import Image
        </button>
      </div>}
    >
      <fieldset disabled={busy} className="p-5 space-y-4 text-xs min-w-0">
        <p className="text-fg-muted dark:text-slate-400">Import an image from an HTTP or HTTPS URL into a backup slot on {server.name}.</p>
        <div>
          <label htmlFor="import-image-url" className={labelClass}>Image URL</label>
          <input id="import-image-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/image" className={fieldClass} autoComplete="off" spellCheck={false} />
        </div>
        <div>
          <label htmlFor="import-image-strategy" className={labelClass}>Replacement strategy</label>
          <select id="import-image-strategy" value={strategy} onChange={(e) => setStrategy(e.target.value as ImportStrategy)} className={fieldClass}>
            {Object.entries(IMPORT_STRATEGIES).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </div>
        {strategy === 'specified' ? <div>
          <label htmlFor="import-image-replacement" className={labelClass}>Image to replace</label>
          <select id="import-image-replacement" value={replacementId ?? ''} onChange={(e) => setReplacementId(Number(e.target.value) || null)} required className={fieldClass}>
            <option value="">Choose an image</option>
            {replacementId && !replacements.some((b) => b.id === replacementId) && <option value={replacementId} disabled>Selected image is unavailable</option>}
            {replacements.map((b) => <option key={b.id} value={b.id}>{b.name ?? 'Image'} (#{b.id}) - {describeBackup(b)}</option>)}
          </select>
        </div> : <div>
          <label htmlFor="import-image-slot" className={labelClass}>Backup slot</label>
          <select id="import-image-slot" value={slot} onChange={(e) => setSlot(e.target.value as BackupSlot)} className={fieldClass}>
            {!slots.includes(slot) && <option value={slot} disabled>Selected slot is unavailable</option>}
            {slots.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>}
        {(strategy === 'specified' ? replacements.find((b) => b.id === replacementId)?.backup_info.type === 'temporary' : slot === 'temporary') &&
          <p className="text-[0.6875rem] text-fg-muted dark:text-slate-400">{IMPORT_TEMPORARY_TERMS}</p>}
        <div>
          <label htmlFor="import-image-label" className={labelClass}>Label (optional)</label>
          <input id="import-image-label" value={label} maxLength={250} onChange={(e) => setLabel(e.target.value)} className={fieldClass} />
        </div>
      </fieldset>
    </Modal>
  )
}
