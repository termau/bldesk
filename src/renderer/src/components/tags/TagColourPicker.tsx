import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import {
  HOLD_DELETE_MS,
  HOLD_TICKS_MS,
  MAX_CUSTOM_COLOURS,
  TAG_COLOR_KEYS,
  addCustomColour,
  canonicalColor,
  colorHex,
  hexProblem,
  hexToRgb,
  holdMovedTooFar,
  holdTimeline,
  hsvToRgb,
  isTagColorKey,
  normaliseHex,
  removeCustomColour,
  rgbToHex,
  rgbToHsv,
  type TagColorKey
} from '../../lib/tags'
import { GROUPS_EVENT, loadCustomColours, saveCustomColours } from '../../lib/serverGroups'
import { usePhoneLayout } from '../../lib/usePhoneLayout'
import { vibrate } from '../../lib/haptics'
import { TAG_STYLES, TagChip } from './TagChip'

const WHEEL_BACKGROUND =
  'radial-gradient(closest-side, #ffffff, rgba(255,255,255,0)), conic-gradient(#ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'

/** The saved custom colours, read again whenever they change anywhere. */
function useCustomColours(): string[] {
  const [list, setList] = useState<string[]>(() => loadCustomColours())
  useEffect(() => {
    const read = () => setList(loadCustomColours())
    window.addEventListener(GROUPS_EVENT, read)
    return () => window.removeEventListener(GROUPS_EVENT, read)
  }, [])
  return list
}

const HOLD_RING_RADIUS = 16
const HOLD_RING_LENGTH = 2 * Math.PI * HOLD_RING_RADIUS

interface SwatchProps {
  colour: string
  selected: boolean
  /** Phone layout: the colour is removed by pressing and holding it, and there is no cross on it. */
  hold: boolean
  className: string
  onSelect: () => void
  onRemove: () => void
}

/**
 * A saved custom colour. A tap selects it. On a phone, pressing and holding it removes it: a ring fills around it
 * while the finger is down, and lifting the finger early, or moving it more than a few pixels, cancels with nothing
 * removed. The device is also asked for three short vibrations and then one longer one when it goes (holdTimeline in
 * lib/tags.ts has the times); the Android app asks for the vibrate permission in its manifest, and where the device
 * cannot vibrate (desktop) the request does nothing. Delete or Backspace on the focused colour removes it from a keyboard.
 */
const SavedSwatch: React.FC<SwatchProps> = ({ colour, selected, hold, className, onSelect, onRemove }) => {
  const [holding, setHolding] = useState(false)
  const timers = useRef<number[]>([])
  const down = useRef<{ x: number; y: number; at: number } | null>(null)
  const suppressClick = useRef(false)
  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    down.current = null
    setHolding(false)
  }, [])
  useEffect(() => stop, [stop])
  // A hold that was let go of early is not a tap either: it selects nothing.
  const cancel = () => {
    if (down.current && Date.now() - down.current.at >= HOLD_TICKS_MS[0]) suppressClick.current = true
    stop()
  }
  const begin = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!hold || (e.pointerType === 'mouse' && e.button !== 0)) return
    suppressClick.current = false
    down.current = { x: e.clientX, y: e.clientY, at: Date.now() }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // not capturable here: the move check still works while the pointer is over it
    }
    setHolding(true)
    for (const step of holdTimeline()) {
      timers.current.push(
        window.setTimeout(() => {
          vibrate(step.vibrate)
          if (step.kind === 'delete') {
            suppressClick.current = true
            stop()
            onRemove()
          }
        }, step.at)
      )
    }
  }
  return (
    <li className="relative">
      <button
        type="button"
        title={hold ? `${colour}, press and hold to remove` : colour}
        aria-label={hold ? `Saved colour ${colour}, press and hold to remove` : `Use saved colour ${colour}`}
        aria-pressed={selected}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false
            return
          }
          onSelect()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            onRemove()
          }
        }}
        onPointerDown={begin}
        onPointerMove={(e) => {
          const d = down.current
          if (d && holdMovedTooFar(e.clientX - d.x, e.clientY - d.y)) cancel()
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onContextMenu={hold ? (e) => e.preventDefault() : undefined}
        style={{ backgroundColor: colour, ...(hold ? { touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } : null) } as React.CSSProperties}
        className={className}
      >
        {selected && <Check className="w-3.5 h-3.5 drop-shadow" />}
      </button>
      {holding && (
        <svg aria-hidden="true" viewBox="0 0 36 36" className="pointer-events-none absolute -inset-1.5 w-9 h-9 -rotate-90">
          <circle cx="18" cy="18" r={HOLD_RING_RADIUS} fill="none" stroke="currentColor" strokeWidth="3" className="text-black/10 dark:text-white/15" />
          <circle cx="18" cy="18" r={HOLD_RING_RADIUS} fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeDasharray={HOLD_RING_LENGTH} strokeDashoffset={HOLD_RING_LENGTH}>
            <animate attributeName="stroke-dashoffset" from={HOLD_RING_LENGTH} to="0" dur={`${HOLD_DELETE_MS}ms`} fill="freeze" />
          </circle>
        </svg>
      )}
      {!hold && (
        <button
          type="button"
          title={`Remove saved colour ${colour}`}
          aria-label={`Remove saved colour ${colour}`}
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white dark:bg-[#212529] border border-[#ced4da] dark:border-[#495057] text-[#495057] dark:text-[#ced4da] flex items-center justify-center hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#017cb6]"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </li>
  )
}

interface Props {
  /** The tag's colour now: a preset key, a custom `#rrggbb`, or null for the default look. */
  value: string | null
  onChange: (value: string | null) => void
  /** The tag's name, for the preview chip. */
  previewTag: string
}

const swatchRing = 'ring-2 ring-offset-1 ring-[#212529] dark:ring-white dark:ring-offset-[#2b3035]'
const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#017cb6] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-[#2b3035]'

/**
 * Choosing a tag's colour: the eight presets and Default, the colours saved earlier (at most eight, kept for the whole
 * app), and a custom colour made with a wheel and brightness slider, a hex field or three RGB fields. The wheel is
 * never the only way in. The hex and RGB fields are plain text and number inputs so they work wherever the wheel's
 * pointer handling does not (a phone, a keyboard).
 */
export const TagColourPicker: React.FC<Props> = ({ value, onChange, previewTag }) => {
  const saved = useCustomColours()
  // Ids that tie a label to its field are made per picker, not written out, so two pickers on a page cannot share them.
  const uid = useId()
  const ids = { colourLabel: `${uid}-colour-label`, customLabel: `${uid}-custom-label`, hex: `${uid}-hex`, hexNote: `${uid}-hex-note`, brightness: `${uid}-brightness` }
  // On a phone every control is a fingertip target of at least 36 px: the circles stay small and the tappable area
  // grows around them, and the saved colours get a Remove button of their own instead of a cross on the circle's corner.
  const phone = usePhoneLayout()
  const hit = phone ? "relative after:absolute after:-inset-1.5 after:content-['']" : ''
  const hitBordered = phone ? "relative after:absolute after:-inset-[7px] after:content-['']" : ''
  /** The colour as a hex, whether it is one of the presets or a custom colour: what the wheel and the hex field show. */
  const resolved = value ? colorHex(value) : null
  // Always starts collapsed: the editor is rebuilt every time it opens, and a tag that already has a custom colour is
  // not a reason to open the picker.
  const [open, setOpen] = useState(false)
  /** The colour a click on Save has asked to overwrite the oldest saved colour for, until it is confirmed or anything else happens. */
  const [pending, setPending] = useState<string | null>(null)
  const [warning, setWarning] = useState('')
  const clearPending = useCallback(() => {
    setPending(null)
    setWarning('')
  }, [])
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(hexToRgb((value && colorHex(value)) || '#2563eb')!))
  // A preset's own hex is shown as the field's text, so the field is never empty for a colour that has a value.
  const [hexText, setHexText] = useState(() => resolved ?? '')
  const [message, setMessage] = useState('')
  const wheel = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const rgb = hsvToRgb(hsv[0], hsv[1], hsv[2])
  const hex = rgbToHex(rgb)

  // A colour chosen elsewhere (a preset, a saved swatch) moves the wheel and the hex field to it.
  useEffect(() => {
    if (resolved && resolved !== hex) {
      setHsv((cur) => {
        const next = rgbToHsv(hexToRgb(resolved)!)
        // An achromatic colour has no hue of its own: keep the one the wheel had.
        return next[1] === 0 || next[2] === 0 ? [cur[0], next[1], next[2]] : next
      })
      setHexText(resolved)
    }
    clearPending()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved])

  const use = useCallback(
    (next: [number, number, number]) => {
      setHsv(next)
      const h = rgbToHex(hsvToRgb(next[0], next[1], next[2]))
      setHexText(h)
      setMessage('')
      clearPending()
      onChange(h)
    },
    [onChange, clearPending]
  )

  const fromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = wheel.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    const radius = r.width / 2
    const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    use([angle, Math.min(Math.hypot(dx, dy) / radius, 1), hsv[2] === 0 ? 1 : hsv[2]])
  }

  const onWheelKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 5
    if (e.key === 'ArrowLeft') use([(hsv[0] - step + 360) % 360, hsv[1], hsv[2]])
    else if (e.key === 'ArrowRight') use([(hsv[0] + step) % 360, hsv[1], hsv[2]])
    else if (e.key === 'ArrowUp') use([hsv[0], Math.min(1, hsv[1] + step / 100), hsv[2]])
    else if (e.key === 'ArrowDown') use([hsv[0], Math.max(0, hsv[1] - step / 100), hsv[2]])
    else return
    e.preventDefault()
  }

  const onHexInput = (text: string) => {
    setHexText(text)
    clearPending()
    const h = normaliseHex(text)
    if (!h) return
    const next = rgbToHsv(hexToRgb(h)!)
    setHsv(next[1] === 0 || next[2] === 0 ? [hsv[0], next[1], next[2]] : next)
    setMessage('')
    onChange(h)
  }

  const onRgbInput = (index: 0 | 1 | 2, text: string) => {
    const n = Math.max(0, Math.min(255, Math.round(Number(text) || 0)))
    const next = [...rgb] as [number, number, number]
    next[index] = n
    const h = rgbToHsv(next)
    use(h[1] === 0 || h[2] === 0 ? [hsv[0], h[1], h[2]] : h)
  }

  // At eight, the first click on Save asks; a second click on it, with nothing else done in between, replaces the oldest.
  const save = () => {
    const r = addCustomColour(saved, hex, pending === hex)
    if (r.status === 'added' || r.status === 'replaced') saveCustomColours(r.list)
    if (r.status === 'full') {
      setPending(hex)
      setWarning(r.message)
      setMessage('')
    } else {
      clearPending()
      setMessage(r.message)
    }
  }

  const problem = hexText ? hexProblem(hexText) : null
  const current = value ? canonicalColor(value) : null
  const fullHue = rgbToHex(hsvToRgb(hsv[0], hsv[1], 1))

  return (
    <div className="space-y-2.5">
      <div id={ids.colourLabel} className="text-[#495057] dark:text-[#adb5bd]">
        Colour: <span className="font-medium text-[#212529] dark:text-white">{current === null ? 'Default' : isTagColorKey(current) ? TAG_STYLES[current].label : `Custom ${current}`}</span>
      </div>

      {/* Presets and Default */}
      <div role="group" aria-labelledby={ids.colourLabel} className={`flex flex-wrap ${phone ? 'gap-3' : 'gap-1.5'}`}>
        {([null, ...TAG_COLOR_KEYS] as Array<TagColorKey | null>).map((key) => {
          const s = TAG_STYLES[key ?? 'default']
          const on = current === key
          return (
            <button
              key={key ?? 'default'}
              type="button"
              title={s.label}
              aria-label={s.label}
              aria-pressed={on}
              onClick={() => {
                clearPending()
                onChange(key)
              }}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${hit} ${focusRing} ${s.swatch} ${on ? swatchRing : ''}`}
            >
              {on && <Check className="w-3.5 h-3.5" />}
            </button>
          )
        })}
      </div>

      {/* Saved custom colours: eight places, always. A filled circle for each saved colour, a dotted ring for each empty one. */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span id={ids.customLabel} className="text-[#495057] dark:text-[#adb5bd]">
            Custom colours
          </span>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              clearPending()
              setOpen((o) => !o)
            }}
            className="inline-flex items-center gap-1 text-fg-link hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#017cb6] rounded"
          >
            Custom colour
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
        <ul role="group" aria-labelledby={ids.customLabel} className={`flex flex-wrap ${phone ? 'gap-3' : 'gap-2'}`}>
          {Array.from({ length: MAX_CUSTOM_COLOURS }, (_, i) => saved[i] ?? null).map((c, i) =>
            c ? (
              <SavedSwatch
                key={c}
                colour={c}
                selected={current === c}
                hold={phone}
                className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${hitBordered} ${focusRing} ${current === c ? swatchRing : 'border border-black/20 dark:border-white/30'}`}
                onSelect={() => {
                  clearPending()
                  onChange(c)
                }}
                onRemove={() => {
                  clearPending()
                  saveCustomColours(removeCustomColour(saved, c))
                  setMessage(`Removed ${c}.`)
                }}
              />
            ) : (
              // An empty place is only a picture: not a button, not focusable, and nothing for a screen reader to say.
              <li key={`empty-${i}`} aria-hidden="true" className="w-6 h-6 rounded-full border-2 border-dotted border-[#adb5bd] dark:border-[#6c757d]" />
            )
          )}
        </ul>
        {phone && saved.length > 0 && <p className="mt-1.5 text-[0.6875rem] text-fg-muted dark:text-slate-400">Hold a saved colour to remove it</p>}
      </div>

      {/* The wheel, the slider and the fields */}
      {open && (
        <div className="rounded border border-[#ced4da] dark:border-[#495057] p-2.5 space-y-2.5">
          <div className="flex items-start gap-3">
            <div
              ref={wheel}
              role="application"
              aria-label="Colour wheel. Arrow keys change the hue and the saturation. The fields below take exact values."
              tabIndex={0}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                dragging.current = true
                fromPointer(e)
              }}
              onPointerMove={(e) => dragging.current && fromPointer(e)}
              onPointerUp={() => (dragging.current = false)}
              onPointerCancel={() => (dragging.current = false)}
              onKeyDown={onWheelKey}
              style={{ background: WHEEL_BACKGROUND, touchAction: 'none' }}
              className={`relative w-32 h-32 shrink-0 rounded-full cursor-crosshair ${focusRing}`}
            >
              <div className="absolute inset-0 rounded-full bg-black pointer-events-none" style={{ opacity: 1 - hsv[2] }} />
              <span
                aria-hidden="true"
                className="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow pointer-events-none"
                style={{
                  left: `${50 + 50 * hsv[1] * Math.sin((hsv[0] * Math.PI) / 180)}%`,
                  top: `${50 - 50 * hsv[1] * Math.cos((hsv[0] * Math.PI) / 180)}%`,
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: hex
                }}
              />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <TagChip tag={previewTag || '…'} color={hex} size="md" className="max-w-full" />
              </div>
              <div>
                <label htmlFor={ids.hex} className="block text-[0.6875rem] text-[#495057] dark:text-[#adb5bd] mb-0.5">
                  Hex
                </label>
                <input
                  id={ids.hex}
                  data-tag-hex
                  value={hexText}
                  onChange={(e) => onHexInput(e.target.value)}
                  onBlur={() => normaliseHex(hexText) && setHexText(normaliseHex(hexText)!)}
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  inputMode="text"
                  enterKeyHint="done"
                  placeholder="e.g. #1e90ff"
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={ids.hexNote}
                  className="w-full font-mono bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#495057] rounded px-2 py-1 placeholder:text-[#adb5bd] placeholder:font-sans focus:outline-none focus:border-[#017cb6]"
                />
              </div>
            </div>
          </div>
          <p id={ids.hexNote} role={problem ? 'alert' : undefined} className={`text-[0.6875rem] ${problem ? 'text-red-700 dark:text-red-300' : 'text-fg-muted dark:text-slate-400'}`}>
            {problem ?? '3 or 6 hex digits, with or without #.'}
          </p>
          <div>
            <label htmlFor={ids.brightness} className="block text-[0.6875rem] text-[#495057] dark:text-[#adb5bd] mb-0.5">
              Brightness
            </label>
            <input
              id={ids.brightness}
              data-tag-brightness
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(hsv[2] * 100)}
              onChange={(e) => use([hsv[0], hsv[1], Number(e.target.value) / 100])}
              // On a phone the control is 36 px tall so a tap near the track still lands on it; the track stays 12 px.
              style={
                phone
                  ? ({ '--brightness-track': `linear-gradient(to right, #000000, ${fullHue})`, touchAction: 'pan-y' } as React.CSSProperties)
                  : { background: `linear-gradient(to right, #000000, ${fullHue})` }
              }
              className={
                phone
                  ? 'w-full h-9 bg-transparent appearance-none cursor-pointer [&::-webkit-slider-runnable-track]:h-3 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:border [&::-webkit-slider-runnable-track]:border-[#ced4da] dark:[&::-webkit-slider-runnable-track]:border-[#495057] [&::-webkit-slider-runnable-track]:bg-[image:var(--brightness-track)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-slate-500 [&::-webkit-slider-thumb]:shadow'
                  : 'w-full h-3 rounded-full appearance-none cursor-pointer border border-[#ced4da] dark:border-[#495057] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-slate-500 [&::-webkit-slider-thumb]:shadow'
              }
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['R', 'G', 'B'] as const).map((label, i) => (
              <label key={label} className="flex items-center gap-1 text-[0.6875rem] text-[#495057] dark:text-[#adb5bd]">
                {label}
                <input
                  type="number"
                  min={0}
                  max={255}
                  inputMode="numeric"
                  aria-label={`${label === 'R' ? 'Red' : label === 'G' ? 'Green' : 'Blue'}, 0 to 255`}
                  value={rgb[i]}
                  onChange={(e) => onRgbInput(i as 0 | 1 | 2, e.target.value)}
                  className="w-full min-w-0 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#495057] rounded px-1.5 py-1 text-xs text-[#212529] dark:text-[#f8f9fa] focus:outline-none focus:border-[#017cb6]"
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <button
              type="button"
              onClick={save}
              className="px-2.5 py-1.5 rounded border border-[#ced4da] dark:border-[#495057] hover:border-[#017cb6]"
            >
              Save as custom colour
            </button>
            {warning && (
              <span role="alert" className="text-[0.6875rem] text-amber-800 dark:text-amber-300 flex-1 min-w-[10rem]">
                {warning}
              </span>
            )}
          </div>
        </div>
      )}
      <p role="status" aria-live="polite" className={message ? 'text-[0.6875rem] text-[#495057] dark:text-[#adb5bd]' : 'sr-only'}>
        {message}
      </p>
    </div>
  )
}
