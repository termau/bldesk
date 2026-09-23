import { HelpLink } from '../ui/HelpLink'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { History, Search, Trash2, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Loader2, HelpCircle, Zap, MousePointerClick } from 'lucide-react'
import { CHANGELOG_EVENT, clearChanges, listChanges, type ChangeEntry, type ChangeOutcome } from '../../lib/changelog'
import { useConfirm } from '../../context/ConfirmContext'

/**
 * "What did I change on this account, and how did it end?" — the local change
 * log (FEATURES.md #5), newest first, with the diff or change table that was
 * confirmed and the outcome the tracker reported.
 */

const OUTCOME: Record<ChangeOutcome, { label: string; icon: typeof CheckCircle2; className: string; spin?: boolean }> = {
  submitted: { label: 'Submitted', icon: Loader2, className: 'text-[#017cb6]', spin: true },
  completed: { label: 'Completed', icon: CheckCircle2, className: 'text-emerald-500' },
  errored: { label: 'Errored', icon: AlertTriangle, className: 'text-rose-500' },
  failed: { label: 'Failed', icon: AlertTriangle, className: 'text-rose-500' },
  lost: { label: 'Lost track', icon: HelpCircle, className: 'text-amber-500' }
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString()
}

export const HistoryView: React.FC<{ profileId?: string; profileName?: string }> = ({ profileId, profileName }) => {
  const [entries, setEntries] = useState<ChangeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const confirmAction = useConfirm()

  const refresh = useCallback(async () => {
    if (!profileId) {
      setEntries([])
      setLoading(false)
      return
    }
    const list = await listChanges(profileId, 1000)
    setEntries(list)
    setLoading(false)
  }, [profileId])

  useEffect(() => {
    void refresh()
    const onChange = () => void refresh()
    window.addEventListener(CHANGELOG_EVENT, onChange)
    return () => window.removeEventListener(CHANGELOG_EVENT, onChange)
  }, [refresh])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) =>
      [e.label, e.target.name, String(e.target.id ?? ''), e.summary ?? '', e.detail ?? '', e.outcome].some((s) => s.toLowerCase().includes(q))
    )
  }, [entries, filter])

  const grouped = useMemo(() => {
    const out: Array<{ day: string; items: ChangeEntry[] }> = []
    for (const e of filtered) {
      const k = dayKey(e.at)
      const last = out[out.length - 1]
      if (last && last.day === k) last.items.push(e)
      else out.push({ day: k, items: [e] })
    }
    return out
  }, [filtered])

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleClear = async () => {
    if (!profileId) return
    const r = await confirmAction({
      title: 'Clear history',
      target: { kind: 'account', name: profileName ?? profileId },
      summary: `Delete the local record of ${entries.length} change${entries.length === 1 ? '' : 's'} on this account. This only affects BLDesk's own log — nothing on BinaryLane changes.`,
      severity: 'destructive',
      log: false,
      confirmLabel: 'Clear history'
    })
    if (!r.ok) return
    await clearChanges(profileId)
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-4 overflow-hidden bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <History className="w-5 h-5 text-[#017cb6]" /> History
            <span className="text-xs font-normal text-[#6c757d] dark:text-[#adb5bd] ml-1">{entries.length} change{entries.length === 1 ? '' : 's'}</span>
          </h2>
          <p className="text-xs text-[#6c757d] dark:text-[#adb5bd] mt-1">
            Every change confirmed in BLDesk on {profileName ?? 'this account'}, with what was confirmed and how it ended. Stored locally on this machine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            disabled={entries.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-[#ced4da] dark:border-[#373b3e] hover:bg-white dark:hover:bg-[#32383e] disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
          <HelpLink slug="history" />
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-[#6c757d] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by server, action, outcome…"
          className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded focus:outline-none focus:border-[#017cb6]"
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {loading ? (
          <div className="text-xs text-[#6c757d] p-8 text-center">Loading…</div>
        ) : grouped.length === 0 ? (
          <div className="text-xs text-[#6c757d] p-8 text-center">
            {entries.length === 0 ? 'No changes recorded yet. Anything you confirm from here on will appear here.' : 'Nothing matches that filter.'}
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.day}>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#6c757d] mb-1.5">
                {new Date(g.items[0].at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
              <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg divide-y divide-[#ced4da] dark:divide-[#373b3e]">
                {g.items.map((e) => {
                  const o = OUTCOME[e.outcome] ?? OUTCOME.submitted
                  const OIcon = o.icon
                  const expandable = !!(e.diff?.length || e.changes?.length || e.detail || e.summary)
                  const isOpen = open.has(e.id)
                  return (
                    <div key={e.id} className="text-xs">
                      <button
                        onClick={() => expandable && toggle(e.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[#017cb6] ${expandable ? 'hover:bg-[#f8f9fa] dark:hover:bg-[#32383e]' : 'cursor-default'}`}
                      >
                        <span className="w-4 flex-shrink-0 text-[#6c757d]">
                          {expandable ? isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" /> : null}
                        </span>
                        <span className="w-24 flex-shrink-0 text-[#6c757d] dark:text-slate-400 font-mono text-[11px]">{fmtWhen(e.at)}</span>
                        <span className="font-semibold truncate">{e.label}</span>
                        <span className="font-mono text-[#495057] dark:text-[#adb5bd] truncate">
                          {e.target.name}
                          {e.target.id !== undefined && <span className="text-[#6c757d]"> #{e.target.id}</span>}
                        </span>
                        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                          {e.severity !== 'normal' && (
                            <span
                              className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${
                                e.severity === 'irreversible' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {e.severity}
                            </span>
                          )}
                          <span className="text-[#6c757d]" title={e.source === 'palette' ? 'From the command palette' : 'From the UI'}>
                            {e.source === 'palette' ? <Zap className="w-3 h-3" /> : <MousePointerClick className="w-3 h-3" />}
                          </span>
                          <span className={`flex items-center gap-1 ${o.className}`}>
                            <OIcon className={`w-3.5 h-3.5 ${o.spin ? 'animate-spin' : ''}`} />
                            {o.label}
                          </span>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 pl-10 space-y-2 select-text">
                          {e.summary && <p className="text-[#495057] dark:text-[#adb5bd]">{e.summary}</p>}
                          {e.changes && e.changes.length > 0 && (
                            <table className="text-[11px]">
                              <tbody>
                                {e.changes.map((c, i) => (
                                  <tr key={i}>
                                    <td className="pr-3 py-0.5 text-[#6c757d] whitespace-nowrap align-top">{c.label}</td>
                                    <td className="py-0.5 font-mono">
                                      {c.from !== undefined && <span className="text-rose-600 dark:text-rose-400 line-through">{c.from}</span>}
                                      {c.from !== undefined && c.to !== undefined && <span className="text-[#6c757d] mx-1.5">→</span>}
                                      {c.to !== undefined && <span className="text-emerald-700 dark:text-emerald-300">{c.to}</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {e.diff && e.diff.length > 0 && (
                            <pre className="text-[11px] font-mono leading-5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded p-2 overflow-x-auto max-h-48">
                              {e.diff.map((l, i) => (
                                <div key={i} className={l.kind === 'add' ? 'text-emerald-700 dark:text-emerald-300' : l.kind === 'remove' ? 'text-rose-600 dark:text-rose-400' : 'text-[#6c757d]'}>
                                  <span className="inline-block w-4">{l.kind === 'add' ? '+' : l.kind === 'remove' ? '−' : ' '}</span>
                                  {l.text}
                                </div>
                              ))}
                            </pre>
                          )}
                          {(e.detail || e.actionId) && (
                            <div className="text-[11px] text-[#6c757d] dark:text-slate-400">
                              {e.actionId && <span className="font-mono">action #{e.actionId}</span>}
                              {e.actionId && e.detail && ' · '}
                              {e.detail}
                              {e.settledAt && <span className="ml-1">({fmtWhen(e.settledAt)})</span>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
