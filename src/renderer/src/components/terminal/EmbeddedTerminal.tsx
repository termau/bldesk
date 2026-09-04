import React, { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { Terminal as TermIcon, Play, RefreshCw, Key, ShieldAlert } from 'lucide-react'
import { LocalSshKey } from '@shared/ipc-types'
import { launchSsh } from '../../lib/launchSsh'
import { useProfileSafety } from '../../context/ProfileSafetyContext'

interface EmbeddedTerminalProps {
  initialHost?: string
  onClose?: () => void
}

export const EmbeddedTerminal: React.FC<EmbeddedTerminalProps> = ({ initialHost = '' }) => {
  const { accessMode } = useProfileSafety()
  const manualTerminalAllowed = accessMode === 'full'
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermInstance = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [hostInput, setHostInput] = useState(initialHost)
  const [username, setUsername] = useState('root')
  const [selectedKeyPath, setSelectedKeyPath] = useState<string>('')
  const [localKeys, setLocalKeys] = useState<LocalSshKey[]>([])

  useEffect(() => {
    if (!manualTerminalAllowed) {
      setLocalKeys([])
      setSelectedKeyPath('')
      return
    }

    let cancelled = false
    const keysRequest = window.bldeskApi?.getLocalSshKeys?.()
    if (keysRequest) {
      keysRequest
        .then((keys) => {
          if (!cancelled) {
            setLocalKeys(keys)
            const defaultKey = keys.find((k) => k.privateKeyPath)
            if (defaultKey?.privateKeyPath) {
              setSelectedKeyPath(defaultKey.privateKeyPath)
            }
          }
        })
        .catch(() => {
          if (!cancelled) setLocalKeys([])
        })
    }
    return () => {
      cancelled = true
    }
  }, [manualTerminalAllowed])

  useEffect(() => {
    if (!terminalRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: '#212529',
        foreground: '#f8f9fa',
        cursor: '#f1ca00',
        selectionBackground: '#017cb6'
      }
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    fitAddon.fit()

    term.writeln('\x1b[1;36m╔══════════════════════════════════════════════════════════════╗\x1b[0m')
    term.writeln('\x1b[1;36m║\x1b[0m   \x1b[1;33mBinaryLane Desktop (BLDesk) Terminal Client\x1b[0m                \x1b[1;36m║\x1b[0m')
    term.writeln('\x1b[1;36m╚══════════════════════════════════════════════════════════════╝\x1b[0m')

    xtermInstance.current = term
    fitAddonRef.current = fitAddon

    const handleResize = () => fitAddon.fit()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      term.dispose()
      xtermInstance.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    xtermInstance.current?.writeln(
      manualTerminalAllowed
        ? '\x1b[90mSelect an SSH key, enter target host, and click Connect to launch.\x1b[0m\r\n'
        : '\x1b[1;33mManual arbitrary-host SSH is unavailable under the active safety policy.\x1b[0m\r\n'
    )
  }, [manualTerminalAllowed])

  const handleLaunchNative = () => {
    // This renderer guard is an affordance, not the authority. The privileged
    // launcher independently re-reads the active vault policy before opening
    // a terminal, so stale UI state cannot turn this into a bypass.
    if (!manualTerminalAllowed || !hostInput) return
    launchSsh({
      host: hostInput,
      username: username || 'root',
      privateKeyPath: selectedKeyPath || undefined
    })
  }

  const handleClear = () => {
    xtermInstance.current?.clear()
  }

  return (
    <div className="h-full flex flex-col bg-[#212529] text-[#f8f9fa] overflow-hidden">
      {/* Top Connection Bar */}
      <div className="p-3 bg-white dark:bg-[#2b3035] border-b border-[#ced4da] dark:border-[#373b3e] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <TermIcon className="w-4 h-4 text-[#017cb6]" />
          <span className="font-bold text-[#212529] dark:text-white">SSH Session</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* User Input */}
          <div className="flex items-center gap-1 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] px-2 py-1 rounded">
            <span className="text-[#6c757d]">User:</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={!manualTerminalAllowed}
              className="bg-transparent text-[#212529] dark:text-white w-14 focus:outline-none font-mono"
            />
          </div>

          {/* Host Input */}
          <div className="flex items-center gap-1 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] px-2 py-1 rounded">
            <span className="text-[#6c757d]">Host:</span>
            <input
              type="text"
              placeholder="e.g. 103.x.x.x"
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
              disabled={!manualTerminalAllowed}
              className="bg-transparent text-[#212529] dark:text-white w-32 sm:w-44 focus:outline-none font-mono"
            />
          </div>

          {/* SSH Key Selector */}
          <div className="flex items-center gap-1 bg-[#f8f9fa] dark:bg-[#212529] border border-[#ced4da] dark:border-[#373b3e] px-2 py-1 rounded">
            <Key className="w-3.5 h-3.5 text-[#f1ca00]" />
            <select
              value={selectedKeyPath}
              onChange={(e) => setSelectedKeyPath(e.target.value)}
              disabled={!manualTerminalAllowed}
              className="bg-transparent text-[#212529] dark:text-white focus:outline-none cursor-pointer max-w-[140px]"
            >
              <option value="" className="bg-white dark:bg-[#2b3035]">Default (~/.ssh/id_*)</option>
              {localKeys.map((k) => (
                <option key={k.name} value={k.privateKeyPath || ''} className="bg-white dark:bg-[#2b3035]">
                  {k.name} {k.privateKeyPath ? '🔑' : '(pub)'}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleLaunchNative}
            disabled={!manualTerminalAllowed || !hostInput}
            title={
              manualTerminalAllowed
                ? 'Launch native SSH'
                : 'Manual arbitrary-host SSH is available only to migrated legacy full-access profiles.'
            }
            className="flex items-center gap-1.5 px-3 py-1 bg-[#017cb6] hover:bg-[#016594] text-white rounded font-medium transition shadow-sm disabled:opacity-50"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Launch Native SSH</span>
          </button>

          <button
            onClick={handleClear}
            className="p-1 text-[#6c757d] hover:text-[#212529] dark:hover:text-white rounded"
            title="Clear Terminal Screen"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!manualTerminalAllowed && (
        <div
          role="status"
          className="mx-3 mt-3 flex items-start gap-2 rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <div className="font-semibold">Manual arbitrary-host SSH is unavailable</div>
            <div className="mt-0.5 text-amber-100/80">
              {accessMode === 'observe'
                ? 'Observe-only safety blocks remote access.'
                : 'Protected mode requires SSH to start from a selected Maintenance or Normal server. Read-only blocks remote access.'}{' '}
              This shell is retained only for migrated legacy full-access profiles.
            </div>
          </div>
        </div>
      )}

      {/* Terminal Viewport */}
      <div className="flex-1 p-3 bg-[#212529] overflow-hidden">
        <div ref={terminalRef} className="h-full w-full" />
      </div>
    </div>
  )
}
