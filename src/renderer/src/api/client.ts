import createClient from 'openapi-fetch'
import type { paths } from '@shared/api/schema'
import { BINARYLANE_API_ORIGIN } from '@shared/binarylane-policy'

// Profile identity is part of every key so accounts can never share a request.
const inFlightMutations = new Map<string, Promise<Response>>()
const recentMutationTimestamps = new Map<string, number>()
const MUTATION_COOLDOWN_MS = 1500

async function mutationFingerprint(profileId: string, request: CanonicalRequest): Promise<string> {
  const material = `${profileId}\u0000${request.method}\u0000${request.path}\u0000${request.body ?? ''}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function safeNormalizeResponse(response: Response): Promise<Response> {
  // Fetch forbids bodies on these statuses. Re-wrapping an empty 204 as a JSON
  // error would itself throw and make a successful deletion look failed.
  if (response.status === 204 || response.status === 205 || response.status === 304) return response
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    try {
      const text = await response.text()
      let parsed: any
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { message: text || `HTTP ${response.status} ${response.statusText}` }
      }
      return new Response(JSON.stringify(parsed), {
        status: response.status,
        statusText: response.statusText,
        headers: {
          'Content-Type': 'application/json',
          ...(response.headers.get('x-bldesk-policy')
            ? { 'X-BLDesk-Policy': response.headers.get('x-bldesk-policy')! }
            : {})
        }
      })
    } catch {
      return response
    }
  }
  return response
}

export interface CanonicalRequest {
  path: string
  method: string
  body?: string
}

/** Preserve method/body when openapi-fetch supplies them on a Request object. */
export async function canonicalizeRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<CanonicalRequest> {
  const asRequest = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const rawUrl = asRequest
    ? asRequest.url
    : input instanceof URL
      ? input.toString()
      : String(input)
  const url = new URL(rawUrl, BINARYLANE_API_ORIGIN)
  if (url.origin !== BINARYLANE_API_ORIGIN) {
    throw new Error('BinaryLane requests must use the pinned API origin.')
  }

  const method = (init?.method || asRequest?.method || 'GET').toUpperCase()
  let body: string | undefined
  if (typeof init?.body === 'string') {
    body = init.body
  } else if (init?.body != null) {
    body = String(init.body)
  } else if (asRequest && method !== 'GET' && method !== 'HEAD') {
    body = (await asRequest.clone().text()) || undefined
  }

  return { path: `${url.pathname}${url.search}`, method, body }
}

async function executeBridgeFetch(profileId: string, request: CanonicalRequest): Promise<Response> {
  if (!window.bldeskApi?.binaryLaneRequest) {
    return new Response(JSON.stringify({ message: 'The protected BinaryLane request bridge is unavailable.' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json', 'X-BLDesk-Policy': 'bridge-unavailable' }
    })
  }

  const result = await window.bldeskApi.binaryLaneRequest(profileId, request)
  const body = result.status === 204 || result.status === 205 || result.status === 304 ? null : result.body
  return new Response(body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers
  })
}

async function normalizeAndDispatch(profileId: string, request: CanonicalRequest): Promise<Response> {
  const response = await safeNormalizeResponse(await executeBridgeFetch(profileId, request))
  const locallyBlocked = response.headers.has('x-bldesk-policy')
  if (locallyBlocked) {
    let message = 'Blocked locally by this profile’s safety policy.'
    try {
      const parsed = await response.clone().json() as { message?: unknown }
      if (typeof parsed.message === 'string' && parsed.message.trim()) message = parsed.message.trim()
    } catch {
      // The privileged bridge normally returns JSON; keep the generic local
      // wording if a platform adapter cannot preserve it.
    }
    window.dispatchEvent(new CustomEvent('bldesk:safety_error', {
      detail: { message, policy: response.headers.get('x-bldesk-policy') || undefined }
    }))
  } else if (response.status === 401 || response.status === 403) {
    window.dispatchEvent(new CustomEvent('bldesk:auth_error', { detail: { status: response.status } }))
  }
  return response
}

export function createBinaryLaneClient(profileId: string) {
  const cleanProfileId = profileId?.trim() || ''

  const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!cleanProfileId) {
      return new Response(JSON.stringify({ message: 'No account profile is active.' }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' }
      })
    }

    let request: CanonicalRequest
    try {
      request = await canonicalizeRequest(input, init)
    } catch (error) {
      return new Response(JSON.stringify({ message: error instanceof Error ? error.message : 'Invalid API request.' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'Content-Type': 'application/json', 'X-BLDesk-Policy': 'invalid-request' }
      })
    }

    const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)
    if (isMutation) {
      const mutationKey = await mutationFingerprint(cleanProfileId, request)
      const now = Date.now()
      for (const [key, timestamp] of recentMutationTimestamps) {
        if (now - timestamp >= MUTATION_COOLDOWN_MS) recentMutationTimestamps.delete(key)
      }
      const lastSent = recentMutationTimestamps.get(mutationKey) || 0

      if (now - lastSent < MUTATION_COOLDOWN_MS) {
        throw new Error('Action was already submitted. Please wait a moment before trying again.')
      }
      const existing = inFlightMutations.get(mutationKey)
      if (existing) return (await existing).clone()

      recentMutationTimestamps.set(mutationKey, now)
      const executionPromise = (async () => {
        try {
          return await normalizeAndDispatch(cleanProfileId, request)
        } finally {
          inFlightMutations.delete(mutationKey)
        }
      })()
      inFlightMutations.set(mutationKey, executionPromise)
      return executionPromise
    }

    return normalizeAndDispatch(cleanProfileId, request)
  }

  return createClient<paths>({
    baseUrl: BINARYLANE_API_ORIGIN,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    fetch: customFetch
  })
}

export type BinaryLaneClient = ReturnType<typeof createBinaryLaneClient>
