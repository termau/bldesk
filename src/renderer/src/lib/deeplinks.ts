import { useEffect, useRef, useState } from 'react'
import { components } from '@shared/api/schema'
import { decideServerOperationAccess } from '@shared/binarylane-policy'
import { AccountProfile } from '@shared/ipc-types'
import { DeepLink, formatDeepLink, parseDeepLink } from '@shared/deeplink'
import { remoteServiceProbeForImage } from '@shared/remote-service'
import { BinaryLaneClient } from '../api/client'
import { ActiveTab, ServerSubTab } from '../components/layout/Sidebar'
import { launchSsh } from './launchSsh'

type ServerResponse = components['schemas']['Server']

export { formatDeepLink, parseDeepLink }
export type { DeepLink }

/** Copy a bldesk:// link to the clipboard. Returns the link text. */
export async function copyDeepLink(link: DeepLink): Promise<string> {
  const url = formatDeepLink(link)
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    // clipboard unavailable — caller can still show the URL
  }
  return url
}

export function primaryIpv4(server: ServerResponse): string | undefined {
  return server.networks?.v4?.find((v) => v.type === 'public')?.ip_address || server.networks?.v4?.[0]?.ip_address
}

function remoteAccessBlockReason(profile: AccountProfile | null, serverId: number): string | null {
  if (!profile) return 'No active account profile is available.'
  const decision = decideServerOperationAccess(profile, serverId, 'remote-access')
  switch (decision.reason) {
    case undefined:
      return null
    case 'observe-only':
      return 'Observe-only safety allows views and diagnostics, but blocks server changes and remote access.'
    case 'guarded-not-configured':
      return 'Protected mode requires at least one Read-only or Maintenance server.'
    case 'protected-server':
      return 'Read-only under this profile’s local safety policy.'
    case 'maintenance-restricted':
      return 'This structural action is outside the Maintenance tier.'
    case 'invalid-server':
      return 'The server identity cannot be verified safely.'
    case 'invalid-operation':
      return 'Remote access has not been classified for safe live-account use.'
  }
}

interface RouterDeps {
  profiles: Omit<AccountProfile, 'token'>[]
  activeProfile: AccountProfile | null
  client: BinaryLaneClient | null
  servers: ServerResponse[]
  isLoadingServers: boolean
  onSwitchProfile: (profileId: string) => Promise<void> | void
  onSelectServer: (server: ServerResponse) => void
  onSelectServerSubTab: (tab: ServerSubTab) => void
  onSelectTab: (tab: ActiveTab) => void
  onSafetyBlocked: (message: string) => void
}

/**
 * Subscribes to bldesk:// links (cold-start and while running) and routes them
 * once the app has enough state to act — the right profile, a client, and the
 * server list. Links that arrive early simply wait in `pending` until they can
 * be resolved, so a link that launched the app works the same as one clicked
 * while it's open.
 */
export function useDeepLinkRouter(deps: RouterDeps): void {
  const [pending, setPending] = useState<DeepLink | null>(null)
  const depsRef = useRef(deps)
  depsRef.current = deps
  const busyRef = useRef(false)

  // Subscribe once
  useEffect(() => {
    const api = window.bldeskApi
    if (!api?.onDeepLink) return

    const accept = (url: string | null) => {
      if (!url) return
      const link = parseDeepLink(url)
      if (!link) {
        depsRef.current.onSafetyBlocked('BLDesk could not recognise that deep link.')
        return
      }
      setPending(link)
    }

    const unsub = api.onDeepLink(accept)
    api.getPendingDeepLink?.().then(accept).catch(() => {})
    api.deepLinkReady?.().catch(() => {})
    return unsub
  }, [])

  // Resolve whenever the link or the state it depends on changes
  useEffect(() => {
    if (!pending || busyRef.current) return
    const d = depsRef.current
    const link = pending

    // 1. Account switch requested?
    if (link.account) {
      const wanted = link.account.toLowerCase()
      const matches = (p: { name: string; email?: string }) =>
        p.name.toLowerCase() === wanted || (p.email || '').toLowerCase() === wanted
      const target = d.profiles.find(matches)
      const stripped = { ...link, account: undefined } as DeepLink
      if (target && (!d.activeProfile || d.activeProfile.id !== target.id)) {
        setPending(stripped) // re-run after the switch lands
        void d.onSwitchProfile(target.id)
        return
      }
      if (!target) {
        d.onSafetyBlocked('The requested account profile was not found; the deep link was not opened.')
        setPending(null)
        return
      }
      setPending(stripped)
      return
    }

    // 2. Navigation-only links need no data
    if (link.kind === 'home') {
      setPending(null)
      return
    }
    if (link.kind === 'tab') {
      d.onSelectTab(link.tab as ActiveTab)
      setPending(null)
      return
    }

    // 3. Server-scoped links need a client and (ideally) the server list
    if (!d.client) return // wait for auth
    const cached = d.servers.find((s) => s.id === link.serverId)
    if (!cached && d.isLoadingServers) return // wait for the first fetch

    busyRef.current = true
    ;(async () => {
      try {
        let server: ServerResponse | null = cached ?? null
        if (!server) {
          const { data } = await d.client!.GET('/v2/servers/{server_id}', { params: { path: { server_id: link.serverId } } })
          server = (data?.server as ServerResponse | undefined) ?? null
        }
        if (!server) {
          d.onSafetyBlocked(`Server #${link.serverId} was not found in the active account.`)
          return
        }

        const opensRemoteAccess = link.kind === 'ssh' || link.kind === 'console'
        if (opensRemoteAccess) {
          const blockReason = remoteAccessBlockReason(depsRef.current.activeProfile, server.id)
          if (blockReason) {
            d.onSafetyBlocked(`Blocked locally: ${server.name} — ${blockReason}`)
            return
          }
        }

        switch (link.kind) {
          case 'server':
            d.onSelectServer(server)
            if (link.subTab) d.onSelectServerSubTab(link.subTab as ServerSubTab)
            d.onSelectTab('servers')
            break

          case 'ssh': {
            const ip = primaryIpv4(server)
            d.onSelectServer(server)
            d.onSelectServerSubTab('remote-access')
            d.onSelectTab('servers')
            const remoteService = remoteServiceProbeForImage(server.image)
            if (remoteService.kind === 'rdp') {
              d.onSafetyBlocked(`${server.name} uses RDP on TCP 3389; BLDesk does not launch RDP yet.`)
              break
            }
            if (!ip) {
              d.onSafetyBlocked(`${server.name} has no IPv4 address to SSH to.`)
              break
            }
            await launchSsh({ serverId: server.id, host: ip, username: 'root' })
            break
          }

          case 'console': {
            d.onSelectServer(server)
            d.onSelectServerSubTab('remote-access')
            d.onSelectTab('servers')
            if (!window.bldeskApi?.openRescueConsole) throw new Error('Rescue-console access is unavailable in this build.')
            const result = await window.bldeskApi.openRescueConsole({
              serverId: server.id,
              serverName: server.name
            })
            if (!result.success) throw new Error(result.error || 'Rescue-console access was refused.')
            break
          }
        }
      } catch (err: any) {
        d.onSafetyBlocked(`Could not open the deep link: ${err?.message || err}`)
      } finally {
        busyRef.current = false
        setPending(null)
      }
    })()
  }, [pending, deps.activeProfile?.id, deps.client, deps.servers, deps.isLoadingServers, deps.profiles])
}
