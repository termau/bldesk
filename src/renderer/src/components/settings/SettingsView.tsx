import React, { useRef, useState } from 'react'
import { Settings, Bell, Tags, Download, Upload, Palette } from 'lucide-react'
import type { NotificationSettingKey } from '@shared/ipc-types'
import { HelpLink } from '../ui/HelpLink'
import { Modal } from '../ui/Modal'
import { useConfirm } from '../../context/ConfirmContext'
import { useTheme, type ThemePreference } from '../../context/ThemeContext'
import { notifyFailure } from '../../lib/failures'
import type { DiffLine } from '../../lib/diff'
import { saveTextFile } from '../../lib/saveFile'
import { applyTagsImport, loadTagColors, loadTags } from '../../lib/serverGroups'
import { TAGS_FILE_MAX_BYTES, buildTagsFile, liveTagCounts, planTagsImport, readTagsFile, type TagsImportPlan } from '../../lib/tags'
import { useNotificationSettings } from '../../lib/traySettings'
import { useTagState } from '../tags/useTagState'

/**
 * Settings for this device.
 *
 * Everything here is local to this device and its saved profiles, not the BinaryLane account: the main process keeps
 * the notification switches in tray.json (desktop) or the bridge in app preferences (Android), and nothing is sent to
 * BinaryLane. The tray menu edits the same switches, so this view follows it (see useNotificationSettings). Tags are
 * local too, kept per account profile (lib/serverGroups.ts); this view exports them to a JSON file and imports them
 * from one.
 *
 * The words for each notification switch are here, not in shared/notifications, so the help page can quote them.
 */

interface Props {
  /** The active account profile: tags are kept per profile. */
  profileId?: string
  profileName?: string
  /** This account's servers. A tag belongs to a server, so these are the servers a tags file can be exported from and imported onto. */
  servers: ReadonlyArray<{ id: number; name: string }>
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** How many tags an import puts on servers, counting a tag once for each server it goes on. */
const tagsAdded = (plan: TagsImportPlan) => plan.changed.reduce((n, c) => n + c.after.length - c.before.length, 0)

const TAGS_FILE_NAME = () => {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  return `bldesk-tags-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.json`
}

// A Record, so a new notification category cannot ship without its wording.
const CATEGORIES: Record<NotificationSettingKey, { label: string; description: string }> = {
  notifyServerState: {
    label: 'Server state changes',
    description: 'A server appears, changes state or is no longer listed.'
  },
  notifyActions: {
    label: 'Action results',
    description: 'A server action is requested, finishes, fails, or pauses to ask you a question.'
  },
  notifyBalance: {
    label: 'Billing',
    description: 'Prepaid credit runs low, or an invoice payment fails.'
  },
  notifyGeneral: {
    label: 'Changes you make',
    description:
      'Confirmations after you change something in BLDesk, such as starting a backup, editing firewall rules or adding an SSH key, and the one-time note that BLDesk is still running in the tray.'
  },
  notifyUpdates: {
    label: 'BLDesk updates',
    description: 'A new version has finished downloading and is ready to install.'
  }
}

export const SettingsView: React.FC<Props> = ({ profileId, profileName, servers }) => {
  const { settings, set } = useNotificationSettings()
  const [choosing, setChoosing] = useState(false)
  const confirmAction = useConfirm()
  const { tags, colors } = useTagState(profileId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [tagStatus, setTagStatus] = useState('')
  const liveIds = new Set(servers.map((s) => s.id))
  const inUse = liveTagCounts(tags, liveIds)
  const taggedServers = servers.filter((s) => (tags[s.id]?.length ?? 0) > 0).length
  const tagSummary = servers.length === 0
    ? 'This account has no servers listed yet, so there are no tags to export and none to import onto.'
    : inUse.length === 0
      ? 'No server has a tag yet. Import adds the tags in a file.'
      : `${plural(inUse.length, 'tag', 'tags')} on ${plural(taggedServers, 'server', 'servers')}${profileName ? ` in ${profileName}` : ''}.`

  const exportTags = async () => {
    if (!profileId) return
    setTagStatus('')
    setExporting(true)
    try {
      const saved = await saveTextFile(TAGS_FILE_NAME(), JSON.stringify(buildTagsFile(tags, colors, servers), null, 2) + '\n')
      // Only where the system says (the Android app); a download cannot say whether it was kept.
      if (saved.saved) setTagStatus(saved.name ? `Saved as ${saved.name}.` : 'Saved the tags file.')
    } catch (err) {
      notifyFailure('Could not export tags', err)
    } finally {
      setExporting(false)
    }
  }

  const importTags = async (file: File) => {
    if (!profileId) return
    setTagStatus('')
    setImporting(true)
    try {
      if (file.size > TAGS_FILE_MAX_BYTES) throw new Error(`${file.name} is too big to be a tags file (the limit is ${TAGS_FILE_MAX_BYTES / 1024 / 1024} MB).`)
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        throw new Error(`${file.name} is not valid JSON.`)
      }
      const read = readTagsFile(parsed)
      if (!read.ok) throw new Error(read.error)
      if (read.servers.length === 0) {
        setTagStatus(`${file.name} has no tagged servers, so there is nothing to import.`)
        return
      }
      const plan = planTagsImport(loadTags(profileId), loadTagColors(profileId), read, liveIds)
      if (plan.missing === read.servers.length) {
        const which = read.servers.length === 1 ? `The server in ${file.name} is not` : `None of the ${read.servers.length} servers in ${file.name} is`
        throw new Error(`${which} on this account. Tags are matched by server id, so import a file exported from this account.`)
      }
      if (plan.changed.length === 0 && plan.colorsSet === 0) {
        setTagStatus('Nothing to import: the servers in the file already have these tags.')
        return
      }
      // The profile the file was chosen in: the dialog can still be open, or the read slow, when the account is switched.
      const inProfile = profileName ? ` in ${profileName}` : ''
      const names = new Map(servers.map((s) => [s.id, s.name]))
      const line = (id: number, list: string[]) => `${names.get(id) ?? `#${id}`}: ${list.join(', ')}`
      const diff: DiffLine[] = plan.changed.flatMap((c) => [
        ...(c.before.length ? [{ kind: 'same' as const, text: line(c.id, c.before) }] : []),
        { kind: 'add' as const, text: line(c.id, c.after) }
      ])
      const notes = [
        plan.missing ? `${plural(plan.missing, 'server in the file is', 'servers in the file are')} not on this account and ${plan.missing === 1 ? 'is' : 'are'} skipped.` : '',
        plan.colorsSet ? `${plural(plan.colorsSet, 'tag gets', 'tags get')} ${plan.colorsSet === 1 ? 'its' : 'their'} colour from the file.` : '',
        plan.colorsKept ? `${plural(plan.colorsKept, 'tag is', 'tags are')} coloured differently in the file. The colour ${plan.colorsKept === 1 ? 'it has' : 'they have'} now stays.` : ''
      ].filter(Boolean)
      const c = await confirmAction({
        title: 'Import tags',
        summary: `Adds ${plural(tagsAdded(plan), 'tag', 'tags')} to ${plural(plan.changed.length, 'server', 'servers')}${inProfile} from ${file.name}. No tag is removed.`,
        severity: 'normal',
        helpSlug: 'settings#tags',
        notes: notes.length ? notes : undefined,
        diff: diff.length ? diff : undefined,
        confirmLabel: 'Import tags',
        log: false
      })
      if (!c.ok) return
      // Throws, with nothing imported, if the device will not save it: the status below is only ever for tags that were kept.
      const done = applyTagsImport(profileId, read, liveIds)
      setTagStatus(`Imported${profileName ? ` into ${profileName}` : ''}: added ${plural(tagsAdded(done), 'tag', 'tags')} to ${plural(done.changed.length, 'server', 'servers')}.`)
    } catch (err) {
      notifyFailure('Could not import tags', err)
    } finally {
      setImporting(false)
    }
  }

  const on = settings?.notificationsEnabled ?? true
  const keys = Object.keys(CATEGORIES) as NotificationSettingKey[]
  const enabled = settings ? keys.filter((key) => settings[key]).length : 0
  const summary = !settings
    ? ''
    : !on
      ? 'Muted: Show notifications is off.'
      : enabled === keys.length
        ? `All ${keys.length} kinds are on.`
        : `${enabled} of ${keys.length} kinds are on.`

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto select-text bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
          <Settings className="w-5 h-5 text-fg-link" />
          <span className="flex-1">Settings</span>
          <HelpLink slug="settings" />
        </h1>
        <p className="text-xs text-fg-muted dark:text-[#adb5bd] mt-1">
          Preferences for this device. They are not saved to your BinaryLane account.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* --- Notifications --- */}
        <Card title="Notifications" icon={Bell}>
          <Setting
            label="Show notifications"
            description="Turn this off to mute every notification. Your choices for each kind are kept for when you turn it back on."
            checked={on}
            disabled={!settings}
            onChange={(v) => void set('notificationsEnabled', v)}
          />

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium text-[#212529] dark:text-white">Notify me about</div>
              <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-fg-muted dark:text-[#adb5bd]">{summary || 'Loading…'}</p>
            </div>
            <button
              type="button"
              onClick={() => setChoosing(true)}
              disabled={!settings}
              className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded border border-[#ced4da] dark:border-[#495057] bg-white dark:bg-[#343a40] text-[#212529] dark:text-white hover:bg-[#f1f3f5] dark:hover:bg-[#3d444b] transition disabled:opacity-50"
            >
              Choose kinds
            </button>
          </div>

          <Note>
            Muting only stops notifications sent through your operating system. Action progress, failures and History
            inside BLDesk are not affected, and your operating system can still hide notifications on its own.
          </Note>
        </Card>

        {/* --- Appearance --- */}
        <Card title="Appearance" icon={Palette}>
          <ThemeChoice />
        </Card>

        {/* --- Tags --- */}
        <Card title="Tags" icon={Tags}>
          <div>
            <div className="font-medium text-[#212529] dark:text-white">Export and import tags</div>
            <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-fg-muted dark:text-[#adb5bd]">{tagSummary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void exportTags()} disabled={!profileId || inUse.length === 0 || exporting} className={tagButton}>
              <Download className="w-3.5 h-3.5" />
              Export tags
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!profileId || servers.length === 0 || importing} className={tagButton}>
              <Upload className="w-3.5 h-3.5" />
              Import tags
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.currentTarget.value = ''
                if (f) void importTags(f)
              }}
            />
          </div>
          {tagStatus && (
            <p role="status" className="text-[0.6875rem] leading-relaxed text-[#212529] dark:text-[#f8f9fa]">
              {tagStatus}
            </p>
          )}
          <Note>
            Tags are kept on this device for the active account profile; BinaryLane does not store them. The file lists each
            tagged server by id and name, with its tags and their colours. Import adds the file's tags to the servers that
            have the same id, never removes a tag, and never changes the colour a tag already has. A server in the file that
            this account does not have is skipped.
          </Note>
        </Card>
      </div>

      {choosing && settings && (
        <Modal
          title="Notify me about"
          icon={Bell}
          size="sm"
          onClose={() => setChoosing(false)}
          footer={
            <div className="flex items-center justify-end gap-2 p-4">
              <button
                type="button"
                onClick={() => setChoosing(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded transition bg-[#017cb6] hover:bg-[#016594] text-white"
              >
                Done
              </button>
            </div>
          }
        >
          <div className="p-4 space-y-4 text-xs text-[#212529] dark:text-white">
            {!on && (
              <p className="text-[0.6875rem] leading-relaxed text-fg-muted dark:text-[#adb5bd]">
                Show notifications is off, so none of these are shown. Turn it on to change them.
              </p>
            )}
            {keys.map((key) => (
              <Setting
                key={key}
                label={CATEGORIES[key].label}
                description={CATEGORIES[key].description}
                checked={settings[key]}
                disabled={!on}
                onChange={(v) => void set(key, v)}
              />
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}

// --- presentational helpers (same look as the cards on Account Details) ---

const tagButton =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-[#ced4da] dark:border-[#495057] bg-white dark:bg-[#343a40] text-[#212529] dark:text-white hover:bg-[#f1f3f5] dark:hover:bg-[#3d444b] transition disabled:opacity-50'

const Card: React.FC<{ title: string; icon: React.FC<{ className?: string }>; children: React.ReactNode }> = ({
  title,
  icon: Icon,
  children
}) => (
  <div className="bg-white dark:bg-[#2b3035] border border-[#dee2e6] dark:border-[#373b3e] rounded-lg shadow-sm">
    <div className="px-4 py-2.5 border-b border-[#dee2e6] dark:border-[#373b3e] flex items-center gap-2">
      <Icon className="w-4 h-4 text-fg-link" />
      <h3 className="font-semibold text-xs text-[#495057] dark:text-[#ced4da]">{title}</h3>
    </div>
    <div className="p-4 space-y-4 text-xs">{children}</div>
  </div>
)

const Setting: React.FC<{
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}> = ({ label, description, checked, disabled, onChange }) => (
  <div className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-60' : ''}`}>
    <div className="min-w-0">
      <div className="font-medium text-[#212529] dark:text-white">{label}</div>
      <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-fg-muted dark:text-[#adb5bd]">{description}</p>
    </div>
    <Switch label={label} checked={checked} disabled={disabled} onChange={onChange} />
  </div>
)

const Switch: React.FC<{ label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }> = ({
  label,
  checked,
  disabled,
  onChange
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#017cb6] disabled:cursor-not-allowed ${
      checked ? 'bg-[#017cb6]' : 'bg-[#ced4da] dark:bg-[#495057]'
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
        checked ? 'translate-x-[18px]' : 'translate-x-0.5'
      }`}
    />
  </button>
)

const THEME_CHOICES: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const ThemeChoice: React.FC = () => {
  const { preference, setPreference } = useTheme()
  return (
    <fieldset>
      <legend className="font-medium text-[#212529] dark:text-white">Theme</legend>
      <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-fg-muted">
        System follows your operating system's light or dark setting and changes when it does.
      </p>
      <div className="mt-2 inline-flex rounded border border-[#ced4da] dark:border-[#495057] overflow-hidden">
        {THEME_CHOICES.map((c) => (
          <label
            key={c.value}
            className={`px-3 py-1.5 text-xs font-medium cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)] ${
              preference === c.value
                ? 'bg-[#017cb6] text-white'
                : 'bg-white dark:bg-[#343a40] text-[#212529] dark:text-white hover:bg-[#f1f3f5] dark:hover:bg-[#3d444b]'
            }`}
          >
            <input
              type="radio"
              name="theme"
              value={c.value}
              checked={preference === c.value}
              onChange={() => setPreference(c.value)}
              className="sr-only"
            />
            {c.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pt-2.5 border-t border-[#dee2e6] dark:border-[#373b3e] text-[0.6875rem] text-fg-muted dark:text-[#adb5bd] leading-relaxed">
    {children}
  </div>
)
