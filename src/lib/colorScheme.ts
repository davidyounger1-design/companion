// Light/dark/auto appearance preference — device-local, like the timer theme
// and font scale. "Auto" follows the OS/browser's prefers-color-scheme and
// stays live for as long as the app is open.

export type ColorMode = 'light' | 'dark' | 'auto'
export type EffectiveScheme = 'light' | 'dark'

const COLOR_MODE_KEY = 'companion_color_mode'

export function getStoredColorMode(): ColorMode {
  const stored = localStorage.getItem(COLOR_MODE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto'
}

export function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveScheme(mode: ColorMode): EffectiveScheme {
  return mode === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : mode
}

export function applyColorMode(mode: ColorMode) {
  document.documentElement.dataset.theme = resolveScheme(mode)
}

export function setStoredColorMode(mode: ColorMode) {
  localStorage.setItem(COLOR_MODE_KEY, mode)
  applyColorMode(mode)
  return mode
}
