import { getTheme, DEFAULT_THEME_ID } from '../lib/timer'

/**
 * The clock/page colour theme, shared across the whole app. Theme selection
 * was removed — everyone gets the default look — but this stays a hook so
 * callers (Journal, Schedule, Notices, Timer, Help) don't need to change.
 */
export function useTimerTheme() {
  return { theme: getTheme(DEFAULT_THEME_ID) }
}
