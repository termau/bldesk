import React, { useEffect, useState } from 'react'
import { Key, ShieldCheck, ExternalLink, Trash2, CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { AccountProfile } from '@shared/ipc-types'
import type { ProfileAccessMode, ServerSafetyLevel } from '@shared/binarylane-policy'
import {
  getResourceSafetyLevel,
  normalizeResourceSafetyTarget,
  normalizeResourceSafetyTargets,
  resourceSafetyKey,
  type ResourceSafetyLevel,
  type ResourceSafetyTarget
} from '@shared/resource-safety'
import type { SafetySettingsTarget } from '../../context/ProfileSafetyContext'
import { useConfirm } from '../../context/ConfirmContext'
import { Modal } from '../ui/Modal'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  profiles: AccountProfile[]
  activeProfile: AccountProfile | null
  servers: Array<{ id: number; name: string }>
  safetyTarget?: SafetySettingsTarget | null
  onProfileAddedOrUpdated: () => void
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  profiles,
  activeProfile,
  servers,
  safetyTarget,
  onProfileAddedOrUpdated
}) => {
  const [profileName, setProfileName] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [isDefault, setIsDefault] = useState(profiles.length === 0)
  const [isValidating, setIsValidating] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [safetyMode, setSafetyMode] = useState<ProfileAccessMode>('observe')
  const [safetyProtectedServerIds, setSafetyProtectedServerIds] = useState<number[]>([])
  const [safetyMaintenanceServerIds, setSafetyMaintenanceServerIds] = useState<number[]>([])
  const [safetyProtectedResources, setSafetyProtectedResources] = useState<ResourceSafetyTarget[]>([])
  const [safetyMaintenanceResources, setSafetyMaintenanceResources] = useState<ResourceSafetyTarget[]>([])
  const [isSavingSafety, setIsSavingSafety] = useState(false)
  const [isConfirmingProfileDelete, setIsConfirmingProfileDelete] = useState(false)
  /**
   * Replacing a key on an existing profile, rather than adding a new account.
   * Previously the only entry point was "add", so repairing a profile whose token
   * had been revoked meant retyping its name and hoping — which silently created
   * a duplicate instead of fixing the original.
   */
  const [updating, setUpdating] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    if (!isOpen || !activeProfile) return
    setSafetyMode(activeProfile.accessMode)
    setSafetyProtectedServerIds(activeProfile.protectedServerIds)
    setSafetyMaintenanceServerIds(activeProfile.maintenanceServerIds ?? [])
    setSafetyProtectedResources(normalizeResourceSafetyTargets(activeProfile.protectedResources))
    setSafetyMaintenanceResources(normalizeResourceSafetyTargets(activeProfile.maintenanceResources))
  }, [
    isOpen,
    activeProfile?.id,
    activeProfile?.accessMode,
    activeProfile?.protectedServerIds,
    activeProfile?.maintenanceServerIds,
    activeProfile?.protectedResources,
    activeProfile?.maintenanceResources
  ])

  if (!isOpen) return null

  const handleOpenTokenPage = () => {
    window.bldeskApi?.openExternal?.('https://home.binarylane.com.au/api-info')
  }

  const handleClose = () => {
    setTokenInput('')
    setProfileName('')
    setUpdating(null)
    setErrorMsg(null)
    setSuccessMsg(null)
    onClose()
  }

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    const cleanToken = tokenInput.trim()
    if (!cleanToken) {
      setErrorMsg('Please enter a valid BinaryLane API token.')
      return
    }

    // Catch the collision before spending a token validation round-trip on it.
    if (!updating) {
      const wanted = profileName.trim().toLowerCase()
      const clash = wanted && profiles.find((p) => (p.name || '').trim().toLowerCase() === wanted)
      if (clash) {
        setErrorMsg(
          `A profile named "${clash.name}" already exists. Use the update action on that profile to replace its API key.`
        )
        return
      }
    }

    setIsValidating(true)

    try {
      // The token crosses the narrow bridge once; saved credentials never return.
      const validation = await window.bldeskApi?.validateBinaryLaneToken?.(cleanToken)
      if (!validation?.success) throw new Error(validation?.error || 'API token verification failed.')

      const verifiedEmail = validation.email
      const name = updating?.name || profileName.trim() || verifiedEmail || 'BinaryLane Account'

      // Privileged storage forces new credentials to observe-only and preserves
      // policy on a verified same-account rotation. Renderer input cannot choose.
      const result = await window.bldeskApi.saveProfile({
        profileId: updating?.id,
        name,
        token: cleanToken,
        isDefault
      })

      if (result.error) {
        throw new Error(result.error)
      }

      setSuccessMsg(`Account "${name}" connected successfully!`)
      setProfileName('')
      setTokenInput('')
      setUpdating(null)
      onProfileAddedOrUpdated()

      setTimeout(() => {
        setSuccessMsg(null)
        handleClose()
      }, 1200)
    } catch (err: any) {
      setErrorMsg(err.message || 'Verification failed.')
    } finally {
      setIsValidating(false)
    }
  }

  const confirmAction = useConfirm()

  const handleSaveSafety = async () => {
    if (!activeProfile) return
    if (
      safetyMode === 'guarded' &&
      safetyProtectedServerIds.length === 0 && safetyMaintenanceServerIds.length === 0 &&
      safetyProtectedResources.length === 0 && safetyMaintenanceResources.length === 0
    ) {
      setErrorMsg('Select at least one server or resource as Read-only or Maintenance before enabling Protected mode.')
      return
    }

    setIsSavingSafety(true)
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const result = await window.bldeskApi.updateProfileSafety(
        activeProfile.id,
        safetyMode,
        safetyProtectedServerIds,
        safetyMaintenanceServerIds,
        safetyProtectedResources,
        safetyMaintenanceResources
      )
      if (!result.success) throw new Error(result.error || 'Could not save the safety policy.')
      setSuccessMsg('Local safety policy saved.')
      onProfileAddedOrUpdated()
    } catch (error: any) {
      setErrorMsg(error?.message || 'Could not save the safety policy.')
    } finally {
      setIsSavingSafety(false)
    }
  }

  const setServerSafetyLevel = (serverId: number, nextLevel: ServerSafetyLevel) => {
    if (!activeProfile) return
    const persistedLevel: ServerSafetyLevel = activeProfile.protectedServerIds.includes(serverId)
      ? 'locked'
      : (activeProfile.maintenanceServerIds ?? []).includes(serverId)
        ? 'maintenance'
        : 'testable'

    if (persistedLevel === 'locked' || (persistedLevel === 'maintenance' && nextLevel === 'testable')) return
    if (nextLevel !== 'testable' && safetyMode === 'full') setSafetyMode('guarded')

    setSafetyProtectedServerIds((current) =>
      nextLevel === 'locked'
        ? [...new Set([...current, serverId])]
        : current.filter((id) => id !== serverId)
    )
    setSafetyMaintenanceServerIds((current) =>
      nextLevel === 'maintenance'
        ? [...new Set([...current, serverId])]
        : current.filter((id) => id !== serverId)
    )
  }

  const setResourceSafetyLevel = (
    targetValue: ResourceSafetyTarget,
    nextLevel: ResourceSafetyLevel
  ) => {
    if (!activeProfile) return
    const target = normalizeResourceSafetyTarget(targetValue.kind, targetValue.id)
    const key = resourceSafetyKey(target)
    if (!target || !key) return
    const persistedLevel = getResourceSafetyLevel(activeProfile, target.kind, target.id)
    if (persistedLevel === 'locked' || (persistedLevel === 'maintenance' && nextLevel === 'testable')) return
    if (nextLevel !== 'testable' && safetyMode === 'full') setSafetyMode('guarded')

    setSafetyProtectedResources((current) => normalizeResourceSafetyTargets(
      nextLevel === 'locked'
        ? [...current, target]
        : current.filter((candidate) => resourceSafetyKey(candidate) !== key)
    ))
    setSafetyMaintenanceResources((current) => normalizeResourceSafetyTargets(
      nextLevel === 'maintenance'
        ? [...current, target]
        : current.filter((candidate) => resourceSafetyKey(candidate) !== key)
    ))
  }

  const focusedResource = safetyTarget
    ? normalizeResourceSafetyTarget(safetyTarget.kind, safetyTarget.id)
    : null
  const focusedResourceKey = resourceSafetyKey(focusedResource)
  const resourceTargets = normalizeResourceSafetyTargets([
    ...safetyProtectedResources,
    ...safetyMaintenanceResources,
    ...(focusedResource ? [focusedResource] : [])
  ])

  const resourceLabel = (target: ResourceSafetyTarget): string => {
    if (resourceSafetyKey(target) === focusedResourceKey && safetyTarget?.label) return safetyTarget.label
    switch (target.kind) {
      case 'vpc': return `VPC #${target.id}`
      case 'domain': return target.id
      case 'load-balancer': return `Load balancer #${target.id}`
      case 'ssh-key': return `SSH key #${target.id}`
      case 'template': return `Template ${target.id}`
    }
  }

  const handleDeleteProfile = async (id: string, name: string) => {
    setIsConfirmingProfileDelete(true)
    const ok = await confirmAction({
      title: 'Remove account profile',
      target: { kind: 'account', name },
      summary: 'The saved API token for this profile is deleted from the vault. You will need to re-enter it to use the account again.',
      severity: 'destructive',
      log: false,
      confirmLabel: 'Remove profile'
    }).finally(() => setIsConfirmingProfileDelete(false))
    if (!ok.ok) return
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const result = await window.bldeskApi?.deleteProfile?.(id)
      if (!result?.success) throw new Error(result?.error || 'The profile could not be removed from the credential vault.')
      onProfileAddedOrUpdated()
    } catch (err: any) {
      setErrorMsg(`Delete failed: ${err.message || 'Unknown error'}`)
    }
  }

  const handleSetActive = async (id: string) => {
    setErrorMsg(null)
    setSuccessMsg(null)
    try {
      const result = await window.bldeskApi?.setActiveProfile?.(id)
      if (!result?.success) throw new Error(result?.error || 'The active profile could not be changed.')
      onProfileAddedOrUpdated()
    } catch (err: any) {
      setErrorMsg(`Profile switch failed: ${err.message || 'Unknown error'}`)
    }
  }

  return (
    <Modal
      title="OS-Protected Credential Vault"
      icon={ShieldCheck}
      headTone="text-[#017cb6]"
      onClose={handleClose}
      size="sm"
      z={60}
      busy={isValidating || isSavingSafety || isConfirmingProfileDelete}
      labelledBy="credential-vault-title"
    >
      <div className="p-5 space-y-5 text-xs">
          {/* Active Profiles List */}
          {profiles.length > 0 && (
            <div className="space-y-2">
              <label className="font-semibold text-[#495057] dark:text-[#ced4da] block">Configured Accounts</label>
              <div className="space-y-1.5">
                {profiles.map((p) => {
                  const isActive = activeProfile?.id === p.id
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between p-2.5 rounded border transition ${
                        isActive
                          ? 'bg-[#017cb6]/10 border-[#017cb6] text-[#017cb6]'
                          : 'bg-[#f8f9fa] dark:bg-[#212529] border-[#ced4da] dark:border-[#373b3e] text-[#212529] dark:text-white hover:border-[#017cb6]'
                      }`}
                    >
                      <div
                        onClick={() => handleSetActive(p.id)}
                        className="cursor-pointer flex-1 flex items-center gap-2"
                      >
                        <Key className={`w-3.5 h-3.5 ${isActive ? 'text-[#f1ca00]' : 'text-[#6c757d]'}`} />
                        <div>
                          <div className="font-semibold">{p.name}</div>
                          {p.email && <div className="text-[10px] text-[#6c757d]">{p.email}</div>}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isActive && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold bg-[#017cb6] text-white rounded">
                            ACTIVE
                          </span>
                        )}
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${
                          p.accessMode === 'full'
                            ? 'bg-amber-600 text-white'
                            : p.accessMode === 'guarded'
                              ? 'bg-emerald-700 text-white'
                              : 'bg-slate-600 text-white'
                        }`}>
                          {p.accessMode === 'full' ? 'FULL' : p.accessMode === 'guarded' ? 'GUARDED' : 'OBSERVE'}
                        </span>
                        <button
                          onClick={() => {
                            setUpdating({ id: p.id, name: p.name })
                            setTokenInput('')
                            setErrorMsg(null)
                            setSuccessMsg(null)
                          }}
                          title={`Replace the API key for ${p.name}`}
                          className="text-[#6c757d] hover:text-[#017cb6] p-1 rounded"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteProfile(p.id, p.name)}
                          className="text-[#6c757d] hover:text-rose-500 p-1 rounded"
                          title="Delete profile"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {activeProfile && (
            <div className="space-y-3 rounded border border-emerald-700/50 bg-emerald-50/70 dark:bg-emerald-950/20 p-3">
              <div>
                <div className="font-semibold text-[#212529] dark:text-white">Live-account safety</div>
                <p className="mt-1 text-[10px] leading-relaxed text-[#6c757d] dark:text-[#adb5bd]">
                  Observe-only blocks changes and remote access. Protected mode assigns compact tiers to each entity independently:
                  locking a VPC does not lock its member servers, and locking a server does not lock its VPC. Read-only blocks changes;
                  Maintenance permits reviewed operational or in-place work but not structural server changes or resource deletion;
                  Normal keeps ordinary reviewed BLDesk work available. Saved tiers can only be strengthened here.
                </p>
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] text-[#6c757d]">Safety mode</span>
                <select
                  value={safetyMode}
                  onChange={(event) => setSafetyMode(event.target.value as ProfileAccessMode)}
                  className="w-full rounded border border-[#ced4da] bg-white px-3 py-1.5 text-[#212529] dark:border-[#373b3e] dark:bg-[#212529] dark:text-white"
                >
                  <option value="observe">Observe only — no changes or remote access</option>
                  <option value="guarded">Protected mode — per-entity safety</option>
                  {activeProfile.accessMode === 'full' &&
                    safetyProtectedServerIds.length === 0 && safetyMaintenanceServerIds.length === 0 &&
                    safetyProtectedResources.length === 0 && safetyMaintenanceResources.length === 0 && (
                    <option value="full">Full access — legacy unrestricted mode</option>
                  )}
                </select>
              </label>

              <div>
                <div className="mb-1 text-[11px] text-[#6c757d]">Per-server safety level</div>
                {servers.length === 0 ? (
                  <div className="rounded bg-white/70 p-2 text-[10px] text-[#6c757d] dark:bg-black/20">
                    The read-only server list has not loaded yet. Leave this dialog open briefly, or reopen it
                    after the dashboard appears.
                  </div>
                ) : (
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-[#ced4da] bg-white/70 p-2 dark:border-[#373b3e] dark:bg-black/20">
                    {servers.map((server) => {
                      const persistedLevel: ServerSafetyLevel = activeProfile.protectedServerIds.includes(server.id)
                        ? 'locked'
                        : (activeProfile.maintenanceServerIds ?? []).includes(server.id)
                          ? 'maintenance'
                          : 'testable'
                      const selectedLevel: ServerSafetyLevel = safetyProtectedServerIds.includes(server.id)
                        ? 'locked'
                        : safetyMaintenanceServerIds.includes(server.id)
                          ? 'maintenance'
                          : 'testable'
                      return (
                        <label key={server.id} className="flex items-center gap-2 text-[11px] text-[#212529] dark:text-white">
                          <span className="min-w-0 flex-1 truncate">{server.name}</span>
                          <span className="font-mono text-[9px] text-[#6c757d]">#{server.id}</span>
                          <select
                            value={selectedLevel}
                            disabled={persistedLevel === 'locked'}
                            onChange={(event) => setServerSafetyLevel(server.id, event.target.value as ServerSafetyLevel)}
                            aria-label={`Safety level for ${server.name}`}
                            className="rounded border border-[#ced4da] bg-white px-1.5 py-1 text-[10px] font-semibold dark:border-[#495057] dark:bg-[#212529] dark:text-white disabled:opacity-70"
                          >
                            {persistedLevel === 'testable' && <option value="testable">Normal</option>}
                            {persistedLevel !== 'locked' && <option value="maintenance">Maintenance</option>}
                            <option value="locked">Read-only</option>
                          </select>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1 text-[11px] text-[#6c757d]">Per-resource safety level</div>
                {resourceTargets.length === 0 ? (
                  <div className="rounded bg-white/70 p-2 text-[10px] text-[#6c757d] dark:bg-black/20">
                    Open a VPC, domain, load balancer, SSH key, or template badge to add that entity here. Unlisted resources remain Normal.
                  </div>
                ) : (
                  <div className="max-h-28 space-y-1 overflow-y-auto rounded border border-[#ced4da] bg-white/70 p-2 dark:border-[#373b3e] dark:bg-black/20">
                    {resourceTargets.map((target) => {
                      const key = resourceSafetyKey(target)!
                      const persistedLevel = getResourceSafetyLevel(activeProfile, target.kind, target.id)
                      const selectedLevel: ResourceSafetyLevel = safetyProtectedResources.some(
                        (candidate) => resourceSafetyKey(candidate) === key
                      )
                        ? 'locked'
                        : safetyMaintenanceResources.some((candidate) => resourceSafetyKey(candidate) === key)
                          ? 'maintenance'
                          : 'testable'
                      const label = resourceLabel(target)
                      return (
                        <label key={key} className="flex items-center gap-2 text-[11px] text-[#212529] dark:text-white">
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          <span className="font-mono text-[9px] uppercase text-[#6c757d]">{target.kind}</span>
                          <select
                            value={selectedLevel}
                            disabled={persistedLevel === 'locked'}
                            onChange={(event) => setResourceSafetyLevel(target, event.target.value as ResourceSafetyLevel)}
                            aria-label={`Safety level for ${label}`}
                            className="rounded border border-[#ced4da] bg-white px-1.5 py-1 text-[10px] font-semibold dark:border-[#495057] dark:bg-[#212529] dark:text-white disabled:opacity-70"
                          >
                            {persistedLevel === 'testable' && <option value="testable">Normal</option>}
                            {persistedLevel !== 'locked' && <option value="maintenance">Maintenance</option>}
                            <option value="locked">Read-only</option>
                          </select>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleSaveSafety}
                disabled={isSavingSafety}
                className="w-full rounded bg-emerald-700 py-1.5 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {isSavingSafety ? 'Saving safety policy…' : 'Save safety policy'}
              </button>
            </div>
          )}

          {/* Add New Profile Form */}
          {updating && (
          <div className="mb-3 flex items-center justify-between gap-2 p-2.5 rounded border border-[#017cb6] bg-[#017cb6]/10 text-[#017cb6] dark:text-[#4db2e0] text-xs">
            <span>
              Replacing the API key for <span className="font-semibold">{updating.name}</span>. The
              profile keeps its name and stays in place.
            </span>
            <button
              type="button"
              onClick={() => {
                setUpdating(null)
                setTokenInput('')
              }}
              className="underline font-medium hover:no-underline flex-shrink-0"
            >
              Cancel
            </button>
          </div>
        )}
          <form onSubmit={handleSaveToken} className="space-y-3 pt-2 border-t border-[#ced4da] dark:border-[#373b3e]">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#495057] dark:text-[#ced4da]">{updating ? 'Replace API Token' : 'Add BinaryLane API Token'}</span>
              <button
                type="button"
                onClick={handleOpenTokenPage}
                className="text-[11px] text-[#017cb6] hover:underline flex items-center gap-1"
              >
                <span>Generate in mPanel</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>

            <div>
              <label className="block text-[11px] text-[#6c757d] mb-1">Account Label (optional)</label>
              <input
                type="text"
                placeholder="e.g. Production / Personal"
                value={updating ? updating.name : profileName}
                onChange={(e) => setProfileName(e.target.value)}
                disabled={!!updating}
                className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] px-3 py-1.5 rounded text-[#212529] dark:text-white focus:outline-none focus:border-[#017cb6]"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#6c757d] mb-1">API Token Secret</label>
              <input
                type="password"
                required
                placeholder="Paste API token secret..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] px-3 py-1.5 rounded text-[#212529] dark:text-white font-mono focus:outline-none focus:border-[#017cb6]"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded border-[#ced4da] text-[#017cb6] focus:ring-0"
              />
              <span className="text-[11px] text-[#6c757d]">Set as default active profile</span>
            </label>

            {errorMsg && (
              <div className="p-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded flex items-center gap-2 text-[11px]">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 rounded flex items-center gap-2 text-[11px]">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={isValidating}
                className="w-full py-2 bg-[#017cb6] hover:bg-[#016594] text-white font-medium rounded transition flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
              >
                {isValidating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Verifying Live Token...</span>
                  </>
                ) : (
                  <>
                    <Key className="w-3.5 h-3.5" />
                    <span>Save & Encrypt Token</span>
                  </>
                )}
              </button>
            </div>
          </form>
      </div>
    </Modal>
  )
}
