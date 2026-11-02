import createClient from 'openapi-fetch'
import type { paths } from '@shared/api/schema'
import { NULL_BODY_STATUSES, refusesToken } from './errors'

// In-flight mutation tracker to prevent duplicate concurrent requests and rapid-fire spam
const inFlightMutations = new Map<string, Promise<Response>>()
const recentMutationTimestamps = new Map<string, number>()
const MUTATION_COOLDOWN_MS = 1500 // 1.5 second debounce for identical mutations

async function safeNormalizeResponse(response: Response): Promise<Response> {
  // A response with a null-body status has no body to rewrite, and `new Response(body, { status })` throws for such a
  // status: pass it through as it is, on purpose, rather than through an exception swallowed below.
  if (NULL_BODY_STATUSES.has(response.status)) return response
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return response
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { message: text || `HTTP ${response.status} ${response.statusText}` }
  }
  return new Response(JSON.stringify(parsed), {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

/**
 * A request reduced to the parts the native bridge needs.
 *
 * openapi-fetch calls `fetch(request, requestInitExt)`: a Request object, with
 * `requestInitExt` undefined. Method, headers and body therefore live on the
 * Request, not on `init` - so reading `init?.method || 'GET'` yields GET with no
 * body for every call, mutations included.
 *
 * On desktop that was invisible: the Request is handed to window.fetch untouched
 * and carries its own method. On Android the native path rebuilds the request
 * from these values, so every mutation went out as a GET - POST
 * /v2/servers/{id}/actions became a GET of the same path, which returns the
 * action list with HTTP 200 and creates nothing. It also meant `isMutation` was
 * never true, so the duplicate-submission guard below never engaged anywhere.
 */
interface CanonicalRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

async function canonicalizeRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<CanonicalRequest> {
  const asRequest = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const url = asRequest
    ? asRequest.url
    : input instanceof URL
      ? input.toString()
      : String(input)
  // `init` wins where present, but the Request is the source of truth here.
  const method = (init?.method || asRequest?.method || 'GET').toUpperCase()

  const headers: Record<string, string> = {}
  asRequest?.headers?.forEach((v, k) => {
    headers[k] = v
  })
  new Headers((init?.headers as HeadersInit) || {}).forEach((v, k) => {
    headers[k] = v
  })

  let body: string | undefined
  if (typeof init?.body === 'string') {
    body = init.body
  } else if (init?.body != null) {
    body = String(init.body)
  } else if (asRequest && method !== 'GET' && method !== 'HEAD') {
    // Clone: the original body must stay unread for the fallback path.
    body = (await asRequest.clone().text()) || undefined
  }

  return { url, method, headers, body }
}

async function executeFetch(
  req: CanonicalRequest,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  token?: string
): Promise<Response> {
  const cap = typeof window !== 'undefined' ? (window as any).Capacitor : undefined
  if (cap?.isNativePlatform?.() && cap?.Plugins?.CapacitorHttp) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...req.headers
      }
      if (token && !headers.Authorization && !headers.authorization) {
        headers.Authorization = `Bearer ${token}`
      }

      let parsedData: any = undefined
      if (req.body !== undefined) {
        try {
          parsedData = JSON.parse(req.body)
        } catch {
          parsedData = req.body
        }
      }

      const res = await cap.Plugins.CapacitorHttp.request({
        url: req.url,
        method: req.method,
        headers,
        data: parsedData
      })

      // A null-body status (204, 205, 304) must have no body: the Response
      // constructor throws for any body, '' included, and the catch below would
      // then send the request a second time.
      const nullBody = res.status === 204 || res.status === 205 || res.status === 304
      const responseBody = nullBody
        ? null
        : typeof res.data === 'string'
          ? res.data
          : JSON.stringify(res.data)
      return new Response(responseBody, {
        status: res.status,
        statusText: res.status === 200 ? 'OK' : '',
        headers: new Headers(res.headers as Record<string, string>)
      })
    } catch (err) {
      // Only an unimplemented plugin proves nothing was sent, so only that may
      // fall back to fetch. Any other failure can come after BinaryLane already
      // ran the request (a lost response, a timeout), and sending it again would
      // run it twice: a second server, a second power cycle. Report it instead,
      // as a TypeError like fetch's own network failure, which the action poll
      // rides out.
      if ((err as { code?: string } | null)?.code !== 'UNIMPLEMENTED') {
        console.warn('[NativeFetch] CapacitorHttp request failed, not resent:', err)
        // A read changed nothing, so the "may have gone through" advice would only mislead (an offline phone, a failed list).
        const read = req.method === 'GET' || req.method === 'HEAD'
        throw new TypeError(
          read
            ? 'No response from BinaryLane.'
            : 'No response from BinaryLane. If this request changed anything, it may or may not have gone through; check before trying again.',
          { cause: err }
        )
      }
      console.warn('[NativeFetch] CapacitorHttp fallback triggered:', err)
    }
  }

  // Desktop / web: hand the original arguments through untouched, so the Request
  // keeps its own method and body.
  return window.fetch(input, init)
}

export function createBinaryLaneClient(token: string) {
  const cleanToken = token?.trim() || ''

  const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!cleanToken) {
      // Return 401 early if token is empty instead of making an unauthenticated network request
      return new Response(JSON.stringify({ message: 'No API token configured.' }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const req = await canonicalizeRequest(input, init)
    const { url, method } = req
    const isMutation = method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH'

    // Spam & Concurrency Protection for Mutations (Create/Update/Delete/Actions)
    if (isMutation) {
      // Keep recreated clients with the same credentials together, but never share another token's response.
      // Hash the identity so the tracking maps do not retain raw credentials in their keys.
      const identity = JSON.stringify([cleanToken, req.headers.authorization ?? null])
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
      const credentialScope = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const mutationKey = `${credentialScope}:${method}:${url}:${req.body ?? ''}`
      const now = Date.now()
      const lastSent = recentMutationTimestamps.get(mutationKey) || 0

      // If exact same mutation was triggered within the cooldown window, suppress duplicate
      if (now - lastSent < MUTATION_COOLDOWN_MS) {
        console.warn(`[AntiSpam] Blocked duplicate mutation within cooldown: ${method} ${url}`)
        throw new Error('Action was already submitted. Please wait a moment before trying again.')
      }

      // If exact same mutation is actively in-flight, return the existing pending promise
      if (inFlightMutations.has(mutationKey)) {
        console.warn(`[AntiSpam] Reusing in-flight request for: ${method} ${url}`)
        return inFlightMutations.get(mutationKey)!
      }

      recentMutationTimestamps.set(mutationKey, now)

      const executionPromise = (async () => {
        try {
          const rawResponse = await executeFetch(req, input, init, cleanToken)
          const response = await safeNormalizeResponse(rawResponse)

          if (refusesToken(method, url, response.status)) {
            window.dispatchEvent(new CustomEvent('bldesk:auth_error', { detail: { status: response.status } }))
          }

          return response
        } finally {
          inFlightMutations.delete(mutationKey)
        }
      })()

      inFlightMutations.set(mutationKey, executionPromise)
      return executionPromise
    }

    // Standard GET / read query path
    const rawResponse = await executeFetch(req, input, init, cleanToken)
    const response = await safeNormalizeResponse(rawResponse)
    if (refusesToken(req.method, req.url, response.status)) {
      window.dispatchEvent(new CustomEvent('bldesk:auth_error', { detail: { status: response.status } }))
    }
    return response
  }

  const client = createClient<paths>({
    baseUrl: 'https://api.binarylane.com.au',
    headers: {
      Authorization: `Bearer ${cleanToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    fetch: customFetch
  })

  return client
}

export type BinaryLaneClient = ReturnType<typeof createBinaryLaneClient>
