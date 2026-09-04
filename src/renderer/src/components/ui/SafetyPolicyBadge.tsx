import React from 'react'
import { LockKeyhole, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import type { ResourceSafetyKind } from '@shared/resource-safety'

interface SafetyPolicyBadgeProps {
  scope: 'shared' | 'server' | 'resource'
  serverId?: unknown
  resourceKind?: ResourceSafetyKind
  resourceId?: unknown
  resourceLabel?: string
  /** Page-specific nuance appended to the policy explanation. */
  note?: string
  className?: string
}

/** Compact, clickable truth about the policy governing the current page. */
export const SafetyPolicyBadge: React.FC<SafetyPolicyBadgeProps> = ({
  scope,
  serverId,
  resourceKind,
  resourceId,
  resourceLabel,
  note,
  className = ''
}) => {
  const {
    accessMode,
    lockedServerCount,
    maintenanceServerCount,
    lockedResourceCount,
    maintenanceResourceCount,
    serverSafetyLevel,
    resourceSafetyLevel,
    openSafetySettings
  } = useProfileSafety()

  const configured = lockedServerCount + maintenanceServerCount + lockedResourceCount + maintenanceResourceCount > 0
  const serverLevel = scope === 'server' && serverId != null ? serverSafetyLevel(serverId) : null
  const resourceLevel = scope === 'resource' && resourceKind && resourceId != null
    ? resourceSafetyLevel(resourceKind, resourceId)
    : null
  const level = serverLevel ?? resourceLevel

  let label: string
  let explanation: string
  let tone: string
  let Icon = LockKeyhole

  if (accessMode === 'full') {
    label = 'FULL'
    explanation = 'Full access is active; reviewed changes are available.'
    tone = 'border-rose-500/45 bg-rose-500/10 text-rose-700 dark:text-rose-300'
    Icon = ShieldAlert
  } else if (accessMode === 'observe') {
    label = 'VIEW ONLY'
    explanation = 'Observe-only allows views and diagnostics while blocking changes and remote access.'
    tone = 'border-slate-500/45 bg-slate-500/10 text-slate-700 dark:text-slate-300'
  } else if (!configured) {
    label = 'SETUP'
    explanation = 'Protected mode remains view-only until at least one server or resource is Read-only or Maintenance.'
    tone = 'border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    Icon = ShieldAlert
  } else if (scope === 'shared') {
    label = 'NEW: NORMAL'
    explanation = 'New resources start Normal; existing resources use their own local safety tier.'
    tone = 'border-sky-500/45 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    Icon = ShieldCheck
  } else if (level === 'locked') {
    label = 'READ'
    explanation = scope === 'resource'
      ? 'This resource is Read-only: views remain available and every change is blocked.'
      : 'This server is Read-only: views and diagnostics are available; changes and remote access are blocked.'
    tone = 'border-rose-500/45 bg-rose-500/10 text-rose-700 dark:text-rose-300'
  } else if (level === 'maintenance') {
    label = 'MAINT'
    explanation = scope === 'resource'
      ? 'This resource permits reviewed in-place maintenance while deletion and cancellation remain blocked.'
      : 'This server permits maintenance operations, including reviewed firewall and recovery actions.'
    tone = 'border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    Icon = ShieldAlert
  } else if (level === 'testable') {
    label = 'NORMAL'
    explanation = scope === 'resource'
      ? 'This resource permits ordinary reviewed BLDesk actions while profile-wide protections remain active.'
      : 'This server permits ordinary reviewed BLDesk actions while profile-wide protections remain active.'
    tone = 'border-sky-500/45 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    Icon = ShieldCheck
  } else {
    label = 'MIXED'
    explanation = 'This page contains server-scoped resources governed by each server’s local safety tier.'
    tone = 'border-sky-500/45 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    Icon = ShieldCheck
  }

  const title = `${explanation}${note ? ` ${note}` : ''} Open Live-account safety.`

  return (
    <button
      type="button"
      data-safety-scope={scope}
      data-safety-level={level ?? undefined}
      onClick={() => openSafetySettings(
        scope === 'resource' && resourceKind && resourceId != null
          ? {
              kind: resourceKind,
              id: typeof resourceId === 'number' ? resourceId : String(resourceId),
              label: resourceLabel || `${resourceKind} ${String(resourceId)}`
            }
          : undefined
      )}
      title={title}
      aria-label={`${label}. ${title}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[#017cb6]/60 ${tone} ${className}`}
    >
      <Icon className="h-3 w-3" />
      <span>{label}</span>
    </button>
  )
}
