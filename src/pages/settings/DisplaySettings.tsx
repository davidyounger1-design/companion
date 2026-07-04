import { useNavigate } from 'react-router-dom'
import { SettingsIcon, BackIcon } from '../../components/icons'
import { useFontScale } from '../../hooks/useFontScale'
import { FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_STEP, FONT_SCALE_DEFAULT } from '../../lib/fontScale'

export default function DisplaySettings() {
  const navigate = useNavigate()
  const { scale, setScale } = useFontScale()
  const percent = Math.round(scale * 100)

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: '3rem' }}>
      <div style={{
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><BackIcon /></button>
        <h1 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <SettingsIcon size={20} /> Display
        </h1>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '1rem' }}>
        <div className="card">
          <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '0.95rem' }}>Text size</p>
          <p style={{ margin: '0 0 1.25rem', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
            Make text throughout the app bigger or smaller on this device.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span aria-hidden style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-muted)' }}>A</span>
            <input
              type="range"
              min={FONT_SCALE_MIN}
              max={FONT_SCALE_MAX}
              step={FONT_SCALE_STEP}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--color-primary)' }}
              aria-label="Text size"
            />
            <span aria-hidden style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-muted)' }}>A</span>
          </div>

          <p style={{ margin: '0 0 1.25rem', fontSize: '0.78rem', color: 'var(--color-muted)', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {percent}%
          </p>

          <div className="card card-sm" style={{ background: 'var(--color-bg)', marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 0.3rem', fontWeight: 700, fontSize: 'var(--text-base)' }}>Physio session</p>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>9:30 – 10:15 am · This is how text will look</p>
          </div>

          {scale !== FONT_SCALE_DEFAULT && (
            <button className="btn btn-ghost" onClick={() => setScale(FONT_SCALE_DEFAULT)} style={{ width: '100%', fontSize: '0.85rem' }}>
              Reset to default
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
