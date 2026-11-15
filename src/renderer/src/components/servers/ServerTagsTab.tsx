import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Tag } from 'lucide-react'
import { components } from '@shared/api/schema'
import { allTags, colorOf, loadTags, normaliseTag, saveTags, tagNameProblem, tagServerCount, tagsOf, withTag } from '../../lib/serverGroups'
import { TagChip } from '../tags/TagChip'
import { TagEditorBody, TagEditorSheet } from '../tags/TagEditor'
import { usePhoneLayout } from '../../lib/usePhoneLayout'
import { useTagState } from '../tags/useTagState'
import { isComposing } from '../../lib/ime'

type ServerResponse = components['schemas']['Server']

interface Props {
  profileId?: string
  server: ServerResponse
  /** The account's servers, so a tag's count leaves out servers that no longer exist. */
  servers?: ServerResponse[]
}

/**
 * The Tags section of a server's Settings: add, remove, rename and colour its tags. Tags are local to this device and profile (the
 * BinaryLane API has none), so nothing here sends a request.
 */
export const ServerTagsTab: React.FC<Props> = ({ profileId, server, servers }) => {
  const { tags, colors } = useTagState(profileId)
  // On a phone the controls are bigger and the editor is a panel inside the visible screen (TagEditorSheet).
  const phone = usePhoneLayout()
  const all = useMemo(() => servers ?? [server], [servers, server])
  /** The tag being edited in place (the same editor a chip opens elsewhere, here without a popover), and what opened it. */
  const [editing, setEditing] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const edit = (tag: string, el: HTMLElement) => {
    opener.current = el
    setEditing(tag)
  }
  const closeEditor = useCallback((restoreFocus: boolean) => {
    setEditing(null)
    const el = opener.current
    if (restoreFocus && el) setTimeout(() => el.isConnected && el.focus(), 0)
  }, [])
  const [input, setInput] = useState('')
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null)

  const liveIds = useMemo(() => new Set(all.map((s) => s.id)), [all])
  const mine = tagsOf(tags, server.id)
  // A tag taken off this server (here or elsewhere) closes its editor: adding it again must not bring the editor back.
  useEffect(() => {
    if (editing && !mine.includes(editing)) setEditing(null)
  }, [editing, mine])
  const query = normaliseTag(input)
  const suggestions = useMemo(
    () =>
      allTags(tags)
        .map((t) => ({ ...t, count: tagServerCount(tags, t.tag, liveIds) }))
        .filter((t) => t.count > 0 && !mine.includes(t.tag) && (!query || t.tag.includes(query)))
        .slice(0, 12),
    [tags, liveIds, mine, query]
  )

  const add = (raw: string) => {
    if (!profileId) return
    const problem = tagNameProblem(raw)
    if (problem) {
      setNotice({ text: problem, bad: true })
      return
    }
    const tag = normaliseTag(raw)
    if (mine.includes(tag)) {
      setNotice({ text: `@${tag} is already on this server.`, bad: true })
      return
    }
    saveTags(profileId, withTag(loadTags(profileId), [server.id], tag, true))
    setInput('')
    setNotice({ text: `Added @${tag}.`, bad: false })
  }

  const remove = (tag: string) => {
    if (!profileId) return
    saveTags(profileId, withTag(loadTags(profileId), [server.id], tag, false))
    setNotice({ text: `Removed @${tag} from this server.`, bad: false })
  }

  return (
    <div className="bg-white dark:bg-[#2b3035] p-5 rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm space-y-4">
      <div>
        <h3 className="text-sm font-bold text-[#212529] dark:text-white flex items-center gap-2">
          <Tag className="w-4 h-4 text-fg-link" />
          Tags
        </h3>
        <p className="text-xs text-fg-muted dark:text-slate-400 mt-1">
          Tags are labels BLDesk keeps on this device for this account profile; BinaryLane does not store them. A tag is also a target: use @name in the command palette or the terminal broadcast to address every server that has it.
        </p>
      </div>

      {!profileId ? (
        <p className="text-xs text-fg-muted dark:text-slate-400">No account profile is active, so tags cannot be saved.</p>
      ) : (
        <>
          <div>
            <h4 className="text-xs font-semibold text-[#495057] dark:text-[#ced4da] mb-2">On this server ({mine.length})</h4>
            {mine.length === 0 ? (
              <p className="text-xs text-fg-muted dark:text-slate-400">This server has no tags yet.</p>
            ) : (
              <ul className="space-y-2">
                {mine.map((t) => (
                  <li key={t} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <TagChip
                      tag={t}
                      color={colorOf(colors, t)}
                      size="md"
                      touch={phone}
                      className="max-w-[16rem]"
                      onEdit={(el) => edit(t, el)}
                      onRemove={() => remove(t)}
                      removeLabel={`Remove @${t} from this server`}
                    />
                    <span className="text-[0.6875rem] text-fg-muted dark:text-slate-400">on {tagServerCount(tags, t, liveIds)} {tagServerCount(tags, t, liveIds) === 1 ? 'server' : 'servers'}</span>
                    <button
                      type="button"
                      onClick={(e) => edit(t, e.currentTarget)}
                      className={`inline-flex items-center gap-1 text-[0.6875rem] text-fg-link hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#017cb6] rounded ${phone ? 'min-h-[40px] min-w-[44px] px-2 justify-center' : ''}`}
                      aria-label={`Edit @${t}: name and colour`}
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {editing && mine.includes(editing) && phone && (
              <TagEditorSheet key={editing} profileId={profileId} tag={editing} serverId={server.id} liveIds={liveIds} onClose={closeEditor} />
            )}
            {editing && mine.includes(editing) && !phone && (
              <div
                className="mt-3 max-w-md rounded-lg border border-[#ced4da] dark:border-[#495057] bg-[#f8f9fa] dark:bg-[#212529] text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    closeEditor(true)
                  }
                }}
              >
                <TagEditorBody key={editing} profileId={profileId} tag={editing} serverId={server.id} liveIds={liveIds} onClose={closeEditor} inline />
              </div>
            )}
          </div>

          <div>
            <label htmlFor="server-tag-input" className="block text-xs font-semibold text-[#495057] dark:text-[#ced4da] mb-1.5">
              Add a tag
            </label>
            <div className="flex items-center gap-2 max-w-md">
              <input
                id="server-tag-input"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  setNotice(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isComposing(e)) {
                    e.preventDefault()
                    add(input)
                  }
                }}
                placeholder="Tag name, then Enter"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                inputMode="text"
                enterKeyHint="done"
                className="flex-1 min-w-0 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-[#f8f9fa] px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
              />
              <button
                type="button"
                onClick={() => add(input)}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
            <p role="status" className={`mt-1.5 min-h-[1rem] text-[0.6875rem] ${notice?.bad ? 'text-red-700 dark:text-red-300' : 'text-[#495057] dark:text-[#adb5bd]'}`}>
              {notice?.text ?? ''}
            </p>
            {suggestions.length > 0 && (
              <div className="mt-1">
                <div className="text-[0.6875rem] text-fg-muted dark:text-slate-400 mb-1">Already in use on other servers</div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s.tag}
                      type="button"
                      onClick={() => add(s.tag)}
                      title={`Add @${s.tag} to this server`}
                      className="inline-flex items-center gap-1 text-[0.6875rem] px-2 py-0.5 rounded-full border border-dashed border-[#ced4da] dark:border-[#495057] text-[#495057] dark:text-[#ced4da] hover:border-[#017cb6] hover:text-fg-link max-w-[14rem]"
                    >
                      <Plus className="w-3 h-3 shrink-0" />
                      <span className="truncate">@{s.tag}</span>
                      <span className="text-fg-muted dark:text-slate-400 shrink-0">({s.count})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="text-[0.6875rem] text-fg-muted dark:text-slate-400">
            A tag is one name shared by every server that has it: renaming it or choosing its colour changes it everywhere.
          </p>
        </>
      )}
    </div>
  )
}
