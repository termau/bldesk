import React, { createContext, useCallback, useContext, useMemo } from 'react'
import type { AccountProfile } from '@shared/ipc-types'
import {
  decideServerOperationAccess,
  getServerSafetyLevel,
  type ServerOperationClass,
  type ServerSafetyLevel,
  type ProfileAccessMode
} from '@shared/binarylane-policy'
import {
  decideResourceOperationAccess,
  getResourceSafetyLevel,
  normalizeResourceSafetyTargets,
  type ResourceOperationClass,
  type ResourceSafetyKind,
  type ResourceSafetyLevel
} from '@shared/resource-safety'

export interface SafetySettingsTarget {
  kind: ResourceSafetyKind
  id: string | number
  label: string
}

interface ProfileSafetyContextValue {
  accessMode: ProfileAccessMode
  lockedServerCount: number
  maintenanceServerCount: number
  lockedResourceCount: number
  maintenanceResourceCount: number
  /** Backwards-compatible alias for lockedServerCount. */
  protectedServerCount: number
  serverSafetyLevel: (serverId: unknown) => ServerSafetyLevel
  isServerProtected: (serverId: unknown) => boolean
  isServerMaintenance: (serverId: unknown) => boolean
  serverActionBlockReason: (serverId: unknown, operation?: ServerOperationClass) => string | null
  resourceSafetyLevel: (kind: unknown, id: unknown) => ResourceSafetyLevel
  resourceActionBlockReason: (
    kind: unknown,
    id: unknown,
    operation?: ResourceOperationClass
  ) => string | null
  collectionMutationBlockReason: () => string | null
  /** Backwards-compatible alias for collectionMutationBlockReason. */
  sharedMutationBlockReason: () => string | null
  openSafetySettings: (target?: SafetySettingsTarget) => void
}

const NO_PROFILE_VALUE: ProfileSafetyContextValue = {
  accessMode: 'observe',
  lockedServerCount: 0,
  maintenanceServerCount: 0,
  lockedResourceCount: 0,
  maintenanceResourceCount: 0,
  protectedServerCount: 0,
  serverSafetyLevel: () => 'testable',
  isServerProtected: () => false,
  isServerMaintenance: () => false,
  serverActionBlockReason: () => 'No active account profile is available.',
  resourceSafetyLevel: () => 'locked',
  resourceActionBlockReason: () => 'No active account profile is available.',
  collectionMutationBlockReason: () => 'No active account profile is available.',
  sharedMutationBlockReason: () => 'No active account profile is available.',
  openSafetySettings: () => undefined
}

const ProfileSafetyContext = createContext<ProfileSafetyContextValue>(NO_PROFILE_VALUE)

export function ProfileSafetyProvider({
  profile,
  onOpenSafetySettings,
  children
}: {
  profile: AccountProfile | null
  onOpenSafetySettings?: (target?: SafetySettingsTarget) => void
  children: React.ReactNode
}) {
  const accessMode = profile?.accessMode ?? 'observe'
  const protectedIds = useMemo(
    () => new Set((profile?.protectedServerIds ?? []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)),
    [profile?.protectedServerIds]
  )
  const maintenanceIds = useMemo(
    () => new Set(
      (profile?.maintenanceServerIds ?? [])
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0 && !protectedIds.has(id))
    ),
    [profile?.maintenanceServerIds, protectedIds]
  )
  const protectedResources = useMemo(
    () => normalizeResourceSafetyTargets(profile?.protectedResources),
    [profile?.protectedResources]
  )
  const maintenanceResources = useMemo(
    () => normalizeResourceSafetyTargets(profile?.maintenanceResources),
    [profile?.maintenanceResources]
  )
  const configured = protectedIds.size + maintenanceIds.size + protectedResources.length + maintenanceResources.length > 0

  const serverSafetyLevel = useCallback(
    (serverId: unknown): ServerSafetyLevel => getServerSafetyLevel(profile, serverId),
    [profile]
  )

  const isServerProtected = useCallback(
    (serverId: unknown) => {
      const normalized = Number(serverId)
      return Number.isSafeInteger(normalized) && normalized > 0 && protectedIds.has(normalized)
    },
    [protectedIds]
  )

  const isServerMaintenance = useCallback(
    (serverId: unknown) => serverSafetyLevel(serverId) === 'maintenance',
    [serverSafetyLevel]
  )

  const serverActionBlockReason = useCallback(
    (serverId: unknown, operation: ServerOperationClass = 'mutation'): string | null => {
      if (!profile) return 'No active account profile is available.'
      const decision = decideServerOperationAccess(profile, serverId, operation)
      switch (decision.reason) {
        case undefined:
          return null
        case 'observe-only':
          return 'Observe-only safety allows views and diagnostics, but blocks server changes and remote access.'
        case 'guarded-not-configured':
          return 'Protected mode requires at least one Read-only or Maintenance entity.'
        case 'protected-server':
          return operation === 'remote-access'
            ? 'Read-only blocks SSH and rescue-console access.'
            : 'Read-only allows views and diagnostics, but blocks every change.'
        case 'maintenance-restricted':
          return 'Maintenance permits operational access, firewall rules, diagnostics, power recovery, and a non-replacing temporary backup, but blocks structural changes.'
        case 'invalid-server':
          return 'The server identity cannot be verified safely.'
        case 'invalid-operation':
          return 'This operation has not been classified for safe live-account use.'
      }
    },
    [profile]
  )

  const resourceSafetyLevel = useCallback(
    (kind: unknown, id: unknown): ResourceSafetyLevel => getResourceSafetyLevel(profile, kind, id),
    [profile]
  )

  const resourceActionBlockReason = useCallback(
    (
      kind: unknown,
      id: unknown,
      operation: ResourceOperationClass = 'maintenance'
    ): string | null => {
      if (!profile) return 'No active account profile is available.'
      const decision = decideResourceOperationAccess(
        profile.accessMode,
        configured,
        profile,
        kind,
        id,
        operation
      )
      switch (decision.reason) {
        case undefined:
          return null
        case 'observe-only':
          return 'Observe-only safety allows views and diagnostics, but blocks resource changes.'
        case 'guarded-not-configured':
          return 'Protected mode requires at least one Read-only or Maintenance entity.'
        case 'protected-resource':
          return 'Read-only allows this resource to be viewed, but blocks every change.'
        case 'maintenance-resource-restricted':
          return 'Maintenance allows reviewed in-place changes, but blocks deleting or cancelling this resource.'
        case 'invalid-resource':
          return 'The resource identity cannot be verified safely.'
        case 'invalid-operation':
          return 'This resource operation has not been classified for safe live-account use.'
      }
    },
    [configured, profile]
  )

  const collectionMutationBlockReason = useCallback((): string | null => {
    if (!profile) return 'No active account profile is available.'
    if (accessMode === 'full') return null
    if (accessMode === 'observe') {
      return 'Observe-only safety allows views and diagnostics, but blocks creating resources.'
    }
    if (!configured) {
      return 'Protected mode requires at least one Read-only or Maintenance entity.'
    }
    return null
  }, [accessMode, configured, profile])

  const sharedMutationBlockReason = collectionMutationBlockReason

  const openSafetySettings = useCallback(
    (target?: SafetySettingsTarget) => onOpenSafetySettings?.(target),
    [onOpenSafetySettings]
  )

  const value = useMemo(
    () => ({
      accessMode,
      lockedServerCount: protectedIds.size,
      maintenanceServerCount: maintenanceIds.size,
      lockedResourceCount: protectedResources.length,
      maintenanceResourceCount: maintenanceResources.length,
      protectedServerCount: protectedIds.size,
      serverSafetyLevel,
      isServerProtected,
      isServerMaintenance,
      serverActionBlockReason,
      resourceSafetyLevel,
      resourceActionBlockReason,
      collectionMutationBlockReason,
      sharedMutationBlockReason,
      openSafetySettings
    }),
    [
      accessMode,
      protectedIds.size,
      maintenanceIds.size,
      protectedResources.length,
      maintenanceResources.length,
      serverSafetyLevel,
      isServerProtected,
      isServerMaintenance,
      serverActionBlockReason,
      resourceSafetyLevel,
      resourceActionBlockReason,
      collectionMutationBlockReason,
      sharedMutationBlockReason,
      openSafetySettings
    ]
  )

  return <ProfileSafetyContext.Provider value={value}>{children}</ProfileSafetyContext.Provider>
}

export function useProfileSafety(): ProfileSafetyContextValue {
  return useContext(ProfileSafetyContext)
}
