import { useColorScheme } from '../hooks/useColorScheme'
import type { ColorMode } from '../lib/colorScheme'

const NEXT: Record<ColorMode, ColorMode> = { light: 'dark', dark: 'auto', auto: 'light' }
const ICON: Record<ColorMode, string> = { light: '☀️', dark: '🌙', auto: '🌗' }
const LABEL: Record<ColorMode, string> = { light: 'Light', dark: 'Dark', auto: 'Auto' }

/** A tiny glanceable appearance indicator for the top bar — tap to cycle
 * Light → Dark → Auto. Full control lives in Display settings. */
export default function ColorModePill() {
  const { mode, setMode } = useColorScheme()
  return (
    <button
      onClick={() => setMode(NEXT[mode])}
      title={`Appearance: ${LABEL[mode]} — tap to change`}
      aria-label={`Appearance: ${LABEL[mode]}. Tap to change.`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, lineHeight: 1,
        fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap',
        padding: '0.32rem 0.55rem', borderRadius: 999,
        border: '1px solid var(--color-border)', background: 'var(--color-surface)',
        color: 'var(--color-text)', cursor: 'pointer',
      }}
    >
      <span aria-hidden="true">{ICON[mode]}</span>{LABEL[mode]}
    </button>
  )
}
