export type ResourceSafetyKind = 'vpc' | 'domain' | 'load-balancer' | 'ssh-key' | 'template'

export type ResourceSafetyLevel = 'locked' | 'maintenance' | 'testable'

export type ResourceOperationClass = 'read' | 'maintenance' | 'destructive'

export interface ResourceSafetyTarget {
  kind: ResourceSafetyKind
  /** Canonical, repository/account-local identity; display labels are never policy. */
  id: string
}

export interface ResourceSafetyAssignments {
  protectedResources?: ResourceSafetyTarget[]
  maintenanceResources?: ResourceSafetyTarget[]
}

export interface ResourceOperationAccessDecision {
  allowed: boolean
  operation: ResourceOperationClass
  level?: ResourceSafetyLevel
  target?: ResourceSafetyTarget
  reason?:
    | 'invalid-resource'
    | 'invalid-operation'
    | 'observe-only'
    | 'guarded-not-configured'
    | 'protected-resource'
    | 'maintenance-resource-restricted'
}

const RESOURCE_KINDS = new Set<ResourceSafetyKind>([
  'vpc',
  'domain',
  'load-balancer',
  'ssh-key',
  'template'
])

const RESOURCE_OPERATIONS = new Set<ResourceOperationClass>(['read', 'maintenance', 'destructive'])
const NUMERIC_RESOURCE_KINDS = new Set<ResourceSafetyKind>(['vpc', 'load-balancer', 'ssh-key'])

export function normalizeResourceSafetyTarget(
  kindValue: unknown,
  idValue: unknown
): ResourceSafetyTarget | null {
  if (typeof kindValue !== 'string' || !RESOURCE_KINDS.has(kindValue as ResourceSafetyKind)) return null
  const kind = kindValue as ResourceSafetyKind

  if (NUMERIC_RESOURCE_KINDS.has(kind)) {
    const numeric = typeof idValue === 'number'
      ? idValue
      : typeof idValue === 'string' && /^\d+$/.test(idValue)
        ? Number(idValue)
        : NaN
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return null
    return { kind, id: String(numeric) }
  }

  if (typeof idValue !== 'string') return null
  let id = idValue.trim().toLowerCase()
  if (kind === 'domain') id = id.replace(/\.$/, '')
  if (
    id.length === 0 ||
    id.length > (kind === 'domain' ? 253 : 128) ||
    /[\u0000-\u001f\u007f/\\]/.test(id)
  ) return null
  if (kind === 'template' && !/^[a-z0-9][a-z0-9._-]*$/.test(id)) return null
  return { kind, id }
}

export function resourceSafetyKey(targetValue: ResourceSafetyTarget | null | undefined): string | null {
  const target = normalizeResourceSafetyTarget(targetValue?.kind, targetValue?.id)
  return target ? `${target.kind}:${target.id}` : null
}

export function normalizeResourceSafetyTargets(value: unknown): ResourceSafetyTarget[] {
  if (!Array.isArray(value)) return []
  const byKey = new Map<string, ResourceSafetyTarget>()
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue
    const record = candidate as Record<string, unknown>
    const target = normalizeResourceSafetyTarget(record.kind, record.id)
    const key = resourceSafetyKey(target)
    if (target && key) byKey.set(key, target)
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, target]) => target)
}

export function areCanonicalResourceSafetyTargets(value: unknown): value is ResourceSafetyTarget[] {
  if (!Array.isArray(value)) return false
  const normalized = normalizeResourceSafetyTargets(value)
  if (normalized.length !== value.length) return false
  return normalized.every((target, index) => {
    const candidate = value[index]
    return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).kind === target.kind &&
      (candidate as Record<string, unknown>).id === target.id
  })
}

export function mergeResourceSafetyTargets(current: unknown, requested: unknown): ResourceSafetyTarget[] {
  return normalizeResourceSafetyTargets([
    ...normalizeResourceSafetyTargets(current),
    ...normalizeResourceSafetyTargets(requested)
  ])
}

export function getResourceSafetyLevel(
  assignments: ResourceSafetyAssignments | null | undefined,
  kindValue: unknown,
  idValue: unknown
): ResourceSafetyLevel {
  const target = normalizeResourceSafetyTarget(kindValue, idValue)
  const key = resourceSafetyKey(target)
  if (!target || !key) return 'locked'
  const locked = new Set(normalizeResourceSafetyTargets(assignments?.protectedResources).map(resourceSafetyKey))
  if (locked.has(key)) return 'locked'
  const maintenance = new Set(normalizeResourceSafetyTargets(assignments?.maintenanceResources).map(resourceSafetyKey))
  return maintenance.has(key) ? 'maintenance' : 'testable'
}

export function hasResourceSafetyAssignments(
  assignments: ResourceSafetyAssignments | null | undefined
): boolean {
  return normalizeResourceSafetyTargets(assignments?.protectedResources).length > 0 ||
    normalizeResourceSafetyTargets(assignments?.maintenanceResources).length > 0
}

export function decideResourceOperationAccess(
  accessModeValue: unknown,
  configured: boolean,
  assignments: ResourceSafetyAssignments | null | undefined,
  kindValue: unknown,
  idValue: unknown,
  operationValue: unknown
): ResourceOperationAccessDecision {
  const target = normalizeResourceSafetyTarget(kindValue, idValue)
  const operation = typeof operationValue === 'string' && RESOURCE_OPERATIONS.has(operationValue as ResourceOperationClass)
    ? operationValue as ResourceOperationClass
    : 'destructive'
  if (!target) return { allowed: false, operation, reason: 'invalid-resource' }
  if (operationValue !== operation) {
    return { allowed: false, operation, target, reason: 'invalid-operation' }
  }

  const level = getResourceSafetyLevel(assignments, target.kind, target.id)
  if (accessModeValue === 'full') return { allowed: true, operation, level, target }
  if (operation === 'read') return { allowed: true, operation, level, target }
  if (accessModeValue !== 'guarded') {
    return { allowed: false, operation, level, target, reason: 'observe-only' }
  }
  if (!configured) {
    return { allowed: false, operation, level, target, reason: 'guarded-not-configured' }
  }
  if (level === 'locked') {
    return { allowed: false, operation, level, target, reason: 'protected-resource' }
  }
  if (level === 'maintenance' && operation === 'destructive') {
    return { allowed: false, operation, level, target, reason: 'maintenance-resource-restricted' }
  }
  return { allowed: true, operation, level, target }
}
