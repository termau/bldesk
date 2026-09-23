import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Search, ExternalLink, ThumbsUp, ThumbsDown, ArrowLeft } from 'lucide-react'
import { looksLikeSecret, SECRET_NOT_SENT, type HelpAnswer } from '@shared/help-api'
import { HELP_PAGES, searchHelp } from '../../lib/help'
import { renderHelpMarkdown, openHelpHref } from '../../lib/helpMarkdown'
import { openHelp, type HelpLocation } from '../../lib/helpNavigation'
import { HelpLink } from '../ui/HelpLink'

const ERROR = "Couldn't reach BinaryLane help. Your local help results are below."
const RECENTS = 'bldesk_help_searches'
const GROUPS: Array<[string, (slug: string) => boolean]> = [
  ['Getting started', s => ['getting-started', 'help'].includes(s)],
  ['Servers', s => s === 'servers' || s.startsWith('server-')],
  ['Fleet', s => ['templates', 'vpcs', 'firewall', 'loadbalancers', 'dns', 'backups', 'keys', 'map', 'heatmap', 'terminal'].includes(s)],
  ['Account', s => ['billing', 'account', 'history'].includes(s)],
  ['Reference', s => ['palette', 'shortcuts', 'confirm-and-history', 'tray', 'deep-links', 'troubleshooting'].includes(s)]
]
const titleCase = (s: string) => s.replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\bIpv([46])\b/gi, 'IPv$1').replace(/\bApi\b/g, 'API')

export function HelpView({ location, contextHint }: { location: HelpLocation; contextHint?: string }) {
  const [query, setQuery] = useState(location.query ?? '')
  const [submitted, setSubmitted] = useState<string | null>(location.ask ? location.query ?? null : null)
  const [submission, setSubmission] = useState(0)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [focused, setFocused] = useState(false)
  const [suggestionIndex, setSuggestionIndex] = useState(-1)
  const [answer, setAnswer] = useState<HelpAnswer | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error' | 'secret'>('idle')
  const [feedback, setFeedback] = useState<'idle' | 'sending' | 'thanks' | 'error'>('idle')
  const [showAll, setShowAll] = useState(false)
  const [recent, setRecent] = useState<string[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(RECENTS) ?? '[]'); return Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 5) : [] } catch { return [] }
  })
  const results = useMemo(() => searchHelp(query), [query])
  const page = HELP_PAGES.find(p => p.slug === (location.slug ?? 'getting-started'))
  const content = useRef<HTMLDivElement>(null)
  const requestId = useRef(0)
  const feedbackBusy = useRef(false)
  const question = query.trim()
  const outlineLinks = page?.headings.filter(h => h.level > 1).map(h => <a key={h.id} href={`#${h.id}`} onClick={e => {
    e.preventDefault()
    const details = e.currentTarget.closest('details')
    if (details) details.open = false
    content.current?.querySelector(`[id="${CSS.escape(h.id)}"]`)?.scrollIntoView({ block: 'start' })
  }} className="block text-[#017cb6] dark:text-sky-400 hover:underline">{h.text}</a>)

  useEffect(() => {
    setQuery(location.query ?? '')
    setSubmitted(location.ask ? location.query ?? null : null)
    setSubmission(n => n + 1)
    setSuggestions([])
    setFocused(false)
    content.current?.scrollTo(0, 0)
    if (location.heading) requestAnimationFrame(() => {
      const target = content.current?.querySelector(`[id="${CSS.escape(location.heading!)}"]`) as HTMLElement | null
      target?.scrollIntoView({ block: 'start' })
    })
  }, [location])

  useEffect(() => {
    let current = true
    setSuggestions([])
    setSuggestionIndex(-1)
    if (question.length < 3 || !navigator.onLine || looksLikeSecret(question)) return
    const timer = setTimeout(() => {
      void window.bldeskApi.helpSuggest(question).then(items => { if (current) setSuggestions(items) }).catch(() => {})
    }, 200)
    return () => { current = false; clearTimeout(timer) }
  }, [question])

  useEffect(() => {
    const id = ++requestId.current
    setAnswer(null); setStatus('idle'); setFeedback('idle'); feedbackBusy.current = false
    if (!question || (question.split(/\s+/).length < 3 && submitted !== question)) return
    if (looksLikeSecret(question)) { setStatus('secret'); return }
    if (!navigator.onLine) { setStatus('error'); return }
    const timer = setTimeout(() => {
      setStatus('loading')
      // Only visible search-box text. No account/profile/server object is passed.
      void window.bldeskApi.helpAsk(question).then(value => {
        if (requestId.current === id) { setAnswer(value); setStatus('done') }
      }).catch(() => { if (requestId.current === id) setStatus('error') })
    }, submitted === question ? 0 : 600)
    return () => { clearTimeout(timer); requestId.current++ }
  }, [question, submitted, submission])

  const edit = (value: string) => { requestId.current++; setShowAll(false); setQuery(value); setSubmitted(null); setAnswer(null); setStatus('idle') }
  const submit = () => {
    if (!question) return
    setFocused(false); setSubmitted(question); setSubmission(n => n + 1)
    if (looksLikeSecret(question)) return // never kept in recent searches either
    const next = [question, ...recent.filter(q => q !== question)].slice(0, 5)
    setRecent(next)
    try { localStorage.setItem(RECENTS, JSON.stringify(next)) } catch { /* Local storage unavailable. */ }
  }
  const rate = async (helpful: boolean) => {
    if (!answer || feedbackBusy.current || feedback === 'thanks') return
    feedbackBusy.current = true; setFeedback('sending')
    const id = requestId.current
    try {
      await window.bldeskApi.helpFeedback(answer.id, helpful)
      if (id === requestId.current) setFeedback('thanks')
    } catch { if (id === requestId.current) setFeedback('error') }
    finally { if (id === requestId.current) feedbackBusy.current = false }
  }

  return <div className="h-full min-h-0 flex flex-col text-[#212529] dark:text-[#f8f9fa]">
    <header className="shrink-0 px-4 py-3 border-b border-[#ced4da] dark:border-[#373b3e] flex items-center justify-between gap-3">
      <div><h1 className="text-lg font-bold flex items-center gap-2"><BookOpen className="w-5 h-5 text-[#017cb6]" />Help &amp; Ask BinaryLane</h1><p className="text-xs text-[#6c757d] dark:text-slate-400">Your guide to BLDesk, with answers from BinaryLane’s published articles.</p></div>
      <HelpLink slug="help" />
    </header>
    <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
      <aside aria-label="Help index" className="sm:w-48 md:w-64 xl:w-72 shrink-0 flex flex-col min-h-0 border-b sm:border-b-0 sm:border-r border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#2b3035]">
        <form onSubmit={e => { e.preventDefault(); submit() }} className="shrink-0 p-3 space-y-2 relative border-b border-[#ced4da] dark:border-[#373b3e]">
          <label htmlFor="help-search" className="block text-xs font-semibold">Search help</label>
          <div className="flex gap-1">
            <input id="help-search" maxLength={1000} value={query} placeholder="e.g. port 22 unreachable" autoComplete="off"
              role="combobox" aria-autocomplete="list" aria-expanded={focused && suggestions.length > 0} aria-controls="help-suggestions" aria-activedescendant={suggestionIndex >= 0 ? `help-suggestion-${suggestionIndex}` : undefined}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={e => { edit(e.target.value); setFocused(true) }}
              onKeyDown={e => {
                if (e.key === 'Escape') { setFocused(false); setSuggestionIndex(-1) }
                if (focused && suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setSuggestionIndex(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length) }
                if (e.key === 'Enter' && focused && suggestionIndex >= 0) { e.preventDefault(); edit(suggestions[suggestionIndex]); setFocused(false) }
              }} className="w-full min-w-0 rounded border border-[#ced4da] dark:border-[#495057] bg-[#f8f9fa] dark:bg-[#212529] px-2 py-2 text-xs focus:outline-[#017cb6]" />
            <button type="submit" aria-label="Search help" className="shrink-0 rounded bg-[#017cb6] text-white px-2"><Search className="w-4 h-4" /></button>
          </div>
          {focused && suggestions.length > 0 && <ul id="help-suggestions" role="listbox" aria-label="Suggested questions" className="absolute z-40 left-3 right-3 top-[74px] max-h-40 overflow-y-auto bg-white dark:bg-[#343a40] border border-[#ced4da] dark:border-[#495057] rounded shadow-lg">
            {suggestions.map((s, i) => <li key={s} id={`help-suggestion-${i}`} role="option" aria-selected={i === suggestionIndex} onMouseDown={e => e.preventDefault()} onClick={() => { edit(s); setFocused(false) }} className={`p-2 text-xs cursor-pointer hover:bg-sky-50 dark:hover:bg-slate-600 ${i === suggestionIndex ? 'bg-sky-100 dark:bg-slate-600' : ''}`}>{s}</li>)}
          </ul>}
          {contextHint && <button type="button" onClick={() => edit(`${query.trim()} ${contextHint}`.trim())} className="max-w-full text-left text-[11px] rounded border border-[#ced4da] dark:border-[#495057] px-2 py-1 text-[#017cb6] dark:text-sky-400">add: {contextHint}</button>}
          <p className="text-[10px] leading-relaxed text-[#6c757d] dark:text-slate-400">Search text goes to BinaryLane help. Leave out names, addresses, IDs, tokens and ticket text.</p>
        </form>
        <nav aria-label="Help topics" className="min-h-0 overflow-y-auto p-3 space-y-3 max-h-20 sm:max-h-none sm:flex-1">
          {GROUPS.map(([group, includes]) => <section key={group}><h2 className="text-[10px] uppercase tracking-wide font-semibold text-[#6c757d] dark:text-slate-400 mb-1">{group}</h2>
            {HELP_PAGES.filter(p => includes(p.slug)).map(p => <button key={p.slug} type="button" onClick={() => openHelp({ slug: p.slug })} aria-current={!question && page?.slug === p.slug ? 'page' : undefined}
              className={`block w-full text-left text-xs px-2 py-1.5 rounded ${!question && page?.slug === p.slug ? 'bg-[#017cb6] text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>{p.title}</button>)}
          </section>)}
          {recent.length > 0 && <section><h2 className="text-[10px] uppercase text-[#6c757d] dark:text-slate-400">Recent searches</h2>{recent.map(q => <button key={q} className="block w-full text-left text-xs py-1 text-[#017cb6] dark:text-sky-400 break-words" onClick={() => edit(q)}>{q}</button>)}</section>}
        </nav>
      </aside>
      <div ref={content} data-help-content className="flex-1 min-w-0 min-h-0 overflow-y-auto p-4 lg:p-6">
        {question ? <div className="max-w-4xl mx-auto space-y-5">
          {status !== 'idle' && <section aria-label="Ask BinaryLane" className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-4 space-y-4">
            <div><h2 className="text-base font-semibold">Ask BinaryLane <span className="text-[10px] font-normal rounded bg-sky-100 dark:bg-sky-900 px-1.5 py-0.5 text-[#017cb6] dark:text-sky-300">beta</span></h2><p className="text-xs text-[#6c757d] dark:text-slate-400 mt-1">Answers are generated from published articles and may be incomplete or out of date; check the linked article.</p></div>
            {status === 'loading' && <div role="status" aria-label="Searching BinaryLane articles" className="space-y-3 animate-pulse motion-reduce:animate-none">{[100, 92, 98, 70].map((w, i) => <div key={i} style={{ width: `${w}%` }} className="h-3 rounded bg-slate-200 dark:bg-slate-600" />)}</div>}
            {status === 'error' && <p role="alert" className="text-sm text-[#6c757d] dark:text-slate-300">{ERROR}</p>}
            {status === 'secret' && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{SECRET_NOT_SENT}</p>}
            {answer && status === 'done' && <>
              <div className="text-sm space-y-3">{renderHelpMarkdown(answer.answer, true)}</div>
              <div aria-label="Source articles" className="border-t border-[#ced4da] dark:border-[#373b3e] pt-3 space-y-1"><h3 className="text-xs font-semibold mb-2">Source articles</h3>{answer.results.map((r, i) => <button key={`${r.url}-${i}`} onClick={() => openHelpHref(r.url, true)} className="w-full text-left flex items-start gap-2 text-xs text-[#017cb6] dark:text-sky-400 p-2 rounded hover:bg-black/5 dark:hover:bg-white/5"><ExternalLink className="w-3.5 h-3.5 shrink-0" />{titleCase(r.title)}</button>)}</div>
              <div className="flex items-center gap-3 text-xs"><span>{feedback === 'thanks' ? 'Thanks' : 'Was this helpful?'}</span>
                {[true, false].map(helpful => <button key={String(helpful)} aria-label={helpful ? 'Helpful' : 'Not helpful'} disabled={feedback === 'sending' || feedback === 'thanks'} onClick={() => void rate(helpful)} className="p-1.5 border border-[#ced4da] dark:border-[#495057] rounded hover:text-[#017cb6] disabled:opacity-40">{helpful ? <ThumbsUp className="w-4 h-4" /> : <ThumbsDown className="w-4 h-4" />}</button>)}
                {feedback === 'error' && <span role="alert">Feedback could not be sent. Try again.</span>}
              </div>
            </>}
          </section>}
          <section aria-label="BLDesk help results"><h2 className="text-base font-semibold mb-3">Help for BLDesk</h2>
            {results.length ? <div className="space-y-2">{(showAll ? results : results.slice(0, 5)).map(hit => <button key={hit.page.slug} onClick={() => openHelp({ slug: hit.page.slug, heading: hit.heading })} className="block w-full text-left bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-3 hover:border-[#017cb6]">
              <span className="text-sm font-semibold text-[#017cb6] dark:text-sky-400">{hit.page.title}</span><span className="block text-xs text-[#6c757d] dark:text-slate-400 mt-1">{hit.page.summary}</span>
            </button>)}{results.length > 5 && <button type="button" onClick={() => setShowAll(v => !v)} className="text-xs text-[#017cb6] dark:text-sky-400 hover:underline">{showAll ? 'Show fewer' : `Show all ${results.length} topics`}</button>}</div> : <p className="text-sm text-[#6c757d] dark:text-slate-400">No local help matched. Try “firewall”, “backup” or “Change Plan”.</p>}
          </section>
          {status === 'idle' && <p className="text-xs text-[#6c757d] dark:text-slate-400">Press Enter to ask BinaryLane, or type a question of at least three words.</p>}
        </div> : page ? <div className="max-w-5xl mx-auto flex flex-col xl:flex-row gap-6">
          <article aria-label={page.title} className="min-w-0 flex-1 bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg p-4 lg:p-6 text-sm space-y-4">{renderHelpMarkdown(page.body)}</article>
          <nav aria-label="On this page" className="hidden xl:block xl:w-40 shrink-0 text-xs space-y-2"><h2 className="font-semibold">On this page</h2>{outlineLinks}</nav>
          <details key={page.slug} className="xl:hidden order-first text-xs"><summary className="cursor-pointer font-semibold">On this page</summary><nav aria-label="On this page" className="space-y-2 mt-3">{outlineLinks}</nav></details>
        </div> : <div className="space-y-3"><h2 className="text-lg font-semibold">Help page not found</h2><p className="text-sm">Choose a topic from the index or search for it.</p><button onClick={() => openHelp({ slug: 'getting-started' })} className="flex items-center gap-2 text-[#017cb6]"><ArrowLeft className="w-4 h-4" />Getting started</button></div>}
      </div>
    </div>
  </div>
}
