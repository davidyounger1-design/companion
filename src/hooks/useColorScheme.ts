import { useEffect, useState } from 'react'
import {
  type ColorMode, getStoredColorMode, setStoredColorMode, resolveScheme, systemPrefersDark,
} from '../lib/colorScheme'

/** Light/dark/auto appearance, shared across the app via localStorage. While
 * mounted (e.g. a header showing the mode pill), also keeps "auto" mode live
 * against OS-level scheme changes — see useTimerTheme for the same
 * read-on-mount, localStorage-backed pattern. */
export function useColorScheme() {
  const [mode, setModeState] = useState<ColorMode>(() => getStoredColorMode())
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark())

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  function setMode(next: ColorMode) {
    setStoredColorMode(next)
    setModeState(next)
  }

  const effective = mode === 'auto' ? (systemDark ? 'dark' : 'light') : resolveScheme(mode)

  return { mode, setMode, effective }
}
