import React, { useEffect, useId, useRef, useState } from 'react'
import { KeyRound, Loader2, FolderOpen, Copy, Check, AlertTriangle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { BinaryLaneClient } from '../../api/client'
import { useSshKeys, useAddSshKeyMutation } from '../../api/queries'
import { recordChange, updateChange } from '../../lib/changelog'
import { validateKeyName } from '@shared/sshKeyNames'

/** Desktop only: Android's bridge has no key generation, so callers hide the button. */
export const canGenerateKeyPair = (): boolean => typeof window.bldeskApi?.generateSshKeyPair === 'function'

interface Generated {
  name: string
  privateKeyPath: string
  /** Set once the public key is on the account. */
  keyId?: number
  uploadError?: string
}

/**
 * Generate an SSH key pair on this device and add its public key to the account
 * (#100). The private key goes to ~/.ssh through the system ssh-keygen and never
 * leaves the device; BLDesk only reads the .pub back.
 *
 * The name is set here, once, and is both the file name and the account key
 * name, so the two always match. A name already taken on the account or in
 * ~/.ssh gets a dated suffix instead of failing or overwriting anything.
 */
export const GenerateKeyPairDialog: React.FC<{
  client: BinaryLaneClient | null
  /** Prefill, e.g. the hostname on the create form. */
  initialName?: string
  onClose: () => void
  /** The public key is on the account. */
  onAdded?: (keyId: number, privateKeyPath: string) => void
  z?: number
}> = ({ client, initialName = '', onClose, onAdded, z }) => {
  const keysQuery = useSshKeys(client)
  const addKey = useAddSshKeyMutation(client)
  const [name, setName] = useState(initialName)
  const [makeDefault, setMakeDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<Generated | null>(null)
  const [copied, setCopied] = useState(false)
  const errRef = useRef<HTMLDivElement>(null)
  const hintId = useId()
  // A failed generate moves focus to its message: the button that was pressed is disabled while it runs, so focus was lost.
  useEffect(() => {
    if (err) errRef.current?.focus()
  }, [err])

  const trimmed = name.trim()
  const invalid = validateKeyName(trimmed)
  const accountClash = !!trimmed && (keysQuery.data || []).some((k: any) => k.name === trimmed)

  const generate = async () => {
    if (invalid || busy || !window.bldeskApi?.generateSshKeyPair) return
    setBusy(true)
    setErr(null)
    try {
      // Names must be unique on the account: check against the live list, not the cache.
      const live = await keysQuery.refetch()
      const takenNames = ((live.data || []) as any[]).map((k) => k.name).filter(Boolean)
      const res = await window.bldeskApi.generateSshKeyPair({ name: trimmed, takenNames })
      if (!res.ok) return setErr(res.message)

      const changeId = await recordChange({
        label: 'Add SSH key',
        target: { kind: 'sshkey', name: res.name },
        severity: 'normal',
        summary: 'Generated on this device',
        changes: [
          { label: 'Public key', to: res.publicKey.slice(0, 40) + '…' },
          { label: 'Private key', to: res.privateKeyPath },
          ...(makeDefault ? [{ label: 'Default for new installations', to: 'Yes' }] : [])
        ],
        source: 'ui'
      })
      try {
        const created = await addKey.mutateAsync({ name: res.name, publicKey: res.publicKey, makeDefault })
        void updateChange(changeId, { outcome: 'completed' })
        setDone({ name: res.name, privateKeyPath: res.privateKeyPath, keyId: created?.id })
        if (created?.id) onAdded?.(created.id, res.privateKeyPath)
      } catch (e: any) {
        void updateChange(changeId, { outcome: 'failed', detail: e.message })
        setDone({ name: res.name, privateKeyPath: res.privateKeyPath, uploadError: e.message || 'Unknown error' })
      }
    } catch (e: any) {
      setErr(e.message || 'Could not generate the key pair.')
    } finally {
      setBusy(false)
    }
  }

  const copyPath = (path: string) => {
    void navigator.clipboard.writeText(path)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const btn = 'px-3 py-1.5 text-xs font-medium rounded transition disabled:opacity-50'

  if (done) {
    return (
      <Modal title="Key Pair Generated" icon={KeyRound} onClose={onClose} size="sm" z={z}
        footer={
          <div className="flex items-center justify-end gap-2 p-4">
            <button onClick={onClose} className={`${btn} font-semibold bg-[#017cb6] hover:bg-[#016594] text-white`}>Done</button>
          </div>
        }
      >
        <div className="p-4 space-y-3 text-xs text-[#212529] dark:text-white">
          {done.uploadError ? (
            <div className="p-2.5 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 break-words">
              The key pair was saved, but its public key was not added to your account: {done.uploadError} You can add
              it later from SSH Keys, where it is listed under your local ~/.ssh folder.
            </div>
          ) : (
            <p>
              <span className="font-semibold">{done.name}</span> is on your account and ready to select for new servers.
            </p>
          )}
          <div className="space-y-1">
            <div className="text-fg-muted dark:text-[#adb5bd]">Private key saved to</div>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 min-w-0 px-2 py-1.5 font-mono text-[0.6875rem] bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded break-all">
                {done.privateKeyPath}
              </code>
              <button type="button" onClick={() => copyPath(done.privateKeyPath)} title="Copy path" aria-label="Copy path"
                className="p-1.5 rounded text-fg-muted hover:text-fg-link">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              {window.bldeskApi?.showSshKeyInFolder && (
                <button type="button" onClick={() => void window.bldeskApi.showSshKeyInFolder?.(done.privateKeyPath)}
                  title="Show in folder" aria-label="Show in folder" className="p-1.5 rounded text-fg-muted hover:text-fg-link">
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2 p-2.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              BinaryLane only has the public key. Keep the private key safe and backed up. If you lose it, you cannot SSH
              in with this key, and you will need the server's web console or rescue mode to get back in.
            </span>
          </div>
          <p className="text-fg-muted dark:text-[#adb5bd]">
            It has no passphrase. To add one: <code className="font-mono">ssh-keygen -p -f {done.privateKeyPath}</code>
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Generate Key Pair" icon={KeyRound} onClose={onClose} size="sm" z={z} busy={busy} as="form"
      onSubmit={(e) => { e.preventDefault(); void generate() }}
      footer={
        <div className="flex items-center justify-end gap-2 p-4">
          <button type="button" onClick={onClose} disabled={busy} className={`${btn} bg-[#6c757d] hover:bg-[#5c636a] text-white`}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !!invalid} className={`${btn} font-semibold flex items-center gap-1.5 bg-[#017cb6] hover:bg-[#016594] text-white`}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Generate
          </button>
        </div>
      }
    >
      <div className="p-4 space-y-3 text-xs">
        <label className="block space-y-1">
          <span className="text-fg-muted dark:text-[#adb5bd]">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="bldesk-20260924-1830"
            spellCheck={false}
            aria-invalid={!!invalid}
            aria-describedby={hintId}
            className="w-full px-2.5 py-1.5 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] rounded outline-none focus:border-[#017cb6] text-[#212529] dark:text-white"
          />
          <span id={hintId} className="block text-[0.625rem] text-fg-muted">
            {invalid
              ? <span className="text-rose-600 dark:text-rose-400">{invalid}</span>
              : accountClash
                ? `A key named ${trimmed} is already on your account, so this one gets the date added to its name.`
                : trimmed
                  ? 'Used for the file in ~/.ssh and the key on your account.'
                  : "If you don't define a name, one will be generated for you."}
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
          <span className="text-[#212529] dark:text-white">Select this SSH Key for all new Cloud Server Installations</span>
        </label>
        <p className="text-fg-muted dark:text-[#adb5bd]">
          The private key is saved to ~/.ssh on this device and never leaves it. Only the public key is added to your
          account.
        </p>
        {/* Mounted before any error, so a message put into it is announced. */}
        <div aria-live="polite" className="!mt-0">
          {err && <div ref={errRef} tabIndex={-1} className="mt-3 text-rose-600 dark:text-rose-400 break-words outline-none">{err}</div>}
        </div>
      </div>
    </Modal>
  )
}
