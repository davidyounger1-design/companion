// Visual countdown timer helpers — the "shrinking disk" mechanic (a la Time Timer).

export const MAX_DIAL_MINUTES = 60

/** SVG path for a clockwise pie slice starting at 12 o'clock, sweeping `fraction` (0–1) of the circle. */
export function pieSlicePath(cx: number, cy: number, r: number, fraction: number): string {
  const f = Math.max(0, Math.min(1, fraction))
  if (f <= 0.001) return ''
  if (f >= 0.999) {
    // A true 360° arc degenerates in the M/L/A/Z formula below, so draw a full circle instead.
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`
  }
  const startAngle = -90
  const endAngle = startAngle + f * 360
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const startX = cx + r * Math.cos(toRad(startAngle))
  const startY = cy + r * Math.sin(toRad(startAngle))
  const endX = cx + r * Math.cos(toRad(endAngle))
  const endY = cy + r * Math.sin(toRad(endAngle))
  const largeArc = f > 0.5 ? 1 : 0
  return `M ${cx} ${cy} L ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY} Z`
}

/** Minutes (0–60, wrapping) for a pointer position relative to the dial's center — used to drag-set a duration. */
export function angleToMinutes(cx: number, cy: number, x: number, y: number): number {
  const deg = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90
  const norm = ((deg % 360) + 360) % 360
  const minutes = Math.round((norm / 360) * MAX_DIAL_MINUTES)
  return minutes === 0 ? MAX_DIAL_MINUTES : minutes
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${String(rem).padStart(2, '0')}`
}

let audioCtx: AudioContext | null = null

/** A short, friendly two-tone chime synthesized with Web Audio — no asset to bundle or cache. */
export function playChime() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctx) return
    audioCtx ??= new Ctx()
    const ctx = audioCtx
    const now = ctx.currentTime
    const notes = [523.25, 659.25, 783.99] // C5, E5, G5 — a bright little arpeggio
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.16
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.28, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.55)
    })
  } catch {
    // Web Audio unavailable — visual pulse still carries the alert.
  }
}

export function vibrate(pattern: number | number[]) {
  if ('vibrate' in navigator) {
    try { navigator.vibrate(pattern) } catch { /* unsupported */ }
  }
}

export const QUICK_PICKS = [1, 5, 10, 15, 20, 30, 45, 60]

// ─── Themes — a fun, personal skin for Sarah's clock ────────────────────────

export type TimerTheme = {
  id: string
  label: string
  emoji: string
  /** Gradient stops for the disk / digital display accent. */
  diskColors: [string, string]
  /** Gradient stops for the card background wash. */
  bgColors: [string, string]
  /** Emoji sprinkled around the disk while a timer runs. */
  particles: string[]
  doneEmoji: string
  doneMessage: string
}

export const TIMER_THEMES: TimerTheme[] = [
  {
    id: 'classic', label: 'Classic', emoji: '⏱️',
    diskColors: ['#6f8c78', '#4d6655'], bgColors: ['#6f8c78', '#f6f2ea'],
    particles: [], doneEmoji: '🎉', doneMessage: 'Great job!',
  },
  {
    id: 'ocean', label: 'Ocean', emoji: '🌊',
    diskColors: ['#4facfe', '#00668c'], bgColors: ['#a8e6ff', '#e8f9ff'],
    particles: ['🐠', '🐬', '🫧', '⭐'], doneEmoji: '🐳', doneMessage: 'Splash! Time\'s up!',
  },
  {
    id: 'space', label: 'Space', emoji: '🚀',
    diskColors: ['#8e6fe8', '#2b1a5e'], bgColors: ['#3a2d6b', '#0d0a26'],
    particles: ['⭐', '✨', '🪐', '👽'], doneEmoji: '🚀', doneMessage: 'Blast off! Mission complete!',
  },
  {
    id: 'rainbow', label: 'Rainbow', emoji: '🌈',
    diskColors: ['#ff6b6b', '#8e6fe8'], bgColors: ['#ffe0f0', '#e0f7ff'],
    particles: ['🌈', '✨', '⭐', '💫'], doneEmoji: '🦄', doneMessage: 'Ta-da! You did it!',
  },
  {
    id: 'candy', label: 'Candy', emoji: '🍭',
    diskColors: ['#ff8fd1', '#c060e0'], bgColors: ['#ffd6f0', '#fff0fb'],
    particles: ['🍬', '🍭', '🍩', '🧁'], doneEmoji: '🍦', doneMessage: 'Sweet! All done!',
  },
  {
    id: 'garden', label: 'Garden', emoji: '🌻',
    diskColors: ['#8bc34a', '#f4c542'], bgColors: ['#e8f5d0', '#fffbe6'],
    particles: ['🌼', '🐝', '🦋', '🌸'], doneEmoji: '🌻', doneMessage: 'Bloomin\' brilliant!',
  },
  {
    id: 'sunset', label: 'Sunset', emoji: '🌅',
    diskColors: ['#ff9a56', '#c06a87'], bgColors: ['#ffd9a0', '#ffe8ec'],
    particles: ['🦋', '☁️', '✨'], doneEmoji: '🌅', doneMessage: 'Beautiful! Time\'s up!',
  },
]

export const DEFAULT_THEME_ID = 'classic'

export function getTheme(id: string | null | undefined): TimerTheme {
  return TIMER_THEMES.find((t) => t.id === id) ?? TIMER_THEMES[0]
}
