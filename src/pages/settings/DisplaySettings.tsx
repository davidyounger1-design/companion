import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingsIcon, BackIcon } from '../../components/icons'
import { useFontScale } from '../../hooks/useFontScale'
import { FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_STEP, FONT_SCALE_DEFAULT } from '../../lib/fontScale'
import { useColorScheme } from '../../hooks/useColorScheme'
import SegmentedControl from '../../components/SegmentedControl'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

function ContactNumberCard() {
  const { user, profile, refreshProfile } = useAuth()
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [initialised, setInitialised] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  if (profile && !initialised) {
    setPhone(profile.phone ?? '')
    setInitialised(true)
  }

  async function handleSave() {
    if (!user) return
    setSaving(true)
    setSaved(false)
    const { error } = await supabase.from('profiles').update({ phone: phone.trim() || null }).eq('id', user.id)
    setSaving(false)
    if (!error) {
      setSaved(true)
      await refreshProfile()
    }
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '0.95rem' }}>Mobile number</p>
      <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
        Lets other coordinators text you things like invite links directly, instead of only by email.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input type="tel" className="input" placeholder="04xx xxx xxx" style={{ flex: 1 }}
          value={phone} onChange={(e) => { setPhone(e.target.value); setSaved(false) }} />
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinner" /> : 'Save'}
        </button>
      </div>
      {saved && <p style={{ fontSize: '0.78rem', color: 'var(--color-primary)', marginTop: '0.5rem' }}>Saved.</p>}
    </div>
  )
}

export default function DisplaySettings() {
  const navigate = useNavigate()
  const { scale, setScale } = useFontScale()
  const percent = Math.round(scale * 100)
  const { mode, setMode, effective } = useColorScheme()

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
        <ContactNumberCard />

        <div className="card" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '0.95rem' }}>Appearance</p>
          <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
            Choose a light or dark look, or match this device's system setting.
          </p>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: 'light', label: '☀️ Light' },
              { value: 'dark', label: '🌙 Dark' },
              { value: 'auto', label: '🌗 Auto' },
            ]}
          />
          {mode === 'auto' && (
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>
              Currently showing {effective} — follows this device's system setting.
            </p>
          )}
        </div>

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
