import { useEffect, useRef, useState } from 'react'
import { components } from '@shared/api/schema'
import { AccountProfile } from '@shared/ipc-types'
import { DeepLink, formatDeepLink, parseDeepLink } from '@shared/deeplink'
import { BinaryLaneClient } from '../api/client'
import { ActiveTab, ServerSubTab } from '../components/layout/Sidebar'
import { openSsh } from './openSsh'
import { openHelp, LOCAL_DEEP_LINK_EVENT } from './helpNavigation'

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

    const accept = (url: string | null) => {
      if (!url) return
      const link = parseDeepLink(url)
      if (!link) {
        console.warn('[DeepLink] Ignoring unrecognised link:', url)
        return
      }
      setPending(link)
    }

    const local = (event: Event) => accept((event as CustomEvent<string>).detail)
    window.addEventListener(LOCAL_DEEP_LINK_EVENT, local)
    const unsub = api?.onDeepLink?.(accept)
    api?.getPendingDeepLink?.().then(accept).catch(() => {})
    api?.deepLinkReady?.().catch(() => {})
    return () => { unsub?.(); window.removeEventListener(LOCAL_DEEP_LINK_EVENT, local) }
  }, [])

  // Resolve whenever the link or the state it depends on changes
  useEffect(() => {
    if (!pending || busyRef.current) return
    const d = depsRef.current
    const link = pending

    if (link.kind === 'help') {
      openHelp({ slug: link.slug, heading: link.heading })
      setPending(null)
      return
    }

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
      if (!target) console.warn(`[DeepLink] No profile matches account "${link.account}"; using the active one`)
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
          alert(`Server #${link.serverId} was not found on ${d.activeProfile?.name ?? 'this account'}.`)
          return
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
            d.onSelectTab('servers')
            if (!ip) {
              alert(`${server.name} has no IPv4 address to SSH to.`)
              break
            }
            await openSsh({ host: ip, username: 'root', serverId: server.id, serverName: server.name })
            break
          }

          case 'console': {
            d.onSelectServer(server)
            d.onSelectServerSubTab('remote-access')
            d.onSelectTab('servers')
            const { data } = await d.client!.GET('/v2/servers/{server_id}/console', {
              params: { path: { server_id: server.id } }
            })
            const url = data?.console?.browser || data?.console?.iframe
            if (!url) {
              alert(`Couldn't get a rescue console URL for ${server.name}.`)
              break
            }
            await window.bldeskApi?.openRescueConsole?.({
              serverId: server.id,
              serverName: server.name,
              url,
              width: data?.console?.width || 1024,
              height: data?.console?.height || 768
            })
            break
          }
        }
      } catch (err: any) {
        console.error('[DeepLink] Failed to route link:', err)
        alert(`Couldn't open link: ${err?.message || err}`)
      } finally {
        busyRef.current = false
        setPending(null)
      }
    })()
  }, [pending, deps.activeProfile?.id, deps.client, deps.servers, deps.isLoadingServers, deps.profiles])
}
