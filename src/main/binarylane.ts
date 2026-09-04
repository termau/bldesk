import { net } from 'electron'
import type {
  BinaryLaneBridgeRequest,
  BinaryLaneBridgeResponse,
  BinaryLaneTokenValidation
} from '../shared/ipc-types'
import {
  BINARYLANE_API_ORIGIN,
  actionProceedIdForPath,
  binaryLaneUrlForPath,
  decideActionProceedAccess,
  decideBinaryLaneRequest,
  decideServerNetworkActionAccess,
  serverActionsIdForPath,
  type ActionProceedContext,
  type BinaryLanePolicyDecision
} from '../shared/binarylane-policy'
import { VaultManager, type ProfileCredential } from './safeStorage'
import { normaliseSshHost } from '../shared/ssh'

const MAX_TOKEN_LENGTH = 4096
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024

function jsonResponse(
  status: number,
  statusText: string,
  message: string,
  policy?: string
): BinaryLaneBridgeResponse {
  return {
    status,
    statusText,
    headers: {
      'content-type': 'application/json',
      ...(policy ? { 'x-bldesk-policy': policy } : {})
    },
    body: JSON.stringify({ message })
  }
}

function policyMessage(reason: string | undefined): string {
  switch (reason) {
    case 'observe-only':
      return 'Blocked locally: this profile is observe-only.'
    case 'guarded-not-configured':
      return 'Blocked locally: set at least one server or shared resource to Read-only or Maintenance before enabling Protected mode.'
    case 'protected-server':
      return 'Blocked locally: this server is Read-only; changes and remote access are blocked while diagnostics remain available.'
    case 'maintenance-restricted':
      return 'Blocked locally: Maintenance permits operational access, firewall rules, diagnostics, power recovery, and non-replacing temporary backups, but not this structural change.'
    case 'protected-resource':
      return 'Blocked locally: this shared resource is Read-only; views remain available but changes are blocked.'
    case 'maintenance-resource-restricted':
      return 'Blocked locally: this shared resource is in Maintenance; in-place changes are allowed but deletion or cancellation is blocked.'
    case 'ambiguous-shared-resource':
      return 'Blocked locally: this request does not identify every server or shared resource it could change.'
    case 'unreviewed-read':
      return 'Blocked locally: this read endpoint is not in the reviewed BinaryLane API inventory.'
    case 'unreviewed-server-action':
      return 'Blocked locally: this server action is not in the reviewed BinaryLane API inventory.'
    case 'invalid-action-body':
      return 'Blocked locally: the server action body is not a valid reviewed JSON object.'
    case 'action-context-required':
    case 'server-network-context-required':
    case 'invalid-action-context':
      return 'Blocked locally: BLDesk could not verify every current server or network identity required by this action.'
    case 'unsupported-method':
    case 'invalid-method':
      return 'Blocked locally: the HTTP method is not part of the reviewed BinaryLane API surface.'
    default:
      return 'Blocked locally: the BinaryLane request is outside the configured safety policy.'
  }
}

async function resolveActionProceedContext(
  credential: ProfileCredential,
  actionId: number
): Promise<ActionProceedContext | null> {
  try {
    const response = await net.fetch(`${BINARYLANE_API_ORIGIN}/v2/actions/${actionId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credential.token}`,
        Accept: 'application/json'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok || (response.status >= 300 && response.status < 400)) {
      return null
    }

    const data = await response.json() as { action?: Record<string, unknown> }
    const action = data?.action
    if (!action || action.id !== actionId) {
      return null
    }
    const interaction = action.user_interaction_required
    const interactionType = interaction !== null && typeof interaction === 'object' && !Array.isArray(interaction)
      ? (interaction as Record<string, unknown>).interaction_type
      : undefined
    return {
      actionId: action.id,
      status: action.status,
      resourceType: action.resource_type,
      resourceId: action.resource_id,
      actionType: action.type,
      interactionType
    }
  } catch {
    return null
  }
}

async function resolveServerVpcContext(
  credential: ProfileCredential,
  serverId: number
): Promise<{ serverId: number; currentVpcId: number | null } | null> {
  try {
    const response = await net.fetch(`${BINARYLANE_API_ORIGIN}/v2/servers/${serverId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credential.token}`,
        Accept: 'application/json'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok || (response.status >= 300 && response.status < 400)) return null

    const data = await response.json() as { server?: Record<string, unknown> }
    const server = data?.server
    if (!server || server.id !== serverId) return null

    const currentVpcId = Object.prototype.hasOwnProperty.call(server, 'vpc_id')
      ? server.vpc_id
      : null
    if (currentVpcId === null) return { serverId, currentVpcId: null }
    if (!Number.isSafeInteger(currentVpcId) || Number(currentVpcId) <= 0) return null
    return { serverId, currentVpcId: Number(currentVpcId) }
  } catch {
    return null
  }
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') headers[key] = value
  })
  return headers
}

export class BinaryLaneBroker {
  public static async validateToken(tokenValue: unknown): Promise<BinaryLaneTokenValidation> {
    const token = typeof tokenValue === 'string' ? tokenValue.trim() : ''
    if (!token || token.length > MAX_TOKEN_LENGTH || /[\u0000-\u001f\u007f]/.test(token)) {
      return { success: false, error: 'The API token format is invalid.' }
    }

    try {
      const response = await net.fetch(`${BINARYLANE_API_ORIGIN}/v2/account`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000)
      })

      if (response.status >= 300 && response.status < 400) {
        return { success: false, error: 'BinaryLane token validation returned an unexpected redirect.' }
      }
      if (!response.ok) {
        return { success: false, error: 'API token verification failed. Check that the token is active.' }
      }

      const data = await response.json() as { account?: { email?: unknown } }
      const email = typeof data?.account?.email === 'string' ? data.account.email.trim() : ''
      if (!email || !email.includes('@')) {
        return { success: false, error: 'BinaryLane returned no verifiable account identity for this token.' }
      }
      return { success: true, email }
    } catch {
      return { success: false, error: 'Unable to verify the API token with BinaryLane.' }
    }
  }

  public static async request(
    profileIdValue: unknown,
    requestValue: BinaryLaneBridgeRequest
  ): Promise<BinaryLaneBridgeResponse> {
    const profileId = typeof profileIdValue === 'string' ? profileIdValue : ''
    if (!profileId || !requestValue || typeof requestValue !== 'object') {
      return jsonResponse(400, 'Bad Request', 'The profile or API request is invalid.', 'invalid-request')
    }

    const url = binaryLaneUrlForPath(requestValue.path)
    if (!url) return jsonResponse(400, 'Bad Request', 'The API path is invalid.', 'invalid-path')

    const body = typeof requestValue.body === 'string' ? requestValue.body : undefined
    if (body !== undefined && Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BODY_BYTES) {
      return jsonResponse(413, 'Payload Too Large', 'The API request body exceeds the local safety limit.', 'body-too-large')
    }

    let credential: ReturnType<typeof VaultManager.getProfileCredential>
    try {
      const active = VaultManager.getActiveProfile()
      if (!active) return jsonResponse(401, 'Unauthorized', 'No BinaryLane profile is active.', 'no-active-profile')
      if (active.id !== profileId) {
        return jsonResponse(409, 'Conflict', 'The requested BinaryLane profile is no longer active.', 'inactive-profile')
      }
      credential = VaultManager.getProfileCredential(profileId)
    } catch {
      return jsonResponse(503, 'Service Unavailable', 'The protected credential vault could not be opened.', 'vault-unavailable')
    }
    if (!credential) return jsonResponse(401, 'Unauthorized', 'The selected account profile no longer exists.')

    let decision = decideBinaryLaneRequest(credential, requestValue.method, requestValue.path, body)
    if (!decision.allowed && decision.reason === 'server-network-context-required') {
      const serverId = serverActionsIdForPath(requestValue.path)
      if (serverId === null) {
        decision = { allowed: false, method: decision.method, reason: 'invalid-action-context' }
      } else {
        const credentialTokenAtContextRead = credential.token
        const context = await resolveServerVpcContext(credential, serverId)
        if (!context) {
          decision = { allowed: false, method: 'POST', reason: 'invalid-action-context' }
        } else {
          // The read-only lookup may take seconds. Re-bind the active profile,
          // token and latest saved tiers immediately before the mutation.
          try {
            const active = VaultManager.getActiveProfile()
            const currentCredential = active?.id === profileId
              ? VaultManager.getProfileCredential(profileId)
              : undefined
            if (!currentCredential || currentCredential.token !== credentialTokenAtContextRead) {
              return jsonResponse(
                409,
                'Conflict',
                'The active BinaryLane profile or token changed while the server network was checked.',
                'inactive-profile'
              )
            }
            credential = currentCredential
            decision = decideServerNetworkActionAccess(
              credential,
              context.serverId,
              context.currentVpcId,
              body
            )
          } catch {
            return jsonResponse(503, 'Service Unavailable', 'The protected credential vault could not be reopened.', 'vault-unavailable')
          }
        }
      }
    }
    if (!decision.allowed && decision.reason === 'action-context-required') {
      const actionId = actionProceedIdForPath(requestValue.path)
      if (actionId === null) {
        decision = { allowed: false, method: decision.method, reason: 'invalid-action-context' }
      } else {
        const credentialTokenAtContextRead = credential.token
        const context = await resolveActionProceedContext(credential, actionId)
        if (!context) {
          decision = { allowed: false, method: 'POST', reason: 'invalid-action-context' }
        } else {
          // The ownership lookup above may take seconds. Re-read the active
          // profile and its policy immediately before dispatch so a profile
          // switch or promotion to Locked cannot race the final POST. A token
          // rotation invalidates the old ownership proof and must be retried.
          try {
            const active = VaultManager.getActiveProfile()
            const currentCredential = active?.id === profileId
              ? VaultManager.getProfileCredential(profileId)
              : undefined
            if (!currentCredential || currentCredential.token !== credentialTokenAtContextRead) {
              return jsonResponse(
                409,
                'Conflict',
                'The active BinaryLane profile or token changed while the pending action was checked.',
                'inactive-profile'
              )
            }
            credential = currentCredential
            const proceed = decideActionProceedAccess(credential, context, body)
            decision = {
              allowed: proceed.allowed,
              method: 'POST',
              ...(proceed.authorizedBody !== undefined ? { authorizedBody: proceed.authorizedBody } : {}),
              ...(proceed.reason !== undefined ? { reason: proceed.reason } : {})
            }
          } catch {
            return jsonResponse(503, 'Service Unavailable', 'The protected credential vault could not be reopened.', 'vault-unavailable')
          }
        }
      }
    }
    if (!decision.allowed) {
      return jsonResponse(403, 'Forbidden', policyMessage(decision.reason), decision.reason)
    }

    // Only the body returned by the policy may cross the privileged transport.
    // Maintenance actions are reconstructed from an allowlist, so renderer
    // extras, duplicate JSON keys and replacement backup IDs cannot survive.
    const authorizedBody = decision.authorizedBody

    try {
      const response = await net.fetch(url, {
        method: decision.method,
        headers: {
          Authorization: `Bearer ${credential.token}`,
          Accept: 'application/json',
          ...(authorizedBody !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        ...(authorizedBody !== undefined && decision.method !== 'GET' ? { body: authorizedBody } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000)
      })

      if (response.status >= 300 && response.status < 400) {
        return jsonResponse(502, 'Bad Gateway', 'BinaryLane returned a redirect that BLDesk refused to follow.', 'redirect-blocked')
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders(response),
        body: await response.text()
      }
    } catch {
      return jsonResponse(502, 'Bad Gateway', 'The BinaryLane API request could not be completed.')
    }
  }

  public static async verifyServerHost(profileId: string, serverId: number, hostValue: string): Promise<boolean> {
    const host = normaliseSshHost(hostValue)
    if (!host || !Number.isSafeInteger(serverId) || serverId <= 0) return false

    const response = await this.request(profileId, {
      path: `/v2/servers/${serverId}`,
      method: 'GET'
    })
    if (response.status < 200 || response.status >= 300) return false

    try {
      const data = JSON.parse(response.body) as {
        server?: { id?: unknown; networks?: { v4?: Array<{ ip_address?: unknown }>; v6?: Array<{ ip_address?: unknown }> } }
      }
      if (Number(data.server?.id) !== serverId) return false
      const addresses = [...(data.server?.networks?.v4 || []), ...(data.server?.networks?.v6 || [])]
        .map((network) => typeof network.ip_address === 'string' ? normaliseSshHost(network.ip_address) : null)
        .filter((address): address is string => address !== null)
      return addresses.includes(host)
    } catch {
      return false
    }
  }

  public static async getRescueConsole(
    profileId: string,
    serverId: number
  ): Promise<{ success: true; url: string; width?: number; height?: number } | { success: false; error: string }> {
    if (!Number.isSafeInteger(serverId) || serverId <= 0) {
      return { success: false, error: 'The rescue-console server ID is invalid.' }
    }

    const response = await this.request(profileId, {
      path: `/v2/servers/${serverId}/console`,
      method: 'GET'
    })
    if (response.status < 200 || response.status >= 300) {
      try {
        const parsed = JSON.parse(response.body) as { message?: unknown }
        return { success: false, error: typeof parsed.message === 'string' ? parsed.message : 'Rescue-console access failed.' }
      } catch {
        return { success: false, error: 'Rescue-console access failed.' }
      }
    }

    try {
      const data = JSON.parse(response.body) as {
        console?: { browser?: unknown; iframe?: unknown; width?: unknown; height?: unknown }
      }
      const value = typeof data.console?.browser === 'string'
        ? data.console.browser
        : typeof data.console?.iframe === 'string'
          ? data.console.iframe
          : ''
      const url = new URL(value)
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid')
      return {
        success: true,
        url: url.toString(),
        ...(Number.isFinite(Number(data.console?.width)) ? { width: Number(data.console?.width) } : {}),
        ...(Number.isFinite(Number(data.console?.height)) ? { height: Number(data.console?.height) } : {})
      }
    } catch {
      return { success: false, error: 'BinaryLane returned an invalid rescue-console response.' }
    }
  }
}
