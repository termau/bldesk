import React from 'react'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'

interface DarkModeToggleProps {
  collapsed?: boolean
}

export const DarkModeToggle: React.FC<DarkModeToggleProps> = ({ collapsed = false }) => {
  const { isDark, toggleTheme } = useTheme()

  if (collapsed) {
    return (
      <button
        onClick={toggleTheme}
        className="w-full flex items-center justify-center py-2 text-slate-400 hover:text-white transition focus-ring"
        title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      >
        {isDark ? <Moon className="w-4 h-4 text-brand-gold" /> : <Sun className="w-4 h-4 text-amber-400" />}
      </button>
    )
  }

  return (
    <div className="flex items-center justify-center gap-2 py-1.5 px-3 text-xs text-slate-400 select-none">
      <Sun className={`w-3.5 h-3.5 ${!isDark ? 'text-amber-400' : 'text-slate-500'}`} />
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        onClick={toggleTheme}
        aria-label="Dark mode"
        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-200 focus-ring ${
          isDark ? 'bg-brand' : 'bg-slate-600'
        }`}
        title="Toggle dark mode"
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform duration-200 ${
            isDark ? 'translate-x-4' : 'translate-x-1'
          }`}
        />
      </button>
      <Moon className={`w-3.5 h-3.5 ${isDark ? 'text-brand-gold' : 'text-slate-500'}`} />
    </div>
  )
}
