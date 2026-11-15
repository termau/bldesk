import React, { createContext, useContext, useEffect, useState } from 'react'

/** The saved choice. 'system' follows the operating system and is the default when nothing is saved. */
export type ThemePreference = 'system' | 'light' | 'dark'
type ThemeMode = 'light' | 'dark'

interface ThemeContextType {
  /** The theme in effect now. */
  theme: ThemeMode
  isDark: boolean
  preference: ThemePreference
  toggleTheme: () => void
  setPreference: (preference: ThemePreference) => void
}

// Also read before first paint by public/theme-init.js, so the window does not open in the wrong theme.
const STORAGE_KEY = 'bldesk_theme'

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const systemQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

const readPreference = (): ThemePreference => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved
  } catch {
    // Storage unavailable: follow the system.
  }
  return 'system'
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [systemDark, setSystemDark] = useState(() => systemQuery().matches)

  useEffect(() => {
    const query = systemQuery()
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const theme: ThemeMode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme)
  }, [theme])

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not saved; the choice still applies until BLDesk is closed.
    }
  }

  const toggleTheme = () => setPreference(theme === 'dark' ? 'light' : 'dark')

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', preference, toggleTheme, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
