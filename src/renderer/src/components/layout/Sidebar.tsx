import React, { useEffect, useRef } from 'react'
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
  CircleHelp,
  Waypoints,
  ChartNoAxesCombined,
  ChevronLeft,
  X, UserCircle, LayoutTemplate, Settings} from 'lucide-react'
import { DarkModeToggle } from './DarkModeToggle'
import logoFull from '../../assets/logo-binarylane.png'
import iconLogo from '../../assets/icon-logo-binarylane.png'
import { MPANEL_URL } from '../ui/LinkOut'
import { holdLayer, isTopLayer } from '../../lib/dialogLayer'

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
  | 'help'
  | 'map'
  | 'heatmap'
  | 'terminal'
  | 'settings'

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
  /** From the server-list read, the app's main call: the footer must not claim more than that read showed. */
  apiStatus?: 'online' | 'checking' | 'unreachable' | 'refused'
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
  apiStatus = 'online',
  selectedServer = null,
  activeServerSubTab = 'overview',
  onSelectServerSubTab,
  onBackToServers,
  isMobileDrawerOpen = false,
  onCloseMobileDrawer
}) => {
  const hasSubNav = Boolean(selectedServer && activeTab === 'servers')

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
    { id: 'help', label: 'Help', icon: CircleHelp },
    ...(window.bldeskApi?.pty ? [{ id: 'terminal' as const, label: 'Embedded SSH', icon: Terminal }] : [])
  ]

  // On a phone the title bar has no room for the Settings gear (see TitleBar), so the drawer carries it.
  const mobileMenuItems: typeof menuItems = [...menuItems, { id: 'settings', label: 'Settings', icon: Settings }]

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
    window.bldeskApi?.openExternal(MPANEL_URL)
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
          <div className="flex-1 min-h-0 overflow-y-auto">
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
                    aria-label={hasSubNav ? item.label : undefined}
                    className={`w-full flex items-center ${
                      hasSubNav ? 'justify-center px-0 py-3' : 'justify-between px-3.5 py-2.5'
                    } rounded-md text-[0.8125rem] font-normal transition duration-150 ${
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
                        className={`px-1.5 py-0.2 text-[0.6875rem] rounded font-semibold ${
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
          <div className="p-2 border-t border-white/10 space-y-1 flex-shrink-0">
            <DarkModeToggle collapsed={hasSubNav} />

            {!hasSubNav && (
              <>
                <div className="flex items-center justify-between px-3 py-1.5 bg-black/20 rounded text-[0.6875rem] text-slate-300">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      {apiStatus === 'online' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${apiStatus === 'online' ? 'bg-emerald-500' : apiStatus === 'checking' ? 'bg-amber-400' : 'bg-rose-500'}`}></span>
                    </span>
                    <span>{apiStatus === 'online' ? 'API Online' : apiStatus === 'checking' ? 'Checking API' : apiStatus === 'refused' ? 'API refused the token' : 'API not answering'}</span>
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

                <div className="flex items-center justify-between px-2 pt-1 text-[0.625rem] text-slate-400">
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
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Server Back Bar */}
              <div className="p-3 border-b border-[#ced4da] dark:border-[#373b3e]">
                <button
                  onClick={onBackToServers}
                  className="flex items-center gap-1.5 text-xs text-fg-link hover:underline font-medium mb-1.5"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>All Servers</span>
                </button>
                <div className="font-bold text-sm truncate text-[#212529] dark:text-white" title={selectedServer.name}>
                  {selectedServer.name}
                </div>
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
        <MobileDrawer onClose={() => onCloseMobileDrawer?.()}>
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
                  aria-label="Close navigation menu"
                  title="Close navigation menu"
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
                  mobileMenuItems.map((item) => {
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
                          <span className="px-1.5 py-0.2 text-[0.625rem] rounded font-semibold bg-black/30 text-slate-300">
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
              <div className="flex items-center justify-between px-2 pt-1 text-[0.625rem] text-slate-400">
                <span>BLDesk</span>
                <span className="font-mono text-slate-300">v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.28'}</span>
              </div>
            </div>
          </div>
        </MobileDrawer>
      )}
    </>
  )
}

const DRAWER_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The phone's navigation drawer, as a dialog: focus moves into it and Tab stays there, the page behind is inert,
 * Escape (and so Android's Back) closes it, and focus goes back to the button that opened it.
 */
const MobileDrawer: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const opener = useRef<Element | null | undefined>(undefined)
  if (opener.current === undefined) opener.current = document.activeElement

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const release = holdLayer(el)
    // At the md breakpoint the drawer is hidden (md:hidden) but would still hold the page inert: close it instead.
    const wide = window.matchMedia?.('(min-width: 768px)')
    const onWide = () => {
      if (wide?.matches) close.current()
    }
    onWide()
    wide?.addEventListener?.('change', onWide)
    const items = () => Array.from(el.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE)).filter((x) => x.getClientRects().length > 0)
    items()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      // A dialog opened over the drawer has the keys.
      if (!isTopLayer(el)) return
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        close.current()
      } else if (e.key === 'Tab') {
        const list = items()
        if (list.length === 0) return
        const at = list.indexOf(document.activeElement as HTMLElement)
        if (at === -1 || (e.shiftKey && at === 0) || (!e.shiftKey && at === list.length - 1)) {
          e.preventDefault()
          list[e.shiftKey ? list.length - 1 : 0].focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      wide?.removeEventListener?.('change', onWide)
      release()
      const back = opener.current
      const now = document.activeElement
      if (back instanceof HTMLElement && back.isConnected && (!now || now === document.body)) back.focus()
    }
  }, [])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
      data-dismissible="true"
      className="md:hidden fixed inset-0 z-50 flex"
    >
      {children}
    </div>
  )
}
