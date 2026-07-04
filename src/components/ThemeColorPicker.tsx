import { TIMER_THEMES } from '../lib/timer'

/** The clock/page colour theme picker — shared between the Timer settings
 * sheet and Display settings so it's reachable without opening the Timer. */
export default function ThemeColorPicker({
  themeId, setThemeId,
}: { themeId: string; setThemeId: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem', overflowX: 'auto', padding: '0.25rem', justifyContent: 'center', flexWrap: 'wrap' }}>
      {TIMER_THEMES.map((t) => (
        <button key={t.id} onClick={() => setThemeId(t.id)} title={t.label} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem',
          background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem',
        }}>
          <span style={{
            width: 44, height: 44, borderRadius: '50%',
            background: `linear-gradient(135deg, ${t.diskColors[0]}, ${t.diskColors[1]})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem',
            border: themeId === t.id ? '3px solid var(--color-ink)' : '3px solid transparent',
            boxShadow: 'var(--shadow-sm)',
          }}>{t.emoji}</span>
          <span style={{ fontSize: '0.65rem', fontWeight: themeId === t.id ? 700 : 500, color: themeId === t.id ? 'var(--color-ink)' : 'var(--color-muted)' }}>{t.label}</span>
        </button>
      ))}
    </div>
  )
}
