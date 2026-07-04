// Personal text-size preference — scales the root font-size so every rem-based
// size in the app (the --text-* scale, and the many inline rem values used
// throughout) grows or shrinks together. Device-local, like the timer theme.

const FONT_SCALE_KEY = 'companion_font_scale'
const ROOT_FONT_PX = 16

export const FONT_SCALE_MIN = 0.875
export const FONT_SCALE_MAX = 1.375
export const FONT_SCALE_STEP = 0.125
export const FONT_SCALE_DEFAULT = 1

export function getStoredFontScale(): number {
  const stored = Number(localStorage.getItem(FONT_SCALE_KEY))
  return stored >= FONT_SCALE_MIN && stored <= FONT_SCALE_MAX ? stored : FONT_SCALE_DEFAULT
}

export function applyFontScale(scale: number) {
  document.documentElement.style.fontSize = `${ROOT_FONT_PX * scale}px`
}

export function setStoredFontScale(scale: number) {
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale))
  localStorage.setItem(FONT_SCALE_KEY, String(clamped))
  applyFontScale(clamped)
  return clamped
}
