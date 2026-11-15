import React, { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Trash2, Undo2 } from 'lucide-react'
import { dropGapAt, dropIndexAt, edgePull, edgeScrollSpeed, isEdited, moveRow, problemsOf, ROW_HOLD_MS, shownProblems, type DraftRow, type RowProblems } from '../../lib/firewallDraft'
import { PORT_CHOICES, withChoice, type PickChoice } from '../../lib/firewallPicks'
import { PickMenu } from './PickMenu'
import { HOLD_TICK_VIBRATION_MS, holdMovedTooFar } from '../../lib/tags'

interface FirewallRulesEditorProps {
  rows: DraftRow[]
  /** Whether the cells, the move controls and the remove button work. The rows are still shown when they do not. */
  editable: boolean
  /** What the magnifier under a source or destination offers: this server's addresses and the account's other servers'. */
  addressChoices: readonly PickChoice[]
  onChange: (rows: DraftRow[]) => void
}

const cell =
  'w-full px-2 py-1.5 bg-white dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-xs text-[#212529] dark:text-white focus:outline-none focus:border-[#017cb6] disabled:opacity-60 select-text'
const mono = 'font-mono'

/** Whether an event began on something you type in, choose from or press: those keep their own behaviour and never start a drag. */
const isControl = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, select, button, option, a')

// The same columns for the header and every row, from the xl breakpoint; below it a rule is a card with labelled fields.
const COLUMNS = 'xl:grid-cols-[4.75rem_minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,0.9fr)_5.25rem_5.75rem_minmax(0,1.2fr)_5.5rem]'

/** The nearest ancestor that scrolls. */
const scrollerOf = (el: HTMLElement | null): HTMLElement | null => {
  let s = el
  while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement
  return s
}

/**
 * The part of a scrolling list that can be seen: its own box within the window, less anything fixed over it. A phone's bottom
 * navigation bar covers the lower part of the page, so the edge where a carried rule scrolls the list is where the list is last
 * visible, not where its box ends. Found by looking at what is on top, a little at a time, from each end.
 */
function visibleBand(scroller: HTMLElement): { top: number; bottom: number } {
  const r = scroller.getBoundingClientRect()
  let top = Math.max(r.top, 0)
  let bottom = Math.min(r.bottom, window.innerHeight)
  const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2))
  for (let y = bottom - 1; y > top + 40; y -= 6) {
    const e = document.elementFromPoint(x, y)
    if (e && scroller.contains(e)) {
      bottom = y + 1
      break
    }
  }
  for (let y = top + 1; y < bottom - 40; y += 6) {
    const e = document.elementFromPoint(x, y)
    if (e && scroller.contains(e)) {
      top = y
      break
    }
  }
  return { top, bottom }
}

/** How many lines a cell shows: a line to a value, from one to six. */
export const lines = (text: string) => Math.min(6, Math.max(1, text.split('\n').length))

/**
 * A server's firewall rules as a table of editable rows. It holds nothing and writes nothing: the rows come in, a changed
 * list goes out (`onChange`), and whoever owns the rows decides when anything is saved.
 */
export const FirewallRulesEditor: React.FC<FirewallRulesEditorProps> = ({ rows, editable, addressChoices, onChange }) => {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  // A rule lifted by a held finger, as opposed to dragged by a mouse.
  const [touchLifted, setTouchLifted] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const rowEls = useRef<Array<HTMLDivElement | null>>([])
  const pointerKind = useRef('mouse')
  const touch = useRef<{ from: number; x: number; y: number; now: number; timer: number | null; lifted: boolean; moved: boolean; band: { top: number; bottom: number } | null } | null>(null)
  // When a carried rule entered the zone at one end of the list, and the last frame, for a scroll speed that grows with the time it is held there.
  const edge = useRef({ dir: 0, since: 0, last: 0 })
  const removeListeners = useRef<(() => void) | null>(null)
  const scrollFrame = useRef(0)
  // The newest rows and callback, for the gesture's listeners, which outlive the render that made them.
  const latest = useRef({ rows, onChange })
  latest.current = { rows, onChange }
  const uid = useId()
  // The field being typed in. Its problem is shown once it is left, and said then, once, in one polite announcement for the list.
  const [typing, setTyping] = useState<{ key: number; field: keyof RowProblems } | null>(null)
  const [said, setSaid] = useState('')
  const sayTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(sayTimer.current), [])
  const typed = (row: DraftRow, field: keyof RowProblems) => {
    window.clearTimeout(sayTimer.current)
    setSaid('')
    if (typing?.key !== row.key || typing.field !== field) setTyping({ key: row.key, field })
  }
  const left = (row: DraftRow, field: keyof RowProblems, name: string) => {
    if (typing?.key !== row.key || typing.field !== field) return
    setTyping(null)
    const problem = problemsOf(row)[field]
    // A moment later, so it does not talk over the field that focus moved to.
    if (problem) sayTimer.current = window.setTimeout(() => setSaid(`${name}: ${problem}`), 500)
  }

  // The middle of every row now in the list, read from the page itself. A list kept in a ref grows with the rows and keeps its length when
  // some go, so after a rule was removed and saved the places that no longer held a row counted as a row at the top of the page.
  const middles = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-rule-row]') ?? []).map((el) => {
      const r = el.getBoundingClientRect()
      return r.top + r.height / 2
    })
  const endTouch = () => {
    const t = touch.current
    if (t?.timer != null) window.clearTimeout(t.timer)
    touch.current = null
    removeListeners.current?.()
    removeListeners.current = null
    cancelAnimationFrame(scrollFrame.current)
    setTouchLifted(false)
    setDragFrom(null)
    setDragOver(null)
  }
  // While a rule is carried, the list scrolls when it is near the top or bottom of the part that can be seen, faster the longer it is held
  // there, and the place it would land follows the finger. Not before the finger has moved: a rule held down low on the screen must not start
  // scrolling by itself.
  const followFinger = (time: number) => {
    const t = touch.current
    if (!t || !t.lifted) return
    const e = edge.current
    const dt = e.last ? Math.min(64, time - e.last) : 16 // a hitch in the frames is not a leap in the list
    e.last = time
    const scroller = scrollerOf(rowEls.current[t.from])
    if (scroller && t.moved && t.band) {
      const { dir, depth } = edgePull(t.now, t.band.top, t.band.bottom)
      if (dir !== e.dir) {
        e.dir = dir
        e.since = time // the clock starts when the finger enters a zone, and starts again if it crosses to the other end
      }
      if (dir !== 0) scroller.scrollTop += dir * edgeScrollSpeed((time - e.since) / 1000, depth) * (dt / 1000)
    }
    setDragOver(dropIndexAt(t.now, middles(), t.from))
    scrollFrame.current = requestAnimationFrame(followFinger)
  }
  /**
   * A finger on a rule, anywhere but its fields and buttons. The rule lifts only if the finger stays where it went down for ROW_HOLD_MS: a finger that moves
   * first is scrolling the page, and a rule must never be reordered by a scroll. Once lifted, the page stops scrolling under
   * the finger, the handle buzzes, the place the rule would land is shown, and letting go puts it there. A mouse drags natively.
   */
  const startTouch = (e: React.PointerEvent, from: number) => {
    pointerKind.current = e.pointerType
    if (e.pointerType === 'mouse' || !editable || rows[from]?.removed || isControl(e.target)) return
    endTouch()
    const t = { from, x: e.clientX, y: e.clientY, now: e.clientY, timer: null as number | null, lifted: false, moved: false, band: null as { top: number; bottom: number } | null }
    touch.current = t
    t.timer = window.setTimeout(() => {
      t.timer = null
      t.lifted = true
      setTouchLifted(true)
      setDragFrom(from)
      setDragOver(from)
      try {
        navigator.vibrate?.(HOLD_TICK_VIBRATION_MS)
      } catch {
        /* no vibration on this device */
      }
      const scroller = scrollerOf(rowEls.current[from])
      t.band = scroller ? visibleBand(scroller) : null
      edge.current = { dir: 0, since: 0, last: 0 }
      scrollFrame.current = requestAnimationFrame(followFinger)
    }, ROW_HOLD_MS)
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      t.now = ev.clientY
      if (!t.lifted && holdMovedTooFar(ev.clientX - t.x, ev.clientY - t.y)) endTouch()
      else if (t.lifted && holdMovedTooFar(ev.clientX - t.x, ev.clientY - t.y)) t.moved = true
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      const to = t.lifted ? dropIndexAt(ev.clientY, middles(), from) : from
      const wasLifted = t.lifted
      endTouch()
      if (wasLifted && to !== from) latest.current.onChange(moveRow(latest.current.rows, from, to))
    }
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === e.pointerId) endTouch()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    removeListeners.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }

  // The page must not scroll under a finger that has lifted a rule. A touchmove can only be cancelled by a listener that is not
  // passive, so this one is added by hand (React's are passive) and does nothing unless a rule is lifted.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const hold = (e: TouchEvent) => {
      if (touch.current?.lifted && e.cancelable) e.preventDefault()
    }
    el.addEventListener('touchmove', hold, { passive: false })
    return () => el.removeEventListener('touchmove', hold)
  }, [])
  useEffect(() => () => endTouch(), [])

  const patch = (index: number, changes: Partial<DraftRow>) => onChange(rows.map((r, i) => (i === index ? { ...r, ...changes } : r)))
  const move = (from: number, to: number) => onChange(moveRow(rows, from, to))
  // The rules that stay are numbered in the order they are evaluated; a removed one has no place in it.
  let position = 0
  const numbers = rows.map((r) => (r.removed ? null : ++position))

  // Where the dragged rule would go, as the space between rules it would go into: before row `open`, or after the last when it is rows.length.
  const open = dragFrom === null || dragOver === null ? null : dropGapAt(dragOver, dragFrom)
  // The space between two rules is 8px, none above the first or below the last. The one the rule would go into opens to 28px and carries
  // a bar, so the rules part around it, and where it will land can be seen before it is let go.
  const gap = (g: number) => (
    <div
      key={`gap-${g}`}
      aria-hidden="true"
      data-drop-gap={open === g ? g : undefined}
      className="relative transition-[height] duration-150 ease-out"
      style={{ height: open === g ? 28 : g === 0 || g === rows.length ? 0 : 8 }}
    >
      {open === g && <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-[#017cb6]" />}
    </div>
  )

  return (
    <div ref={listRef}>
      <div
        aria-hidden="true"
        className={`hidden xl:grid ${COLUMNS} gap-x-3 px-3 mb-2 text-[0.625rem] font-bold uppercase tracking-wider text-fg-muted dark:text-slate-400`}
      >
        <span>#</span>
        <span>Source</span>
        <span>Destination</span>
        <span>Destination ports</span>
        <span>Protocol</span>
        <span>Action</span>
        <span>Description</span>
        <span />
      </div>

      {rows.map((row, i) => {
        const edited = isEdited(row)
        const problems: RowProblems = shownProblems(problemsOf(row), typing?.key === row.key ? typing.field : undefined)
        const problemId = (field: keyof RowProblems) => `${uid}-${row.key}-${field}`
        // A field with a problem shown is marked invalid and described by it.
        const invalid = (field: keyof RowProblems) => ({
          'aria-invalid': !!problems[field],
          'aria-describedby': problems[field] ? problemId(field) : undefined
        })
        const n = numbers[i]
        const label = n === null ? `Removed rule ${row.key + 1}` : `Rule ${n}`
        const off = !editable || row.removed
        const tone = row.removed
          ? 'border-dashed border-[#ced4da] dark:border-[#373b3e] opacity-60'
          : edited
            ? 'border-amber-400 dark:border-amber-600 bg-amber-50/40 dark:bg-amber-950/20'
            : 'border-[#ced4da] dark:border-[#373b3e]'
        return (
          <React.Fragment key={row.key}>
            {gap(i)}
          <div
            data-rule-row
            ref={(el) => {
              rowEls.current[i] = el
            }}
            onPointerDown={(e) => startTouch(e, i)}
            onMouseDown={(e) => {
              // A draggable row would take over selecting text in a field, so the row is made draggable only while the mouse
              // is down outside its fields, dropdowns and buttons.
              e.currentTarget.draggable = pointerKind.current === 'mouse' && e.button === 0 && editable && !row.removed && !isControl(e.target)
            }}
            onContextMenu={(e) => {
              if (pointerKind.current !== 'mouse' && !isControl(e.target)) e.preventDefault()
            }}
            onDragStart={(e) => {
              // A text selection being dragged out of a field is not the rule being dragged.
              if (e.target !== e.currentTarget) return
              // A held finger is handled by startTouch; the browser's own touch drag must not start as well.
              if (pointerKind.current !== 'mouse') {
                e.preventDefault()
                return
              }
              setDragFrom(i)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', String(i))
              e.dataTransfer.setDragImage(e.currentTarget, 16, 16)
              // The same edge scrolling as a held finger gets: a mouse drag past the end of the window is no use on a long list.
              const scroller = scrollerOf(e.currentTarget)
              touch.current = { from: i, x: e.clientX, y: e.clientY, now: e.clientY, timer: null, lifted: true, moved: true, band: scroller ? visibleBand(scroller) : null }
              edge.current = { dir: 0, since: 0, last: 0 }
              scrollFrame.current = requestAnimationFrame(followFinger)
              // The whole scrolling area takes the drag, not only the list: let go over the space below the last rule, or above the first, and
              // the rule goes there. A drop only happens where both dragenter and dragover were accepted, and the element under the pointer
              // changes as the space between rules opens, so both are. It is placed by where the pointer is, never by which rule it is over.
              if (scroller) {
                const enter = (ev: DragEvent) => ev.preventDefault()
                const over = (ev: DragEvent) => {
                  ev.preventDefault()
                  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
                  if (touch.current) touch.current.now = ev.clientY
                  const to = dropIndexAt(ev.clientY, middles(), i)
                  setDragOver((was) => (was === to ? was : to))
                }
                const drop = (ev: DragEvent) => {
                  ev.preventDefault()
                  const to = dropIndexAt(ev.clientY, middles(), i)
                  endTouch()
                  if (to !== i) latest.current.onChange(moveRow(latest.current.rows, i, to))
                }
                scroller.addEventListener('dragenter', enter)
                scroller.addEventListener('dragover', over)
                scroller.addEventListener('drop', drop)
                removeListeners.current = () => {
                  scroller.removeEventListener('dragenter', enter)
                  scroller.removeEventListener('dragover', over)
                  scroller.removeEventListener('drop', drop)
                }
              }
            }}
            onDragEnd={(e) => {
              e.currentTarget.draggable = false
              endTouch()
            }}
            className={`p-3 rounded-lg border bg-[#f8f9fa] dark:bg-[#212529] grid grid-cols-2 sm:grid-cols-6 ${COLUMNS} gap-x-3 gap-y-2 xl:items-start ${tone} ${
              dragFrom === i ? (touchLifted ? 'shadow-lg opacity-90' : 'opacity-50') : ''
            } ${
              off ? '' : 'cursor-grab active:cursor-grabbing'
            }`}
          >
            {/* Place in the list, and the arrows */}
            <div className="col-span-2 sm:col-span-6 xl:col-span-1 flex items-center gap-1.5 xl:pt-1.5">
              <span className="shrink-0 flex items-center gap-1.5 select-none text-fg-muted [@media(pointer:coarse)]:py-2 [@media(pointer:coarse)]:pr-1">
                <span aria-hidden="true" className="xl:hidden text-[0.6875rem] text-fg-muted dark:text-slate-400">
                  Rule
                </span>
                <span className={`font-mono text-xs font-bold text-[#495057] dark:text-slate-300 w-5 text-center ${row.removed ? 'line-through' : ''}`}>
                  {n ?? '–'}
                </span>
              </span>
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={off || i === 0}
                  aria-label={`Move ${label.toLowerCase()} up`}
                  title="Move Rule Up"
                  className="text-fg-muted hover:text-fg-link disabled:opacity-20 transition"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={off || i === rows.length - 1}
                  aria-label={`Move ${label.toLowerCase()} down`}
                  title="Move Rule Down"
                  className="text-fg-muted hover:text-fg-link disabled:opacity-20 transition"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <Field caption="Source" className="col-span-2 sm:col-span-2 xl:col-span-1" problem={problems.sources} problemId={problemId('sources')}>
              <textarea
                aria-label={`${label} source addresses`}
                {...invalid('sources')}
                rows={lines(row.sources)}
                value={row.sources}
                disabled={off}
                placeholder="0.0.0.0/0"
                spellCheck={false}
                onChange={(e) => {
                  typed(row, 'sources')
                  patch(i, { sources: e.target.value })
                }}
                onBlur={() => left(row, 'sources', `${label} source addresses`)}
                className={`${cell} ${mono} resize-none`}
              />
              <PickMenu label={`${label.toLowerCase()} source addresses`} choices={addressChoices} disabled={off} onPick={(c) => patch(i, { sources: withChoice(row.sources, c.values) })} />
            </Field>

            <Field caption="Destination" className="col-span-2 sm:col-span-2 xl:col-span-1" problem={problems.destinations} problemId={problemId('destinations')}>
              <textarea
                aria-label={`${label} destination addresses`}
                {...invalid('destinations')}
                rows={lines(row.destinations)}
                value={row.destinations}
                disabled={off}
                placeholder="0.0.0.0/0"
                spellCheck={false}
                onChange={(e) => {
                  typed(row, 'destinations')
                  patch(i, { destinations: e.target.value })
                }}
                onBlur={() => left(row, 'destinations', `${label} destination addresses`)}
                className={`${cell} ${mono} resize-none`}
              />
              <PickMenu label={`${label.toLowerCase()} destination addresses`} choices={addressChoices} disabled={off} onPick={(c) => patch(i, { destinations: withChoice(row.destinations, c.values) })} />
            </Field>

            <Field caption="Destination ports" short="Dest. ports" className="col-span-2 sm:col-span-2 xl:col-span-1" problem={problems.ports} problemId={problemId('ports')}>
              <textarea
                aria-label={`${label} destination ports`}
                {...invalid('ports')}
                rows={lines(row.ports)}
                value={row.ports}
                disabled={off || row.protocol === 'icmp'}
                placeholder={row.protocol === 'icmp' ? 'No ports' : 'All ports'}
                spellCheck={false}
                onChange={(e) => {
                  typed(row, 'ports')
                  patch(i, { ports: e.target.value })
                }}
                onBlur={() => left(row, 'ports', `${label} destination ports`)}
                className={`${cell} ${mono} resize-none`}
              />
              <PickMenu label={`${label.toLowerCase()} destination ports`} choices={PORT_CHOICES} disabled={off || row.protocol === 'icmp'} onPick={(c) => patch(i, { ports: withChoice(row.ports, c.values) })} />
            </Field>

            <Field caption="Protocol" className="col-span-2 sm:col-span-2 xl:col-span-1">
              <select
                aria-label={`${label} protocol`}
                value={row.protocol}
                disabled={off}
                // ICMP has no ports, so they are cleared with the switch rather than left behind unseen.
                onChange={(e) => patch(i, { protocol: e.target.value as DraftRow['protocol'], ...(e.target.value === 'icmp' ? { ports: '' } : {}) })}
                className={`${cell} uppercase`}
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP</option>
                <option value="all">ALL</option>
              </select>
            </Field>

            <Field caption="Action" className="col-span-2 sm:col-span-2 xl:col-span-1">
              <select
                aria-label={`${label} action`}
                value={row.action}
                disabled={off}
                onChange={(e) => patch(i, { action: e.target.value as DraftRow['action'] })}
                className={`${cell} font-semibold ${row.action === 'accept' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}
              >
                <option value="accept">Accept</option>
                <option value="drop">Drop</option>
              </select>
            </Field>

            <Field caption="Description" className="col-span-2 sm:col-span-2 xl:col-span-1" problem={problems.description} problemId={problemId('description')}>
              <input
                type="text"
                aria-label={`${label} description`}
                {...invalid('description')}
                value={row.description}
                disabled={off}
                placeholder="Description"
                onChange={(e) => {
                  typed(row, 'description')
                  patch(i, { description: e.target.value })
                }}
                onBlur={() => left(row, 'description', `${label} description`)}
                className={cell}
              />
            </Field>

            <div className="col-span-2 sm:col-span-6 xl:col-span-1 flex items-center max-sm:justify-start justify-end gap-2 xl:flex-col xl:items-end xl:gap-1 xl:pt-0.5">
              {row.removed && <span className="text-[0.625rem] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Removed</span>}
              {edited && !row.removed && <span className="text-[0.625rem] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Edited</span>}
              {row.removed ? (
                <button
                  type="button"
                  onClick={() => patch(i, { removed: false })}
                  disabled={!editable}
                  aria-label={`Put ${label.toLowerCase()} back`}
                  title="Put this rule back"
                  className="flex items-center gap-1 px-2 py-1 text-[0.6875rem] font-medium text-fg-link hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded transition disabled:opacity-30"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>Undo</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => patch(i, { removed: true })}
                  disabled={!editable}
                  aria-label={`Remove ${label.toLowerCase()}`}
                  title="Remove Rule"
                  className="p-1.5 text-fg-muted hover:text-rose-500 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition disabled:opacity-30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          </React.Fragment>
        )
      })}
      {gap(rows.length)}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  )
}

/**
 * A cell with its caption. On a phone the caption sits to the left of the cell, one field to a line; from sm it sits above it; from the
 * xl breakpoint the header row names the column and the caption is not shown.
 */
const Field: React.FC<{ caption: string; short?: string; className?: string; problem?: string; problemId?: string; children: React.ReactNode }> = ({ caption, short, className, problem, problemId, children }) => (
  <div className={`min-w-0 max-sm:grid max-sm:grid-cols-[7.25rem_minmax(0,1fr)] max-sm:gap-x-3 ${className ?? ''}`}>
    <span aria-hidden="true" className="xl:hidden block select-none mb-1 max-sm:mb-0 max-sm:pt-2 text-[0.625rem] max-sm:text-[0.6875rem] font-bold uppercase tracking-wider text-fg-muted dark:text-slate-400">
      {short ? (
        <>
          <span className="sm:hidden">{short}</span>
          <span className="max-sm:hidden">{caption}</span>
        </>
      ) : (
        caption
      )}
    </span>
    <div className="min-w-0">
      {children}
      {problem && (
        <p id={problemId} className="mt-1 text-[0.6875rem] text-rose-600 dark:text-rose-400 break-words">
          {problem}
        </p>
      )}
    </div>
  </div>
)
