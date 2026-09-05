/**
 * bldesk:// deep links — one parser and one formatter shared by the main
 * process (which receives the URL from the OS) and the renderer (which routes
 * it and produces "Copy link" buttons).
 *
 *   bldesk://server/<id>[/<subtab>]     open a server (optionally on a sub-tab)
 *   bldesk://console/<id>               open the rescue console for a server
 *   bldesk://ssh/<id>                   open SSH using the desktop preference
 *   bldesk://tab/<name>                 jump to a top-level tab (vpcs, dns, firewall…)
 *   bldesk://home                       just bring the window to the front
 *
 * Optional `?account=<profile name or email>` on any link asks the app to switch
 * to that profile first, so a link pasted into a ticket lands on the right account.
 */

export const DEEP_LINK_SCHEME = 'bldesk'

export const SERVER_SUB_TABS = ['overview', 'remote-access', 'usage', 'cloud-init', 'network', 'backups', 'firewall', 'settings', 'recovery', 'change-plan', 'cancel'] as const
export type DeepLinkServerSubTab = (typeof SERVER_SUB_TABS)[number]

export const TOP_TABS = ['servers', 'templates', 'vpcs', 'firewall', 'loadbalancers', 'dns', 'backups', 'keys', 'billing', 'account', 'history', 'help', 'map', 'heatmap', 'terminal'] as const
export type DeepLinkTab = (typeof TOP_TABS)[number]

export type DeepLink =
  | { kind: 'help'; slug: string; heading?: string; account?: string }
  | { kind: 'server'; serverId: number; subTab?: DeepLinkServerSubTab; account?: string }
  | { kind: 'console'; serverId: number; account?: string }
  | { kind: 'ssh'; serverId: number; account?: string }
  | { kind: 'tab'; tab: DeepLinkTab; account?: string }
  | { kind: 'home'; account?: string }

const ID_RE = /^\d{1,12}$/

/** Is this string something we should even try to parse as a bldesk link? */
export function isDeepLinkUrl(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`)
}

/** Parse a bldesk:// URL. Returns null for anything malformed or unknown. */
export function parseDeepLink(raw: string): DeepLink | null {
  if (!isDeepLinkUrl(raw)) return null

  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null

  // `bldesk://server/123/network` → host "server", path "/123/network".
  // Also accept `bldesk:///server/123` and `bldesk:server/123`, both of which
  // some launchers produce, by folding host back into the path.
  let segments: string[], heading: string | undefined
  try {
    segments = [url.hostname, ...url.pathname.split('/')].map((s) => decodeURIComponent(s).trim().toLowerCase()).filter(Boolean)
    heading = url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined
  } catch { return null }
  const account = url.searchParams.get('account')?.trim() || undefined
  const withAccount = <T extends DeepLink>(link: T): T => (account ? { ...link, account } : link)

  const [head, a, b] = segments
  switch (head) {
    case 'help':
      if (segments.length > 2 || (a && !/^[a-z0-9-]+$/.test(a)) || (heading && !/^[a-z0-9-]+$/.test(heading))) return null
      return { kind: 'help', slug: a || 'getting-started', heading }
    case undefined:
    case 'home':
      return withAccount({ kind: 'home' })
    case 'server':
    case 'servers': {
      if (!a || !ID_RE.test(a)) return null
      const subTab = b && (SERVER_SUB_TABS as readonly string[]).includes(b) ? (b as DeepLinkServerSubTab) : undefined
      return withAccount({ kind: 'server', serverId: Number(a), subTab })
    }
    case 'console': {
      if (!a || !ID_RE.test(a)) return null
      return withAccount({ kind: 'console', serverId: Number(a) })
    }
    case 'ssh': {
      if (!a || !ID_RE.test(a)) return null
      return withAccount({ kind: 'ssh', serverId: Number(a) })
    }
    case 'tab': {
      if (!a || !(TOP_TABS as readonly string[]).includes(a)) return null
      return withAccount({ kind: 'tab', tab: a as DeepLinkTab })
    }
    default:
      return null
  }
}

/** Format a DeepLink back to its canonical URL. */
export function formatDeepLink(link: DeepLink): string {
  let path: string
  switch (link.kind) {
    case 'help':
      return `${DEEP_LINK_SCHEME}://help/${encodeURIComponent(link.slug)}${link.heading ? `#${encodeURIComponent(link.heading)}` : ''}`
    case 'home':
      path = 'home'
      break
    case 'server':
      path = link.subTab && link.subTab !== 'overview' ? `server/${link.serverId}/${link.subTab}` : `server/${link.serverId}`
      break
    case 'console':
      path = `console/${link.serverId}`
      break
    case 'ssh':
      path = `ssh/${link.serverId}`
      break
    case 'tab':
      path = `tab/${link.tab}`
      break
  }
  const query = link.account ? `?account=${encodeURIComponent(link.account)}` : ''
  return `${DEEP_LINK_SCHEME}://${path}${query}`
}

/** Pull the first bldesk:// argument out of a process argv (Windows / Linux launch). */
export function findDeepLinkInArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (isDeepLinkUrl(arg)) return arg
  }
  return null
}
