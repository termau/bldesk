import React from 'react'
import { X } from 'lucide-react'
import { customChipStyle, isTagColorKey, normaliseHex, type ChipStyle, type TagColorKey } from '../../lib/tags'
import { isComposing } from '../../lib/ime'

/**
 * How each tag colour is drawn, in the light and the dark theme. The text is always `@name`, so colour is never the
 * only thing that tells two tags apart. Each pair keeps text against its tinted background at 4.5:1 or better (the
 * figures are in docs/HELP_VERIFICATION.md). The class strings are written out whole so Tailwind finds them.
 */
export const TAG_STYLES: Record<TagColorKey | 'default', { chip: string; swatch: string; label: string }> = {
  default: {
    label: 'Default',
    chip: 'bg-[#017cb6]/10 text-[#015f8c] border-[#017cb6]/30 dark:text-[#5fc3f0]',
    swatch: 'bg-[#017cb6]'
  },
  slate: {
    label: 'Slate',
    chip: 'bg-slate-500/15 text-slate-700 border-slate-500/40 dark:bg-slate-400/15 dark:text-slate-200 dark:border-slate-400/40',
    swatch: 'bg-slate-500'
  },
  blue: {
    label: 'Blue',
    chip: 'bg-blue-600/10 text-blue-800 border-blue-600/35 dark:bg-blue-400/15 dark:text-blue-200 dark:border-blue-400/40',
    swatch: 'bg-blue-600'
  },
  teal: {
    label: 'Teal',
    chip: 'bg-teal-600/10 text-teal-800 border-teal-600/35 dark:bg-teal-400/15 dark:text-teal-200 dark:border-teal-400/40',
    swatch: 'bg-teal-600'
  },
  green: {
    label: 'Green',
    chip: 'bg-green-600/10 text-green-800 border-green-600/35 dark:bg-green-400/15 dark:text-green-200 dark:border-green-400/40',
    swatch: 'bg-green-600'
  },
  amber: {
    label: 'Amber',
    chip: 'bg-amber-500/15 text-amber-900 border-amber-600/40 dark:bg-amber-400/15 dark:text-amber-200 dark:border-amber-400/40',
    swatch: 'bg-amber-500'
  },
  red: {
    label: 'Red',
    chip: 'bg-red-600/10 text-red-800 border-red-600/35 dark:bg-red-400/15 dark:text-red-200 dark:border-red-400/40',
    swatch: 'bg-red-600'
  },
  purple: {
    label: 'Purple',
    chip: 'bg-purple-600/10 text-purple-800 border-purple-600/35 dark:bg-purple-400/15 dark:text-purple-200 dark:border-purple-400/40',
    swatch: 'bg-purple-600'
  },
  pink: {
    label: 'Pink',
    chip: 'bg-pink-600/10 text-pink-800 border-pink-600/35 dark:bg-pink-400/15 dark:text-pink-200 dark:border-pink-400/40',
    swatch: 'bg-pink-600'
  }
}

/** Custom colours are worked out once per colour: the style for each theme comes from the colour (lib/tags.ts). */
const customStyles = new Map<string, { light: ChipStyle; dark: ChipStyle }>()
function customStyle(hex: string): { light: ChipStyle; dark: ChipStyle } | null {
  let s = customStyles.get(hex)
  if (!s) {
    s = customChipStyle(hex) ?? undefined
    if (s) customStyles.set(hex, s)
  }
  return s ?? null
}

/** A custom colour as the chip draws it: the tint, border and text for each theme, as CSS variables the classes below read. */
const CUSTOM_CHIP_CLASS =
  'bg-[color:var(--tag-bg-l)] text-[color:var(--tag-fg-l)] border-[color:var(--tag-bd-l)] dark:bg-[color:var(--tag-bg-d)] dark:text-[color:var(--tag-fg-d)] dark:border-[color:var(--tag-bd-d)]'

/** A small round colour sample, for lists that name a tag next to the colour it has. */
export const TagDot: React.FC<{ color?: string | null; className?: string }> = ({ color: given, className = '' }) => {
  // a colour is a string; anything else drawn from a map is not one and gets the default look
  const color = typeof given === 'string' ? given : null
  const hex = color && !isTagColorKey(color) ? normaliseHex(color) : null
  const style = TAG_STYLES[color && isTagColorKey(color) ? color : 'default']
  return (
    <span
      aria-hidden="true"
      className={`inline-block w-2.5 h-2.5 shrink-0 rounded-full ${hex ? '' : style.swatch} ${className}`}
      style={hex ? { backgroundColor: hex } : undefined}
    />
  )
}

interface TagChipProps {
  tag: string
  /** A preset key, a custom `#rrggbb`, or nothing for the default look. */
  color?: string | null
  /** Makes the chip editable: double-click, or Enter or F2 while it has focus. Receives the chip's element. */
  onEdit?: (anchor: HTMLElement) => void
  /** Adds a remove button inside the chip. */
  onRemove?: () => void
  /** Wording for the remove button's tooltip; defaults to "Remove @tag". */
  removeLabel?: string
  /** `sm` is for table rows, `md` for the Tags tab. */
  size?: 'sm' | 'md'
  /** A fingertip is using it (the phone layout): the remove button's tappable area grows to at least 36 px, its look does not. */
  touch?: boolean
  className?: string
}

/**
 * One server tag, drawn the same everywhere it appears (Servers list, a server's Tags tab, the Fleet matrix). A tag
 * is one shared name per account profile, so editing it edits it for every server that carries it.
 */
export const TagChip: React.FC<TagChipProps> = ({ tag, color: given, onEdit, onRemove, removeLabel, size = 'sm', touch = false, className = '' }) => {
  const color = typeof given === 'string' ? given : null
  const hex = color && !isTagColorKey(color) ? normaliseHex(color) : null
  const custom = hex ? customStyle(hex) : null
  const style = TAG_STYLES[color && isTagColorKey(color) ? color : 'default']
  const cssVars = custom
    ? ({
        '--tag-bg-l': custom.light.bg,
        '--tag-fg-l': custom.light.text,
        '--tag-bd-l': custom.light.border,
        '--tag-bg-d': custom.dark.bg,
        '--tag-fg-d': custom.dark.text,
        '--tag-bd-d': custom.dark.border
      } as React.CSSProperties)
    : undefined
  const text = size === 'md' ? 'text-xs' : 'text-[0.6875rem]'
  const pad = size === 'md' ? 'px-2.5 py-1' : 'px-2 py-0.5'
  const name = `@${tag}`
  return (
    <span
      data-tag={tag}
      data-tag-color={color ?? 'default'}
      style={cssVars}
      className={`inline-flex items-center min-w-0 max-w-full rounded-full border leading-none font-normal no-underline ${text} ${custom ? CUSTOM_CHIP_CLASS : style.chip} ${className}`}
    >
      {onEdit ? (
        <button
          type="button"
          title={`${name}: Double-click to edit`}
          aria-label={`${name}. Double-click, or press Enter or F2, to edit`}
          aria-haspopup="dialog"
          aria-keyshortcuts="F2"
          // The row behind a chip opens the server on click; a chip must not.
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation()
            onEdit(e.currentTarget)
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' && !isComposing(e)) || e.key === 'F2') {
              e.preventDefault()
              e.stopPropagation()
              onEdit(e.currentTarget)
            }
          }}
          className={`min-w-0 truncate rounded-full select-none cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-[#017cb6] ${pad} ${onRemove ? 'pr-1' : ''}`}
        >
          {name}
        </button>
      ) : (
        <span title={name} className={`min-w-0 truncate select-none ${pad} ${onRemove ? 'pr-1' : ''}`}>
          {name}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          title={removeLabel ?? `Remove ${name}`}
          aria-label={removeLabel ?? `Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className={`shrink-0 rounded-full pl-0.5 pr-1.5 py-0.5 opacity-70 hover:opacity-100 hover:text-rose-600 dark:hover:text-rose-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#017cb6] ${touch ? "relative after:absolute after:-inset-3 after:content-['']" : ''}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  )
}

/** "+3" for the tags a row has no room for; its tooltip names them. They are edited from the server's Tags tab. */
export const TagOverflowChip: React.FC<{ tags: string[]; size?: 'sm' | 'md' }> = ({ tags, size = 'sm' }) => {
  const names = tags.map((t) => `@${t}`).join(', ')
  return (
    <span
      title={`${tags.length} more: ${names}`}
      className={`inline-flex items-center rounded-full border leading-none font-normal no-underline select-none ${size === 'md' ? 'text-xs px-2.5 py-1' : 'text-[0.6875rem] px-2 py-0.5'} ${TAG_STYLES.slate.chip}`}
    >
      <span aria-hidden="true">+{tags.length}</span>
      <span className="sr-only">{`${tags.length} more tags: ${names}`}</span>
    </span>
  )
}
