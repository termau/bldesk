import { HelpLink } from '../ui/HelpLink'
import React, { useState, useEffect } from 'react'
import { Key, Plus, Trash2, Copy, Check, Loader2, Sparkles, X } from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import { useSshKeys, useAddSshKeyMutation, useDeleteSshKeyMutation } from '../../api/queries'
import { useConfirm } from '../../context/ConfirmContext'
import { recordChange, updateChange } from '../../lib/changelog'

interface SshKeysManagerProps {
  client: BinaryLaneClient | null
}

export const SshKeysManager: React.FC<SshKeysManagerProps> = ({ client }) => {
  const [isAdding, setIsAdding] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [localKeys, setLocalKeys] = useState<{ name: string; publicKey: string }[]>([])
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const sshKeysQuery = useSshKeys(client)
  const addKeyMutation = useAddSshKeyMutation(client)
  const deleteKeyMutation = useDeleteSshKeyMutation(client)

  const keys = sshKeysQuery.data || []

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
    const changeId = await recordChange({
      label: 'Add SSH key',
      target: { kind: 'sshkey', name: localKey.name },
      severity: 'normal',
      summary: 'Imported from ~/.ssh',
      changes: [{ label: 'Public key', to: localKey.publicKey.slice(0, 40) + '…' }],
      source: 'ui'
    })
    try {
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
      alert(`Import failed: ${err.message}`)
    }
  }

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyName.trim() || !publicKey.trim()) return

    const changeId = await recordChange({
      label: 'Add SSH key',
      target: { kind: 'sshkey', name: keyName.trim() },
      severity: 'normal',
      changes: [{ label: 'Public key', to: publicKey.trim().slice(0, 40) + '…' }],
      source: 'ui'
    })
    try {
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
      alert(`Failed to add key: ${err.message}`)
    }
  }

  const confirmAction = useConfirm()
  const handleDeleteKey = async (keyId: number, name: string) => {
    const c = await confirmAction({
      title: 'Delete SSH key',
      target: { kind: 'sshkey', id: keyId, name },
      summary: 'Removes the public key from your BinaryLane account. Servers that already have it installed keep it.',
      severity: 'destructive',
      confirmLabel: 'Delete key'
    })
    if (!c.ok) return
    try {
      await deleteKeyMutation.mutateAsync(keyId)
      void updateChange(c.changeId, { outcome: 'completed' })
      window.bldeskApi?.sendNotification?.({
        title: 'SSH Key Deleted',
        body: `Deleted key #${keyId}.`
      })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      alert(`Delete failed: ${err.message}`)
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
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Add SSH Key</span>
        </button>
        <HelpLink slug="keys" />
      </div>

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
                      disabled={addKeyMutation.isPending}
                      className="px-2.5 py-1 text-[11px] font-medium bg-[#017cb6] hover:bg-[#016594] text-white rounded transition shadow-sm"
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
          /* A key row is ~786px - the fingerprint alone wants 342px - against a
             412px phone, and the card clips overflow, so the fingerprint and the
             actions were simply unreachable. Scrolls sideways now. */
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#f8f9fa] dark:bg-[#212529] border-b border-[#ced4da] dark:border-[#373b3e] text-[#6c757d]">
                <th className="py-2.5 px-4">Name</th>
                <th className="py-2.5 px-4">Fingerprint</th>
                <th className="py-2.5 px-4">Public Key</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] transition">
                  <td className="py-3 px-4 font-bold text-[#017cb6]">{k.name}</td>
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
                        className="text-[#6c757d] hover:text-rose-500 p-1 rounded"
                        title="Delete Key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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

            <form onSubmit={handleManualAdd} className="space-y-4">
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
                  disabled={addKeyMutation.isPending}
                  className="px-4 py-1.5 bg-[#017cb6] hover:bg-[#016594] text-white text-xs font-medium rounded transition flex items-center gap-1.5 shadow-sm"
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
