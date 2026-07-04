import { useState } from 'react'
import { getTheme, DEFAULT_THEME_ID } from '../lib/timer'

const THEME_KEY = 'companion_timer_theme'

/**
 * Sarah's chosen clock theme, shared across the whole app — not just the
 * Timer page. Backed by localStorage; each page reads the current value on
 * mount, so picking a theme on the Timer page is reflected everywhere else
 * the next time that page is visited.
 */
export function useTimerTheme() {
  const [themeId, setThemeIdState] = useState(() => localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME_ID)

  function setThemeId(id: string) {
    localStorage.setItem(THEME_KEY, id)
    setThemeIdState(id)
  }

  return { themeId, setThemeId, theme: getTheme(themeId) }
}
