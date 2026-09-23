/**
 * How a server's status should read.
 *
 * The API reports four states - `new`, `active`, `off`, `archive` - but the UI
 * tested `status === 'active'` and rendered everything else as a red "Stopped".
 * A server that is still being built is `new`, so a freshly created server
 * appeared in the list as though it had failed, which is alarming and wrong.
 */
export type ServerStatus = 'new' | 'active' | 'off' | 'archive' | (string & {})

export interface StatusPresentation {
  label: string
  /** Tailwind background for the status dot. */
  dot: string
  /** Tailwind classes for a status pill. */
  pill: string
  /** Work is in progress and the UI should show motion rather than a fixed state. */
  busy: boolean
  /** What the state means, where the label alone does not say. */
  hint?: string
}

/**
 * `archive` keeps BinaryLane's own name, as mPanel and the API do (#69). This is
 * the API reference's definition of it, so the label is explained rather than
 * renamed.
 */
export const ARCHIVE_HINT = 'Powered off due to cancellation or non-payment'

export function describeStatus(status: ServerStatus | undefined): StatusPresentation {
  switch (status) {
    case 'active':
      return {
        label: 'Running',
        dot: 'bg-emerald-500',
        pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
        busy: false
      }
    case 'new':
      return {
        label: 'Building',
        dot: 'bg-amber-500',
        pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
        busy: true
      }
    case 'archive':
      return {
        label: 'Archived',
        dot: 'bg-slate-400',
        pill: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        busy: false,
        hint: ARCHIVE_HINT
      }
    case 'off':
      return {
        label: 'Stopped',
        dot: 'bg-rose-500',
        pill: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
        busy: false
      }
    default:
      return {
        label: status ? String(status) : 'Unknown',
        dot: 'bg-slate-400',
        pill: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        busy: false
      }
  }
}

/**
 * Order for the server list: anything still building first, then by name.
 *
 * Building first because a new server is appended by the API, so the one thing
 * you just created - and are most likely watching - landed at the bottom of a
 * long list. By name after that because the API's own order read as random
 * (#71). Numeric-aware, so `web-2` sorts before `web-10`.
 */
export function compareServersForList(a: { status?: string; name?: string }, b: { status?: string; name?: string }): number {
  const rank = (s?: string): number => (s === 'new' ? 0 : 1)
  return rank(a.status) - rank(b.status) || (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true, sensitivity: 'base' })
}
