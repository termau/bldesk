import React, { useEffect, useState } from 'react'
import { Minus, Square, Copy, X, Search, Key, ShieldCheck, Menu, Settings } from 'lucide-react'
import { AccountProfile } from '@shared/ipc-types'
import iconLogo from '../../assets/icon-logo-binarylane.png'
import { UpdateMenu } from './UpdateMenu'

interface TitleBarProps {
  activeProfile: AccountProfile | null
  profiles: Omit<AccountProfile, 'token'>[]
  onSwitchProfile: (id: string) => void
  onOpenAuth: () => void
  onOpenCommandPalette: () => void
  onOpenSettings: () => void
  settingsActive: boolean
  onToggleMobileDrawer?: () => void
}

export const TitleBar: React.FC<TitleBarProps> = ({
  activeProfile,
  profiles,
  onSwitchProfile,
  onOpenAuth,
  onOpenCommandPalette,
  onOpenSettings,
  settingsActive,
  onToggleMobileDrawer
}) => {
  const [isMaximized, setIsMaximized] = useState(false)
  const platform = window.bldeskApi?.platform ?? 'web'
  // We draw the window controls only where we also dropped the OS frame
  // (Windows, Linux). macOS keeps its traffic lights, overlaid at the left of
  // this bar, so the brand shifts right to make room for them.
  const ownsControls = platform === 'win32' || platform === 'linux'
  const macInset = platform === 'darwin'

  useEffect(() => {
    if (window.bldeskApi?.isMaximized) {
      window.bldeskApi.isMaximized().then(setIsMaximized)
    }
    return window.bldeskApi?.onWindowMaximized?.(setIsMaximized)
  }, [])

  const handleMinimize = () => window.bldeskApi?.minimizeWindow?.()
  const handleMaximize = async () => {
    if (window.bldeskApi?.maximizeWindow) {
      await window.bldeskApi.maximizeWindow()
      const max = await window.bldeskApi.isMaximized()
      setIsMaximized(max)
    }
  }
  const handleClose = () => window.bldeskApi?.closeWindow?.()

  return (
    <div
      onDoubleClick={(e) => {
        // Double-click on the bar itself toggles maximise, as a native title bar would.
        if (ownsControls && e.target === e.currentTarget) void handleMaximize()
      }}
      className={`titlebar-drag-region min-h-[44px] w-full bg-[#343a40] text-[#f8f9fa] border-b border-black/20 flex items-center justify-between ${
        macInset ? 'pl-[84px] pr-3' : 'px-2 min-[420px]:px-2.5 sm:px-3'
      } pt-[env(safe-area-inset-top,0px)] select-none z-50 flex-shrink-0 gap-1 min-[420px]:gap-2 max-sm:flex-wrap max-sm:gap-y-1 max-sm:pt-[max(0.25rem,env(safe-area-inset-top,0px))] max-sm:pb-1 max-sm:[&>:last-child]:ml-auto`}
    >
      {/* Brand & Mobile Drawer Toggle */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 max-[399px]:gap-0 flex-shrink-0">
        {onToggleMobileDrawer && (
          <button
            onClick={onToggleMobileDrawer}
            className="md:hidden text-slate-300 hover:text-white p-1 rounded hover:bg-white/10 transition"
            title="Open Navigation Menu"
            aria-label="Open Navigation Menu"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center gap-1.5 sm:gap-2 font-bold tracking-wide text-sm">
          <img src={iconLogo} alt="BinaryLane" className="h-5 w-auto object-contain flex-shrink-0 max-[399px]:hidden" />
          <span className="hidden xs:inline-flex items-center gap-1.5">
            <span>
              <span className="text-[#f1ca00]">binary</span>
              <span className="text-white">lane</span>
            </span>
            <span className="hidden sm:inline-block text-[0.625rem] font-normal text-slate-300/90 bg-black/30 px-1.5 py-0.5 rounded border border-white/10 font-mono">
              BLDesk v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.35'}
            </span>
          </span>
        </div>
      </div>

      {/* Global Command Palette Trigger */}
      <div className="titlebar-no-drag flex items-center">
        {/* Desktop Search Bar */}
        <button
          onClick={onOpenCommandPalette}
          className="hidden sm:flex items-center gap-2 px-3 py-1 text-xs text-slate-300 bg-black/25 hover:bg-black/40 border border-white/10 hover:border-white/20 rounded-md transition shadow-inner"
        >
          <Search className="w-3.5 h-3.5 text-slate-300" />
          <span>Search servers, DNS, actions...</span>
          <kbd className="ml-3 max-md:hidden px-1.5 py-0.5 text-[0.625rem] bg-black/40 text-slate-300 rounded border border-white/10 font-mono">
            Ctrl+K
          </kbd>
        </button>

        {/* Mobile Search Icon Button */}
        <button
          onClick={onOpenCommandPalette}
          className="sm:hidden p-1.5 text-slate-300 hover:text-white bg-black/20 rounded-md border border-white/10"
          title="Search"
          aria-label="Search"
        >
          <Search className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Profile & Window Controls */}
      <div className="titlebar-no-drag flex items-center gap-1 min-[420px]:gap-1.5 sm:gap-2 flex-shrink-0">
        {/* Version / Auto-update */}
        <div className="flex items-center">
          <UpdateMenu />
        </div>

        {/* Profile Switcher / Auth Button */}
        {activeProfile ? (
          <div className="flex items-center gap-1 sm:gap-1.5 bg-black/30 border border-white/10 rounded-md px-1.5 sm:px-2 py-0.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 max-[399px]:hidden" />
            <select
              value={activeProfile.id}
              onChange={(e) => onSwitchProfile(e.target.value)}
              className="bg-transparent text-[0.6875rem] sm:text-xs text-slate-200 font-medium outline-none cursor-pointer pr-1 max-w-[85px] max-[399px]:max-w-[56px] xs:max-w-[110px] sm:max-w-[130px] truncate"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#343a40] text-slate-100">
                  {p.name}
                </option>
              ))}
            </select>
            <button
              onClick={onOpenAuth}
              title="Add or Manage Profiles"
              aria-label="Add or Manage Profiles"
              className="text-slate-400 hover:text-[#f1ca00] p-0.5 transition flex-shrink-0"
            >
              <Key className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenAuth}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-[#017cb6] hover:bg-[#016594] rounded-md transition shadow"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Connect</span>
          </button>
        )}

        {/* Settings. Hidden below 640px, where the bar is already full: the mobile drawer has the entry there. */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          aria-pressed={settingsActive}
          className={`w-7 h-7 hidden sm:flex items-center justify-center rounded transition ${
            settingsActive ? 'text-[#f1ca00] bg-white/10' : 'text-slate-300 hover:text-white hover:bg-white/10'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* Window controls — only where the OS frame is gone (Windows, Linux) */}
        {ownsControls && (
        <div className="hidden md:flex items-center ml-2 border-l border-white/10 pl-2">
          <button
            onClick={handleMinimize}
            className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 rounded transition"
            title="Minimize"
            aria-label="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 rounded transition"
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
          </button>
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-white hover:bg-rose-600 rounded transition"
            title="Close"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        )}
      </div>
    </div>
  )
}
