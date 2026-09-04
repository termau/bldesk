import React, { useEffect, useRef, useState } from 'react'
import { Key, Plus, Trash2, Copy, Check, Loader2, ShieldAlert, Sparkles, X } from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import { useSshKeys, useAddSshKeyMutation, useDeleteSshKeyMutation } from '../../api/queries'
import { useConfirm } from '../../context/ConfirmContext'
import { recordChange, updateChange } from '../../lib/changelog'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import { SafetyPolicyBadge } from '../ui/SafetyPolicyBadge'

interface SshKeysManagerProps {
  client: BinaryLaneClient | null
}

export const SshKeysManager: React.FC<SshKeysManagerProps> = ({ client }) => {
  const [isAdding, setIsAdding] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [localKeys, setLocalKeys] = useState<{ name: string; publicKey: string }[]>([])
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const sshKeysQuery = useSshKeys(client)
  const addKeyMutation = useAddSshKeyMutation(client)
  const deleteKeyMutation = useDeleteSshKeyMutation(client)
  const confirmAction = useConfirm()
  const { collectionMutationBlockReason, resourceActionBlockReason } = useProfileSafety()
  const collectionMutationBlockReasonRef = useRef(collectionMutationBlockReason)
  const resourceActionBlockReasonRef = useRef(resourceActionBlockReason)
  collectionMutationBlockReasonRef.current = collectionMutationBlockReason
  resourceActionBlockReasonRef.current = resourceActionBlockReason
  const collectionBlockReason = collectionMutationBlockReason()

  const keys = sshKeysQuery.data || []

  const reportBlocked = (reason: string): void => {
    setActionError(`Blocked locally: ${reason}`)
  }

  useEffect(() => {
    // Scan local ~/.ssh directory
    if (window.bldeskApi?.getLocalSshKeys) {
      window.bldeskApi.getLocalSshKeys().then(setLocalKeys)
    }
  }, [])

  const handleCopyKey = (id: number, keyText: string) => {
    navigator.clipboard.writeText(keyText)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const handleImportLocalKey = async (localKey: { name: string; publicKey: string }) => {
    const blockReason = collectionMutationBlockReasonRef.current()
    if (blockReason) {
      reportBlocked(blockReason)
      return
    }
    setActionError(null)
    const changeId = await recordChange({
      label: 'Add SSH key',
      target: { kind: 'sshkey', name: localKey.name },
      severity: 'normal',
      summary: 'Imported from ~/.ssh',
      changes: [{ label: 'Public key', to: localKey.publicKey.slice(0, 40) + '…' }],
      source: 'ui'
    })
    try {
      const currentBlockReason = collectionMutationBlockReasonRef.current()
      if (currentBlockReason) throw new Error(`Blocked locally: ${currentBlockReason}`)
      await addKeyMutation.mutateAsync({
        name: localKey.name,
        publicKey: localKey.publicKey
      })
      void updateChange(changeId, { outcome: 'completed' })
      window.bldeskApi?.sendNotification?.({
        title: 'SSH Key Imported',
        body: `Imported "${localKey.name}" from your local ~/.ssh directory.`
      })
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Import failed: ${err.message}`)
    }
  }

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyName.trim() || !publicKey.trim()) return
    const blockReason = collectionMutationBlockReasonRef.current()
    if (blockReason) {
      reportBlocked(blockReason)
      return
    }

    setActionError(null)
    const changeId = await recordChange({
      label: 'Add SSH key',
      target: { kind: 'sshkey', name: keyName.trim() },
      severity: 'normal',
      changes: [{ label: 'Public key', to: publicKey.trim().slice(0, 40) + '…' }],
      source: 'ui'
    })
    try {
      const currentBlockReason = collectionMutationBlockReasonRef.current()
      if (currentBlockReason) throw new Error(`Blocked locally: ${currentBlockReason}`)
      await addKeyMutation.mutateAsync({
        name: keyName.trim(),
        publicKey: publicKey.trim()
      })
      void updateChange(changeId, { outcome: 'completed' })
      setIsAdding(false)
      setKeyName('')
      setPublicKey('')
      window.bldeskApi?.sendNotification?.({
        title: 'SSH Key Added',
        body: `Added SSH key "${keyName}".`
      })
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Failed to add key: ${err.message}`)
    }
  }

  const handleDeleteKey = async (keyId: number, name: string) => {
    const blockReason = resourceActionBlockReasonRef.current('ssh-key', keyId, 'destructive')
    if (blockReason) {
      reportBlocked(blockReason)
      return
    }
    setActionError(null)
    const c = await confirmAction({
      title: 'Delete SSH key',
      target: { kind: 'sshkey', id: keyId, name },
      summary: 'Removes the public key from your BinaryLane account. Servers that already have it installed keep it.',
      severity: 'destructive',
      confirmLabel: 'Delete key'
    })
    if (!c.ok) return
    try {
      const currentBlockReason = resourceActionBlockReasonRef.current('ssh-key', keyId, 'destructive')
      if (currentBlockReason) throw new Error(`Blocked locally: ${currentBlockReason}`)
      await deleteKeyMutation.mutateAsync(keyId)
      void updateChange(c.changeId, { outcome: 'completed' })
      window.bldeskApi?.sendNotification?.({
        title: 'SSH Key Deleted',
        body: `Deleted key #${keyId}.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      setActionError(`Delete failed: ${err.message}`)
    }
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
            <Key className="w-5 h-5 text-[#017cb6]" />
            <span>SSH Public Keys</span>
          </h1>
          <p className="text-xs text-[#6c757d] dark:text-slate-400 mt-0.5">
            Manage your SSH public keys for passwordless authentication to your cloud servers.
          </p>
        </div>

        <button
          onClick={() => {
            if (collectionBlockReason) return reportBlocked(collectionBlockReason)
            setActionError(null)
            setIsAdding(true)
          }}
          disabled={!!collectionBlockReason}
          title={collectionBlockReason ?? 'Add SSH key (starts Normal)'}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          <span>Add SSH Key</span>
        </button>
      </div>

      {collectionBlockReason && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{collectionBlockReason} Account keys remain visible, and local discovery and public-key copying remain available.</span>
        </div>
      )}

      {actionError && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="font-semibold hover:underline">Dismiss</button>
        </div>
      )}

      {/* Local Auto-Discovery Card */}
      {localKeys.length > 0 && (
        <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-[#f1ca00]" />
            <h3 className="text-xs font-bold text-[#212529] dark:text-white uppercase tracking-wider">
              Discovered in your local ~/.ssh folder
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {localKeys.map((lk) => {
              const alreadyImported = keys.some((k) => k.public_key?.trim() === lk.publicKey?.trim())
              return (
                <div
                  key={lk.name}
                  className="flex items-center justify-between p-2.5 bg-[#f8f9fa] dark:bg-[#212529] rounded border border-[#ced4da] dark:border-[#373b3e]"
                >
                  <div className="truncate mr-2">
                    <div className="text-xs font-semibold text-[#212529] dark:text-white truncate">{lk.name}</div>
                    <div className="text-[10px] text-[#6c757d] font-mono truncate">{lk.publicKey.substring(0, 24)}...</div>
                  </div>
                  {alreadyImported ? (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold px-2 py-0.5 bg-emerald-500/10 rounded">
                      Linked
                    </span>
                  ) : (
                    <button
                      onClick={() => handleImportLocalKey(lk)}
                      disabled={addKeyMutation.isPending || !!collectionBlockReason}
                      title={collectionBlockReason ?? 'Import this key into the BinaryLane account (starts Normal)'}
                      className="px-2.5 py-1 text-[11px] font-medium bg-[#017cb6] hover:bg-[#016594] text-white rounded transition shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Import
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Cloud SSH Keys Table */}
      <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] shadow-sm overflow-hidden flex-shrink-0">
        <div className="p-3 bg-[#f1f1f1] dark:bg-[#262a2e] border-b border-[#ced4da] dark:border-[#373b3e] font-semibold text-xs text-[#495057] dark:text-[#ced4da]">
          Account SSH Keys ({keys.length})
        </div>

        {sshKeysQuery.isLoading && (
          <div className="p-8 text-center text-xs text-[#6c757d]">Loading keys...</div>
        )}

        {!sshKeysQuery.isLoading && keys.length === 0 && (
          <div className="p-8 text-center text-xs text-[#6c757d]">No SSH keys registered in BinaryLane.</div>
        )}

        {!sshKeysQuery.isLoading && keys.length > 0 && (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#f8f9fa] dark:bg-[#212529] border-b border-[#ced4da] dark:border-[#373b3e] text-[#6c757d]">
                <th className="py-2.5 px-4">Name</th>
                <th className="py-2.5 px-4">Fingerprint</th>
                <th className="py-2.5 px-4">Public Key</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
              {keys.map((k) => {
                const deleteBlockReason = resourceActionBlockReason('ssh-key', k.id, 'destructive')
                return (
                <tr key={k.id} className="hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] transition">
                  <td className="py-3 px-4 font-bold text-[#017cb6]">
                    <span className="inline-flex items-center gap-2">
                      {k.name}
                      <SafetyPolicyBadge
                        scope="resource"
                        resourceKind="ssh-key"
                        resourceId={k.id}
                        resourceLabel={k.name || `SSH key #${k.id}`}
                      />
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-[#6c757d] dark:text-slate-300 text-[11px]">
                    {k.fingerprint || '—'}
                  </td>
                  <td className="py-3 px-4 font-mono text-[#6c757d] text-[11px] truncate max-w-xs">
                    {k.public_key?.substring(0, 32)}...
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleCopyKey(k.id, k.public_key ?? "")}
                        className="text-[#6c757d] hover:text-[#017cb6] p-1 rounded"
                        title="Copy Public Key"
                      >
                        {copiedId === k.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => handleDeleteKey(k.id, k.name || "SSH Key")}
                        disabled={!!deleteBlockReason}
                        className="text-[#6c757d] hover:text-rose-500 p-1 rounded disabled:cursor-not-allowed disabled:opacity-40"
                        title={deleteBlockReason ?? 'Delete Key'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Modal */}
      {isAdding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overlay-safe bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#ced4da] dark:border-[#373b3e] pb-3">
              <h2 className="text-base font-bold text-[#212529] dark:text-white">Add Public SSH Key</h2>
              <button onClick={() => setIsAdding(false)} className="text-[#6c757d] hover:text-[#212529] dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionError && (
              <div role="alert" className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                {actionError}
              </div>
            )}

            <form onSubmit={handleManualAdd} className="space-y-4">
              {collectionBlockReason && (
                <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  {collectionBlockReason}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  Key Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. MacBook Pro M3"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                  Public Key (ssh-ed25519 or ssh-rsa)
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5..."
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white p-3 rounded font-mono focus:outline-none focus:border-[#017cb6]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-3 py-1.5 text-xs text-[#6c757d] hover:text-[#212529] dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addKeyMutation.isPending || !!collectionBlockReason}
                  title={collectionBlockReason ?? 'Save SSH key (starts Normal)'}
                  className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition flex items-center gap-1.5 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {addKeyMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save SSH Key</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
