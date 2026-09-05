import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'
import { subscribeTerminalOutput, type TerminalSession } from '../../lib/terminalSessions'

export function TerminalTab({ session, active, onReconnect, onClose }: {
  session: TerminalSession; active: boolean; onReconnect?: () => void; onClose?: () => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<Terminal>()
  const search = useRef<SearchAddon>()
  const fit = useRef<() => void>()
  const [finding, setFinding] = useState(false)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<boolean>()
  const [error, setError] = useState('')
  const exited = session.status === 'exited'
  useEffect(() => {
    const api = window.bldeskApi.pty
    if (!container.current || !api || session.status === 'connecting') return
    const term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: { background: '#212529', foreground: '#f8f9fa', cursor: '#f1ca00', selectionBackground: '#017cb6' } })
    const fitter = new FitAddon()
    const finder = new SearchAddon()
    term.loadAddon(fitter)
    term.loadAddon(finder)
    term.loadAddon(new WebLinksAddon((_event, uri) => {
      // Remote text is untrusted. Only web URLs, never arbitrary local/deep links.
      if (/^https?:\/\//i.test(uri)) void window.bldeskApi.openExternal(uri)
    }))
    term.open(container.current)
    instance.current = term
    search.current = finder
    term.attachCustomKeyEventHandler((e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (e.type === 'keydown') setFinding(true)
        e.preventDefault()
        return false
      }
      return true
    })
    const input = term.onData((data) => { void api.write(session.id, data).catch((e) => setError(String(e))) })
    const unsubscribe = subscribeTerminalOutput(session.id, (data) => term.write(data))
    let frame = 0
    fit.current = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!container.current?.clientWidth || !container.current.clientHeight) return
        if (instance.current !== term) return
        fitter.fit()
        void api.resize(session.id, term.cols, term.rows).catch((e) => setError(String(e)))
      })
    }
    const observer = new ResizeObserver(() => fit.current?.())
    observer.observe(container.current)
    fit.current()
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); input.dispose(); unsubscribe()
      instance.current = undefined
      fit.current = undefined
      // xterm 5.3's Viewport does not cancel its own pending refresh RAF on
      // dispose. Let callbacks queued by a final resize drain before disposal;
      // otherwise rapid zoom + tab close dereferences a disposed renderService.
      requestAnimationFrame(() => requestAnimationFrame(() => term.dispose()))
    }
  }, [session.id])
  useEffect(() => { if (active) { fit.current?.(); instance.current?.focus() } }, [active])
  useEffect(() => {
    if (exited) instance.current?.writeln(`\r\n\x1b[90m[ssh exited with code ${session.exitCode ?? 'unknown'}${session.signal ? `, signal ${session.signal}` : ''}]\x1b[0m`)
  }, [exited, session.exitCode, session.signal])
  function find(previous = false) {
    setFound(query ? (previous ? search.current?.findPrevious(query) : search.current?.findNext(query)) : undefined)
  }
  return <section className="h-full min-h-0 min-w-0 flex flex-col bg-[#212529] text-[#f8f9fa]" aria-label={`SSH ${session.serverName}`}>
    {finding && <form className="shrink-0 flex flex-wrap items-center gap-2 p-2 text-xs" onSubmit={(e) => { e.preventDefault(); find() }}>
      <input autoFocus aria-label="Find in terminal" className="min-w-0 w-40 rounded bg-[#343a40] px-2 py-1" value={query} onChange={(e) => { setQuery(e.target.value); setFound(undefined) }} onKeyDown={(e) => { if (e.key === 'Escape') { setFinding(false); instance.current?.focus() } }} />
      <button type="submit">Find next</button><button type="button" onClick={() => find(true)}>Previous</button>
      <button type="button" aria-label="Close terminal search" onClick={() => { setFinding(false); instance.current?.focus() }}>×</button>
      {found === false && <span role="status">No match</span>}
    </form>}
    {error && <p role="alert" className="p-2 text-xs text-rose-300">{error}</p>}
    <div ref={container} className="flex-1 min-h-0 min-w-0 overflow-hidden p-2" />
    {exited && <div className="shrink-0 flex flex-wrap gap-3 p-2 text-xs bg-[#2b3035]">
      <span>SSH exited: {session.exitCode ?? 'unknown'}{session.signal ? ` (signal ${session.signal})` : ''}</span>
      {onReconnect && <button onClick={onReconnect}>Reconnect</button>}{onClose && <button onClick={onClose}>Close</button>}
    </div>}
  </section>
}
