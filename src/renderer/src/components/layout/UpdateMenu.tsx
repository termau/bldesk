import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, CheckCircle2, CloudOff, Loader2, RefreshCw, AlertTriangle, RotateCw, ChevronDown } from 'lucide-react'
import { UpdateChannel, UpdaterState } from '@shared/ipc-types'
import { renderHelpMarkdown } from '../../lib/helpMarkdown'
import { notifyFailure } from '../../lib/failures'
import { isModalOpen } from '../ui/Modal'

/*
 * Release notes, rendered without innerHTML. Desktop notes are GitHub-rendered
 * HTML; Android's are Markdown. The HTML is parsed into an inert document and
 * rebuilt as React elements from an allowlist, so nothing the notes contain is
 * ever handed to the page as markup: an unknown element keeps only its text,
 * and a link keeps only an http(s) address, opened in the system browser.
 * (The previous blocklist sanitiser re-inserted parsed HTML, which a
 * <noscript> payload could turn back into live script.)
 */
const NOTE_TAGS = new Set(['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'code', 'pre', 'blockquote', 'a'])
const DROPPED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'head', 'title'])

const openNoteLink = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
  e.preventDefault()
  void window.bldeskApi?.openExternal?.(href)
}

function noteNodes(nodes: NodeListOf<ChildNode> | ChildNode[], key = 'n'): React.ReactNode[] {
  return Array.from(nodes).flatMap((node, i): React.ReactNode[] => {
    const k = `${key}-${i}`
    if (node.nodeType === Node.TEXT_NODE) return [node.textContent ?? '']
    if (node.nodeType !== Node.ELEMENT_NODE) return []
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (DROPPED_TAGS.has(tag)) return []
    const children = noteNodes(el.childNodes, k)
    if (!NOTE_TAGS.has(tag)) return children
    if (tag === 'br' || tag === 'hr') return [React.createElement(tag, { key: k })]
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? ''
      if (!/^https?:\/\//i.test(href)) return children
      return [<a key={k} href={href} onClick={(e) => openNoteLink(e, href)}>{children}</a>]
    }
    return [React.createElement(tag, { key: k }, ...children)]
  })
}

/*
 * Under the build's Trusted Types policy, DOMParser takes only TrustedHTML. This policy passes the notes through as
 * they are: the parsed document is never inserted, only read by noteNodes above. It is created once, on first use, and
 * kept in this module, because a second createPolicy with the same name is refused. A hot reload in development runs
 * this module again, so the policy is carried over in Vite's hot data rather than created a second time. Where Trusted
 * Types does not exist (an older Android WebView) the string is passed as it is.
 */
type NotesPolicy = { createHTML: (raw: string) => unknown }
const POLICY_NAME = 'bldesk-release-notes'
let cachedPolicy: NotesPolicy | null | undefined = import.meta.hot?.data.notesPolicy

function notesPolicy(): NotesPolicy | null {
  if (cachedPolicy !== undefined) return cachedPolicy
  const tt = (window as unknown as {
    trustedTypes?: { createPolicy: (name: string, rules: { createHTML: (s: string) => string }) => NotesPolicy }
  }).trustedTypes
  cachedPolicy = tt ? tt.createPolicy(POLICY_NAME, { createHTML: (s) => s }) : null
  if (import.meta.hot) import.meta.hot.data.notesPolicy = cachedPolicy
  return cachedPolicy
}

export function renderReleaseNotes(raw: string): React.ReactNode[] {
  if (!raw) return []
  if (/<(?:h[1-6]|p|div|ul|ol|li|table|blockquote|a|strong|em|code)\b/i.test(raw)) {
    const policy = notesPolicy()
    const html = (policy ? policy.createHTML(raw) : raw) as string
    return noteNodes(new DOMParser().parseFromString(html, 'text/html').body.childNodes)
  }
  // Markdown (Android): the help renderer builds React elements too, and in its
  // remote mode it turns no link into an action.
  return renderHelpMarkdown(raw, true)
}

const ReleaseNotesView: React.FC<{ notes: string }> = ({ notes }) => {
  const content = useMemo(() => renderReleaseNotes(notes), [notes])

  return (
    <div
      className="text-[0.6875rem] leading-relaxed text-[#495057] dark:text-[#adb5bd] max-h-36 overflow-y-auto border-l-2 border-[#017cb6]/40 pl-2.5 my-1 space-y-1 select-text
        [&_h2]:text-xs [&_h2]:font-bold [&_h2]:text-[#212529] dark:[&_h2]:text-white [&_h2]:mt-2 [&_h2]:mb-0.5
        [&_h3]:text-[0.6875rem] [&_h3]:font-semibold [&_h3]:text-[#212529] dark:[&_h3]:text-gray-200 [&_h3]:mt-1.5 [&_h3]:mb-0.5
        [&_p]:my-0.5
        [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_ul]:space-y-0.5
        [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1 [&_ol]:space-y-0.5
        [&_li]:my-0.5
        [&_a]:text-fg-link dark:[&_a]:text-[#38bdf8] [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80
        [&_code]:font-mono [&_code]:text-[0.625rem] [&_code]:bg-black/5 dark:[&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
        [&_hr]:my-1.5 [&_hr]:border-black/10 dark:[&_hr]:border-white/10
        [&_strong]:font-semibold [&_strong]:text-[#212529] dark:[&_strong]:text-gray-100"
    >
      {content}
    </div>
  )
}

/**
 * Title-bar update indicator + popover. Quiet when nothing is happening; shows a
 * gold dot when an update is downloading and a "Restart" pill once one is ready.
 */

export function useUpdaterState(): UpdaterState {
  const [state, setState] = useState<UpdaterState>({
    status: 'idle',
    currentVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.28',
    channel: 'stable',
    supported: false
  })

  useEffect(() => {
    const api = window.bldeskApi
    if (!api?.getUpdaterState) return
    let unsub: (() => void) | undefined
    api.getUpdaterState().then(setState).catch(() => {})
    if (api.onUpdaterState) unsub = api.onUpdaterState(setState)
    return () => unsub?.()
  }, [])

  return state
}

export const UpdateMenu: React.FC = () => {
  const state = useUpdaterState()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Whichever button stands in the title bar: the version button, or Restart / Update once an update is ready. The
  // status can change while the popover is open, and focus goes back to the one that is there when it closes.
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const panelId = useId()

  // The Restart button stands in for the menu while an update is ready, so a Restart that did not install is reported
  // where the user is looking, not in the menu.
  useEffect(() => {
    if (state.installError) notifyFailure("Couldn't install the update", state.installError)
  }, [state.installError])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      // Escape (and so Android's Back) closes it and gives focus back to the button in the title bar; a dialog on top has its own.
      if (e.key !== 'Escape' || e.defaultPrevented || isModalOpen() || ref.current?.closest('[inert]')) return
      e.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    panel.current?.focus()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // On a phone the popover is fixed to the window (see below), so its top is set from where the button is, before it is
  // painted: the title bar wraps to two rows on a narrow screen, and the safe-area inset moves it down.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const bottom = ref.current?.getBoundingClientRect().bottom
      if (bottom !== undefined) panel.current?.style.setProperty('--update-top', `${bottom}px`)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  const busy = state.status === 'checking' || state.status === 'downloading' || state.status === 'available' || state.status === 'installing'
  const ready = state.status === 'ready'

  const check = () => window.bldeskApi?.checkForUpdates?.()
  const install = () => window.bldeskApi?.installUpdate?.()
  const setChannel = (c: UpdateChannel) => window.bldeskApi?.setUpdateChannel?.(c)

  return (
    <div
      ref={ref}
      className="relative"
      // Tabbing (or a screen reader moving focus) out of the popover closes it, as a click elsewhere does. Focus that goes
      // nowhere (the window losing focus, a button in it being disabled) leaves it open.
      onBlur={(e) => {
        if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      {/* Trigger */}
      {ready ? (
        <button
          ref={trigger}
          onClick={install}
          title={`Restart to install BLDesk ${state.availableVersion}`}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[0.6875rem] font-semibold text-slate-900 bg-[#f1ca00] hover:bg-[#ffd633] rounded-md transition shadow"
        >
          <RotateCw className="w-3 h-3 animate-spin" />
          <span>Restart to update</span>
        </button>
      ) : state.apkUrl && state.status === 'available' ? (
        <button
          ref={trigger}
          onClick={install}
          title={`Download and install BLDesk v${state.availableVersion}`}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[0.6875rem] font-semibold text-slate-900 bg-[#f1ca00] hover:bg-[#ffd633] rounded-md transition shadow"
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
          <span>Update v{state.availableVersion}</span>
        </button>
      ) : (
        <button
          ref={trigger}
          onClick={() => setOpen((o) => !o)}
          title={`BLDesk v${state.currentVersion} (${state.channel} channel)`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className="relative flex items-center gap-1.5 px-2 py-0.5 text-xs text-slate-300 hover:text-white bg-black/25 hover:bg-black/40 border border-white/10 hover:border-white/20 rounded-md transition shadow-inner font-mono"
        >
          {busy ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#f1ca00]" aria-hidden="true" />
              <span className="sr-only">BLDesk v{state.currentVersion}</span>
            </>
          ) : (
            <span>v{state.currentVersion}</span>
          )}
          {state.status === 'installing' && state.installPhase && (
            <span className="font-sans">{state.installPhase === 'checking' ? 'Checking' : state.installPhase === 'authorising' ? 'Waiting for password' : 'Installing'}</span>
          )}
          <ChevronDown className="w-3 h-3 opacity-60" />
          {state.status === 'error' && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#343a40]" />}
          {state.status === 'up-to-date' && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-emerald-400" />}
          {state.status === 'check-failed' && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-slate-500" />}
          {state.status === 'available' && <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-[#f1ca00]" />}
        </button>
      )}

      {/* Popover. Below the sm breakpoint (a phone) the version button is too far in from the right edge for a 320px
          popup hung from it, which ran off the left of the screen. There the popup is fixed to the viewport, its top at
          the button's bottom (--update-top, measured when it opens and on resize) plus the same 6px gap, 8px (or the
          safe-area inset) clear of both edges and as wide as fits, up to 320px. */}
      {open && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label="BLDesk updates"
          tabIndex={-1}
          data-dismissible="true"
          className="outline-none absolute right-0 top-full mt-1.5 w-80 max-sm:fixed max-sm:top-[var(--update-top,2.75rem)] max-sm:left-[max(0.5rem,env(safe-area-inset-left,0px))] max-sm:right-[max(0.5rem,env(safe-area-inset-right,0px))] max-sm:ml-auto max-sm:w-auto max-sm:max-w-80 bg-white dark:bg-[#2b3035] text-[#212529] dark:text-[#f8f9fa] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-xl z-50 p-3 text-xs space-y-3 select-text">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold">BLDesk</div>
              <div className="font-mono text-fg-muted">v{state.currentVersion}</div>
            </div>
            <StatusPill state={state} />
          </div>

          {state.apkUrl && state.status === 'available' && (
            <button
              onClick={install}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-[#f1ca00] hover:bg-[#ffd633] text-slate-950 font-semibold rounded transition text-xs shadow"
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              <span>Download APK (v{state.availableVersion})</span>
            </button>
          )}

          {state.status === 'installing' && (
            <div className="text-[0.6875rem] text-fg-muted dark:text-[#adb5bd]">
              {state.installPhase === 'checking'
                ? `Checking whether a newer version than ${state.availableVersion} has been published before installing.`
                : state.installPhase === 'authorising'
                ? `Waiting for you to approve the install of BLDesk ${state.availableVersion} in the system's password prompt. BLDesk stays open until you do, and closing the prompt leaves it as it is.`
                : state.installPhase === 'installing'
                  ? `Password accepted. BLDesk is closing to install ${state.availableVersion}, and opens again by itself when it is done.`
                  : `Installing BLDesk ${state.availableVersion}. This window may not respond for a few seconds, and BLDesk restarts when it is done.`}
            </div>
          )}

          {state.status === 'check-failed' && (
            <div className="text-[0.6875rem] text-fg-muted dark:text-[#adb5bd] space-y-1">
              <div>Couldn't reach the update feed, so this build can't be confirmed as current.</div>
              {state.error && (
                <div className="font-mono text-[0.625rem] opacity-70 break-words max-h-16 overflow-y-auto">{state.error}</div>
              )}
            </div>
          )}

          {state.status === 'error' && state.error && (
            <div className="text-[0.6875rem] text-rose-600 dark:text-rose-400 break-words max-h-16 overflow-y-auto">{state.error}</div>
          )}

          {state.status === 'downloading' && (
            <div className="h-1.5 w-full bg-black/10 dark:bg-white/10 rounded overflow-hidden">
              <div className="h-full bg-[#017cb6] transition-all" style={{ width: `${state.progress ?? 0}%` }} />
            </div>
          )}

          {state.releaseNotes && (state.status === 'available' || state.status === 'downloading' || ready) && (
            <ReleaseNotesView notes={state.releaseNotes} />
          )}

          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-fg-muted dark:text-[#adb5bd]">
              <span>Channel</span>
              <select
                value={state.channel}
                disabled={!state.supported}
                onChange={(e) => setChannel(e.target.value as UpdateChannel)}
                className="bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded px-1.5 py-0.5 text-[#212529] dark:text-white outline-none disabled:opacity-50"
              >
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
              </select>
            </label>

            <button
              onClick={check}
              disabled={!state.supported || busy}
              className="flex items-center gap-1 px-2 py-1 bg-[#017cb6] hover:bg-[#016594] text-white rounded font-medium transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${state.status === 'checking' ? 'animate-spin' : ''}`} />
              <span>Check now</span>
            </button>
          </div>

          {!state.supported && (
            <div className="text-[0.6875rem] text-fg-muted dark:text-[#adb5bd]">
              Auto-update is only available in packaged desktop builds.
            </div>
          )}
          {state.lastCheckedAt && state.supported && (
            <div className="text-[0.625rem] text-fg-muted">Last checked {new Date(state.lastCheckedAt).toLocaleString()}</div>
          )}
        </div>
      )}
    </div>
  )
}

const StatusPill: React.FC<{ state: UpdaterState }> = ({ state }) => {
  const base = 'flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.625rem] font-semibold'
  switch (state.status) {
    case 'checking':
      return (
        <span className={`${base} bg-black/5 dark:bg-white/10 text-fg-muted dark:text-[#adb5bd]`}>
          <Loader2 className="w-3 h-3 animate-spin" /> Checking
        </span>
      )
    case 'available':
    case 'downloading':
      return (
        <span className={`${base} bg-[#017cb6]/15 text-fg-link`}>
          <ArrowDownToLine className="w-3 h-3" /> {state.availableVersion ?? 'Update'} {state.progress != null ? `${state.progress}%` : ''}
        </span>
      )
    case 'installing':
      return (
        <span className={`${base} bg-[#f1ca00]/25 text-amber-700 dark:text-[#f1ca00]`}>
          <Loader2 className="w-3 h-3 animate-spin" /> Installing
        </span>
      )
    case 'ready':
      return (
        <span className={`${base} bg-[#f1ca00]/25 text-amber-700 dark:text-[#f1ca00]`}>
          <RotateCw className="w-3 h-3" /> {state.availableVersion} ready
        </span>
      )
    case 'up-to-date':
      return (
        <span className={`${base} bg-emerald-500/15 text-emerald-600 dark:text-emerald-400`}>
          <CheckCircle2 className="w-3 h-3" /> Up to date
        </span>
      )
    case 'check-failed':
      return (
        <span className={`${base} bg-black/5 dark:bg-white/10 text-fg-muted dark:text-[#adb5bd]`}>
          <CloudOff className="w-3 h-3" /> Couldn't check
        </span>
      )
    case 'error':
      return (
        <span className={`${base} bg-rose-500/15 text-rose-600 dark:text-rose-400`}>
          <AlertTriangle className="w-3 h-3" /> Error
        </span>
      )
    default:
      return state.supported ? null : (
        <span className={`${base} bg-black/5 dark:bg-white/10 text-fg-muted dark:text-[#adb5bd]`}>Dev build</span>
      )
  }
}
