import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BinaryLaneClient } from './client'
import { components } from '@shared/api/schema'
import type { FleetMetricResult } from '../lib/heatmap'

type ServerResponse = components['schemas']['Server']

// --- SERVERS & COMPUTE ---

export function useServers(client: BinaryLaneClient | null, profileId?: string) {
  return useQuery<ServerResponse[]>({
    queryKey: ['servers', profileId || 'default'],
    queryFn: async () => {
      if (!client) return []
      let allServers: any[] = []
      let page = 1
      let hasMore = true

      while (hasMore && page <= 10) {
        const { data, error } = await client.GET('/v2/servers', {
          params: { query: { per_page: 200, page } }
        })
        if (error) {
          console.warn('[useServers] Query error:', describeApiError(error))
          // A failed first page must not become "no servers": returning [] here
          // replaced the cached list with nothing on any transient API failure
          // (blank sidebar, empty matrix, tray at 0) until the next poll. Throw
          // instead so React Query keeps the last good data and retries.
          if (page === 1) throw new Error(describeApiError(error))
          break
        }
        const pageServers = data?.servers || []
        allServers = [...allServers, ...pageServers]
        if (!data?.links?.pages?.next || pageServers.length === 0) {
          hasMore = false
        } else {
          page++
        }
      }

      // Persist to local cache for instant cold-start loading
      try {
        if (profileId && allServers.length > 0) {
          localStorage.setItem(`bldesk_cached_servers_${profileId}`, JSON.stringify(allServers))
        }
      } catch {
        // ignore quota
      }

      return allServers
    },
    initialData: () => {
      if (!profileId) return undefined
      try {
        const raw = localStorage.getItem(`bldesk_cached_servers_${profileId}`)
        return raw ? JSON.parse(raw) : undefined
      } catch {
        return undefined
      }
    },
    enabled: !!client,
    refetchInterval: 15000,
    staleTime: 10000
  })
}

export function useServer(client: BinaryLaneClient | null, serverId: number | null) {
  return useQuery({
    queryKey: ['server', serverId],
    queryFn: async () => {
      if (!client || !serverId) return null
      const { data, error } = await client.GET('/v2/servers/{server_id}', {
        params: { path: { server_id: serverId } }
      })
      if (error) throw new Error(JSON.stringify(error))
      return data?.server || null
    },
    enabled: !!client && !!serverId,
    refetchInterval: 10000
  })
}

export function useServerUserData(client: BinaryLaneClient | null, serverId: number | null) {
  return useQuery({
    queryKey: ['server-user-data', serverId],
    queryFn: async () => {
      if (!client || !serverId) return null
      const { data, error } = await client.GET('/v2/servers/{server_id}/user_data', {
        params: { path: { server_id: serverId } }
      })
      if (error) throw new Error(describeApiError(error))
      return data?.user_data ?? null
    },
    enabled: !!client && !!serverId,
    staleTime: 60000
  })
}

export function useFleetUserData(client: BinaryLaneClient | null, serverIds: number[]) {
  const key = serverIds.join(',')
  return useQuery({
    queryKey: ['fleet-user-data', key],
    queryFn: async () => {
      const map = new Map<number, string | null | undefined>()
      if (!client) return map
      const results = await mapLimitNullable(serverIds, 4, async (id) => {
        const { data, error } = await client.GET('/v2/servers/{server_id}/user_data', {
          params: { path: { server_id: id } },
          signal: AbortSignal.timeout(20_000)
        })
        if (error) throw new Error(describeApiError(error))
        return { userData: data?.user_data ?? null }
      })
      serverIds.forEach((id, i) => map.set(id, results[i] === null ? undefined : results[i]?.userData))
      return map
    },
    enabled: !!client && serverIds.length > 0,
    staleTime: 60000
  })
}

export function useServerMetrics(client: BinaryLaneClient | null, serverId: number | null) {
  return useQuery({
    queryKey: ['serverMetrics', serverId],
    queryFn: async () => {
      if (!client || !serverId) return null
      const { data, error } = await client.GET('/v2/samplesets/{server_id}/latest', {
        params: { path: { server_id: serverId } }
      })
      if (error) return null
      return data?.sample_set || null
    },
    enabled: !!client && !!serverId,
    refetchInterval: 5000 // live gauges poll every 5s
  })
}

// --- SERVER ACTIONS MUTATION ---

export function useServerActionMutation(client: BinaryLaneClient | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ serverId, actionPayload }: { serverId: number; actionPayload: any }) => {
      if (!client) throw new Error('No client available')
      const { data, error } = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: serverId } },
        body: actionPayload
      })
      // describeApiError rather than JSON.stringify: the raw body was being shown
      // to users verbatim in an alert().
      if (error) throw new Error(describeApiError(error))
      return data?.action
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      queryClient.invalidateQueries({ queryKey: ['server', variables.serverId] })
      // A resize can change what the server is licensed for.
      queryClient.invalidateQueries({ queryKey: ['server-software', variables.serverId] })
    }
  })
}

// --- ACCOUNT & BILLING ---

export function useAccount(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['account'],
    queryFn: async () => {
      if (!client) return null
      const { data, error } = await client.GET('/v2/account')
      if (error) throw new Error(JSON.stringify(error))
      return data?.account || null
    },
    enabled: !!client
  })
}

export function useBalance(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['balance'],
    queryFn: async () => {
      if (!client) return null
      const { data, error } = await client.GET('/v2/customers/my/balance')
      if (error) throw new Error(JSON.stringify(error))
      return data?.balance || null
    },
    enabled: !!client,
    refetchInterval: 60000
  })
}

/**
 * Invoices whose payment attempt failed and remain unpaid. Surfaced separately so
 * the billing view can warn about them without the user opening every invoice.
 */
export function useUnpaidInvoices(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['unpaid-invoices'],
    queryFn: async () => {
      if (!client) return []
      const { data, error } = await client.GET('/v2/customers/my/unpaid-payment-failed-invoices')
      if (error) throw new Error(JSON.stringify(error))
      return data?.invoices || []
    },
    enabled: !!client
  })
}

/**
 * Invoices are paginated server-side: `per_page` defaults to 20 and caps at 200.
 * Calling this without parameters silently returns only the 20 most recent and
 * drops `meta.total`, leaving older invoices unreachable — so page through it
 * explicitly and hand the total back for the pager.
 */
export function useInvoices(client: BinaryLaneClient | null, page = 1, perPage = 20) {
  return useQuery({
    queryKey: ['invoices', page, perPage],
    queryFn: async () => {
      if (!client) return { invoices: [], total: 0 }
      const { data, error } = await client.GET('/v2/customers/my/invoices', {
        params: { query: { page, per_page: perPage } }
      })
      if (error) throw new Error(JSON.stringify(error))
      return { invoices: data?.invoices || [], total: data?.meta?.total ?? 0 }
    },
    enabled: !!client,
    placeholderData: (prev) => prev
  })
}

export function useDataUsage(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['dataUsageCurrent'],
    queryFn: async () => {
      if (!client) return []
      const { data, error } = await client.GET('/v2/data_usages/current')
      if (error) return []
      return data?.data_usages || []
    },
    enabled: !!client
  })
}

// --- VPCS ---

export function useVpcs(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['vpcs'],
    queryFn: async () => {
      if (!client) return []
      const { data, error } = await client.GET('/v2/vpcs')
      if (error) throw new Error(JSON.stringify(error))
      return data?.vpcs || []
    },
    enabled: !!client
  })
}

// --- FIREWALL RULES ---

export function useFirewallRules(client: BinaryLaneClient | null, serverId: number | null) {
  return useQuery({
    queryKey: ['firewallRules', serverId],
    queryFn: async () => {
      if (!client || !serverId) return []
      const { data, error } = await client.GET('/v2/servers/{server_id}/advanced_firewall_rules', {
        params: { path: { server_id: serverId } }
      })
      if (error) return []
      return data?.firewall_rules || []
    },
    enabled: !!client && !!serverId
  })
}

/** Run `fn` over `items` with at most `limit` in flight; per-item failures become `null`. */
async function mapLimitNullable<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      try {
        out[i] = await fn(items[i])
      } catch {
        out[i] = null
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * Every server's firewall rules in one query, for the fleet matrix. One GET
 * per server, four at a time; a server whose rules could not be read maps to
 * `null` so the matrix can say so rather than show it as rule-less.
 */
export function useFleetFirewalls(client: BinaryLaneClient | null, serverIds: number[]) {
  const key = serverIds.join(',')
  return useQuery({
    queryKey: ['fleet-firewalls', key],
    queryFn: async () => {
      const map = new Map<number, any[] | null>()
      if (!client) return map
      const results = await mapLimitNullable(serverIds, 4, async (id) => {
        const { data, error } = await client.GET('/v2/servers/{server_id}/advanced_firewall_rules', {
          params: { path: { server_id: id } },
          signal: AbortSignal.timeout(20_000)
        })
        if (error) throw new Error(describeApiError(error))
        return data?.firewall_rules || []
      })
      serverIds.forEach((id, i) => map.set(id, results[i]))
      return map
    },
    enabled: !!client && serverIds.length > 0,
    staleTime: 60_000
  })
}

/** BinaryLane publishes one sample set per 5-minute period; polling faster returns the same sample. */
export const SAMPLE_PERIOD_MS = 5 * 60 * 1000
/**
 * How long after a period ends its sample set appears on /latest. Measured
 * 2026-09-03 on a 4-vCPU server: the 07:20–07:25 sample was absent at
 * 07:26:27 and present at 07:26:41, so publish lag is roughly 80–100 s.
 * Two minutes keeps the first fetch after the lag rather than before it.
 */
const SAMPLE_PUBLISH_SLACK_MS = 120_000

/**
 * When the next sample set can exist: 5 minutes after the newest period end we
 * have seen, plus a little slack for it to be published. Falls back to a plain
 * 5-minute interval when nothing has been fetched yet, and never sooner than
 * 30 s so a clock skew cannot turn this into a tight loop.
 */
function nextSampleDelay(samples: Map<number, FleetMetricResult> | undefined, now = Date.now()): number {
  let newest = 0
  for (const result of samples?.values() ?? []) {
    const end = result.sample ? Date.parse(result.sample.period.end) : NaN
    if (Number.isFinite(end) && end > newest) newest = end
  }
  if (!newest) return SAMPLE_PERIOD_MS
  const due = newest + SAMPLE_PERIOD_MS + SAMPLE_PUBLISH_SLACK_MS - now
  return Math.min(SAMPLE_PERIOD_MS, Math.max(30_000, due))
}

/** Latest metrics for the active fleet, four requests at a time, once per sample period. */
function combineAbortSignals(querySignal: AbortSignal, timeoutSignal: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([querySignal, timeoutSignal])
  const controller = new AbortController()
  const forward = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason)
  }
  for (const source of [querySignal, timeoutSignal]) {
    if (source.aborted) forward(source)
    else source.addEventListener('abort', () => forward(source), { once: true })
  }
  return controller.signal
}

export function useFleetMetrics(client: BinaryLaneClient | null, serverIds: number[]) {
  const key = serverIds.join(',')
  return useQuery({
    queryKey: ['fleet-metrics', key],
    queryFn: async ({ signal }) => {
      const map = new Map<number, FleetMetricResult>()
      if (!client) return map
      const results = await mapLimitNullable(serverIds, 4, async (id) => {
        try {
          const timeout = AbortSignal.timeout(20_000)
          const requestSignal = combineAbortSignals(signal, timeout)
          const { data, error } = await client.GET('/v2/samplesets/{server_id}/latest', {
            params: { path: { server_id: id } },
            signal: requestSignal
          })
          if (error) return { sample: null, error: describeApiError(error) }
          return { sample: data?.sample_set ?? null, error: null }
        } catch (error) {
          return { sample: null, error: error instanceof Error ? error.message : 'Metrics request failed.' }
        }
      })
      serverIds.forEach((id, index) => map.set(id, results[index] ?? { sample: null, error: 'Metrics request failed.' }))
      return map
    },
    enabled: !!client && serverIds.length > 0,
    refetchInterval: (query) => nextSampleDelay(query.state.data),
    placeholderData: keepPreviousData
  })
}

/**
 * Members of every VPC, for the network map: the authoritative answer to
 * "what is in this VPC" (servers and load balancers), rather than reading each
 * server's own vpc_id. One GET per VPC, four at a time.
 */
export function useVpcMembers(client: BinaryLaneClient | null, vpcIds: number[]) {
  const key = vpcIds.join(',')
  return useQuery({
    queryKey: ['vpc-members', key],
    queryFn: async () => {
      const map = new Map<number, Array<{ resource_type: string; resource_id: string; name: string }> | null>()
      if (!client) return map
      const results = await mapLimitNullable(vpcIds, 4, async (id) => {
        const { data, error } = await client.GET('/v2/vpcs/{vpc_id}/members', {
          params: { path: { vpc_id: id }, query: { per_page: 200 } as any },
          signal: AbortSignal.timeout(20_000)
        })
        if (error) throw new Error(describeApiError(error))
        return (data?.members || []) as Array<{ resource_type: string; resource_id: string; name: string }>
      })
      vpcIds.forEach((id, i) => map.set(id, results[i]))
      return map
    },
    enabled: !!client && vpcIds.length > 0,
    staleTime: 60_000
  })
}

export function useUpdateFirewallRulesMutation(client: BinaryLaneClient | null, serverId: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (rules: any[]) => {
      if (!client || !serverId) throw new Error('No client or serverId')
      const { data, error } = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: serverId } },
        body: {
          type: 'change_advanced_firewall_rules',
          firewall_rules: rules
        }
      })
      if (error) throw new Error(JSON.stringify(error))
      return data?.action
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['firewallRules', serverId] })
    }
  })
}

// --- LOAD BALANCERS ---

export function useLoadBalancers(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['loadBalancers'],
    queryFn: async () => {
      if (!client) return []
      const { data, error } = await client.GET('/v2/load_balancers')
      if (error) throw new Error(JSON.stringify(error))
      const lbs = data?.load_balancers || []

      // Concurrently fetch full details for each load balancer to ensure server_ids and live status are fully loaded
      const detailedLbs = await Promise.all(
        lbs.map(async (lb) => {
          try {
            const { data: detailData } = await client.GET('/v2/load_balancers/{load_balancer_id}', {
              params: { path: { load_balancer_id: lb.id } }
            })
            return detailData?.load_balancer || lb
          } catch {
            return lb
          }
        })
      )
      return detailedLbs
    },
    enabled: !!client
  })
}

export function useAddServerToLoadBalancerMutation(client: BinaryLaneClient | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ loadBalancerId, serverId }: { loadBalancerId: number; serverId: number }) => {
      if (!client) throw new Error('No client')
      const { error } = await client.POST('/v2/load_balancers/{load_balancer_id}/servers', {
        params: { path: { load_balancer_id: loadBalancerId } },
        body: { server_ids: [serverId] }
      })
      if (error) throw new Error(JSON.stringify(error))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loadBalancers'] })
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    }
  })
}

export function useRemoveServerFromLoadBalancerMutation(client: BinaryLaneClient | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ loadBalancerId, serverId }: { loadBalancerId: number; serverId: number }) => {
      if (!client) throw new Error('No client')
      const { error } = await client.DELETE('/v2/load_balancers/{load_balancer_id}/servers', {
        params: { path: { load_balancer_id: loadBalancerId } },
        body: { server_ids: [serverId] }
      })
      if (error) throw new Error(JSON.stringify(error))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loadBalancers'] })
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    }
  })
}

export function useCreateLoadBalancerMutation(client: BinaryLaneClient | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: any) => {
      if (!client) throw new Error('No client')
      const { data, error } = await client.POST('/v2/load_balancers', { body })
      if (error) throw new Error(JSON.stringify(error))
      return data?.load_balancer
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loadBalancers'] })
    }
  })
}

export function useDeleteLoadBalancerMutation(client: BinaryLaneClient | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (loadBalancerId: number) => {
      if (!client) throw new Error('No client')
      const { error } = await client.DELETE('/v2/load_balancers/{load_balancer_id}', {
        params: { path: { load_balancer_id: loadBalancerId } }
      })
      if (error) throw new Error(JSON.stringify(error))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loadBalancers'] })
    }
  })
}

// --- DNS DOMAINS & RECORDS ---

/** API maximum for /v2/domains. */
const DOMAIN_PAGE_SIZE = 200
/** Ceiling on paging: 2000 domains is far beyond any real account. */
const MAX_DOMAIN_PAGES = 10

/**
 * All domains on the account.
 *
 * `per_page` defaults to 20, so a bare call returned only the first 20 and
 * dropped `meta.total` — an account with a few hundred zones simply lost most of
 * them, with nothing in the UI to say so.
 */
/**
 * Fetch every page of a paginated list endpoint.
 *
 * `per_page` defaults to 20 across this API and `meta.total` is returned but easy
 * to ignore, which silently truncates. It matters for the create form: there are
 * 27 distribution images and 21 sizes, so a single default-page request drops 7
 * operating systems and a plan without any indication.
 */
async function fetchAllPages<T>(
  fetchPage: (page: number, perPage: number) => Promise<{ data?: { meta?: { total?: number } } & Record<string, any>; error?: unknown }>,
  key: string,
  label: string
): Promise<T[]> {
  const PER_PAGE = 200
  const MAX_PAGES = 10
  const first = await fetchPage(1, PER_PAGE)
  if (first.error) throw new Error(describeApiError(first.error))
  const items: T[] = [...((first.data?.[key] as T[]) || [])]
  const total = first.data?.meta?.total ?? items.length
  const pages = Math.min(Math.ceil(total / PER_PAGE), MAX_PAGES)
  if (pages > 1) {
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchPage(i + 2, PER_PAGE)))
    for (const r of rest) {
      if (r.error) {
        console.warn(`[${label}] Error loading a page:`, r.error)
        continue
      }
      items.push(...((r.data?.[key] as T[]) || []))
    }
  }
  return items
}

export function useDomains(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['domains'],
    queryFn: async () => {
      if (!client) return []

      const fetchPage = (page: number) =>
        client.GET('/v2/domains', { params: { query: { page, per_page: DOMAIN_PAGE_SIZE } as any } })

      const first = await fetchPage(1)
      if (first.error) throw new Error(describeApiError(first.error))

      const domains = [...(first.data?.domains || [])]
      const total = first.data?.meta?.total ?? domains.length
      const pages = Math.min(Math.ceil(total / DOMAIN_PAGE_SIZE), MAX_DOMAIN_PAGES)

      if (pages > 1) {
        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchPage(i + 2)))
        for (const r of rest) {
          if (r.error) {
            // A partial list still beats an empty one; the count below shows the shortfall.
            console.warn('[useDomains] Error loading a domain page:', r.error)
            continue
          }
          domains.push(...(r.data?.domains || []))
        }
      }
      return domains
    },
    enabled: !!client
  })
}

/**
 * BinaryLane's own nameservers, used to tell whether a zone's authority is
 * actually delegated here or the zone is merely staged locally.
 */
export function useLocalNameservers(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['local-nameservers'],
    queryFn: async () => {
      if (!client) return [] as string[]
      const { data, error } = await client.GET('/v2/domains/nameservers')
      if (error) throw new Error(describeApiError(error))
      return (data?.local_nameservers || []) as string[]
    },
    enabled: !!client,
    staleTime: 24 * 60 * 60 * 1000 // effectively static
  })
}

export function useDomainRecords(client: BinaryLaneClient | null, domainName: string | null) {
  return useQuery({
    queryKey: ['domainRecords', domainName],
    queryFn: async () => {
      if (!client || !domainName) return []
      const { data, error } = await client.GET('/v2/domains/{domain_name}/records', {
        params: { path: { domain_name: domainName } }
      })
      if (error) throw new Error(JSON.stringify(error))
      return data?.domain_records || []
    },
    enabled: !!client && !!domainName
  })
}

// --- SIZES, REGIONS & IMAGES ---

/** Every plan, including the one past the default 20-item page. */
export function useSizes(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['sizes'],
    queryFn: async () => {
      if (!client) return []
      return fetchAllPages<any>(
        (page, per_page) => client.GET('/v2/sizes', { params: { query: { page, per_page } as any } }),
        'sizes',
        'useSizes'
      )
    },
    enabled: !!client,
    staleTime: 300000
  })
}

export function useRegions(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['regions'],
    queryFn: async () => {
      if (!client) return []
      const { data, error } = await client.GET('/v2/regions')
      if (error) return []
      return data?.regions || []
    },
    enabled: !!client,
    staleTime: 300000
  })
}

/**
 * Every image. There are 27 distribution images against a default page of 20, so
 * the unpaged call was hiding seven operating systems from the create form.
 */
export function useImages(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['images'],
    queryFn: async () => {
      if (!client) return []
      return fetchAllPages<any>(
        (page, per_page) => client.GET('/v2/images', { params: { query: { page, per_page } as any } }),
        'images',
        'useImages'
      )
    },
    enabled: !!client,
    staleTime: 300000
  })
}

/** Distribution images only, which is what the create form offers. */
export function useDistributionImages(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['images', 'distribution'],
    queryFn: async () => {
      if (!client) return []
      return fetchAllPages<any>(
        (page, per_page) =>
          client.GET('/v2/images', { params: { query: { page, per_page, type: 'distribution' } as any } }),
        'images',
        'useDistributionImages'
      )
    },
    enabled: !!client,
    staleTime: 300000
  })
}

export function useHistoricalMetrics(client: BinaryLaneClient | null, serverId: number | null) {
  return useQuery({
    queryKey: ['historicalMetrics', serverId],
    queryFn: async () => {
      if (!client || !serverId) return []
      const { data, error } = await client.GET('/v2/samplesets/{server_id}', {
        params: { path: { server_id: serverId } }
      })
      if (error) return []
      return (data as any)?.sample_sets || []
    },
    enabled: !!client && !!serverId,
    refetchInterval: 30000
  })
}

/** API maximum for this endpoint. */
const SAMPLE_PAGE_SIZE = 200
/** Ceiling on paging, so an unexpectedly huge window can't fan out endlessly. */
const MAX_SAMPLE_PAGES = 6

export function useSampleSets(
  client: BinaryLaneClient | null,
  serverId: number | undefined,
  interval: 'five-minute' | 'half-hour' | 'four-hour' | 'day' | 'week' | 'month' = 'five-minute',
  start?: string,
  end?: string
) {
  return useQuery({
    queryKey: ['sample-sets', serverId, interval, start, end],
    queryFn: async () => {
      if (!client || !serverId) return []

      // `per_page` caps at 200, but a day at five-minute resolution is ~288
      // samples, so a single request silently returned the oldest 200 and left
      // the most recent several hours missing from the chart. Page through until
      // the window is complete.
      const fetchPage = async (page: number) => {
        const query: Record<string, any> = {
          data_interval: interval,
          per_page: SAMPLE_PAGE_SIZE,
          page
        }
        if (start) query.start = start
        if (end) query.end = end
        return client.GET('/v2/samplesets/{server_id}', {
          params: { path: { server_id: serverId }, query: query as any }
        })
      }

      const first = await fetchPage(1)
      if (first.error) {
        console.warn('[useSampleSets] Error loading sample sets:', first.error)
        return []
      }

      const sets = [...(first.data?.sample_sets || [])]
      const total = first.data?.meta?.total ?? sets.length
      const pages = Math.min(Math.ceil(total / SAMPLE_PAGE_SIZE), MAX_SAMPLE_PAGES)

      if (pages > 1) {
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) => fetchPage(i + 2))
        )
        for (const r of rest) {
          if (r.error) {
            // A partial window still charts; better than dropping everything.
            console.warn('[useSampleSets] Error loading a sample page:', r.error)
            continue
          }
          sets.push(...(r.data?.sample_sets || []))
        }
      }
      return sets
    },
    enabled: !!client && !!serverId,
    refetchInterval: interval === 'five-minute' ? 30000 : 120000
  })
}

export function useCreateServerMutation(client: BinaryLaneClient | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: any) => {
      if (!client) throw new Error('No client')
      const { data, error } = await client.POST('/v2/servers', {
        body
      })
      if (error) throw new Error(JSON.stringify(error))
      return data?.server
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    }
  })
}

// --- SSH KEYS ---

export function useSshKeys(client: BinaryLaneClient | null) {
  return useQuery({
    queryKey: ['sshKeys'],
    queryFn: async () => {
      if (!client) return []
      const { data, error } = await client.GET('/v2/account/keys')
      if (error) throw new Error(JSON.stringify(error))
      return data?.ssh_keys || []
    },
    enabled: !!client
  })
}

export function useAddSshKeyMutation(client: BinaryLaneClient | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ name, publicKey }: { name: string; publicKey: string }) => {
      if (!client) throw new Error('No client')
      const { data, error } = await client.POST('/v2/account/keys', {
        body: { name, public_key: publicKey }
      })
      if (error) throw new Error(JSON.stringify(error))
      return data?.ssh_key
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sshKeys'] })
    }
  })
}

export function useDeleteSshKeyMutation(client: BinaryLaneClient | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (keyId: number) => {
      if (!client) throw new Error('No client')
      const { error } = await client.DELETE('/v2/account/keys/{key_id}', {
        params: { path: { key_id: keyId } }
      })
      if (error) throw new Error(JSON.stringify(error))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sshKeys'] })
    }
  })
}

// --- BACKUPS & SNAPSHOTS ---

export function useServerBackups(client: BinaryLaneClient | null, serverId: number | null) {
  return useQuery({
    queryKey: ['serverBackups', serverId],
    queryFn: async () => {
      if (!client || !serverId) return []
      const { data, error } = await client.GET('/v2/servers/{server_id}/backups', {
        params: { path: { server_id: serverId } }
      })
      if (error) throw new Error(describeApiError(error))
      return data?.backups || []
    },
    enabled: !!client && !!serverId
  })
}

export function useServerSnapshots(client: BinaryLaneClient | null, serverId: number | null) {
  return useQuery({
    queryKey: ['serverSnapshots', serverId],
    queryFn: async () => {
      if (!client || !serverId) return []
      const { data, error } = await client.GET('/v2/servers/{server_id}/snapshots', {
        params: { path: { server_id: serverId } }
      })
      if (error) throw new Error(describeApiError(error))
      return data?.snapshots || []
    },
    enabled: !!client && !!serverId
  })
}

export interface TakeBackupParams {
  label?: string
  backupType?: 'daily' | 'weekly' | 'monthly' | 'temporary'
  replacementStrategy?: 'none' | 'specified' | 'oldest' | 'newest'
  backupIdToReplace?: number
}

export function useServerActions(client: BinaryLaneClient | null, serverId: number | null) {
  return useQuery({
    queryKey: ['serverActions', serverId],
    queryFn: async () => {
      if (!client || !serverId) return []
      const { data, error } = await client.GET('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: serverId } }
      })
      if (error) throw new Error(describeApiError(error))
      return data?.actions || []
    },
    enabled: !!client && !!serverId,
    refetchInterval: 3000
  })
}

export function useTakeBackupMutation(client: BinaryLaneClient | null, serverId: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: string | TakeBackupParams | undefined) => {
      if (!client || !serverId) throw new Error('No client or serverId')

      const p: TakeBackupParams = typeof params === 'string' ? { label: params } : params || {}
      // Default to 'oldest' replacement strategy so that if all slots of this type are occupied,
      // BinaryLane smoothly replaces/rotates the oldest existing snapshot instead of throwing an error.
      const replacementStrategy = p.replacementStrategy || (p.backupIdToReplace ? 'specified' : 'oldest')
      const backupType = replacementStrategy === 'specified' ? undefined : (p.backupType || 'temporary')

      const body: any = {
        type: 'take_backup',
        replacement_strategy: replacementStrategy,
        label: p.label || undefined
      }

      if (backupType) {
        body.backup_type = backupType
      }
      if (p.backupIdToReplace) {
        body.backup_id_to_replace = p.backupIdToReplace
      }

      const { data, error } = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: serverId } },
        body
      })
      if (error) {
        const errorObj = error as any
        const msg =
          errorObj?.message ||
          errorObj?.title ||
          (errorObj?.errors && Object.values(errorObj.errors).flat().join(', ')) ||
          JSON.stringify(error)
        throw new Error(msg)
      }
      return data?.action
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serverBackups', serverId] })
      queryClient.invalidateQueries({ queryKey: ['serverSnapshots', serverId] })
      queryClient.invalidateQueries({ queryKey: ['serverActions', serverId] })
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    }
  })
}

export function useImageDownloadMutation(client: BinaryLaneClient | null) {
  return useMutation({
    mutationFn: async (imageId: number) => {
      if (!client) throw new Error('No client')
      const { data, error } = await client.GET('/v2/images/{image_id}/download', {
        params: { path: { image_id: imageId } }
      })
      if (error) {
        const errorObj = error as any
        const msg = errorObj?.message || errorObj?.title || JSON.stringify(error)
        throw new Error(msg)
      }
      return data?.link
    }
  })
}

export function useRestoreBackupMutation(client: BinaryLaneClient | null, serverId: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (imageId: number) => {
      if (!client || !serverId) throw new Error('No client or serverId')
      const { data, error } = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: serverId } },
        body: {
          type: 'restore',
          image: imageId
        }
      })
      if (error) throw new Error(JSON.stringify(error))
      return data?.action
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    }
  })
}

export function useToggleAutomatedBackupsMutation(client: BinaryLaneClient | null, serverId: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (enable: boolean) => {
      if (!client || !serverId) throw new Error('No client or serverId')
      const { data, error } = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: serverId } },
        body: {
          type: enable ? 'enable_backups' : 'disable_backups'
        }
      })
      if (error) throw new Error(JSON.stringify(error))
      return data?.action
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      queryClient.invalidateQueries({ queryKey: ['server', serverId] })
    }
  })
}

export function useAttachBackupMutation(client: BinaryLaneClient | null, serverId: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (imageId: number) => {
      if (!client || !serverId) throw new Error('No client or serverId')
      const { data, error } = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: serverId } },
        body: {
          type: 'attach_backup',
          image: imageId
        }
      })
      if (error) throw new Error(JSON.stringify(error))
      return data?.action
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      queryClient.invalidateQueries({ queryKey: ['server', serverId] })
    }
  })
}

export function useDetachBackupMutation(client: BinaryLaneClient | null, serverId: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!client || !serverId) throw new Error('No client or serverId')
      const { data, error } = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: serverId } },
        body: {
          type: 'detach_backup'
        }
      })
      if (error) throw new Error(JSON.stringify(error))
      return data?.action
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      queryClient.invalidateQueries({ queryKey: ['server', serverId] })
    }
  })
}

// --- ASYNC SERVER ACTIONS ---

/**
 * Every server action is asynchronous: the POST returns an `in-progress` action
 * and a 200 means "queued", not "done". There are four ways to submit one, and
 * the difference is what should happen to the UI while it runs:
 *
 * - `useServerActionMutation` — submit and return immediately. For the list and
 *   detail views, whose callers hand the queued action to the action tracker and
 *   let a toast report the outcome.
 * - `useServerActionWithHandoff` — submit, wait briefly, then release the UI and
 *   return the action still running for the caller to track. For the settings
 *   panel, where a quick change should confirm inline but a rebuild must not
 *   hold the panel hostage.
 * - `useNetworkActionMutation` — submit and block until it settles. For network
 *   changes only, where the hazard is a second write landing on top of an
 *   unsettled first one, so keeping the UI locked is the point.
 * - `useServerDiagnosticMutation` — submit and block until it completes, then
 *   return the action for its `result_data`. For `ping` / `uptime` /
 *   `is_running`, whose whole purpose is a value that does not exist until the
 *   action finishes.
 *
 * All four share `pollActionToSettled`, so the per-request cap, the tolerance
 * for one slow poll, and the checks for an action stalled on an operator answer
 * or an unpaid invoice cannot drift apart between them.
 */

type ServerAction = components['schemas']['Action']

/** Turn an openapi-fetch error body into something a human can read. */
export function describeApiError(error: unknown): string {
  if (!error) return 'Unknown error'
  if (typeof error === 'string') return error
  const e = error as { message?: string; detail?: string; title?: string; errors?: Record<string, string[]> }
  if (e.message) return e.message
  if (e.detail) return e.detail
  if (e.errors) {
    return Object.entries(e.errors)
      .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
      .join('; ')
  }
  return e.title || JSON.stringify(error)
}

/**
 * The detail of a failed action, or null when BinaryLane gave none.
 *
 * Deliberately does NOT fall back to `reason`. The spec defines that field as
 * "a user-friendly explanation of what is happening" — a running description,
 * not a verdict. A ping action carries reason "Your server is being pinged"
 * whether it succeeds or fails, so presenting it as the cause of a failure reads
 * as nonsense. The field that carries the cause is `error_message`, which the
 * live API returns on a failed action but which the generated schema only
 * declares on `Image` — hence the local cast rather than a schema change.
 */
export function describeActionFailure(action: ServerAction): string | null {
  const detail = (action as { error_message?: string | null }).error_message
  return detail && detail.trim() ? detail.trim() : null
}

/** One phrasing for "this action ended badly", used wherever an action is reported. */
export function actionFailureMessage(label: string, action: ServerAction): string {
  const detail = describeActionFailure(action)
  return detail ? `"${label}" ${action.status}: ${detail}` : `"${label}" ${action.status}`
}

/** The server actions the Network tab is allowed to submit — typed against the generated schema. */
export type NetworkActionPayload =
  | components['schemas']['ChangeIpv6']
  | components['schemas']['ChangeIpv6ReverseNameservers']
  | components['schemas']['ChangeReverseName']
  | components['schemas']['ChangePortBlocking']
  | components['schemas']['ChangeVpcIpv4']
  | components['schemas']['ChangeNetwork']
  | components['schemas']['ChangeSeparatePrivateNetworkInterface']

const ACTION_POLL_INTERVAL_MS = 2000
const ACTION_POLL_TIMEOUT_MS = 90_000
/** Per-request cap: a black-holed connection must not wedge the mutation (and the UI) forever. */
const ACTION_REQUEST_TIMEOUT_MS = 15_000

const isTimeoutError = (err: unknown): boolean =>
  err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')

/**
 * How an action finished, from the client's point of view.
 *
 * `awaiting-interaction` and `blocked-by-invoice` are first-class outcomes
 * rather than flavours of "still running", because BinaryLane has no status for
 * either: a stalled action reports `in-progress` indefinitely, and the only
 * signals are a non-null `user_interaction_required` or `blocking_invoice_id`.
 * Anything that treats them as "keep waiting" burns its whole timeout and then
 * blames the server for being slow — or, with no deadline, waits for something
 * that will never arrive on its own.
 */
export type SettledAction =
  | { state: 'completed'; action: ServerAction }
  | { state: 'errored'; action: ServerAction }
  | { state: 'awaiting-interaction'; action: ServerAction }
  | { state: 'blocked-by-invoice'; action: ServerAction }
  | { state: 'timed-out'; action: ServerAction | null }

export interface PollActionOptions {
  /** The just-submitted action, if the caller already has it. Saves a first poll. */
  initial?: ServerAction
  /**
   * Overall budget. `null` means no deadline, for background tracking of things
   * like a rebuild or a region migration that legitimately run for minutes —
   * any fixed cap short enough to suit a power cycle will misreport those.
   */
  timeoutMs?: number | null
  /** Cadence, or a function of elapsed time so long waits can ease off. */
  intervalMs?: number | ((elapsedMs: number) => number)
  /** Lets a tracker drop an action on profile switch or teardown. */
  signal?: AbortSignal
  /** Fires on every fresh snapshot, for progress display. */
  onProgress?: (action: ServerAction) => void
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Classify a snapshot, or null if it is genuinely still working. */
function classifyAction(action: ServerAction): SettledAction | null {
  // Both checked before status on purpose: a stalled action still says `in-progress`.
  if (action.user_interaction_required) return { state: 'awaiting-interaction', action }
  if (action.blocking_invoice_id) return { state: 'blocked-by-invoice', action }
  if (action.status === 'completed') return { state: 'completed', action }
  if (action.status === 'errored') return { state: 'errored', action }
  return null
}

/**
 * Poll one action until it settles. The single place this repeat-until-done
 * logic lives — both the blocking network mutation and background tracking use
 * it, so the per-request cap, the tolerance for one slow poll, and the
 * paused-for-operator check cannot drift apart between them.
 *
 * Lifecycle outcomes are returned. A genuine API failure throws, because that
 * is a different kind of event from "the action finished badly".
 */
export async function pollActionToSettled(
  client: BinaryLaneClient,
  actionId: number,
  options: PollActionOptions = {}
): Promise<SettledAction> {
  const { initial, timeoutMs = ACTION_POLL_TIMEOUT_MS, intervalMs = ACTION_POLL_INTERVAL_MS, signal, onProgress } = options

  let action: ServerAction | null = initial ?? null
  if (action) {
    const settled = classifyAction(action)
    if (settled) return settled
  }

  const startedAt = Date.now()
  const deadline = timeoutMs == null ? Number.POSITIVE_INFINITY : startedAt + timeoutMs

  for (;;) {
    if (Date.now() > deadline) return { state: 'timed-out', action }

    const elapsed = Date.now() - startedAt
    await sleep(typeof intervalMs === 'function' ? intervalMs(elapsed) : intervalMs, signal)

    let poll: { data?: { action?: ServerAction }; error?: unknown }
    try {
      poll = await client.GET('/v2/actions/{action_id}', {
        params: { path: { action_id: actionId } },
        signal: AbortSignal.timeout(ACTION_REQUEST_TIMEOUT_MS)
      })
    } catch (err) {
      // One slow poll is not a lost action — the deadline above bounds the total wait.
      if (isTimeoutError(err) && !signal?.aborted) continue
      throw err
    }
    if (poll.error) throw new Error(`Lost track of action #${actionId}: ${describeApiError(poll.error)}`)
    if (poll.data?.action) {
      action = poll.data.action
      onProgress?.(action)
      const settled = classifyAction(action)
      if (settled) return settled
    }
  }
}

/**
 * Submit a server action and poll it until BinaryLane reports it finished.
 * Network changes (IPv6, port blocking, VPC moves, reverse DNS) are asynchronous
 * on the BL side, so a bare POST returning 200 only means "queued". Resolves only
 * on `completed`; anything else (errored, timeout, lost action) throws so the UI
 * never reports success it hasn't seen. The server cache is refetched before the
 * promise settles, so callers can trust `server.networks` once `mutateAsync` returns.
 */
export const networkActionMutationKey = (serverId: number | null) => ['network-action', serverId] as const

/**
 * openapi-fetch resolves with BOTH `data` and `error` unset in more cases than an
 * empty success: a 204, a HEAD, or any response reporting `Content-Length: 0`
 * (dist/index.js:230). On Android that state was reported as "BinaryLane accepted
 * the action", which is worse than useless when nothing reached the API at all -
 * it sends you looking at the wrong end. Report what actually came back.
 */
function describeMissingAction(type: string, submitted: unknown): string {
  // Narrowed locally: on the branch where openapi-fetch leaves both `data` and
  // `error` unset, `response` is not part of the inferred union.
  const res = (submitted as { response?: Response } | null | undefined)?.response
  if (!res) {
    return `"${type}" produced no response at all - the request did not reach BinaryLane. Check connectivity.`
  }
  const cl = res.headers?.get?.('Content-Length')
  const bits = [`HTTP ${res.status}`]
  if (cl !== null && cl !== undefined) bits.push(`Content-Length: ${cl}`)
  return `"${type}" returned ${bits.join(', ')} with no action body, so there is nothing to track.`
}

/**
 * Cancel (terminate) a server.
 *
 * DELETE /v2/servers/{id} answers 204 with no body - it is not an Action, so
 * there is nothing to poll and nothing to track. The optional `reason` is free
 * text the panel collects for its own service reporting; the API caps it at 250
 * characters.
 */
export function useCancelServerMutation(client: BinaryLaneClient | null) {
  const qc = useQueryClient()
  return useMutation<void, Error, { serverId: number; reason?: string }>({
    mutationFn: async ({ serverId, reason }) => {
      if (!client) throw new Error('No client available')
      const trimmed = (reason || '').trim().slice(0, 250)
      const { error } = await client.DELETE('/v2/servers/{server_id}', {
        params: {
          path: { server_id: serverId },
          query: trimmed ? { reason: trimmed } : {}
        } as never
      })
      if (error) throw new Error(describeApiError(error))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['servers'] })
    }
  })
}

export function useNetworkActionMutation(client: BinaryLaneClient | null, serverId: number | null) {
  const queryClient = useQueryClient()
  return useMutation<ServerAction, Error, NetworkActionPayload>({
    // Keyed so `useIsMutating(networkActionMutationKey(id))` can report an in-flight action
    // even after the component that started it unmounted (tab switch mid-action).
    mutationKey: networkActionMutationKey(serverId),
    mutationFn: async (actionPayload) => {
      if (!client || !serverId) throw new Error('No client available')
      let submitted: { data?: { action?: ServerAction }; error?: unknown }
      try {
        submitted = await client.POST('/v2/servers/{server_id}/actions', {
          params: { path: { server_id: serverId } },
          body: actionPayload,
          signal: AbortSignal.timeout(ACTION_REQUEST_TIMEOUT_MS)
        })
      } catch (err) {
        if (isTimeoutError(err)) {
          throw new Error(
            `BinaryLane did not answer the "${actionPayload.type}" request within ${ACTION_REQUEST_TIMEOUT_MS / 1000}s. It may or may not have been applied — check the interfaces above once they refresh.`
          )
        }
        throw err
      }
      if (submitted.error) throw new Error(describeApiError(submitted.error))

      const queued = submitted.data?.action
      if (!queued?.id) throw new Error(describeMissingAction(actionPayload.type, submitted))

      // Blocking on purpose: a second network change over an unsettled first one
      // is the hazard here, so the UI stays locked until this one resolves.
      const settled = await pollActionToSettled(client, queued.id, { initial: queued })
      switch (settled.state) {
        case 'completed':
          return settled.action
        case 'awaiting-interaction':
          // Not something more waiting can fix — release the lock and let the
          // account-wide prompt collect the answer.
          throw new Error(
            `"${actionPayload.type}" is waiting for your confirmation (action #${settled.action.id}). Answer the prompt to let it continue.`
          )
        case 'blocked-by-invoice':
          throw new Error(
            `"${actionPayload.type}" is blocked by invoice #${settled.action.blocking_invoice_id}, which requires payment (action #${settled.action.id}).`
          )
        case 'timed-out':
          throw new Error(
            `"${actionPayload.type}" is still in progress after ${ACTION_POLL_TIMEOUT_MS / 1000}s (action #${queued.id}). It may still complete; this page refreshes automatically.`
          )
        case 'errored':
          throw new Error(actionFailureMessage(actionPayload.type, settled.action))
      }
    },
    onSettled: async () => {
      // Await the refetch so the mutation lock only releases once the UI has fresh data —
      // whole-list writes (IPv6 reverse nameservers) must never be built from a stale server.
      // refetchType 'all' also refreshes the server query when its tab is currently unmounted,
      // so a remount never briefly renders the pre-action snapshot.
      // The wait is capped: the refetch GETs have no timeout of their own, and a wedged
      // connection must not hold the UI lock after the action itself has already timed out.
      // The refetch keeps running in the background past the cap.
      const refetch = Promise.all([
        queryClient.invalidateQueries({ queryKey: ['server', serverId], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['servers'] }),
        queryClient.invalidateQueries({ queryKey: ['server-threshold-alerts', serverId] }),
        queryClient.invalidateQueries({ queryKey: ['server-advanced-features', serverId] })
      ])
      await Promise.race([refetch, new Promise((r) => setTimeout(r, ACTION_REQUEST_TIMEOUT_MS))])
    }
  })
}

/**
 * How long a submitted action is allowed to hold the UI before it is handed to
 * background tracking.
 *
 * This replaces guessing which operations are "long". Judging by action type
 * would mean hardcoding durations nobody has measured — and being wrong in the
 * expensive direction, since the previous 90s cap turned a perfectly healthy
 * rebuild into a reported failure. A short block instead lets quick actions
 * (rename, threshold alerts) still resolve inline and report a true
 * "completed", while anything slower keeps running with the UI released.
 */
const ACTION_HANDOFF_MS = 10_000

export type ServerActionOutcome =
  | { state: 'completed'; action: ServerAction }
  | { state: 'errored'; action: ServerAction }
  | { state: 'awaiting-interaction'; action: ServerAction }
  | { state: 'blocked-by-invoice'; action: ServerAction }
  /** Still running, and no longer holding the UI. The caller should track it. */
  | { state: 'handed-off'; action: ServerAction }

/**
 * Submit a server action, wait briefly for it to settle, and otherwise hand it
 * back still running so the caller can track it in the background.
 *
 * Reuses `networkActionMutationKey` so the existing `useIsMutating` busy locks
 * keep working, and so a Settings action and a Network action on the same
 * server continue to lock each other out as they do today.
 */
export function useServerActionWithHandoff(client: BinaryLaneClient | null, serverId: number | null) {
  const queryClient = useQueryClient()
  return useMutation<ServerActionOutcome, Error, Record<string, unknown> & { type: string }>({
    mutationKey: networkActionMutationKey(serverId),
    mutationFn: async (actionPayload) => {
      if (!client || !serverId) throw new Error('No client available')

      let submitted: { data?: { action?: ServerAction }; error?: unknown }
      try {
        submitted = await client.POST('/v2/servers/{server_id}/actions', {
          params: { path: { server_id: serverId } },
          body: actionPayload as never,
          signal: AbortSignal.timeout(ACTION_REQUEST_TIMEOUT_MS)
        })
      } catch (err) {
        if (isTimeoutError(err)) {
          throw new Error(
            `BinaryLane did not answer the "${actionPayload.type}" request within ${ACTION_REQUEST_TIMEOUT_MS / 1000}s. It may or may not have been applied — check the server once it refreshes.`
          )
        }
        throw err
      }
      if (submitted.error) throw new Error(describeApiError(submitted.error))

      const queued = submitted.data?.action
      if (!queued?.id) throw new Error(describeMissingAction(actionPayload.type, submitted))

      const settled = await pollActionToSettled(client, queued.id, {
        initial: queued,
        timeoutMs: ACTION_HANDOFF_MS
      })
      if (settled.state === 'timed-out') {
        return { state: 'handed-off', action: settled.action ?? queued }
      }
      return settled
    },
    onSettled: async () => {
      const refetch = Promise.all([
        queryClient.invalidateQueries({ queryKey: ['server', serverId], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['servers'] }),
        queryClient.invalidateQueries({ queryKey: ['server-threshold-alerts', serverId] }),
        queryClient.invalidateQueries({ queryKey: ['server-advanced-features', serverId] })
      ])
      await Promise.race([refetch, new Promise((r) => setTimeout(r, ACTION_REQUEST_TIMEOUT_MS))])
    }
  })
}

/**
 * Diagnostics answer in seconds, and the caller is watching a spinner, so this
 * polls faster than the default and gives up sooner. Neither number is a
 * measurement of how long a diagnostic takes — the cap only has to be long
 * enough that a healthy one is never cut short.
 */
const DIAGNOSTIC_POLL_INTERVAL_MS = 1000
const DIAGNOSTIC_POLL_TIMEOUT_MS = 30_000

/**
 * Submit a diagnostic (`ping`, `uptime`, `is_running`) and wait for its answer.
 *
 * These are the one case that must block: the value the user asked for arrives
 * in `result_data`, which is only populated once the action reaches `completed`.
 * Reading the action returned by the POST gives `status: 'in-progress'` and no
 * result at all — which is why the panel used to report `"in-progress"` forever.
 * A toast is no use here either; the answer belongs inline, next to the button
 * that asked for it.
 */
export function useServerDiagnosticMutation(client: BinaryLaneClient | null, serverId: number | null) {
  return useMutation<ServerAction, Error, Record<string, unknown> & { type: string }>({
    mutationFn: async (actionPayload) => {
      if (!client || !serverId) throw new Error('No client available')

      const submitted = await client.POST('/v2/servers/{server_id}/actions', {
        params: { path: { server_id: serverId } },
        body: actionPayload as never,
        signal: AbortSignal.timeout(ACTION_REQUEST_TIMEOUT_MS)
      })
      if (submitted.error) throw new Error(describeApiError(submitted.error))

      const queued = submitted.data?.action
      if (!queued?.id) throw new Error(describeMissingAction(actionPayload.type, submitted))

      const settled = await pollActionToSettled(client, queued.id, {
        initial: queued,
        timeoutMs: DIAGNOSTIC_POLL_TIMEOUT_MS,
        intervalMs: DIAGNOSTIC_POLL_INTERVAL_MS
      })
      switch (settled.state) {
        case 'completed':
          return settled.action
        case 'errored':
          throw new Error(actionFailureMessage(actionPayload.type, settled.action))
        case 'awaiting-interaction':
          throw new Error(
            `"${actionPayload.type}" is waiting for your confirmation (action #${settled.action.id}). Answer the prompt to let it continue.`
          )
        case 'blocked-by-invoice':
          throw new Error(
            `"${actionPayload.type}" is blocked by invoice #${settled.action.blocking_invoice_id}, which requires payment.`
          )
        case 'timed-out':
          throw new Error(
            `"${actionPayload.type}" had not finished after ${DIAGNOSTIC_POLL_TIMEOUT_MS / 1000}s (action #${queued.id}). It may still complete — check the server's action history.`
          )
      }
    }
  })
}

export function useServerThresholdAlerts(client: BinaryLaneClient | null, serverId: number | undefined) {
  return useQuery({
    queryKey: ['server-threshold-alerts', serverId],
    queryFn: async () => {
      if (!client || !serverId) return []
      const { data, error } = await client.GET('/v2/servers/{server_id}/threshold_alerts', {
        params: { path: { server_id: serverId } }
      })
      if (error) throw new Error(describeApiError(error))
      return data?.threshold_alerts || []
    },
    enabled: !!client && !!serverId
  })
}

export function useAvailableAdvancedFeatures(client: BinaryLaneClient | null, serverId: number | undefined) {
  return useQuery({
    queryKey: ['server-advanced-features', serverId],
    queryFn: async () => {
      if (!client || !serverId) return null
      const { data, error } = await client.GET('/v2/servers/{server_id}/available_advanced_features', {
        params: { path: { server_id: serverId } }
      })
      if (error) throw new Error(describeApiError(error))
      return data?.available_advanced_server_features || null
    },
    enabled: !!client && !!serverId
  })
}

// --- ACTIONS AWAITING USER INTERACTION (account-wide) ---

/**
 * BinaryLane can pause an action partway through and wait for the operator to
 * answer a yes/no question — a new server that never answered a ping, or one
 * that would not shut down cleanly. Two things make this easy to miss:
 *
 * 1. `status` stays `in-progress` the whole time it waits. There is no distinct
 *    status value for it; the only signal is a non-null `user_interaction_required`.
 * 2. Nothing resumes until someone answers via POST /v2/actions/{id}/proceed, so
 *    an unanswered prompt is a wedged operation, not a slow one.
 *
 * The watch is account-wide on purpose: the question usually arrives a minute or
 * more after the click that caused it (BinaryLane has to time out a ping or a
 * clean shutdown first), by which point the user has very likely navigated away
 * from — or closed — the view that started it.
 */

const INTERACTION_POLL_INTERVAL_MS = 20_000
const INTERACTION_PAGE_SIZE = 50

export type ActionAwaitingInteraction = ServerAction & {
  user_interaction_required: NonNullable<ServerAction['user_interaction_required']>
}

const awaitsInteraction = (action: ServerAction): action is ActionAwaitingInteraction =>
  action.user_interaction_required != null

async function fetchActionsPage(
  client: BinaryLaneClient,
  page: number
): Promise<{ actions: ServerAction[]; total: number }> {
  const { data, error } = await client.GET('/v2/actions', {
    params: { query: { page, per_page: INTERACTION_PAGE_SIZE } }
  })
  if (error) throw new Error(describeApiError(error))
  return { actions: data?.actions ?? [], total: data?.meta?.total ?? 0 }
}

/**
 * `/v2/actions` does not document its sort order, and guessing wrong would make
 * this watch silently never fire on a long-lived account — the worst failure
 * mode for a prompt whose whole job is to unblock a stuck operation. So rather
 * than assume, read the page we got: if its timestamps ascend, the newest
 * actions are at the far end and we go fetch that page too.
 */
function looksOldestFirst(actions: ServerAction[]): boolean {
  if (actions.length < 2) return false
  const first = Date.parse(actions[0].started_at)
  const last = Date.parse(actions[actions.length - 1].started_at)
  if (Number.isNaN(first) || Number.isNaN(last)) return false
  return last > first
}

export function useActionsAwaitingInteraction(client: BinaryLaneClient | null, profileId?: string) {
  return useQuery<ActionAwaitingInteraction[]>({
    queryKey: ['actions-awaiting-interaction', profileId || 'default'],
    queryFn: async () => {
      if (!client) return []
      const firstPage = await fetchActionsPage(client, 1)
      const seen = new Map<number, ServerAction>()
      for (const action of firstPage.actions) seen.set(action.id, action)

      if (firstPage.total > firstPage.actions.length && looksOldestFirst(firstPage.actions)) {
        const lastPage = Math.ceil(firstPage.total / INTERACTION_PAGE_SIZE)
        if (lastPage > 1) {
          const tail = await fetchActionsPage(client, lastPage)
          for (const action of tail.actions) seen.set(action.id, action)
          // A trailing page is usually a partial one — with total 101 and 50 per
          // page the newest page holds a single action, and a question raised a
          // few actions earlier would sit just off the end of it. Take one more
          // page back so a full page of recent history is always inspected.
          if (tail.actions.length < INTERACTION_PAGE_SIZE) {
            const previous = await fetchActionsPage(client, lastPage - 1)
            for (const action of previous.actions) seen.set(action.id, action)
          }
        }
      }

      return [...seen.values()].filter(awaitsInteraction)
    },
    enabled: !!client,
    refetchInterval: INTERACTION_POLL_INTERVAL_MS,
    // The interval is the retry: a failed poll should wait its turn rather than
    // stack extra requests on an API that may already be unhappy.
    retry: 0,
    staleTime: 0
  })
}

/**
 * Answer a waiting action. `proceed: true` means the operator agreed to the
 * specific thing `interaction_type` names — assume the server came up despite
 * the failed ping, or permit the unclean power off.
 */
export function useActionProceedMutation(client: BinaryLaneClient | null) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { actionId: number; proceed: boolean }>({
    mutationFn: async ({ actionId, proceed }) => {
      if (!client) throw new Error('No client available')
      const { error, response } = await client.POST('/v2/actions/{action_id}/proceed', {
        params: { path: { action_id: actionId } },
        body: { proceed }
      })
      if (error) throw new Error(describeApiError(error))
      // A successful answer is 204 No Content. There is deliberately no `data`
      // check here: treating an empty body as failure would report every
      // success as an error.
      if (!response.ok) {
        throw new Error(`BinaryLane did not accept the answer to action #${actionId} (HTTP ${response.status}).`)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions-awaiting-interaction'] })
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      queryClient.invalidateQueries({ queryKey: ['serverActions'] })
    }
  })
}

// --- LICENSED SOFTWARE ---

/**
 * The licences an operating system can carry, which is what Change Plan offers.
 *
 * Per-OS rather than the whole `/v2/software` catalogue, because the catalogue
 * lists the same product several times at different prices - "cPanel: Up to 30
 * Accounts" is $25/mo on cpanel-plus-whm and $65/mo on alma-9 - and the only
 * thing separating them is `supported_operating_systems`. Asking for the OS
 * gives the set that actually applies, already deduplicated and priced.
 */
export function useOsSoftware(client: BinaryLaneClient | null, osSlug: string | null | undefined) {
  return useQuery({
    queryKey: ['software', 'os', osSlug],
    queryFn: async () => {
      if (!client || !osSlug) return []
      const { data, error, response } = await client.GET('/v2/software/operating_system/{operating_system_id_or_slug}', {
        params: { path: { operating_system_id_or_slug: osSlug } as any, query: { per_page: 200 } as any }
      })
      // A 404 here is an image with no licences on offer (every Windows slug,
      // and any custom image), not a failure worth surfacing. Anything else is:
      // Change Plan builds `change_licenses` from this list, and an empty list
      // that really means "the request failed" would read as "drop them all".
      if (error) {
        if (response?.status === 404) return []
        throw new Error(describeApiError(error))
      }
      return data?.software || []
    },
    enabled: !!client && !!osSlug,
    staleTime: 300000
  })
}

/** The licences a server currently holds, used to prefill the licence controls. */
export function useServerSoftware(client: BinaryLaneClient | null, serverId: number | null | undefined) {
  return useQuery({
    queryKey: ['server-software', serverId],
    queryFn: async () => {
      if (!client || !serverId) return []
      const { data, error } = await client.GET('/v2/servers/{server_id}/software', {
        params: { path: { server_id: serverId }, query: { per_page: 200 } as any }
      })
      if (error) throw new Error(describeApiError(error))
      return data?.licensed_software || []
    },
    enabled: !!client && !!serverId,
    staleTime: 60000
  })
}
