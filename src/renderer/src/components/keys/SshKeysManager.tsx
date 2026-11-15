import { HelpLink } from '../ui/HelpLink'
import React, { useState, useEffect, useId } from 'react'
import { Key, Plus, Trash2, Copy, Check, Loader2, Sparkles, Pencil, RefreshCw, KeyRound } from 'lucide-react'
import { BinaryLaneClient } from '../../api/client'
import { useSshKeys, useAddSshKeyMutation, useUpdateSshKeyMutation, useDeleteSshKeyMutation } from '../../api/queries'
import { Modal } from '../ui/Modal'
import { LoadError } from '../ui/LoadError'
import { GenerateKeyPairDialog, canGenerateKeyPair } from './GenerateKeyPairDialog'
import { useConfirm } from '../../context/ConfirmContext'
import { recordChange, updateChange } from '../../lib/changelog'
import { notifyFailure } from '../../lib/failures'

interface SshKeysManagerProps {
  client: BinaryLaneClient | null
}

export const SshKeysManager: React.FC<SshKeysManagerProps> = ({ client }) => {
  const uid = useId()
  const [isAdding, setIsAdding] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [editingKey, setEditingKey] = useState<{ id: number; name: string; isDefault: boolean } | null>(null)
  const [localKeys, setLocalKeys] = useState<{ name: string; publicKey: string }[]>([])
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const sshKeysQuery = useSshKeys(client)
  const addKeyMutation = useAddSshKeyMutation(client)
  const deleteKeyMutation = useDeleteSshKeyMutation(client)
  const updateKeyMutation = useUpdateSshKeyMutation(client)

  const keys = sshKeysQuery.data || []
  // Until the account's keys have been read, whether a local key is already on it is unknown: offering Import then would add a duplicate.
  const keysKnown = sshKeysQuery.data !== undefined

  const scanLocalKeys = () => {
    // Scan local ~/.ssh directory
    if (window.bldeskApi?.getLocalSshKeys) {
      window.bldeskApi.getLocalSshKeys().then(setLocalKeys)
    }
  }
  useEffect(scanLocalKeys, [])

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
      notifyFailure('Import failed', err)
    }
  }

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyName.trim() || !publicKey.trim()) return

    const changeId = await recordChange({
      label: 'Add SSH key',
      target: { kind: 'sshkey', name: keyName.trim() },
      severity: 'normal',
      changes: [
        { label: 'Public key', to: publicKey.trim().slice(0, 40) + '…' },
        ...(makeDefault ? [{ label: 'Default for new installations', to: 'Yes' }] : [])
      ],
      source: 'ui'
    })
    try {
      await addKeyMutation.mutateAsync({
        name: keyName.trim(),
        publicKey: publicKey.trim(),
        makeDefault
      })
      void updateChange(changeId, { outcome: 'completed' })
      setIsAdding(false)
      setKeyName('')
      setPublicKey('')
      setMakeDefault(false)
      window.bldeskApi?.sendNotification?.({
        title: 'SSH Key Added',
        body: `Added SSH key "${keyName}".`
      })
    } catch (err: any) {
      void updateChange(changeId, { outcome: 'failed', detail: err.message })
      notifyFailure('Failed to add key', err)
    }
  }

  const confirmAction = useConfirm()

  const handleEditKey = async (key: { id: number; name: string; isDefault: boolean }, name: string, isDefault: boolean) => {
    const changes = [
      ...(name !== key.name ? [{ label: 'Name', from: key.name, to: name }] : []),
      ...(isDefault !== key.isDefault
        ? [{ label: 'Default for new installations', from: key.isDefault ? 'Yes' : 'No', to: isDefault ? 'Yes' : 'No' }]
        : [])
    ]
    setEditingKey(null)
    if (!changes.length) return
    const c = await confirmAction({
      title: 'Edit SSH key',
      target: { kind: 'sshkey', id: key.id, name: key.name },
      summary:
        isDefault === key.isDefault
          ? 'Renames the key on your BinaryLane account. Servers that already have it are not changed.'
          : isDefault
            ? 'New servers get this key unless you pick their keys yourself. Existing servers are not changed.'
            : 'New servers stop getting this key by default. Existing servers are not changed.',
      changes,
      confirmLabel: 'Update key'
    })
    if (!c.ok) return
    try {
      await updateKeyMutation.mutateAsync({
        keyId: key.id,
        name,
        makeDefault: isDefault !== key.isDefault ? isDefault : undefined
      })
      void updateChange(c.changeId, { outcome: 'completed' })
    } catch (err: any) {
      void updateChange(c.changeId, { outcome: 'failed', detail: err.message })
      notifyFailure('Update failed', err)
    }
  }
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
      notifyFailure('Delete failed', err)
    }
  }

  return (
    <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto bg-[#f8f9fa] dark:bg-[#212529] text-[#212529] dark:text-[#f8f9fa]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#212529] dark:text-white flex items-center gap-2.5">
            <Key className="w-5 h-5 text-fg-link" />
            <span>SSH Public Keys</span>
          </h1>
          <p className="text-xs text-fg-muted dark:text-slate-400 mt-0.5">
            Manage your SSH public keys for passwordless authentication to your cloud servers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => sshKeysQuery.refetch()}
            disabled={sshKeysQuery.isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition shadow-sm disabled:opacity-60"
            title="Reload the keys from BinaryLane"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${sshKeysQuery.isFetching ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          {canGenerateKeyPair() && (
            <button
              onClick={() => setGenerating(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#212529] dark:text-slate-200 bg-white dark:bg-[#2b3035] hover:bg-[#f1f1f1] dark:hover:bg-[#343a40] border border-[#ced4da] dark:border-[#373b3e] rounded transition shadow-sm"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Generate Key Pair</span>
            </button>
          )}
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add SSH Key</span>
          </button>
          <HelpLink slug="keys" />
        </div>
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
                    <div className="text-[0.625rem] text-fg-muted font-mono truncate">{lk.publicKey.substring(0, 24)}...</div>
                  </div>
                  {!keysKnown ? (
                    <span className="text-[0.625rem] text-fg-muted px-2 py-0.5">{sshKeysQuery.isError ? 'Keys not read' : 'Checking…'}</span>
                  ) : alreadyImported ? (
                    <span className="text-[0.625rem] text-emerald-600 dark:text-emerald-400 font-semibold px-2 py-0.5 bg-emerald-500/10 rounded">
                      Linked
                    </span>
                  ) : (
                    <button
                      onClick={() => handleImportLocalKey(lk)}
                      disabled={addKeyMutation.isPending}
                      className="px-2.5 py-1 text-[0.6875rem] font-medium bg-[#017cb6] hover:bg-[#016594] text-white rounded transition shadow-sm"
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
          Account SSH Keys ({keysKnown ? keys.length : '…'})
        </div>

        {sshKeysQuery.isLoading && (
          <div className="p-8 text-center text-xs text-fg-muted">Loading keys...</div>
        )}

        {sshKeysQuery.isError && (
          <div className="p-3.5">
            <LoadError what="SSH keys" hasData={(sshKeysQuery.data?.length ?? 0) > 0} message={sshKeysQuery.error?.message} isFetching={sshKeysQuery.isFetching} onRetry={() => void sshKeysQuery.refetch()} />
          </div>
        )}

        {!sshKeysQuery.isLoading && !sshKeysQuery.isError && keys.length === 0 && (
          <div className="p-8 text-center text-xs text-fg-muted">No SSH keys registered in BinaryLane.</div>
        )}

        {!sshKeysQuery.isLoading && keys.length > 0 && (
          /* A key row is ~786px - the fingerprint alone wants 342px - against a
             412px phone, and the card clips overflow, so the fingerprint and the
             actions were simply unreachable. Scrolls sideways now. */
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#f8f9fa] dark:bg-[#212529] border-b border-[#ced4da] dark:border-[#373b3e] text-fg-muted">
                <th className="py-2.5 px-4">Name</th>
                <th className="py-2.5 px-4">Fingerprint</th>
                <th className="py-2.5 px-4">Public Key</th>
                <th className="py-2.5 px-4" title="Default For Future Installations">Default</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-[#f8f9fa] dark:hover:bg-[#32383e] transition">
                  <td className="py-3 px-4 font-bold text-fg-link">{k.name}</td>
                  <td className="py-3 px-4 font-mono text-fg-muted dark:text-slate-300 text-[0.6875rem]">
                    {k.fingerprint || '—'}
                  </td>
                  <td className="py-3 px-4 font-mono text-fg-muted text-[0.6875rem] truncate max-w-xs">
                    {k.public_key?.substring(0, 32)}...
                  </td>
                  <td className="py-3 px-4 text-[#495057] dark:text-[#ced4da]">{k.default ? 'Yes' : 'No'}</td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleCopyKey(k.id, k.public_key ?? "")}
                        className="text-fg-muted hover:text-fg-link p-1 rounded"
                        title="Copy Public Key"
                      >
                        {copiedId === k.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => setEditingKey({ id: k.id, name: k.name || '', isDefault: !!k.default })}
                        className="text-fg-muted hover:text-fg-link p-1 rounded"
                        title="Edit Key"
                        aria-label="Edit key"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteKey(k.id, k.name || "SSH Key")}
                        className="text-fg-muted hover:text-rose-500 p-1 rounded"
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
        <Modal
          title="Add Public SSH Key"
          size="sm"
          onClose={() => setIsAdding(false)}
          busy={addKeyMutation.isPending}
          as="form"
          onSubmit={handleManualAdd}
          footer={
            <div className="flex justify-end gap-2 p-4">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 text-xs text-fg-muted hover:text-[#212529] dark:hover:text-white"
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
          }
        >
          <div className="p-5 space-y-4">

            <div>
              <label htmlFor={`${uid}-name`} className="block text-xs font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                Key Name
              </label>
              <input
                id={`${uid}-name`}
                type="text"
                required
                placeholder="e.g. MacBook Pro M3"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white px-3 py-2 rounded focus:outline-none focus:border-[#017cb6]"
              />
            </div>

            <div>
              <label htmlFor={`${uid}-key`} className="block text-xs font-medium text-[#495057] dark:text-[#ced4da] mb-1">
                Public Key (ssh-ed25519 or ssh-rsa)
              </label>
              <textarea
                id={`${uid}-key`}
                required
                rows={4}
                placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5..."
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                className="w-full bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] text-xs text-[#212529] dark:text-white p-3 rounded font-mono focus:outline-none focus:border-[#017cb6]"
              />
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
              <span className="text-[#212529] dark:text-white">Select this SSH Key for all new Cloud Server Installations</span>
            </label>

          </div>
        </Modal>
      )}

      {generating && (
        <GenerateKeyPairDialog
          client={client}
          onClose={() => setGenerating(false)}
          onAdded={() => { void sshKeysQuery.refetch(); scanLocalKeys() }}
        />
      )}

      {editingKey && (
        <EditSshKeyDialog
          sshKey={editingKey}
          onCancel={() => setEditingKey(null)}
          onSave={(name, isDefault) => handleEditKey(editingKey, name, isDefault)}
        />
      )}
    </div>
  )
}

/** mPanel's Edit SSH Key: the name and the default flag. The key itself cannot be changed. */
const EditSshKeyDialog: React.FC<{
  sshKey: { id: number; name: string; isDefault: boolean }
  onCancel: () => void
  onSave: (name: string, isDefault: boolean) => void
}> = ({ sshKey, onCancel, onSave }) => {
  const [name, setName] = useState(sshKey.name)
  const [isDefault, setIsDefault] = useState(sshKey.isDefault)
  const trimmed = name.trim()

  return (
    <Modal
      title="Edit SSH Key"
      onClose={onCancel}
      size="sm"
      as="form"
      onSubmit={(e) => {
        e.preventDefault()
        if (trimmed) onSave(trimmed, isDefault)
      }}
      footer={
        <div className="flex items-center justify-end gap-2 p-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[#6c757d] hover:bg-[#5c636a] text-white transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!trimmed}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-[#017cb6] hover:bg-[#016594] text-white transition disabled:opacity-50"
          >
            Update
          </button>
        </div>
      }
    >
      <div className="p-4 space-y-3 text-xs">
        <label className="block space-y-1">
          <span className="text-fg-muted dark:text-[#adb5bd]">Name</span>
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
          />
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          <span className="text-[#212529] dark:text-white">Select this SSH Key for all new Cloud Server Installations</span>
        </label>
      </div>
    </Modal>
  )
}
