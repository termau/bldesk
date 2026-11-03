import React, { useMemo, useState } from 'react'
import { Bell, Loader2 } from 'lucide-react'
import type { components } from '@shared/api/schema'
import { alertValueLimits, pendingAlertChanges, shortUnit, type AlertChange, type AlertEdit } from '../../lib/thresholdAlerts'

type ThresholdAlert = components['schemas']['ThresholdAlert']

interface Props {
  /** BinaryLane's alert rules for this server: every rule it has, each with its own name, unit and description. */
  alerts: ThresholdAlert[] | undefined
  status: 'loading' | 'error' | 'ready'
  error: string | null
  onRetry: () => void
  /** Another change to this server is still being applied. */
  busy: boolean
  /** Confirm and submit these changes; true once they were submitted. */
  onSave: (changes: AlertChange[]) => Promise<boolean>
}

const inputClass =
  'w-20 px-2.5 py-1.5 text-right text-xs bg-white dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded text-[#212529] dark:text-slate-100 focus:outline-none focus:border-[#017cb6] disabled:opacity-50 transition aria-[invalid=true]:border-rose-500 [@media(pointer:coarse)]:py-2.5'
const COLUMNS = 'md:grid-cols-[minmax(9rem,12rem)_minmax(10rem,13rem)_1fr]'

/**
 * Every threshold alert rule BinaryLane has for the server, as its table: name, an on box and threshold, and its own
 * description. The rows come from the API, so a rule BLDesk has never heard of still shows. Saving sends only the rules
 * that were changed (the request keeps the status and value of anything left out), and it is switched off until the rules
 * have loaded, so a failed read can never be saved over the server's real rules.
 */
export const ServerAlertRules: React.FC<Props> = ({ alerts, status, error, onRetry, busy, onSave }) => {
  const [edits, setEdits] = useState<Partial<Record<string, AlertEdit>>>({})
  const { changes, invalid } = useMemo(() => pendingAlertChanges(alerts ?? [], edits), [alerts, edits])
  const edit = (type: string, patch: AlertEdit) => setEdits((previous) => ({ ...previous, [type]: { ...previous[type], ...patch } }))
  const canSave = status === 'ready' && !busy && changes.length > 0 && invalid.length === 0

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    if (await onSave(changes)) setEdits({})
  }

  return (
    <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm overflow-hidden">
      <div className="p-3.5 bg-[#f1f1f1] dark:bg-[#262a2e] border-b border-[#ced4da] dark:border-[#373b3e]">
        <h3 className="font-bold text-xs text-[#495057] dark:text-[#ced4da] flex items-center gap-2">
          <Bell className="w-4 h-4 text-[#017cb6]" />
          <span>Monitoring & Threshold Alert Rules</span>
        </h3>
        <p className="text-[11px] text-[#6c757d] dark:text-slate-400 mt-0.5">
          BinaryLane automatically sends email notifications when sustained resource usage crosses these limits.
        </p>
      </div>

      {status === 'loading' && (
        <p className="p-5 text-xs text-[#6c757d] dark:text-slate-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading alert rules…</p>
      )}

      {status === 'error' && (
        <div role="alert" className="m-5 flex flex-wrap items-center gap-2 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          <span>The alert rules could not be loaded{error ? `: ${error}` : '.'} Saving is switched off, so no rule is overwritten.</span>
          <button type="button" onClick={onRetry} className="font-semibold underline">Retry</button>
        </div>
      )}

      {status === 'ready' && alerts && alerts.length === 0 && (
        <p className="p-5 text-xs text-[#6c757d] dark:text-slate-400">BinaryLane returned no alert rules for this server.</p>
      )}

      {status === 'ready' && alerts && alerts.length > 0 && (
        <form onSubmit={save}>
          <div className={`hidden md:grid ${COLUMNS} gap-x-4 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#6c757d] dark:text-slate-400 border-b border-[#ced4da]/60 dark:border-[#373b3e]`}>
            <span>Alert</span>
            <span>Threshold</span>
            <span>Description</span>
          </div>
          <div className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
            {alerts.map((rule) => {
              const name = rule.name || rule.alert_type
              const change = edits[rule.alert_type]
              const enabled = change?.enabled ?? rule.enabled
              const value = change?.value === undefined ? rule.value : change.value
              const { min, max } = alertValueLimits(rule)
              const id = `alert-rule-${rule.alert_type}`
              return (
                <div key={rule.alert_type} className={`grid gap-x-4 gap-y-1.5 px-4 py-3 ${COLUMNS} md:items-start`}>
                  <label htmlFor={id} className="text-xs font-semibold text-[#212529] dark:text-white md:pt-1.5">{name}</label>
                  <div className="flex items-center gap-2">
                    {/* The label widens the tap area around the small box (negative margin keeps the layout as it was). */}
                    <label className="-m-2 flex cursor-pointer items-center p-2">
                      <input
                        type="checkbox"
                        aria-label={`${name} alert on`}
                        checked={enabled}
                        disabled={busy}
                        onChange={(e) => edit(rule.alert_type, { enabled: e.target.checked })}
                        className="rounded border-[#ced4da] text-[#017cb6]"
                      />
                    </label>
                    <input
                      id={id}
                      type="number"
                      min={min}
                      max={max}
                      step={1}
                      inputMode="numeric"
                      value={value ?? ''}
                      disabled={busy || !enabled}
                      aria-invalid={invalid.includes(rule.alert_type)}
                      onChange={(e) => edit(rule.alert_type, { value: e.target.value === '' ? null : Number(e.target.value) })}
                      className={inputClass}
                    />
                    <span className="text-xs text-[#6c757d] dark:text-slate-400">{shortUnit(rule.unit)}</span>
                  </div>
                  <p className="text-[11px] leading-snug text-[#6c757d] dark:text-slate-400 md:pt-1.5">{rule.description}</p>
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-[#ced4da]/60 p-4 dark:border-[#373b3e]">
            <button
              type="submit"
              disabled={!canSave}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#017cb6] hover:bg-[#016696] rounded shadow-sm disabled:opacity-50 transition flex items-center gap-1.5 [@media(pointer:coarse)]:py-2.5"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Save Alert Thresholds</span>
            </button>
            <span className={`text-[11px] ${invalid.length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-[#6c757d] dark:text-slate-400'}`}>
              {invalid.length > 0
                ? 'A threshold must be a whole number of at least 1, and at most 100 for a percentage (memory can go higher).'
                : changes.length === 0
                  ? 'No changes to save.'
                  : `${changes.length} ${changes.length === 1 ? 'rule' : 'rules'} changed. Only the changed rules are sent.`}
            </span>
          </div>
        </form>
      )}
    </div>
  )
}
