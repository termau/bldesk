import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  colorOf,
  loadGroups,
  loadTagColors,
  loadTags,
  normaliseTag,
  renameTag,
  saveTagColors,
  saveTags,
  tagNameProblem,
  tagServerCount,
  withTag,
  withTagColor
} from '../../lib/serverGroups'
import { TagChip } from './TagChip'
import { TagColourPicker } from './TagColourPicker'
import { useTagState } from './useTagState'
import { useVisualViewport } from '../../lib/useVisualViewport'
import { safeAreaInsets } from '../../lib/safeArea'
import { isComposing } from '../../lib/ime'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

interface BodyProps {
  profileId: string
  tag: string
  /** The server whose chip was opened; "Remove from this server" acts on it. Absent when the editor is not tied to one. */
  serverId?: number
  liveIds?: ReadonlySet<number>
  onClose: (restoreFocus: boolean) => void
  /** The editor sits in the page (a server's Tags section) and not in a popover: it does not scroll on its own. */
  inline?: boolean
}

/**
 * What the tag editor holds: rename, colour (presets, saved custom colours, a wheel/hex/RGB picker) and "Remove from
 * this server". Used in the popover a chip opens and inline in a server's Tags section. Nothing here changes the
 * BinaryLane account, so nothing is confirmed and nothing is sent.
 */
export const TagEditorBody: React.FC<BodyProps> = ({ profileId, tag, serverId, liveIds, onClose, inline }) => {
  const { tags } = useTagState(profileId)
  const uid = useId()
  const [name, setName] = useState(tag)
  const [color, setColor] = useState<string | null>(() => colorOf(loadTagColors(profileId), tag) ?? null)
  const [colorTouched, setColorTouched] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const target = normaliseTag(name)
  const onCount = tagServerCount(tags, tag, liveIds)
  const targetCount = target && target !== tag ? tagServerCount(tags, target, liveIds) : 0
  const groups = useMemo(() => loadGroups(profileId), [profileId])
  const groupOld = groups.find((g) => g.name.toLowerCase() === tag)
  const groupNew = target && target !== tag ? groups.find((g) => g.name.toLowerCase() === target) : undefined

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = () => {
    const problem = tagNameProblem(name)
    if (problem) {
      setError(problem)
      inputRef.current?.focus()
      return
    }
    let nextTags = loadTags(profileId)
    let nextColors = loadTagColors(profileId)
    let finalTag = tag
    if (target !== tag) {
      const r = renameTag(nextTags, nextColors, tag, target)
      nextTags = r.tags
      nextColors = r.colors
      finalTag = target
    }
    // The colour is applied only when it was picked here: a plain rename keeps the colour, and a rename into a tag that
    // already has one keeps theirs.
    if (colorTouched) nextColors = withTagColor(nextColors, finalTag, color)
    if (target === tag && !colorTouched) return onClose(true)
    // Colours first, so the tags' own save does not drop a colour the new name is about to have. A rename gives the new
    // name the old tag's colour (or none); it is not a new tag, so it is not given an automatic one.
    saveTagColors(profileId, nextColors)
    saveTags(profileId, nextTags, { autoColor: false })
    onClose(true)
  }

  const removeFromServer = () => {
    if (serverId === undefined) return
    saveTags(profileId, withTag(loadTags(profileId), [serverId], tag, false))
    onClose(true)
  }

  const nameId = `${uid}-name`
  const noteId = `${uid}-note`
  return (
    <div className={`flex flex-col ${inline ? '' : 'min-h-0 flex-1'}`}>
      <div
        className={`${inline ? '' : 'min-h-0 flex-1 overflow-y-auto'} p-3 space-y-3`}
        // With a soft keyboard up there is little room: the field being typed in is scrolled into what can be seen.
        onFocusCapture={(e) => {
          const t = e.target as HTMLElement
          if (t.matches('input, [role="application"]')) window.setTimeout(() => t.scrollIntoView({ block: 'nearest' }), 250)
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-[0.8125rem]">Edit tag</span>
          <TagChip tag={target || '…'} color={color} className="max-w-[170px]" />
        </div>

        <div>
          <label htmlFor={nameId} className="block text-[#495057] dark:text-[#adb5bd] mb-1">
            Name
          </label>
          <div className="flex items-center rounded border border-[#ced4da] dark:border-[#495057] bg-[#f8f9fa] dark:bg-[#212529] focus-within:border-[#017cb6]">
            <span className="pl-2 text-fg-muted dark:text-[#adb5bd]">@</span>
            <input
              id={nameId}
              data-tag-editor-name
              ref={inputRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isComposing(e)) {
                  e.preventDefault()
                  commit()
                }
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={noteId}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              inputMode="text"
              enterKeyHint="done"
              className="w-full bg-transparent px-1.5 py-1.5 focus:outline-none"
            />
          </div>
          <div id={noteId} data-tag-editor-note className="mt-1.5 space-y-1 text-[0.6875rem] text-[#495057] dark:text-[#adb5bd]">
            {error ? (
              <p role="alert" className="text-red-700 dark:text-red-300">
                {error}
              </p>
            ) : target && target !== tag ? (
              <p>
                Renames @{tag} to @{target} on {plural(onCount, 'server', 'servers')}.
              </p>
            ) : (
              <p>Renames @{tag} on {plural(onCount, 'server', 'servers')}, not only this one.</p>
            )}
            {!error && targetCount > 0 && (
              <p className="text-amber-800 dark:text-amber-300">
                @{target} is already on {plural(targetCount, 'server', 'servers')}: the two tags are merged, and a server with both keeps one.
              </p>
            )}
            {!error && groupOld && target !== tag && (
              <p>The saved group @{tag} keeps its name and pattern; it will no longer include servers through this tag.</p>
            )}
            {!error && groupNew && <p>The saved group @{target} will also include the servers tagged @{target}.</p>}
          </div>
        </div>

        <TagColourPicker
          value={color}
          previewTag={target}
          onChange={(c) => {
            setColor(c)
            setColorTouched(true)
          }}
        />
      </div>

      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-[#ced4da] dark:border-[#495057]">
        {serverId !== undefined ? (
          <button
            type="button"
            onClick={removeFromServer}
            className="text-red-700 dark:text-red-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#017cb6] rounded"
          >
            Remove from this server
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onClose(true)}
            className="px-2.5 py-1.5 rounded border border-[#ced4da] dark:border-[#495057] hover:border-[#017cb6]"
          >
            Cancel
          </button>
          <button type="button" onClick={commit} className="px-3 py-1.5 rounded bg-[#017cb6] hover:bg-[#016594] text-white font-medium">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

interface EditorTarget {
  tag: string
  serverId?: number
  /** The chip that opened it, to place the popover and to give focus back to. */
  anchor: HTMLElement
}

interface PopoverProps extends EditorTarget {
  profileId: string
  liveIds?: ReadonlySet<number>
  onClose: (restoreFocus: boolean) => void
}

const WIDTH = 300
const GAP = 6

/**
 * The small editor a tag chip opens. Not a dialog shell (nothing here changes the BinaryLane account, so there is
 * nothing to confirm) and not a portal: it is positioned against the viewport from the chip's rectangle, so no table
 * or scroll area clips it, and it scrolls inside itself when the picker makes it taller than the window.
 */
const TagEditorPopover: React.FC<PopoverProps> = ({ profileId, tag, serverId, anchor, liveIds, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  /** Put the popover against the chip's current place in the viewport; false once the chip is gone or scrolled out of view. */
  const place = useCallback(() => {
    const panel = panelRef.current
    if (!panel || !anchor.isConnected) return false
    const a = anchor.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    if (a.bottom < 0 || a.top > vh) return false
    const h = panel.offsetHeight
    const width = Math.min(WIDTH, vw - 16)
    const left = Math.max(8, Math.min(a.left, vw - width - 8))
    // Never under the status bar or the gesture bar on a phone: the screen's safe area is kept clear.
    const inset = safeAreaInsets()
    const lowest = Math.max(8, inset.top + 4)
    let top = a.bottom + GAP
    if (top + h > vh - 8 - inset.bottom) top = a.top - GAP - h
    setPos({ top: Math.max(lowest, Math.min(top, vh - 8 - inset.bottom - h)), left })
    return true
  }, [anchor])
  useLayoutEffect(() => {
    place()
    // The picker, a note or an error can make the popover taller: keep it inside the window.
    const panel = panelRef.current
    if (!panel || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => place())
    ro.observe(panel)
    return () => ro.disconnect()
  }, [place])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(false)
    }
    const onKey = (e: KeyboardEvent) => {
      // Not while a dialog, the palette or the drawer sits above it (it is inert then): that layer's Escape comes first.
      if (e.key === 'Escape' && !panelRef.current?.closest('[inert]')) {
        e.stopPropagation()
        onClose(true)
      }
    }
    // The popover is placed against the viewport, so it follows the chip when the page scrolls or the window or zoom
    // changes, and goes when the chip does.
    const onMove = (e: Event) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return
      if (!place()) onClose(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [anchor, onClose, place])

  return (
    <div
      ref={panelRef}
      role="dialog"
      // Escape closes it, so the app's Back (which sends Escape to a dismissible dialog) closes it too.
      data-dismissible="true"
      aria-label={`Edit tag @${tag}`}
      // Nothing here is the row's click, context menu or key.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, width: Math.min(WIDTH, document.documentElement.clientWidth - 16), maxHeight: 'calc(100vh - max(0.5rem, env(safe-area-inset-top, 0px) + 0.25rem) - 0.5rem - env(safe-area-inset-bottom, 0px))', opacity: pos ? 1 : 0 }}
      className="!m-0 z-50 flex flex-col rounded-lg border border-[#ced4da] dark:border-[#495057] bg-white dark:bg-[#2b3035] text-[#212529] dark:text-[#f8f9fa] shadow-xl text-xs cursor-default"
    >
      <TagEditorBody profileId={profileId} tag={tag} serverId={serverId} liveIds={liveIds} onClose={onClose} />
    </div>
  )
}

interface SheetProps {
  profileId: string
  tag: string
  serverId?: number
  liveIds?: ReadonlySet<number>
  onClose: (restoreFocus: boolean) => void
}

/**
 * The editor on a phone, in a server's Tags section: a panel pinned inside what can be seen (the visual viewport, so
 * a soft keyboard shrinks it rather than covering it), with the form scrolling inside it and Save and Cancel fixed at
 * its foot. It does not depend on where the page has been scrolled to or on the header and the bottom bar.
 */
export const TagEditorSheet: React.FC<SheetProps> = ({ profileId, tag, serverId, liveIds, onClose }) => {
  const vv = useVisualViewport()
  const sheetRef = useRef<HTMLDivElement>(null)
  // Escape closes it wherever focus is (a keyboard on a tablet, or after a control inside it has gone).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while a dialog, the palette or the drawer sits above it (it is inert then): that layer's Escape comes first.
      if (e.key === 'Escape' && !sheetRef.current?.closest('[inert]')) {
        e.stopPropagation()
        onClose(true)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div
      ref={sheetRef}
      role="dialog"
      data-dismissible="true"
      aria-label={`Edit tag @${tag}`}
      data-tag-editor-sheet
      style={{
        position: 'fixed',
        // below the status bar (the top inset, kept clear even if the page is edge to edge)
        top: `calc(${vv.top}px + max(0.5rem, env(safe-area-inset-top, 0px)) + 0.25rem)`,
        left: 8,
        right: 8,
        // what is left of the visible screen after the top inset, the bottom bar (its measured height, inset included) and the gaps
        maxHeight: `max(10rem, calc(${vv.height}px - max(0.5rem, env(safe-area-inset-top, 0px)) - 0.25rem - var(--bottom-nav-h) - 0.5rem))`
      }}
      className="!m-0 z-50 flex flex-col rounded-lg border border-[#ced4da] dark:border-[#495057] bg-white dark:bg-[#2b3035] text-[#212529] dark:text-[#f8f9fa] shadow-xl text-xs"
    >
      <TagEditorBody profileId={profileId} tag={tag} serverId={serverId} liveIds={liveIds} onClose={onClose} />
    </div>
  )
}

/**
 * State for a page that hosts tag chips: `open` is what a chip's `onEdit` calls, and `element` is the editor to
 * render once, outside any scrolling table.
 */
export function useTagEditor(profileId: string | undefined, servers: ReadonlyArray<{ id: number }> | undefined) {
  const [target, setTarget] = useState<EditorTarget | null>(null)
  const liveIds = useMemo(() => (servers ? new Set(servers.map((s) => s.id)) : undefined), [servers])
  const open = useCallback((tag: string, anchor: HTMLElement, serverId?: number) => setTarget({ tag, anchor, serverId }), [])
  const current = useRef<EditorTarget | null>(null)
  current.current = target
  const close = useCallback((restoreFocus: boolean) => {
    const t = current.current
    setTarget(null)
    // Back to the chip that opened it, so keyboard use carries on from where it was (a renamed chip is a new element).
    if (t && restoreFocus) setTimeout(() => t.anchor.isConnected && t.anchor.focus(), 0)
  }, [])
  const element =
    target && profileId ? (
      <TagEditorPopover key={`${target.tag}-${target.serverId ?? ''}`} profileId={profileId} liveIds={liveIds} {...target} onClose={close} />
    ) : null
  return { open, element }
}
