// What a failed BinaryLane call becomes, and the paged reads that must not hide one. No imports, so it can be tested
// on its own (scripts/test-api-errors.mjs).

/**
 * A failed API call: a message a customer can read, and the HTTP status so the code that handles it
 * (the retry policy, the token banner) can tell kinds of failure apart. A plain `Error` carries no status.
 */
export class ApiError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const MAX_TEXT = 300
const MAX_FIELDS = 5

/** One reason, or one field name, on one line and no longer than `max`. */
const tidy = (text: string, max = MAX_TEXT): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/**
 * The field-level reasons in a validation body: `errors` maps a field to the reasons for it (the reference's
 * ValidationProblemDetails). Anything else in there is left out, never printed: a value that is not a string or a list of
 * strings, a field with nothing readable, an `errors` that is not an object. The text is bounded: at most MAX_FIELDS fields,
 * each reason on one line.
 */
function fieldReasons(errors: unknown): { field: string; reasons: string[] }[] {
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) return []
  const found: { field: string; reasons: string[] }[] = []
  for (const [field, raw] of Object.entries(errors)) {
    const reasons = (Array.isArray(raw) ? raw : [raw]).filter((r): r is string => typeof r === 'string').map((r) => tidy(r)).filter(Boolean)
    if (reasons.length) found.push({ field: tidy(field, 80), reasons })
  }
  return found
}

/**
 * Fields whose reasons are the very same, joined into one entry ("replace_id, strategy: reason"): the same text under
 * several fields is said once, because repeating it reads as noise. The order the fields were listed in is kept.
 */
function mergeSameReasons(fields: { field: string; reasons: string[] }[]): { field: string; reasons: string[] }[] {
  const groups = new Map<string, { names: string[]; reasons: string[] }>()
  for (const { field, reasons } of fields) {
    const key = reasons.join('\n')
    const group = groups.get(key)
    if (group) group.names.push(field)
    else groups.set(key, { names: [field], reasons })
  }
  return [...groups.values()].map(({ names, reasons }) => ({ field: names.join(', '), reasons }))
}

/**
 * The reason BinaryLane gave, in words. Never raw JSON: a body with none of the fields the API reference
 * documents reads as a generic failure rather than a dump of what came back.
 *
 * A validation failure can carry a generic summary in `message` (or `detail`) and the actionable reason only in `errors`
 * ("backup_type: there is no free slot"). Both are shown, the summary first, unless the summary already says every reason.
 */
export function describeApiError(error: unknown): string {
  if (!error) return 'Unknown error'
  if (typeof error === 'string') {
    const text = error.trim()
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text || 'Unknown error'
  }
  const e = error as { message?: unknown; detail?: unknown; title?: unknown; errors?: unknown }
  const summary = typeof e.message === 'string' && e.message ? e.message : typeof e.detail === 'string' && e.detail ? e.detail : ''
  const fields = mergeSameReasons(fieldReasons(e.errors))
  let reasons = ''
  if (fields.length) {
    const shown = fields.slice(0, MAX_FIELDS).map(({ field, reasons: list }) => `${field}: ${list.join(', ')}`)
    if (fields.length > MAX_FIELDS) shown.push(`and ${fields.length - MAX_FIELDS} more`)
    reasons = tidy(shown.join('; '))
  }
  if (summary) {
    const said = summary.toLowerCase()
    if (!reasons || fields.every(({ reasons: list }) => list.every((r) => said.includes(r.toLowerCase())))) return summary
    return `${summary}${/[.!?]$/.test(summary.trim()) ? '' : '.'} ${reasons}`
  }
  if (reasons) return reasons
  if (typeof e.title === 'string' && e.title) return e.title
  return 'BinaryLane returned an error without a reason.'
}

/**
 * The error to throw for a failed result of the typed client. A failure with an empty body leaves `error`
 * unset (openapi-fetch), so the response status counts too: `if (error || !response.ok) throw apiFailure(error, response)`.
 */
export function apiFailure(error: unknown, response?: { status: number } | null): ApiError {
  const status = response?.status
  if (error) return new ApiError(describeApiError(error), status)
  return new ApiError(status ? `BinaryLane answered HTTP ${status} with no reason.` : 'BinaryLane returned an error without a reason.', status)
}

/**
 * Statuses that retrying cannot change: the token is refused (401, 403) or the thing is not there (404). A read
 * that fails this way is reported at once instead of being retried.
 */
export function isFinalFailure(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status
  return status === 401 || status === 403 || status === 404
}

/**
 * Whether a response says the token itself is refused, which raises the "token failed" banner. A 401 always does.
 * A 403 does too, except where the API reference uses it for a rule about the request rather than the token:
 * deleting a VPC that is not allowed. That one is an ordinary failure with its own reason.
 */
export function refusesToken(method: string, url: string, status: number): boolean {
  if (status === 401) return true
  if (status !== 403) return false
  let path = url
  try {
    path = new URL(url, 'https://api.binarylane.com.au').pathname
  } catch {
    // Not a URL: test it as given.
  }
  return !(method.toUpperCase() === 'DELETE' && /^\/v2\/vpcs\/[^/]+\/?$/.test(path))
}

/** Statuses that cannot carry a body: rebuilding a Response with one and a body throws. */
export const NULL_BODY_STATUSES = new Set([204, 205, 304])

/**
 * Fetch every page of a paginated list endpoint.
 *
 * `per_page` defaults to 20 across this API and `meta.total` is returned but easy
 * to ignore, which silently truncates. It matters for the create form: there are
 * 27 distribution images and 21 sizes, so a single default-page request drops 7
 * operating systems and a plan without any indication.
 */
export async function fetchAllPages<T>(
  fetchPage: (
    page: number,
    perPage: number
  ) => Promise<{ data?: { meta?: { total?: number } } & Record<string, any>; error?: unknown; response?: { ok: boolean; status: number } }>,
  key: string,
  label: string
): Promise<T[]> {
  const PER_PAGE = 200
  const MAX_PAGES = 10
  const failed = (r: { error?: unknown; response?: { ok: boolean } }) => !!r.error || r.response?.ok === false
  const first = await fetchPage(1, PER_PAGE)
  if (failed(first)) throw apiFailure(first.error, first.response)
  const items: T[] = [...((first.data?.[key] as T[]) || [])]
  const total = first.data?.meta?.total ?? items.length
  const pages = Math.min(Math.ceil(total / PER_PAGE), MAX_PAGES)
  if (pages > 1) {
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchPage(i + 2, PER_PAGE)))
    for (const r of rest) {
      // A page that failed is a failed read: returning the pages that did load would pass off a shorter list as the whole one.
      if (failed(r)) {
        console.warn(`[${label}] Error loading a page:`, r.error)
        throw apiFailure(r.error, r.response)
      }
      items.push(...((r.data?.[key] as T[]) || []))
    }
  }
  return items
}
