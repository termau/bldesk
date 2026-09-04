import {
  decideResourceOperationAccess,
  hasResourceSafetyAssignments,
  normalizeResourceSafetyTarget,
  normalizeResourceSafetyTargets,
  resourceSafetyKey,
  type ResourceOperationClass,
  type ResourceSafetyAssignments,
  type ResourceSafetyKind,
  type ResourceSafetyTarget
} from './resource-safety'

export const BINARYLANE_API_ORIGIN = 'https://api.binarylane.com.au'

export type ProfileAccessMode = 'observe' | 'guarded' | 'full'

export type ServerSafetyLevel = 'locked' | 'maintenance' | 'testable'

export type ServerOperationClass =
  | 'read'
  | 'diagnostic'
  | 'reboot'
  | 'power-cycle'
  | 'non-replacing-temp-backup'
  | 'remote-access'
  | 'firewall'
  | 'mutation'

export type ServerOperation = ServerOperationClass

export interface ProfileSafetyPolicy extends ResourceSafetyAssignments {
  accessMode: ProfileAccessMode
  protectedServerIds: number[]
  maintenanceServerIds: number[]
  protectedResources: ResourceSafetyTarget[]
  maintenanceResources: ResourceSafetyTarget[]
}

export interface BinaryLanePolicyDecision {
  allowed: boolean
  method: string
  /** The only request body the transport is authorised to send. */
  authorizedBody?: string
  reason?:
    | 'invalid-method'
    | 'invalid-path'
    | 'unsupported-method'
    | 'observe-only'
    | 'guarded-not-configured'
    | 'protected-server'
    | 'maintenance-restricted'
    | 'protected-resource'
    | 'maintenance-resource-restricted'
    | 'ambiguous-shared-resource'
    | 'unreviewed-read'
    | 'unreviewed-server-action'
    | 'invalid-action-body'
    | 'action-context-required'
    | 'server-network-context-required'
    | 'invalid-action-context'
    | 'invalid-server'
    | 'invalid-resource'
    | 'invalid-operation'
}

export interface ProfileAccessTransition {
  allowed: boolean
  mode: ProfileAccessMode
  reason?: 'cannot-promote-to-full'
}

export interface ServerActionAccessDecision {
  allowed: boolean
  reason?:
    | 'invalid-server'
    | 'observe-only'
    | 'guarded-not-configured'
    | 'protected-server'
    | 'maintenance-restricted'
}

export interface ServerOperationAccessDecision {
  allowed: boolean
  operation: ServerOperationClass
  level?: ServerSafetyLevel
  reason?:
    | 'invalid-server'
    | 'invalid-operation'
    | 'observe-only'
    | 'guarded-not-configured'
    | 'protected-server'
    | 'maintenance-restricted'
}

export interface ActionProceedContext {
  actionId: unknown
  status: unknown
  resourceType: unknown
  resourceId: unknown
  actionType: unknown
  interactionType: unknown
}

export interface ActionProceedAccessDecision {
  allowed: boolean
  authorizedBody?: string
  serverId?: number
  reason?:
    | 'invalid-action-body'
    | 'invalid-action-context'
    | 'observe-only'
    | 'guarded-not-configured'
    | 'protected-server'
    | 'maintenance-restricted'
    | 'unreviewed-server-action'
}

const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const SERVER_PATH = /^\/v2\/servers\/(\d+)(?:\/|$)/i
const SERVER_COLLECTION_PATH = /^\/v2\/servers$/i
const SERVER_ROOT_PATH = /^\/v2\/servers\/(\d+)\/?$/i
const SERVER_ACTIONS_PATH = /^\/v2\/servers\/(\d+)\/actions\/?$/i
const SERVER_BACKUP_UPLOAD_PATH = /^\/v2\/servers\/(\d+)\/backups\/?$/i
const CONSOLE_PATH = /^\/v2\/servers\/(\d+)\/console\/?$/i
const ACTION_PROCEED_PATH = /^\/v2\/actions\/(\d+)\/proceed\/?$/i
const DOMAIN_REFRESH_PATH = /^\/v2\/domains\/refresh_nameserver_cache$/i
const DOMAIN_COLLECTION_PATH = /^\/v2\/domains$/i
const DOMAIN_ROOT_PATH = /^\/v2\/domains\/([^/]+)\/?$/i
const DOMAIN_RECORDS_PATH = /^\/v2\/domains\/([^/]+)\/records\/?$/i
const DOMAIN_RECORD_PATH = /^\/v2\/domains\/([^/]+)\/records\/(\d+)\/?$/i
const SSH_KEY_COLLECTION_PATH = /^\/v2\/account\/keys$/i
const SSH_KEY_ROOT_PATH = /^\/v2\/account\/keys\/(\d+)\/?$/i
const LOAD_BALANCER_COLLECTION_PATH = /^\/v2\/load_balancers$/i
const LOAD_BALANCER_ROOT_PATH = /^\/v2\/load_balancers\/(\d+)\/?$/i
const LOAD_BALANCER_SERVERS_PATH = /^\/v2\/load_balancers\/(\d+)\/servers\/?$/i
const LOAD_BALANCER_FORWARDING_RULES_PATH = /^\/v2\/load_balancers\/(\d+)\/forwarding_rules\/?$/i
const VPC_COLLECTION_PATH = /^\/v2\/vpcs$/i
const VPC_ROOT_PATH = /^\/v2\/vpcs\/(\d+)\/?$/i
const SERVER_OPERATION_CLASSES = new Set<ServerOperationClass>([
  'read',
  'diagnostic',
  'reboot',
  'power-cycle',
  'non-replacing-temp-backup',
  'remote-access',
  'firewall',
  'mutation'
])

const MAINTENANCE_DIAGNOSTICS = new Set(['ping', 'uptime', 'is_running'])

/** Exact action discriminator inventory reviewed from the bundled OpenAPI schema. */
export const REVIEWED_SERVER_ACTION_TYPES = [
  'add_disk',
  'attach_backup',
  'change_advanced_features',
  'change_advanced_firewall_rules',
  'change_backup_schedule',
  'change_ipv6',
  'change_ipv6_reverse_nameservers',
  'change_kernel',
  'change_manage_offsite_backup_copies',
  'change_network',
  'change_offsite_backup_location',
  'change_partner',
  'change_port_blocking',
  'change_region',
  'change_reverse_name',
  'change_separate_private_network_interface',
  'change_source_and_destination_check',
  'change_threshold_alerts',
  'change_vpc_ipv4',
  'clone_using_backup',
  'delete_disk',
  'detach_backup',
  'disable_backups',
  'disable_selinux',
  'enable_backups',
  'enable_ipv6',
  'is_running',
  'password_reset',
  'ping',
  'power_cycle',
  'power_off',
  'power_on',
  'reboot',
  'rebuild',
  'rename',
  'resize',
  'resize_disk',
  'restore',
  'shutdown',
  'take_backup',
  'uncancel',
  'uptime'
] as const

const REVIEWED_SERVER_ACTION_TYPE_SET = new Set<string>(REVIEWED_SERVER_ACTION_TYPES)

/** Exact GET inventory reviewed from the bundled BinaryLane OpenAPI schema. */
export const REVIEWED_GET_PATH_TEMPLATES = [
  '/v2/account',
  '/v2/actions/{action_id}',
  '/v2/actions',
  '/v2/customers/my/balance',
  '/v2/customers/my/invoices/{invoice_id}',
  '/v2/customers/my/invoices',
  '/v2/customers/my/unpaid-payment-failed-invoices',
  '/v2/data_usages/{server_id}/current',
  '/v2/data_usages/current',
  '/v2/domains/nameservers',
  '/v2/domains',
  '/v2/domains/{domain_name}',
  '/v2/domains/{domain_name}/records',
  '/v2/domains/{domain_name}/records/{record_id}',
  '/v2/images',
  '/v2/images/{image_id_or_slug}',
  '/v2/images/{image_id}/download',
  '/v2/account/keys/{key_id}',
  '/v2/account/keys',
  '/v2/load_balancers/{load_balancer_id}',
  '/v2/load_balancers',
  '/v2/load_balancers/availability',
  '/v2/regions',
  '/v2/reverse_names/ipv6',
  '/v2/samplesets/{server_id}/latest',
  '/v2/samplesets/{server_id}',
  '/v2/servers/{server_id}/actions',
  '/v2/servers/{server_id}',
  '/v2/servers',
  '/v2/servers/{server_id}/actions/{action_id}',
  '/v2/servers/{server_id}/advanced_firewall_rules',
  '/v2/servers/{server_id}/available_advanced_features',
  '/v2/servers/{server_id}/backups',
  '/v2/servers/{server_id}/kernels',
  '/v2/servers/{server_id}/snapshots',
  '/v2/servers/{server_id}/threshold_alerts',
  '/v2/servers/threshold_alerts',
  '/v2/servers/{server_id}/software',
  '/v2/servers/{server_id}/user_data',
  '/v2/servers/{server_id}/console',
  '/v2/sizes',
  '/v2/software/{software_id}',
  '/v2/software',
  '/v2/software/operating_system/{operating_system_id_or_slug}',
  '/v2/vpcs/{vpc_id}',
  '/v2/vpcs',
  '/v2/vpcs/{vpc_id}/members'
] as const

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const REVIEWED_GET_PATHS = REVIEWED_GET_PATH_TEMPLATES.map((template) => {
  const pattern = template
    .split(/(\{[^}]+\})/)
    .map((part) => part.startsWith('{') ? '[^/]+' : escapeRegex(part))
    .join('')
  return new RegExp(`^${pattern}/?$`, 'i')
})

function isReviewedGetPath(path: string): boolean {
  return REVIEWED_GET_PATHS.some((pattern) => pattern.test(path))
}

/**
 * Existing profiles predate access modes and retain their former full-access
 * behaviour. Any present but unrecognised value fails closed to protected.
 */
export function normalizeStoredAccessMode(value: unknown): ProfileAccessMode {
  if (value === undefined) return 'full'
  if (value === 'full' || value === 'guarded' || value === 'observe') return value
  return 'observe'
}

/** Runtime inputs outside the vault fail closed unless they are recognised. */
export function effectiveAccessMode(value: unknown): ProfileAccessMode {
  if (value === 'full' || value === 'guarded') return value
  return 'observe'
}

export function normalizeProtectedServerIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is number => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b)
}

/**
 * Normalise Maintenance IDs and, when supplied, remove IDs already Locked.
 * Locked always wins if persisted data contains the same server in both sets.
 */
export function normalizeMaintenanceServerIds(value: unknown, lockedValue?: unknown): number[] {
  const locked = new Set(normalizeProtectedServerIds(lockedValue))
  return normalizeProtectedServerIds(value).filter((id) => !locked.has(id))
}

export function isGuardedServerSafetyConfigured(
  policyValue: Partial<ProfileSafetyPolicy> | null | undefined
): boolean {
  return normalizeProtectedServerIds(policyValue?.protectedServerIds).length > 0 ||
    normalizeMaintenanceServerIds(policyValue?.maintenanceServerIds).length > 0 ||
    hasResourceSafetyAssignments(policyValue)
}

/**
 * Resolve one server's effective tier. Invalid identifiers fail closed to
 * Locked; callers that need an error distinction should use
 * decideServerOperationAccess, which reports invalid-server explicitly.
 */
export function getServerSafetyLevel(
  policyValue: Partial<ProfileSafetyPolicy> | null | undefined,
  serverIdValue: unknown
): ServerSafetyLevel {
  if (!Number.isSafeInteger(serverIdValue) || Number(serverIdValue) <= 0) return 'locked'
  const serverId = Number(serverIdValue)
  const locked = normalizeProtectedServerIds(policyValue?.protectedServerIds)
  if (locked.includes(serverId)) return 'locked'
  const maintenance = normalizeMaintenanceServerIds(policyValue?.maintenanceServerIds, locked)
  return maintenance.includes(serverId) ? 'maintenance' : 'testable'
}

/**
 * Pure operation-aware decision shared by renderer affordances and privileged
 * transports. Route/body validation remains an additional broker concern.
 */
export function decideServerOperationAccess(
  policyValue: Partial<ProfileSafetyPolicy> | null | undefined,
  serverIdValue: unknown,
  operationValue: unknown
): ServerOperationAccessDecision {
  const operation = typeof operationValue === 'string' && SERVER_OPERATION_CLASSES.has(operationValue as ServerOperationClass)
    ? operationValue as ServerOperationClass
    : 'mutation'

  if (!Number.isSafeInteger(serverIdValue) || Number(serverIdValue) <= 0) {
    return { allowed: false, operation, reason: 'invalid-server' }
  }
  if (operationValue !== operation) {
    return { allowed: false, operation, reason: 'invalid-operation' }
  }

  const serverId = Number(serverIdValue)
  const level = getServerSafetyLevel(policyValue, serverId)
  const accessMode = effectiveAccessMode(policyValue?.accessMode)
  if (accessMode === 'full') return { allowed: true, operation, level }
  // Reads and diagnostics are observations. The latter may use a reviewed POST
  // action in BinaryLane, but ping/uptime/running-state do not change a server.
  if (operation === 'read' || operation === 'diagnostic') {
    return { allowed: true, operation, level }
  }
  if (accessMode === 'observe') {
    return { allowed: false, operation, level, reason: 'observe-only' }
  }
  if (!isGuardedServerSafetyConfigured(policyValue)) {
    return { allowed: false, operation, level, reason: 'guarded-not-configured' }
  }
  if (level === 'locked') {
    return { allowed: false, operation, level, reason: 'protected-server' }
  }
  if (level === 'maintenance') {
    if (
      operation === 'reboot' ||
      operation === 'power-cycle' ||
      operation === 'non-replacing-temp-backup' ||
      operation === 'remote-access' ||
      operation === 'firewall'
    ) {
      return { allowed: true, operation, level }
    }
    return { allowed: false, operation, level, reason: 'maintenance-restricted' }
  }
  return { allowed: true, operation, level }
}

/** Protection may only grow within a profile; removal needs no public API. */
export function mergeProtectedServerIds(current: unknown, requested: unknown): number[] {
  return normalizeProtectedServerIds([
    ...normalizeProtectedServerIds(current),
    ...normalizeProtectedServerIds(requested)
  ])
}

/** Only profiles migrated as legacy-full may remain full or downgrade. */
export function decideProfileAccessTransition(
  currentValue: unknown,
  requestedValue: unknown
): ProfileAccessTransition {
  const current = effectiveAccessMode(currentValue)
  const requested = effectiveAccessMode(requestedValue)
  if (current !== 'full' && requested === 'full') {
    return { allowed: false, mode: current, reason: 'cannot-promote-to-full' }
  }
  return { allowed: true, mode: requested }
}

export function normalizeHttpMethod(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const method = value.trim().toUpperCase()
  return /^[A-Z]{3,12}$/.test(method) ? method : null
}

/**
 * Convert a renderer-supplied API path into the one fixed BinaryLane origin.
 * Absolute/protocol-relative URLs, fragments, credentials and alternate hosts
 * never reach the transport.
 */
export function binaryLaneUrlForPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) return null
  if (!value.startsWith('/v2/') || value.startsWith('//')) return null
  if (value.includes('#') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return null
  // The reviewed API uses plain ASCII path spellings. Reject every encoded
  // path byte so an intermediary cannot decode `%63onsole`, `%2f`, `%25...`,
  // or a traversal variant differently from this policy. Query encoding stays
  // available for ordinary filters and cursors.
  const rawPathname = value.split('?', 1)[0]
  if (rawPathname.includes('%')) return null

  try {
    const url = new URL(value, BINARYLANE_API_ORIGIN)
    if (url.origin !== BINARYLANE_API_ORIGIN || !url.pathname.startsWith('/v2/')) return null
    return url.toString()
  } catch {
    return null
  }
}

export function actionProceedIdForPath(value: unknown): number | null {
  const url = binaryLaneUrlForPath(value)
  if (!url) return null
  const match = ACTION_PROCEED_PATH.exec(new URL(url).pathname)
  if (!match) return null
  const actionId = Number(match[1])
  return Number.isSafeInteger(actionId) && actionId > 0 ? actionId : null
}

/** Resolve an exact server-actions route without trusting renderer context. */
export function serverActionsIdForPath(value: unknown): number | null {
  const url = binaryLaneUrlForPath(value)
  if (!url) return null
  const match = SERVER_ACTIONS_PATH.exec(new URL(url).pathname)
  if (!match) return null
  const serverId = Number(match[1])
  return Number.isSafeInteger(serverId) && serverId > 0 ? serverId : null
}

interface ParsedServerAction {
  body: Record<string, unknown>
  type: string
  serializedBody: string
}

interface ParsedJsonObject {
  body: Record<string, unknown>
  serializedBody: string
}

/**
 * JSON.parse keeps only the last occurrence of a duplicate object key. Even
 * though Guarded reconstructs the body before transport, accepting ambiguous
 * input makes audits and alternate parsers needlessly hard to reason about.
 * The input is parsed for validity immediately afterwards; this scanner only
 * needs to identify repeated keys at any object depth.
 */
function hasDuplicateJsonObjectKeys(value: string): boolean {
  let index = 0
  let duplicate = false
  const skipWhitespace = () => {
    while (/\s/.test(value[index] ?? '')) index += 1
  }
  const scanString = (): string | null => {
    if (value[index] !== '"') return null
    const start = index
    index += 1
    while (index < value.length) {
      if (value[index] === '\\') {
        index += 2
        continue
      }
      if (value[index] === '"') {
        index += 1
        try {
          return JSON.parse(value.slice(start, index)) as string
        } catch {
          return null
        }
      }
      index += 1
    }
    return null
  }

  const scanValue = (): boolean => {
    skipWhitespace()
    if (value[index] === '"') return scanString() !== null
    if (value[index] === '{') return scanObject()
    if (value[index] === '[') return scanArray()
    const start = index
    while (index < value.length) {
      const char = value[index]
      if (char === ',' || char === '}' || char === ']' || /\s/.test(char)) break
      index += 1
    }
    return index > start
  }

  const scanObject = (): boolean => {
    if (value[index] !== '{') return false
    index += 1
    const keys = new Set<string>()
    skipWhitespace()
    if (value[index] === '}') {
      index += 1
      return true
    }

    while (index < value.length) {
      skipWhitespace()
      const key = scanString()
      if (key === null) return false
      if (keys.has(key)) duplicate = true
      keys.add(key)
      skipWhitespace()
      if (value[index] !== ':') return false
      index += 1
      if (!scanValue()) return false
      skipWhitespace()
      if (value[index] === ',') {
        index += 1
        continue
      }
      if (value[index] === '}') {
        index += 1
        return true
      }
      return false
    }
    return false
  }

  const scanArray = (): boolean => {
    if (value[index] !== '[') return false
    index += 1
    skipWhitespace()
    if (value[index] === ']') {
      index += 1
      return true
    }
    while (index < value.length) {
      if (!scanValue()) return false
      skipWhitespace()
      if (value[index] === ',') {
        index += 1
        continue
      }
      if (value[index] === ']') {
        index += 1
        return true
      }
      return false
    }
    return false
  }

  const validShape = scanValue()
  skipWhitespace()
  return validShape && index === value.length && duplicate
}

function parseJsonObjectBody(value: unknown): ParsedJsonObject | null {
  if (typeof value !== 'string') return null
  try {
    if (hasDuplicateJsonObjectKeys(value)) return null
    const parsed = JSON.parse(value) as unknown
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.getPrototypeOf(parsed) !== Object.prototype
    ) return null
    const body = parsed as Record<string, unknown>
    return { body, serializedBody: JSON.stringify(body) }
  } catch {
    return null
  }
}

function parseServerActionBody(value: unknown): ParsedServerAction | null {
  const parsed = parseJsonObjectBody(value)
  if (!parsed || typeof parsed.body.type !== 'string' || parsed.body.type.length === 0) return null
  return { ...parsed, type: parsed.body.type }
}

function hasExactKeys(body: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(body)
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(body, key)) &&
    keys.every((key) => allowed.has(key))
}

function positiveSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null
}

function canonicalDomainId(value: unknown): string | null {
  const target = normalizeResourceSafetyTarget('domain', value)
  if (!target) return null
  const labels = target.id.split('.')
  if (
    labels.some((label) => label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) return null
  return target.id
}

function canonicalDomainRefreshBody(value: unknown): { authorizedBody?: string } | null {
  if (value === undefined) return {}
  const parsed = parseJsonObjectBody(value)
  if (!parsed || !hasExactKeys(parsed.body, ['domain_names']) || !Array.isArray(parsed.body.domain_names)) {
    return null
  }
  const domainNames: string[] = []
  for (const candidate of parsed.body.domain_names) {
    const domain = canonicalDomainId(candidate)
    if (!domain) return null
    domainNames.push(domain)
  }
  return { authorizedBody: JSON.stringify({ domain_names: domainNames }) }
}

function canonicalDomainCreateBody(value: unknown): string | null {
  const parsed = parseJsonObjectBody(value)
  if (!parsed || !hasExactKeys(parsed.body, ['name'], ['ip_address'])) return null
  const name = canonicalDomainId(parsed.body.name)
  if (!name) return null
  const canonical: Record<string, unknown> = { name }
  if (Object.prototype.hasOwnProperty.call(parsed.body, 'ip_address')) {
    if (parsed.body.ip_address !== null && typeof parsed.body.ip_address !== 'string') return null
    canonical.ip_address = parsed.body.ip_address
  }
  return JSON.stringify(canonical)
}

const DOMAIN_RECORD_TYPES = new Set(['A', 'AAAA', 'CAA', 'CNAME', 'MX', 'NS', 'SOA', 'SRV', 'TXT'])
const DOMAIN_RECORD_OPTIONAL_FIELDS = ['priority', 'port', 'ttl', 'weight', 'flags', 'tag']

function canonicalDomainRecordBody(value: unknown, create: boolean): string | null {
  const parsed = parseJsonObjectBody(value)
  const required = create ? ['type', 'name', 'data'] : []
  const optional = create
    ? DOMAIN_RECORD_OPTIONAL_FIELDS
    : ['type', 'name', 'data', ...DOMAIN_RECORD_OPTIONAL_FIELDS]
  if (!parsed || !hasExactKeys(parsed.body, required, optional)) return null

  const canonical: Record<string, unknown> = {}
  for (const key of ['type', 'name', 'data']) {
    if (!Object.prototype.hasOwnProperty.call(parsed.body, key)) continue
    const field = parsed.body[key]
    if (key === 'type') {
      if (field !== null && (typeof field !== 'string' || !DOMAIN_RECORD_TYPES.has(field))) return null
    } else if (field !== null && (typeof field !== 'string' || (create && field.length === 0))) {
      return null
    }
    canonical[key] = field
  }
  for (const key of ['priority', 'port', 'weight']) {
    if (!Object.prototype.hasOwnProperty.call(parsed.body, key)) continue
    const field = parsed.body[key]
    if (field !== null && (!Number.isInteger(field) || Number(field) < 0 || Number(field) > 65535)) return null
    canonical[key] = field
  }
  if (Object.prototype.hasOwnProperty.call(parsed.body, 'ttl')) {
    const ttl = parsed.body.ttl
    if (ttl !== null && !Number.isInteger(ttl)) return null
    canonical.ttl = ttl
  }
  if (Object.prototype.hasOwnProperty.call(parsed.body, 'flags')) {
    const flags = parsed.body.flags
    if (flags !== null && (!Number.isInteger(flags) || Number(flags) < 0 || Number(flags) > 255)) return null
    canonical.flags = flags
  }
  if (Object.prototype.hasOwnProperty.call(parsed.body, 'tag')) {
    const tag = parsed.body.tag
    if (tag !== null && (typeof tag !== 'string' || !/^[a-z0-9]{1,15}$/.test(tag))) return null
    canonical.tag = tag
  }
  return JSON.stringify(canonical)
}

function canonicalSshKeyBody(value: unknown, create: boolean): string | null {
  const parsed = parseJsonObjectBody(value)
  const required = create ? ['name', 'public_key'] : ['name']
  const optional = create ? ['default'] : ['default']
  if (!parsed || !hasExactKeys(parsed.body, required, optional)) return null
  if (typeof parsed.body.name !== 'string' || parsed.body.name.length === 0) return null
  const canonical: Record<string, unknown> = { name: parsed.body.name }
  if (create) {
    if (typeof parsed.body.public_key !== 'string' || parsed.body.public_key.length === 0) return null
    canonical.public_key = parsed.body.public_key
  }
  if (Object.prototype.hasOwnProperty.call(parsed.body, 'default')) {
    if (parsed.body.default !== null && typeof parsed.body.default !== 'boolean') return null
    canonical.default = parsed.body.default
  }
  return JSON.stringify(canonical)
}

function canonicalRouteEntries(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null
  const canonical: unknown[] = []
  for (const candidate of value) {
    if (
      candidate === null || typeof candidate !== 'object' || Array.isArray(candidate) ||
      Object.getPrototypeOf(candidate) !== Object.prototype
    ) return null
    const route = candidate as Record<string, unknown>
    if (!hasExactKeys(route, ['router', 'destination'], ['description'])) return null
    if (
      typeof route.router !== 'string' || route.router.length === 0 ||
      typeof route.destination !== 'string' || route.destination.length === 0 ||
      (route.description !== undefined && route.description !== null &&
        (typeof route.description !== 'string' || [...route.description].length > 250))
    ) return null
    const result: Record<string, unknown> = { router: route.router, destination: route.destination }
    if (Object.prototype.hasOwnProperty.call(route, 'description')) result.description = route.description
    canonical.push(result)
  }
  return canonical
}

function canonicalVpcBody(value: unknown, mode: 'create' | 'put' | 'patch'): string | null {
  const parsed = parseJsonObjectBody(value)
  const required = mode === 'patch' ? [] : ['name']
  const optional = mode === 'create' ? ['route_entries', 'ip_range'] : ['route_entries', ...(mode === 'patch' ? ['name'] : [])]
  if (!parsed || !hasExactKeys(parsed.body, required, optional)) return null
  const canonical: Record<string, unknown> = {}
  if (Object.prototype.hasOwnProperty.call(parsed.body, 'name')) {
    const name = parsed.body.name
    const minimum = mode === 'patch' ? 1 : 0
    if (name !== null && (typeof name !== 'string' || [...name].length < minimum || [...name].length > 250)) return null
    if (mode !== 'patch' && name === null) return null
    canonical.name = name
  }
  if (Object.prototype.hasOwnProperty.call(parsed.body, 'route_entries')) {
    if (parsed.body.route_entries === null) canonical.route_entries = null
    else {
      const routes = canonicalRouteEntries(parsed.body.route_entries)
      if (!routes) return null
      canonical.route_entries = routes
    }
  }
  if (mode === 'create' && Object.prototype.hasOwnProperty.call(parsed.body, 'ip_range')) {
    if (parsed.body.ip_range !== null && typeof parsed.body.ip_range !== 'string') return null
    canonical.ip_range = parsed.body.ip_range
  }
  return JSON.stringify(canonical)
}

function canonicalForwardingRules(value: unknown): Array<{ entry_protocol: string }> | null {
  if (!Array.isArray(value)) return null
  const canonical: Array<{ entry_protocol: string }> = []
  for (const candidate of value) {
    if (
      candidate === null || typeof candidate !== 'object' || Array.isArray(candidate) ||
      Object.getPrototypeOf(candidate) !== Object.prototype
    ) return null
    const rule = candidate as Record<string, unknown>
    if (!hasExactKeys(rule, ['entry_protocol']) || (rule.entry_protocol !== 'http' && rule.entry_protocol !== 'https')) {
      return null
    }
    canonical.push({ entry_protocol: rule.entry_protocol })
  }
  return canonical
}

function canonicalHealthCheck(value: unknown): Record<string, unknown> | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return null
  }
  const health = value as Record<string, unknown>
  if (!hasExactKeys(health, [], ['protocol', 'path'])) return null
  const canonical: Record<string, unknown> = {}
  if (Object.prototype.hasOwnProperty.call(health, 'protocol')) {
    if (health.protocol !== null && !['http', 'https', 'both'].includes(String(health.protocol))) return null
    canonical.protocol = health.protocol
  }
  if (Object.prototype.hasOwnProperty.call(health, 'path')) {
    if (health.path !== null && (typeof health.path !== 'string' || !/^\/[A-Za-z0-9/.?=&+%_-]*$/.test(health.path))) {
      return null
    }
    canonical.path = health.path
  }
  return canonical
}

function canonicalServerIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const ids: number[] = []
  for (const candidate of value) {
    const id = positiveSafeInteger(candidate)
    if (id === null) return null
    ids.push(id)
  }
  return ids
}

interface CanonicalLoadBalancerBody {
  authorizedBody: string
  serverIds: number[]
  hasServerIds: boolean
}

function canonicalLoadBalancerBody(value: unknown, create: boolean): CanonicalLoadBalancerBody | null {
  const parsed = parseJsonObjectBody(value)
  const optional = ['forwarding_rules', 'health_check', 'server_ids', ...(create ? ['region'] : [])]
  if (!parsed || !hasExactKeys(parsed.body, ['name'], optional)) return null
  if (typeof parsed.body.name !== 'string' || parsed.body.name.length === 0) return null
  const canonical: Record<string, unknown> = { name: parsed.body.name }

  if (Object.prototype.hasOwnProperty.call(parsed.body, 'forwarding_rules')) {
    if (parsed.body.forwarding_rules === null) canonical.forwarding_rules = null
    else {
      const rules = canonicalForwardingRules(parsed.body.forwarding_rules)
      if (!rules) return null
      canonical.forwarding_rules = rules
    }
  }
  if (Object.prototype.hasOwnProperty.call(parsed.body, 'health_check')) {
    if (parsed.body.health_check === null) canonical.health_check = null
    else {
      const health = canonicalHealthCheck(parsed.body.health_check)
      if (!health) return null
      canonical.health_check = health
    }
  }

  const hasServerIds = Object.prototype.hasOwnProperty.call(parsed.body, 'server_ids')
  let serverIds: number[] = []
  if (hasServerIds) {
    if (parsed.body.server_ids === null) canonical.server_ids = null
    else {
      const ids = canonicalServerIds(parsed.body.server_ids)
      if (!ids) return null
      serverIds = ids
      canonical.server_ids = ids
    }
  }
  if (create && Object.prototype.hasOwnProperty.call(parsed.body, 'region')) {
    if (parsed.body.region !== null && typeof parsed.body.region !== 'string') return null
    canonical.region = parsed.body.region
  }
  return { authorizedBody: JSON.stringify(canonical), serverIds, hasServerIds }
}

function canonicalServerIdsBody(value: unknown): { authorizedBody: string; serverIds: number[] } | null {
  const parsed = parseJsonObjectBody(value)
  if (!parsed || !hasExactKeys(parsed.body, ['server_ids'])) return null
  const serverIds = canonicalServerIds(parsed.body.server_ids)
  return serverIds ? { authorizedBody: JSON.stringify({ server_ids: serverIds }), serverIds } : null
}

function canonicalServerCreateBody(
  value: unknown
): { authorizedBody: string; targetVpcId: number | null } | null {
  const parsed = parseJsonObjectBody(value)
  if (!parsed) return null
  if (!Object.prototype.hasOwnProperty.call(parsed.body, 'vpc_id') || parsed.body.vpc_id === null) {
    return { authorizedBody: parsed.serializedBody, targetVpcId: null }
  }
  const targetVpcId = positiveSafeInteger(parsed.body.vpc_id)
  return targetVpcId === null
    ? null
    : { authorizedBody: parsed.serializedBody, targetVpcId }
}

function canonicalForwardingRulesBody(value: unknown): string | null {
  const parsed = parseJsonObjectBody(value)
  if (!parsed || !hasExactKeys(parsed.body, ['forwarding_rules'])) return null
  const forwardingRules = canonicalForwardingRules(parsed.body.forwarding_rules)
  return forwardingRules ? JSON.stringify({ forwarding_rules: forwardingRules }) : null
}

function resourceRequestDecision(
  policy: Partial<ProfileSafetyPolicy>,
  method: string,
  kind: ResourceSafetyKind,
  id: unknown,
  operation: ResourceOperationClass,
  authorizedBody?: string
): BinaryLanePolicyDecision {
  const access = decideResourceOperationAccess(
    effectiveAccessMode(policy.accessMode),
    isGuardedServerSafetyConfigured(policy),
    policy,
    kind,
    id,
    operation
  )
  return access.allowed
    ? { allowed: true, method, ...(authorizedBody !== undefined ? { authorizedBody } : {}) }
    : { allowed: false, method, reason: access.reason }
}

function authorizeServerIds(
  policy: Partial<ProfileSafetyPolicy>,
  method: string,
  serverIds: number[]
): BinaryLanePolicyDecision | null {
  for (const serverId of new Set(serverIds)) {
    const access = decideServerOperationAccess(policy, serverId, 'mutation')
    if (!access.allowed) return { allowed: false, method, reason: access.reason }
  }
  return null
}

function numericResourceId(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null
  return positiveSafeInteger(Number(value))
}

function canonicalCloneUsingBackupAction(
  action: ParsedServerAction
): { targetServerId: number; authorizedBody: string } | null {
  if (
    action.type !== 'clone_using_backup' ||
    !hasExactKeys(action.body, ['type', 'image_id', 'target_server_id'], ['name']) ||
    !Number.isSafeInteger(action.body.image_id) || Number(action.body.image_id) <= 0 ||
    !Number.isSafeInteger(action.body.target_server_id) || Number(action.body.target_server_id) <= 0
  ) return null

  if (
    Object.prototype.hasOwnProperty.call(action.body, 'name') &&
    action.body.name !== null &&
    typeof action.body.name !== 'string'
  ) return null

  const targetServerId = Number(action.body.target_server_id)
  const canonical: Record<string, unknown> = {
    type: 'clone_using_backup',
    image_id: Number(action.body.image_id),
    target_server_id: targetServerId
  }
  if (Object.prototype.hasOwnProperty.call(action.body, 'name')) canonical.name = action.body.name
  return { targetServerId, authorizedBody: JSON.stringify(canonical) }
}

function canonicalChangeNetworkAction(
  action: ParsedServerAction
): { targetVpcId: number | null; authorizedBody: string } | null {
  if (action.type !== 'change_network' || !hasExactKeys(action.body, ['type'], ['vpc_id'])) return null
  if (!Object.prototype.hasOwnProperty.call(action.body, 'vpc_id') || action.body.vpc_id === null) {
    return { targetVpcId: null, authorizedBody: JSON.stringify({ type: 'change_network', vpc_id: null }) }
  }
  const targetVpcId = positiveSafeInteger(action.body.vpc_id)
  return targetVpcId === null
    ? null
    : { targetVpcId, authorizedBody: JSON.stringify({ type: 'change_network', vpc_id: targetVpcId }) }
}

function canonicalChangeVpcIpv4Action(action: ParsedServerAction): string | null {
  if (
    action.type !== 'change_vpc_ipv4' ||
    !hasExactKeys(action.body, ['type', 'current_ipv4_address', 'new_ipv4_address']) ||
    typeof action.body.current_ipv4_address !== 'string' || action.body.current_ipv4_address.length === 0 ||
    typeof action.body.new_ipv4_address !== 'string' || action.body.new_ipv4_address.length === 0
  ) return null
  return JSON.stringify({
    type: 'change_vpc_ipv4',
    current_ipv4_address: action.body.current_ipv4_address,
    new_ipv4_address: action.body.new_ipv4_address
  })
}

/**
 * Complete a network-action decision using current server state read by the
 * privileged transport. This is intentionally separate from the renderer
 * request: change_network names the destination but not the source VPC, while
 * change_vpc_ipv4 names neither VPC. Every entity actually touched must pass
 * its own tier without inferring a lock from any other member.
 */
export function decideServerNetworkActionAccess(
  policyValue: Partial<ProfileSafetyPolicy> | null | undefined,
  serverIdValue: unknown,
  currentVpcIdValue: unknown,
  bodyValue: unknown
): BinaryLanePolicyDecision {
  const method = 'POST'
  const serverId = positiveSafeInteger(serverIdValue)
  if (serverId === null) return { allowed: false, method, reason: 'invalid-server' }

  const currentVpcId = currentVpcIdValue === null ? null : positiveSafeInteger(currentVpcIdValue)
  if (currentVpcIdValue !== null && currentVpcId === null) {
    return { allowed: false, method, reason: 'invalid-action-context' }
  }

  const action = parseServerActionBody(bodyValue)
  if (!action) return { allowed: false, method, reason: 'invalid-action-body' }

  const serverAccess = decideServerOperationAccess(policyValue, serverId, 'mutation')
  if (!serverAccess.allowed) return { allowed: false, method, reason: serverAccess.reason }

  if (currentVpcId !== null) {
    const sourceAccess = resourceRequestDecision(
      policyValue ?? {},
      method,
      'vpc',
      currentVpcId,
      'maintenance'
    )
    if (!sourceAccess.allowed) return sourceAccess
  }

  if (action.type === 'change_network') {
    const network = canonicalChangeNetworkAction(action)
    if (!network) return { allowed: false, method, reason: 'invalid-action-body' }
    if (network.targetVpcId !== null) {
      const targetAccess = resourceRequestDecision(
        policyValue ?? {},
        method,
        'vpc',
        network.targetVpcId,
        'maintenance'
      )
      if (!targetAccess.allowed) return targetAccess
    }
    return { allowed: true, method, authorizedBody: network.authorizedBody }
  }

  if (action.type === 'change_vpc_ipv4') {
    const authorizedBody = canonicalChangeVpcIpv4Action(action)
    if (!authorizedBody) return { allowed: false, method, reason: 'invalid-action-body' }
    // The action is meaningful only for a server currently attached to a VPC;
    // a missing current VPC is malformed or stale privileged context.
    if (currentVpcId === null) return { allowed: false, method, reason: 'invalid-action-context' }
    return { allowed: true, method, authorizedBody }
  }

  return { allowed: false, method, reason: 'invalid-action-body' }
}

function canonicalChangePartnerAction(
  action: ParsedServerAction
): { partnerServerId: number | null; authorizedBody: string } | null {
  if (action.type !== 'change_partner' || !hasExactKeys(action.body, ['type'], ['partner_server_id'])) return null
  if (!Object.prototype.hasOwnProperty.call(action.body, 'partner_server_id') || action.body.partner_server_id === null) {
    return { partnerServerId: null, authorizedBody: JSON.stringify({ type: 'change_partner', partner_server_id: null }) }
  }
  const partnerServerId = positiveSafeInteger(action.body.partner_server_id)
  return partnerServerId === null
    ? null
    : {
        partnerServerId,
        authorizedBody: JSON.stringify({ type: 'change_partner', partner_server_id: partnerServerId })
      }
}

function isReviewedCancelServerQuery(method: string, path: string, parsedUrl: URL): boolean {
  if (method !== 'DELETE' || !SERVER_ROOT_PATH.test(path) || !parsedUrl.search) return false
  const entries = [...parsedUrl.searchParams.entries()]
  return entries.length === 1 && entries[0][0] === 'reason' && [...entries[0][1]].length <= 250
}

function canonicalMaintenanceFirewallRule(value: unknown): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return null

  const rule = value as Record<string, unknown>
  if (!hasExactKeys(
    rule,
    ['source_addresses', 'destination_addresses', 'protocol', 'action'],
    ['destination_ports', 'description']
  )) return null

  const sourceAddresses = rule.source_addresses
  const destinationAddresses = rule.destination_addresses
  if (
    !Array.isArray(sourceAddresses) ||
    sourceAddresses.length === 0 ||
    !sourceAddresses.every((address) => typeof address === 'string') ||
    !Array.isArray(destinationAddresses) ||
    destinationAddresses.length === 0 ||
    !destinationAddresses.every((address) => typeof address === 'string') ||
    !['all', 'icmp', 'tcp', 'udp'].includes(String(rule.protocol)) ||
    !['drop', 'accept'].includes(String(rule.action))
  ) return null

  const canonical: Record<string, unknown> = {
    source_addresses: [...sourceAddresses],
    destination_addresses: [...destinationAddresses]
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'destination_ports')) {
    if (
      rule.destination_ports !== null &&
      (!Array.isArray(rule.destination_ports) || !rule.destination_ports.every((port) => typeof port === 'string'))
    ) return null
    canonical.destination_ports = rule.destination_ports === null ? null : [...rule.destination_ports]
  }
  canonical.protocol = rule.protocol
  canonical.action = rule.action
  if (Object.prototype.hasOwnProperty.call(rule, 'description')) {
    if (
      rule.description !== null &&
      (typeof rule.description !== 'string' || [...rule.description].length > 250)
    ) return null
    canonical.description = rule.description
  }
  return canonical
}

function maintenanceAction(
  action: ParsedServerAction
): { operation: ServerOperationClass; authorizedBody: string } | null {
  if (MAINTENANCE_DIAGNOSTICS.has(action.type)) {
    if (!hasExactKeys(action.body, ['type'])) return null
    return {
      operation: 'diagnostic',
      authorizedBody: JSON.stringify({ type: action.type })
    }
  }

  if (action.type === 'reboot') {
    if (!hasExactKeys(action.body, ['type'])) return null
    return { operation: 'reboot', authorizedBody: JSON.stringify({ type: 'reboot' }) }
  }

  if (action.type === 'power_cycle') {
    if (!hasExactKeys(action.body, ['type'])) return null
    return { operation: 'power-cycle', authorizedBody: JSON.stringify({ type: 'power_cycle' }) }
  }

  if (action.type === 'change_advanced_firewall_rules') {
    if (!hasExactKeys(action.body, ['type', 'firewall_rules']) || !Array.isArray(action.body.firewall_rules)) {
      return null
    }
    const firewallRules: Record<string, unknown>[] = []
    for (const rule of action.body.firewall_rules) {
      const canonical = canonicalMaintenanceFirewallRule(rule)
      if (!canonical) return null
      firewallRules.push(canonical)
    }
    return {
      operation: 'firewall',
      authorizedBody: JSON.stringify({
        type: 'change_advanced_firewall_rules',
        firewall_rules: firewallRules
      })
    }
  }

  if (action.type === 'take_backup') {
    if (!hasExactKeys(
      action.body,
      ['type', 'backup_type', 'replacement_strategy'],
      ['label']
    )) return null
    if (
      action.body.backup_type !== 'temporary' ||
      action.body.replacement_strategy !== 'none' ||
      (action.body.label !== undefined &&
        (typeof action.body.label !== 'string' || [...action.body.label].length > 250))
    ) return null

    const canonicalBody: Record<string, string> = {
      type: 'take_backup',
      backup_type: 'temporary',
      replacement_strategy: 'none'
    }
    if (typeof action.body.label === 'string') canonicalBody.label = action.body.label
    return {
      operation: 'non-replacing-temp-backup',
      authorizedBody: JSON.stringify(canonicalBody)
    }
  }

  return null
}

function canonicalProceedBody(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    if (hasDuplicateJsonObjectKeys(value)) return null
    const parsed = JSON.parse(value) as unknown
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.getPrototypeOf(parsed) !== Object.prototype
    ) return null
    const body = parsed as Record<string, unknown>
    if (!hasExactKeys(body, ['proceed']) || typeof body.proceed !== 'boolean') return null
    return JSON.stringify({ proceed: body.proceed })
  } catch {
    return null
  }
}

/**
 * Authorise a pending action response only after the privileged broker resolves
 * its server ownership and interaction state from BinaryLane under the token.
 */
export function decideActionProceedAccess(
  policyValue: Partial<ProfileSafetyPolicy> | null | undefined,
  context: ActionProceedContext,
  bodyValue: unknown
): ActionProceedAccessDecision {
  const authorizedBody = canonicalProceedBody(bodyValue)
  if (!authorizedBody) return { allowed: false, reason: 'invalid-action-body' }
  if (
    !Number.isSafeInteger(context.actionId) || Number(context.actionId) <= 0 ||
    context.status !== 'in-progress' ||
    context.resourceType !== 'server' ||
    !Number.isSafeInteger(context.resourceId) || Number(context.resourceId) <= 0 ||
    typeof context.actionType !== 'string' ||
    (context.interactionType !== 'allow-unclean-power-off' &&
      context.interactionType !== 'continue-after-ping-failure')
  ) {
    return { allowed: false, reason: 'invalid-action-context' }
  }

  const serverId = Number(context.resourceId)
  const accessMode = effectiveAccessMode(policyValue?.accessMode)
  if (accessMode === 'full') return { allowed: true, serverId, authorizedBody }
  if (accessMode === 'observe') return { allowed: false, serverId, reason: 'observe-only' }
  if (accessMode === 'guarded' && !isGuardedServerSafetyConfigured(policyValue)) {
    return { allowed: false, serverId, reason: 'guarded-not-configured' }
  }

  const level = getServerSafetyLevel(policyValue, serverId)
  if (level === 'locked') return { allowed: false, serverId, reason: 'protected-server' }
  if (level === 'maintenance') {
    if (
      context.interactionType !== 'allow-unclean-power-off' ||
      (context.actionType !== 'reboot' && context.actionType !== 'power_cycle')
    ) {
      return { allowed: false, serverId, reason: 'maintenance-restricted' }
    }
    const operation = context.actionType === 'power_cycle' ? 'power-cycle' : 'reboot'
    const access = decideServerOperationAccess(policyValue, serverId, operation)
    return access.allowed
      ? { allowed: true, serverId, authorizedBody }
      : { allowed: false, serverId, reason: access.reason as ActionProceedAccessDecision['reason'] }
  }

  if (!REVIEWED_SERVER_ACTION_TYPE_SET.has(context.actionType)) {
    return { allowed: false, serverId, reason: 'unreviewed-server-action' }
  }

  // An action response does not include the original cross-entity request
  // body, so it cannot prove every server/VPC that was touched. Neither answer
  // is documented as cancelling the parent action, so Guarded fails closed
  // until trusted context can carry every affected identity.
  if (
    context.actionType === 'clone_using_backup' ||
    context.actionType === 'change_network' ||
    context.actionType === 'change_vpc_ipv4' ||
    context.actionType === 'change_partner'
  ) {
    return { allowed: false, serverId, reason: 'invalid-action-context' }
  }
  const access = decideServerOperationAccess(policyValue, serverId, 'mutation')
  return access.allowed
    ? { allowed: true, serverId, authorizedBody }
    : { allowed: false, serverId, reason: access.reason as ActionProceedAccessDecision['reason'] }
}

/**
 * Non-Full profiles allow schema-backed GET reads and the three exact,
 * non-mutating diagnostic POST actions by default. Maintenance and Normal add
 * their reviewed operational actions. The console endpoint is classified
 * separately because it returns an interactive credential capable of changing
 * the guest outside the API. The checked OpenAPI schema defines no HEAD calls.
 */
export function decideBinaryLaneRequest(
  policyValue: Partial<ProfileSafetyPolicy> | null | undefined,
  methodValue: unknown,
  pathValue: unknown,
  bodyValue?: unknown
): BinaryLanePolicyDecision {
  const method = normalizeHttpMethod(methodValue)
  if (!method) return { allowed: false, method: '', reason: 'invalid-method' }
  if (!SUPPORTED_METHODS.has(method)) return { allowed: false, method, reason: 'unsupported-method' }

  const url = binaryLaneUrlForPath(pathValue)
  if (!url) return { allowed: false, method, reason: 'invalid-path' }
  const parsedUrl = new URL(url)
  const path = parsedUrl.pathname
  const accessMode = effectiveAccessMode(policyValue?.accessMode)
  const protectedServerIds = normalizeProtectedServerIds(policyValue?.protectedServerIds)
  const maintenanceServerIds = normalizeMaintenanceServerIds(
    policyValue?.maintenanceServerIds,
    protectedServerIds
  )
  const protectedResources = normalizeResourceSafetyTargets(policyValue?.protectedResources)
  const protectedResourceKeys = new Set(protectedResources.map(resourceSafetyKey))
  const maintenanceResources = normalizeResourceSafetyTargets(policyValue?.maintenanceResources)
    .filter((target) => !protectedResourceKeys.has(resourceSafetyKey(target)))
  const policy: Partial<ProfileSafetyPolicy> = {
    accessMode,
    protectedServerIds,
    maintenanceServerIds,
    protectedResources,
    maintenanceResources
  }

  // Legacy Full remains deliberately unrestricted inside the validated origin,
  // method and body-size boundary. Guarded is the reviewed-action mode.
  if (accessMode === 'full') {
    return {
      allowed: true,
      method,
      ...(typeof bodyValue === 'string' ? { authorizedBody: bodyValue } : {})
    }
  }

  // Reviewed GETs may use filters and cursors. The only reviewed mutation query
  // is the optional cancellation reason on DELETE /servers/{id}; admit exactly
  // one schema-bounded reason and reject all other renderer-supplied flags.
  const reviewedCancelQuery = isReviewedCancelServerQuery(method, path, parsedUrl)
  if (parsedUrl.search && (method !== 'GET' || CONSOLE_PATH.test(path)) && !reviewedCancelQuery) {
    return { allowed: false, method, reason: 'invalid-path' }
  }

  const consoleMatch = CONSOLE_PATH.exec(path)
  const serverMatch = SERVER_PATH.exec(path)
  const serverId = serverMatch ? Number(serverMatch[1]) : null

  if (method === 'GET' && !isReviewedGetPath(path)) {
    return { allowed: false, method, reason: 'unreviewed-read' }
  }

  // BinaryLane models its non-mutating diagnostics as POST actions. Admit only
  // their exact canonical bodies before the Observe/incomplete-setup gates so
  // every server keeps normal ping, uptime and running-state checks.
  const diagnosticMatch = method === 'POST' ? SERVER_ACTIONS_PATH.exec(path) : null
  if (diagnosticMatch) {
    const action = parseServerActionBody(bodyValue)
    const exactAction = action && REVIEWED_SERVER_ACTION_TYPE_SET.has(action.type)
      ? maintenanceAction(action)
      : null
    if (exactAction?.operation === 'diagnostic') {
      const access = decideServerOperationAccess(policy, Number(diagnosticMatch[1]), 'diagnostic')
      return access.allowed
        ? { allowed: true, method, authorizedBody: exactAction.authorizedBody }
        : { allowed: false, method, reason: access.reason }
    }
  }

  // Refreshing BinaryLane's cached authoritative nameserver view changes no
  // durable DNS resource. The schema permits a global no-body refresh or an
  // exact domain_names body; reconstruct the latter so hidden fields cannot
  // turn this diagnostic-like endpoint into a broader request.
  if (method === 'POST' && DOMAIN_REFRESH_PATH.test(path)) {
    const refresh = canonicalDomainRefreshBody(bodyValue)
    return refresh
      ? { allowed: true, method, ...refresh }
      : { allowed: false, method, reason: 'invalid-action-body' }
  }

  if (accessMode === 'observe') {
    // Console URLs are remote-access credentials, not ordinary observations.
    if (consoleMatch) return { allowed: false, method, reason: 'protected-server' }
    return method === 'GET'
      ? { allowed: true, method }
      : { allowed: false, method, reason: 'observe-only' }
  }

  // A guarded profile without any classified target is an incomplete safety
  // configuration. Keep it observe-only until the user classifies a server.
  if (!isGuardedServerSafetyConfigured(policy)) {
    if (method === 'GET' && !consoleMatch) return { allowed: true, method }
    return { allowed: false, method, reason: 'guarded-not-configured' }
  }

  if (method === 'POST' && actionProceedIdForPath(pathValue) !== null) {
    const authorizedBody = canonicalProceedBody(bodyValue)
    return authorizedBody
      ? { allowed: false, method, authorizedBody, reason: 'action-context-required' }
      : { allowed: false, method, reason: 'invalid-action-body' }
  }

  if (consoleMatch) {
    const access = decideServerOperationAccess(policy, Number(consoleMatch[1]), 'remote-access')
    return access.allowed
      ? { allowed: true, method }
      : { allowed: false, method, reason: access.reason }
  }

  if (method === 'GET') return { allowed: true, method }

  // Collection creates are additive and their server-generated IDs naturally
  // start Normal. Domain names are themselves stable IDs, so a saved lock for
  // that exact name still applies if the zone is recreated.
  if (method === 'POST' && SERVER_COLLECTION_PATH.test(path)) {
    const create = canonicalServerCreateBody(bodyValue)
    if (!create) return { allowed: false, method, reason: 'invalid-action-body' }
    return create.targetVpcId === null
      ? { allowed: true, method, authorizedBody: create.authorizedBody }
      : resourceRequestDecision(
          policy,
          method,
          'vpc',
          create.targetVpcId,
          'maintenance',
          create.authorizedBody
        )
  }
  if (method === 'POST' && DOMAIN_COLLECTION_PATH.test(path)) {
    const authorizedBody = canonicalDomainCreateBody(bodyValue)
    if (!authorizedBody) return { allowed: false, method, reason: 'invalid-action-body' }
    const domain = (JSON.parse(authorizedBody) as { name: string }).name
    return resourceRequestDecision(policy, method, 'domain', domain, 'maintenance', authorizedBody)
  }
  if (method === 'POST' && VPC_COLLECTION_PATH.test(path)) {
    const authorizedBody = canonicalVpcBody(bodyValue, 'create')
    return authorizedBody
      ? { allowed: true, method, authorizedBody }
      : { allowed: false, method, reason: 'invalid-action-body' }
  }
  if (method === 'POST' && SSH_KEY_COLLECTION_PATH.test(path)) {
    const authorizedBody = canonicalSshKeyBody(bodyValue, true)
    return authorizedBody
      ? { allowed: true, method, authorizedBody }
      : { allowed: false, method, reason: 'invalid-action-body' }
  }
  if (method === 'POST' && LOAD_BALANCER_COLLECTION_PATH.test(path)) {
    const loadBalancer = canonicalLoadBalancerBody(bodyValue, true)
    if (!loadBalancer) return { allowed: false, method, reason: 'invalid-action-body' }
    const serverBlock = authorizeServerIds(policy, method, loadBalancer.serverIds)
    return serverBlock ?? { allowed: true, method, authorizedBody: loadBalancer.authorizedBody }
  }

  if (serverId !== null) {
    const level = getServerSafetyLevel(policy, serverId)
    const actionsMatch = method === 'POST' ? SERVER_ACTIONS_PATH.exec(path) : null
    if (actionsMatch) {
      const action = parseServerActionBody(bodyValue)
      if (!action) return { allowed: false, method, reason: 'invalid-action-body' }
      if (!REVIEWED_SERVER_ACTION_TYPE_SET.has(action.type)) {
        return { allowed: false, method, reason: 'unreviewed-server-action' }
      }

      if (level === 'locked') {
        const lockedAction = maintenanceAction(action)
        if (!lockedAction || lockedAction.operation !== 'diagnostic') {
          return { allowed: false, method, reason: 'protected-server' }
        }
        const access = decideServerOperationAccess(policy, serverId, lockedAction.operation)
        return access.allowed
          ? { allowed: true, method, authorizedBody: lockedAction.authorizedBody }
          : { allowed: false, method, reason: access.reason }
      }

      if (level === 'maintenance') {
        const maintenance = maintenanceAction(action)
        if (!maintenance) return { allowed: false, method, reason: 'maintenance-restricted' }
        const access = decideServerOperationAccess(policy, serverId, maintenance.operation)
        return access.allowed
          ? { allowed: true, method, authorizedBody: maintenance.authorizedBody }
          : { allowed: false, method, reason: access.reason }
      }

      const access = decideServerOperationAccess(policy, serverId, 'mutation')
      if (!access.allowed) return { allowed: false, method, reason: access.reason }

      if (action.type === 'change_network') {
        const network = canonicalChangeNetworkAction(action)
        if (!network) return { allowed: false, method, reason: 'invalid-action-body' }
        if (network.targetVpcId !== null) {
          const targetAccess = resourceRequestDecision(
            policy,
            method,
            'vpc',
            network.targetVpcId,
            'maintenance',
            network.authorizedBody
          )
          if (!targetAccess.allowed) return targetAccess
        }
        // The request identifies the destination but not the source VPC that
        // will lose this member. Ask the privileged transport to read the
        // server's current VPC, then re-run policy over both identities.
        return {
          allowed: false,
          method,
          authorizedBody: network.authorizedBody,
          reason: 'server-network-context-required'
        }
      }

      if (action.type === 'change_vpc_ipv4') {
        if (!canonicalChangeVpcIpv4Action(action)) {
          return { allowed: false, method, reason: 'invalid-action-body' }
        }
        // The VPC whose address space changes is absent from this action body.
        // Resolve it from current server state in the privileged transport.
        return {
          allowed: false,
          method,
          authorizedBody: canonicalChangeVpcIpv4Action(action)!,
          reason: 'server-network-context-required'
        }
      }

      if (action.type === 'change_partner') {
        const partner = canonicalChangePartnerAction(action)
        if (!partner) return { allowed: false, method, reason: 'invalid-action-body' }
        if (partner.partnerServerId !== null) {
          const partnerAccess = decideServerOperationAccess(policy, partner.partnerServerId, 'mutation')
          if (!partnerAccess.allowed) return { allowed: false, method, reason: partnerAccess.reason }
        }
        // Replacing/removing a partnership also touches the prior partner,
        // whose ID is not present in the request.
        return { allowed: false, method, reason: 'ambiguous-shared-resource' }
      }

      if (action.type === 'clone_using_backup') {
        const clone = canonicalCloneUsingBackupAction(action)
        if (!clone) return { allowed: false, method, reason: 'invalid-action-body' }
        const targetAccess = decideServerOperationAccess(policy, clone.targetServerId, 'mutation')
        return targetAccess.allowed
          ? { allowed: true, method, authorizedBody: clone.authorizedBody }
          : { allowed: false, method, reason: targetAccess.reason }
      }

      return { allowed: true, method, authorizedBody: action.serializedBody }
    }

    // The reviewed OpenAPI has only DELETE on the server root and POST for
    // backup upload as other direct-server mutations. Future routes/methods
    // must be reviewed before Guarded can send them.
    const reviewedDirectMutation =
      (method === 'DELETE' && SERVER_ROOT_PATH.test(path)) ||
      (method === 'POST' && SERVER_BACKUP_UPLOAD_PATH.test(path))
    if (!reviewedDirectMutation) {
      const access = decideServerOperationAccess(policy, serverId, 'mutation')
      if (!access.allowed) return { allowed: false, method, reason: access.reason }
      return { allowed: false, method, reason: 'unreviewed-server-action' }
    }

    const access = decideServerOperationAccess(policy, serverId, 'mutation')
    return access.allowed
      ? {
          allowed: true,
          method,
          ...(typeof bodyValue === 'string' ? { authorizedBody: bodyValue } : {})
        }
      : { allowed: false, method, reason: access.reason }
  }

  const domainRecordMatch = DOMAIN_RECORD_PATH.exec(path)
  if (domainRecordMatch && (method === 'PUT' || method === 'DELETE')) {
    const domain = canonicalDomainId(domainRecordMatch[1])
    const recordId = numericResourceId(domainRecordMatch[2])
    if (!domain || recordId === null) return { allowed: false, method, reason: 'invalid-resource' }
    const access = resourceRequestDecision(policy, method, 'domain', domain, 'maintenance')
    if (!access.allowed) return access
    if (method === 'DELETE') {
      return bodyValue === undefined
        ? access
        : { allowed: false, method, reason: 'invalid-action-body' }
    }
    const authorizedBody = canonicalDomainRecordBody(bodyValue, false)
    return authorizedBody
      ? { allowed: true, method, authorizedBody }
      : { allowed: false, method, reason: 'invalid-action-body' }
  }

  const domainRecordsMatch = DOMAIN_RECORDS_PATH.exec(path)
  if (domainRecordsMatch && method === 'POST') {
    const domain = canonicalDomainId(domainRecordsMatch[1])
    if (!domain) return { allowed: false, method, reason: 'invalid-resource' }
    const access = resourceRequestDecision(policy, method, 'domain', domain, 'maintenance')
    if (!access.allowed) return access
    const authorizedBody = canonicalDomainRecordBody(bodyValue, true)
    return authorizedBody
      ? { allowed: true, method, authorizedBody }
      : { allowed: false, method, reason: 'invalid-action-body' }
  }

  const domainRootMatch = DOMAIN_ROOT_PATH.exec(path)
  if (domainRootMatch && method === 'DELETE') {
    const domain = canonicalDomainId(domainRootMatch[1])
    if (!domain) return { allowed: false, method, reason: 'invalid-resource' }
    if (bodyValue !== undefined) return { allowed: false, method, reason: 'invalid-action-body' }
    return resourceRequestDecision(policy, method, 'domain', domain, 'destructive')
  }

  const sshKeyMatch = SSH_KEY_ROOT_PATH.exec(path)
  if (sshKeyMatch && (method === 'PUT' || method === 'DELETE')) {
    const keyId = numericResourceId(sshKeyMatch[1])
    if (keyId === null) return { allowed: false, method, reason: 'invalid-resource' }
    const operation: ResourceOperationClass = method === 'DELETE' ? 'destructive' : 'maintenance'
    const access = resourceRequestDecision(policy, method, 'ssh-key', keyId, operation)
    if (!access.allowed) return access
    if (method === 'DELETE') {
      return bodyValue === undefined
        ? access
        : { allowed: false, method, reason: 'invalid-action-body' }
    }
    const authorizedBody = canonicalSshKeyBody(bodyValue, false)
    return authorizedBody
      ? { allowed: true, method, authorizedBody }
      : { allowed: false, method, reason: 'invalid-action-body' }
  }

  const vpcMatch = VPC_ROOT_PATH.exec(path)
  if (vpcMatch && (method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
    const vpcId = numericResourceId(vpcMatch[1])
    if (vpcId === null) return { allowed: false, method, reason: 'invalid-resource' }
    const operation: ResourceOperationClass = method === 'DELETE' ? 'destructive' : 'maintenance'
    const access = resourceRequestDecision(policy, method, 'vpc', vpcId, operation)
    if (!access.allowed) return access
    if (method === 'DELETE') {
      return bodyValue === undefined
        ? access
        : { allowed: false, method, reason: 'invalid-action-body' }
    }
    const authorizedBody = canonicalVpcBody(bodyValue, method === 'PUT' ? 'put' : 'patch')
    return authorizedBody
      ? { allowed: true, method, authorizedBody }
      : { allowed: false, method, reason: 'invalid-action-body' }
  }

  const loadBalancerServersMatch = LOAD_BALANCER_SERVERS_PATH.exec(path)
  if (loadBalancerServersMatch && (method === 'POST' || method === 'DELETE')) {
    const loadBalancerId = numericResourceId(loadBalancerServersMatch[1])
    if (loadBalancerId === null) return { allowed: false, method, reason: 'invalid-resource' }
    const access = resourceRequestDecision(policy, method, 'load-balancer', loadBalancerId, 'maintenance')
    if (!access.allowed) return access
    const membership = canonicalServerIdsBody(bodyValue)
    if (!membership) return { allowed: false, method, reason: 'invalid-action-body' }
    const serverBlock = authorizeServerIds(policy, method, membership.serverIds)
    return serverBlock ?? { allowed: true, method, authorizedBody: membership.authorizedBody }
  }

  const loadBalancerRulesMatch = LOAD_BALANCER_FORWARDING_RULES_PATH.exec(path)
  if (loadBalancerRulesMatch && (method === 'POST' || method === 'DELETE')) {
    const loadBalancerId = numericResourceId(loadBalancerRulesMatch[1])
    if (loadBalancerId === null) return { allowed: false, method, reason: 'invalid-resource' }
    const access = resourceRequestDecision(policy, method, 'load-balancer', loadBalancerId, 'maintenance')
    if (!access.allowed) return access
    const authorizedBody = canonicalForwardingRulesBody(bodyValue)
    return authorizedBody
      ? { allowed: true, method, authorizedBody }
      : { allowed: false, method, reason: 'invalid-action-body' }
  }

  const loadBalancerMatch = LOAD_BALANCER_ROOT_PATH.exec(path)
  if (loadBalancerMatch && (method === 'PUT' || method === 'DELETE')) {
    const loadBalancerId = numericResourceId(loadBalancerMatch[1])
    if (loadBalancerId === null) return { allowed: false, method, reason: 'invalid-resource' }
    const operation: ResourceOperationClass = method === 'DELETE' ? 'destructive' : 'maintenance'
    const access = resourceRequestDecision(policy, method, 'load-balancer', loadBalancerId, operation)
    if (!access.allowed) return access
    if (method === 'DELETE') {
      return bodyValue === undefined
        ? access
        : { allowed: false, method, reason: 'invalid-action-body' }
    }
    const loadBalancer = canonicalLoadBalancerBody(bodyValue, false)
    if (!loadBalancer) return { allowed: false, method, reason: 'invalid-action-body' }
    const serverBlock = authorizeServerIds(policy, method, loadBalancer.serverIds)
    if (serverBlock) return serverBlock
    if (loadBalancer.hasServerIds) {
      // PUT replaces the complete backend list. IDs omitted from the new list
      // are also touched, but their identities are absent from the request;
      // use the exact add/remove endpoints when Protected.
      return { allowed: false, method, reason: 'ambiguous-shared-resource' }
    }
    return { allowed: true, method, authorizedBody: loadBalancer.authorizedBody }
  }

  // Unknown/global writes remain closed. Exact shared-resource routes above
  // authorise only their own stable ID and any explicitly touched server IDs;
  // a lock is never inferred merely from another member of the resource.
  return { allowed: false, method, reason: 'ambiguous-shared-resource' }
}

/** Shared UI/remote-access decision for operations tied to one known server. */
export function decideServerActionAccess(
  policyValue: Partial<ProfileSafetyPolicy> | null | undefined,
  serverId: unknown
): ServerActionAccessDecision {
  if (!Number.isSafeInteger(serverId) || Number(serverId) <= 0) {
    return { allowed: false, reason: 'invalid-server' }
  }

  const decision = decideServerOperationAccess(policyValue, serverId, 'mutation')
  return decision.allowed
    ? { allowed: true }
    : { allowed: false, reason: decision.reason as ServerActionAccessDecision['reason'] }
}

export function isRemoteAccessAllowed(
  policyValue: Partial<ProfileSafetyPolicy> | null | undefined,
  serverId: unknown
): boolean {
  const accessMode = effectiveAccessMode(policyValue?.accessMode)
  if (accessMode === 'full') return true
  return decideServerOperationAccess(policyValue, serverId, 'remote-access').allowed
}
