import React from 'react'
import { Server, Network, Layers, Globe, Menu } from 'lucide-react'
import { ActiveTab } from './Sidebar'

interface BottomNavProps {
  activeTab: ActiveTab
  onSelectTab: (tab: ActiveTab) => void
  onOpenDrawer: () => void
  serverCount?: number
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenDrawer,
  serverCount = 0
}) => {
  const navItems: { id: ActiveTab; label: string; icon: React.FC<{ className?: string }>; badge?: number }[] = [
    { id: 'servers', label: 'Servers', icon: Server, badge: serverCount > 0 ? serverCount : undefined },
    { id: 'vpcs', label: 'VPCs', icon: Network },
    { id: 'loadbalancers', label: 'Load Bal.', icon: Layers },
    { id: 'dns', label: 'DNS', icon: Globe }
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[calc(3.5rem+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)] bg-[#343a40] border-t border-black/30 flex items-center justify-around px-2 z-40 select-none">
      {navItems.map((item) => {
        const Icon = item.icon
        const isActive = activeTab === item.id
        return (
          <button
            key={item.id}
            onClick={() => onSelectTab(item.id)}
            className={`flex flex-col items-center justify-center w-14 py-1 relative transition ${
              isActive ? 'text-[#f1ca00] font-semibold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <div className="relative">
              <Icon className={`w-5 h-5 ${isActive ? 'text-[#f1ca00]' : 'text-slate-300'}`} />
              {item.badge !== undefined && (
                <span className="absolute -top-1 -right-2 px-1 text-[0.5625rem] font-bold bg-[#017cb6] text-white rounded-full">
                  {item.badge}
                </span>
              )}
            </div>
            <span className="text-[0.625rem] tracking-tight mt-0.5">{item.label}</span>
          </button>
        )
      })}

      {/* More / Hamburger drawer trigger */}
      <button
        onClick={onOpenDrawer}
        className="flex flex-col items-center justify-center w-14 py-1 text-slate-300 hover:text-white transition"
      >
        <Menu className="w-5 h-5 text-slate-300" />
        <span className="text-[0.625rem] tracking-tight mt-0.5">More</span>
      </button>
    </nav>
  )
}
