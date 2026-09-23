import React, { useState } from 'react'
import { X, Key, ShieldCheck, ExternalLink, Trash2, CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { AccountProfile } from '@shared/ipc-types'
import { createBinaryLaneClient } from '../../api/client'
import { useConfirm } from '../../context/ConfirmContext'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  profiles: Omit<AccountProfile, 'token'>[]
  activeProfile: AccountProfile | null
  onProfileAddedOrUpdated: () => void
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  profiles,
  activeProfile,
  onProfileAddedOrUpdated
}) => {
  const [profileName, setProfileName] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [isDefault, setIsDefault] = useState(profiles.length === 0)
  const [isValidating, setIsValidating] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  /**
   * Replacing a key on an existing profile, rather than adding a new account.
   * Previously the only entry point was "add", so repairing a profile whose token
   * had been revoked meant retyping its name and hoping — which silently created
   * a duplicate instead of fixing the original.
   */
  const [updating, setUpdating] = useState<{ id: string; name: string } | null>(null)
  /*
   * Set when the system has no working keyring and the save was refused. Only
   * then is saving without encryption offered, and only as an explicit choice.
   */
  const [encryptionUnavailable, setEncryptionUnavailable] = useState(false)
  const [allowUnencrypted, setAllowUnencrypted] = useState(false)

  if (!isOpen) return null

  const handleOpenTokenPage = () => {
    window.bldeskApi?.openExternal?.('https://home.binarylane.com.au/api-info')
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
      // Validate token live against BinaryLane API
      const client = createBinaryLaneClient(cleanToken)
      const { data, error } = await client.GET('/v2/account')

      if (error || !data?.account) {
        throw new Error('API token verification failed. Please ensure the token is active and has correct permissions.')
      }

      const verifiedEmail = data.account.email
      const name = updating?.name || profileName.trim() || verifiedEmail || 'BinaryLane Account'

      const result = await window.bldeskApi?.saveProfile?.({
        profileId: updating?.id,
        name,
        token: cleanToken,
        isDefault,
        allowUnencrypted: encryptionUnavailable && allowUnencrypted
      })

      if (result?.errorCode === 'encryption-unavailable') setEncryptionUnavailable(true)
      if (!result?.success) {
        throw new Error(result?.error || 'The token could not be saved.')
      }
      setEncryptionUnavailable(false)
      setAllowUnencrypted(false)

      setSuccessMsg(`Account "${name}" connected successfully!`)
      setProfileName('')
      setTokenInput('')
      setUpdating(null)
      onProfileAddedOrUpdated()

      setTimeout(() => {
        setSuccessMsg(null)
        onClose()
      }, 1200)
    } catch (err: any) {
      setErrorMsg(err.message || 'Verification failed.')
    } finally {
      setIsValidating(false)
    }
  }

  const confirmAction = useConfirm()
  const handleDeleteProfile = async (id: string, name: string) => {
    const ok = await confirmAction({
      title: 'Remove account profile',
      target: { kind: 'account', name },
      summary: 'The saved API token for this profile is deleted from the vault. You will need to re-enter it to use the account again.',
      severity: 'destructive',
      log: false,
      confirmLabel: 'Remove profile'
    })
    if (!ok.ok) return
    try {
      const result = await window.bldeskApi?.deleteProfile?.(id)
      if (result && !result.success) throw new Error('the vault could not be written')
      // The profile's cached server list is account data; nothing reads it once
      // the profile is gone.
      try {
        localStorage.removeItem(`bldesk_cached_servers_${id}`)
      } catch {
        /* storage unavailable */
      }
      onProfileAddedOrUpdated()
    } catch (err: any) {
      setErrorMsg(`Could not remove the profile: ${err.message}`)
    }
  }

  const handleSetActive = async (id: string) => {
    await window.bldeskApi?.setActiveProfile?.(id)
    onProfileAddedOrUpdated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overlay-safe bg-black/60 backdrop-blur-sm animate-in fade-in duration-100">
      <div className="w-full max-w-md bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-2xl overflow-hidden flex flex-col text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#ced4da] dark:border-[#373b3e] bg-[#f1f1f1] dark:bg-[#262a2e]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#017cb6]" />
            <h3 className="font-bold text-sm text-[#212529] dark:text-white">API Token Vault</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#6c757d] hover:text-[#212529] dark:hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto max-h-[80vh]">
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
                          {p.tokenStatus === 'unencrypted' && (
                            <div className="text-[10px] text-amber-600 dark:text-amber-400" title="Saved without encryption because this system had no working keyring. Replace the token once a keyring is available to encrypt it.">
                              Token not encrypted
                            </div>
                          )}
                          {p.tokenStatus === 'unreadable' && (
                            <div className="text-[10px] text-rose-600 dark:text-rose-400" title="The token could not be decrypted, for example because the keyring is locked or was replaced. Use the replace button to enter it again.">
                              Token needs re-entering
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isActive && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold bg-[#017cb6] text-white rounded">
                            ACTIVE
                          </span>
                        )}
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

          {/* Add New Profile Form */}
          {updating && (
          <div className="mb-3 flex items-center justify-between gap-2 p-2.5 rounded border border-[#017cb6] bg-[#017cb6]/10 text-[#017cb6] dark:text-[#4db2e0] text-xs">
            <span>
              Replacing the API key for <span className="font-semibold">{updating.name}</span>. The
              profile keeps its name and stays in place.
            </span>
            <button
              type="button"
              onClick={() => setUpdating(null)}
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

            {encryptionUnavailable && (
              <label className="flex items-start gap-2 cursor-pointer p-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30">
                <input
                  type="checkbox"
                  checked={allowUnencrypted}
                  onChange={(e) => setAllowUnencrypted(e.target.checked)}
                  className="mt-0.5 rounded border-[#ced4da] text-amber-600 focus:ring-0"
                />
                <span className="text-[11px] text-amber-800 dark:text-amber-300">
                  Save this token without encryption on this device
                </span>
              </label>
            )}

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
                    <span>{encryptionUnavailable && allowUnencrypted ? 'Save Token Without Encryption' : 'Save & Encrypt Token'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
