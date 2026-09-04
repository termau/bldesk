import React from 'react'
import {
  Server,
  Network,
  Shield,
  Layers,
  Globe,
  Archive,
  Key,
  Receipt,
  ExternalLink,
  Terminal,
  Activity,
  History,
  Waypoints,
  ChartNoAxesCombined,
  ChevronLeft,
  X, UserCircle, LayoutTemplate} from 'lucide-react'
import { DarkModeToggle } from './DarkModeToggle'
import { useProfileSafety } from '../../context/ProfileSafetyContext'
import logoFull from '../../assets/logo-binarylane.png'
import iconLogo from '../../assets/icon-logo-binarylane.png'

export type ActiveTab =
  | 'servers'
  | 'templates'
  | 'vpcs'
  | 'firewall'
  | 'loadbalancers'
  | 'dns'
  | 'backups'
  | 'keys'
  | 'billing'
  | 'account'
  | 'history'
  | 'map'
  | 'heatmap'
  | 'terminal'

export type ServerSubTab =
  | 'overview'
  | 'remote-access'
  | 'usage'
  | 'cloud-init'
  | 'network'
  | 'backups'
  | 'firewall'
  | 'settings'
  | 'recovery'
  | 'change-plan'
  | 'cancel'

interface SidebarProps {
  activeTab: ActiveTab
  onSelectTab: (tab: ActiveTab) => void
  serverCount?: number
  selectedServer?: any | null
  activeServerSubTab?: ServerSubTab
  onSelectServerSubTab?: (tab: ServerSubTab) => void
  onBackToServers?: () => void
  isMobileDrawerOpen?: boolean
  onCloseMobileDrawer?: () => void
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  serverCount = 0,
  selectedServer = null,
  activeServerSubTab = 'overview',
  onSelectServerSubTab,
  onBackToServers,
  isMobileDrawerOpen = false,
  onCloseMobileDrawer
}) => {
  const { accessMode, serverSafetyLevel } = useProfileSafety()
  const hasSubNav = Boolean(selectedServer && activeTab === 'servers')
  const selectedSafetyLevel = selectedServer ? serverSafetyLevel(selectedServer.id) : null

  const menuItems: { id: ActiveTab; label: string; icon: React.FC<{ className?: string }>; badge?: number | string }[] = [
    { id: 'servers', label: 'Servers', icon: Server, badge: serverCount > 0 ? serverCount : undefined },
    { id: 'templates', label: 'Templates', icon: LayoutTemplate },
    { id: 'vpcs', label: 'VPCs', icon: Network },
    { id: 'firewall', label: 'Firewall', icon: Shield },
    { id: 'loadbalancers', label: 'Load Balancers', icon: Layers },
    { id: 'map', label: 'Network Map', icon: Waypoints },
    { id: 'heatmap', label: 'Fleet Heatmap', icon: ChartNoAxesCombined },
    { id: 'dns', label: 'DNS & Domains', icon: Globe },
    { id: 'backups', label: 'Backups', icon: Archive },
    { id: 'keys', label: 'SSH Keys', icon: Key },
    { id: 'billing', label: 'Billing & Invoices', icon: Receipt },
    { id: 'account', label: 'Account Details', icon: UserCircle },
    { id: 'history', label: 'History', icon: History },
    {
      id: 'terminal',
      label: 'Embedded Shell',
      icon: Terminal,
      badge: accessMode === 'full' ? undefined : 'LEGACY ONLY'
    }
  ]

  const serverSubNavItems: { id: ServerSubTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'remote-access', label: 'Remote Access' },
    { id: 'usage', label: 'Usage & Metrics' },
    { id: 'cloud-init', label: 'Cloud-init' },
    { id: 'network', label: 'Network' },
    { id: 'backups', label: 'Backups' },
    { id: 'firewall', label: 'Firewall Rules' },
    { id: 'settings', label: 'Settings' },
    { id: 'recovery', label: 'Recovery & Rescue' },
    { id: 'change-plan', label: 'Change Plan' },
    { id: 'cancel', label: 'Cancel Server' }
  ]

  const handleOpenMpanel = () => {
    window.bldeskApi?.openExternal('https://home.binarylane.com.au/mpanel')
  }

  const handleItemClick = (id: ActiveTab) => {
    onSelectTab(id)
    if (onCloseMobileDrawer) {
      onCloseMobileDrawer()
    }
  }

  const handleSubTabClick = (subTab: ServerSubTab) => {
    if (onSelectServerSubTab) {
      onSelectServerSubTab(subTab)
    }
    if (onCloseMobileDrawer) {
      onCloseMobileDrawer()
    }
  }

  return (
    <>
      {/* 1. Desktop Dual-Navigation Container */}
      <aside className="hidden md:flex flex-row h-full select-none flex-shrink-0 z-30">
        {/* Global Nav Strip.
            The rail (w-16) plus the server sub-nav (w-40) is exactly the full
            strip (w-56), so opening or leaving a server never moves the main
            content. It used to: 64 + 208 against 224 shifted everything 48px,
            which under a dialog's backdrop looked like the whole app sliding.
            No width transition either: the labels rendered into a strip still
            animating open, and the content jumped twice. */}
        <div
          className={`bg-[#343a40] text-[#f8f9fa] flex flex-col justify-between border-r border-black/20 ${
            hasSubNav ? 'w-16' : 'w-56'
          }`}
        >
          {/* Logo Header */}
          <div>
            <div className="h-14 flex items-center justify-center px-3 border-b border-white/10 overflow-hidden">
              {hasSubNav ? (
                <img src={iconLogo} alt="BinaryLane" className="h-7 w-auto object-contain" />
              ) : (
                <img src={logoFull} alt="BinaryLane" className="h-7 w-auto object-contain brightness-110" />
              )}
            </div>

            {/* Global Nav Links */}
            <div className="p-2 space-y-0.5">
              {menuItems.map((item) => {
                const Icon = item.icon
                const isActive = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => handleItemClick(item.id)}
                    title={hasSubNav ? item.label : undefined}
                    className={`w-full flex items-center ${
                      hasSubNav ? 'justify-center px-0 py-3' : 'justify-between px-3.5 py-2.5'
                    } rounded-md text-[13px] font-normal transition duration-150 ${
                      isActive
                        ? 'text-[#f1ca00] bg-white/[0.09] font-medium'
                        : 'text-[#f8f9fa] hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className={`flex items-center ${hasSubNav ? '' : 'gap-3'}`}>
                      <Icon className={`w-4 h-4 ${isActive ? 'text-[#f1ca00]' : 'text-slate-300'}`} />
                      {!hasSubNav && <span>{item.label}</span>}
                    </div>
                    {!hasSubNav && item.badge !== undefined && (
                      <span
                        className={`px-1.5 py-0.2 text-[11px] rounded font-semibold ${
                          isActive ? 'bg-[#f1ca00]/20 text-[#f1ca00]' : 'bg-black/30 text-slate-300'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Footer Controls */}
          <div className="p-2 border-t border-white/10 space-y-1">
            <DarkModeToggle collapsed={hasSubNav} />

            {!hasSubNav && (
              <>
                <div className="flex items-center justify-between px-3 py-1.5 bg-black/20 rounded text-[11px] text-slate-300">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span>API Online</span>
                  </div>
                  <Activity className="w-3.5 h-3.5 text-slate-400" />
                </div>

                <button
                  onClick={handleOpenMpanel}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-normal text-slate-300 hover:text-white hover:bg-white/[0.06] transition border border-white/10"
                >
                  <span>Open mPanel Web</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </button>

                <div className="flex items-center justify-between px-2 pt-1 text-[10px] text-slate-400">
                  <span>BLDesk</span>
                  <span className="font-mono text-slate-300">v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.28'}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Server Sub-Navigation Drawer (when a server is selected) */}
        {hasSubNav && (
          <div className="w-40 bg-[#f1f1f1] dark:bg-[#2b3035] text-[#212529] dark:text-[#f8f9fa] border-r border-[#ced4da] dark:border-[#373b3e] flex flex-col justify-between">
            <div>
              {/* Server Back Bar */}
              <div className="p-3 border-b border-[#ced4da] dark:border-[#373b3e]">
                <button
                  onClick={onBackToServers}
                  className="flex items-center gap-1.5 text-xs text-[#017cb6] hover:underline font-medium mb-1.5"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>All Servers</span>
                </button>
                <div className="font-bold text-sm truncate text-[#212529] dark:text-white" title={selectedServer.name}>
                  {selectedServer.name}
                </div>
                {selectedSafetyLevel && (
                  <span
                    data-safety-level={selectedSafetyLevel}
                    className={`mt-1 inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                      selectedSafetyLevel === 'locked'
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                        : selectedSafetyLevel === 'maintenance'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          : 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                    }`}
                  >
                    {selectedSafetyLevel === 'locked' ? 'Read' : selectedSafetyLevel === 'maintenance' ? 'Maint' : 'Normal'}
                  </span>
                )}
              </div>

              {/* SubNav Items */}
              <div className="p-2 space-y-0.5 text-xs">
                {serverSubNavItems.map((sub) => {
                  const isActive = activeServerSubTab === sub.id
                  return (
                    <button
                      key={sub.id}
                      onClick={() => handleSubTabClick(sub.id)}
                      className={`w-full text-left px-3 py-2 rounded transition ${
                        isActive
                          ? 'bg-[#017cb6] text-white font-semibold shadow-sm'
                          : 'text-[#495057] dark:text-[#ced4da] hover:bg-black/[0.05] dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {sub.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* 2. Mobile Slide-Over Drawer (< 768px) */}
      {isMobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            onClick={onCloseMobileDrawer}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
          />

          <div className="relative w-72 max-w-[85vw] bg-[#343a40] text-[#f8f9fa] border-r border-black/30 flex flex-col justify-between z-10 shadow-2xl animate-in slide-in-from-left duration-200 panel-safe overflow-y-auto">
            <div>
              <div className="p-3.5 border-b border-white/10 flex items-center justify-between">
                <img src={logoFull} alt="BinaryLane" className="h-6 w-auto object-contain" />
                <button
                  onClick={onCloseMobileDrawer}
                  className="text-slate-300 hover:text-white p-1 rounded hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* If server subnav is active on mobile, show quick back button */}
              {hasSubNav && (
                <div className="p-3 bg-black/20 border-b border-white/10">
                  <button
                    onClick={() => {
                      if (onBackToServers) onBackToServers()
                      if (onCloseMobileDrawer) onCloseMobileDrawer()
                    }}
                    className="flex items-center gap-1 text-xs text-[#f1ca00] hover:underline font-medium"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Back to Server Fleet</span>
                  </button>
                  <div className="font-bold text-sm text-white truncate mt-1">{selectedServer?.name}</div>
                  {selectedSafetyLevel && (
                    <span
                      data-safety-level={selectedSafetyLevel}
                      className={`mt-1 inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                        selectedSafetyLevel === 'locked'
                          ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
                          : selectedSafetyLevel === 'maintenance'
                            ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                            : 'border-sky-400/50 bg-sky-500/15 text-sky-200'
                      }`}
                    >
                      {selectedSafetyLevel === 'locked' ? 'Read' : selectedSafetyLevel === 'maintenance' ? 'Maint' : 'Normal'}
                    </span>
                  )}
                </div>
              )}

              <div className="p-2 space-y-1">
                {hasSubNav ? (
                  // Server SubNav links on mobile
                  serverSubNavItems.map((sub) => {
                    const isActive = activeServerSubTab === sub.id
                    return (
                      <button
                        key={sub.id}
                        onClick={() => handleSubTabClick(sub.id)}
                        className={`w-full text-left px-3.5 py-2.5 rounded-md text-xs font-medium transition ${
                          isActive
                            ? 'bg-[#017cb6] text-white font-semibold'
                            : 'text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        {sub.label}
                      </button>
                    )
                  })
                ) : (
                  // Global Links
                  menuItems.map((item) => {
                    const Icon = item.icon
                    const isActive = activeTab === item.id
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleItemClick(item.id)}
                        className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-md text-xs font-medium transition ${
                          isActive
                            ? 'text-[#f1ca00] bg-white/[0.09] font-medium'
                            : 'text-[#f8f9fa] hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className={`w-4 h-4 ${isActive ? 'text-[#f1ca00]' : 'text-slate-300'}`} />
                          <span>{item.label}</span>
                        </div>
                        {item.badge !== undefined && (
                          <span className="px-1.5 py-0.2 text-[10px] rounded font-semibold bg-black/30 text-slate-300">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            <div className="p-3 border-t border-white/10 space-y-2">
              <DarkModeToggle />
              <button
                onClick={handleOpenMpanel}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-normal text-slate-300 hover:text-white bg-black/20 hover:bg-black/30 transition border border-white/10"
              >
                <span>Open mPanel Web</span>
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </button>
              <div className="flex items-center justify-between px-2 pt-1 text-[10px] text-slate-400">
                <span>BLDesk</span>
                <span className="font-mono text-slate-300">v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.28'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
