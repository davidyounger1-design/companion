import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingsIcon, BackIcon } from '../../components/icons'
import { useFontScale } from '../../hooks/useFontScale'
import { FONT_SCALE_MIN, FONT_SCALE_MAX, FONT_SCALE_STEP, FONT_SCALE_DEFAULT } from '../../lib/fontScale'
import { useColorScheme } from '../../hooks/useColorScheme'
import SegmentedControl from '../../components/SegmentedControl'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import MfaCodeInput from '../../components/MfaCodeInput'
import Toggle from '../../components/Toggle'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import { useInstallPrompt } from '../../hooks/useInstallPrompt'
import { isStandalone } from '../../lib/pwa'
import { APP_VERSION } from '../../lib/version'

function InstallCard() {
  const { canInstall, isIOS, hasPrompt, install } = useInstallPrompt()

  // Hidden once installed (running standalone) — nothing to install then.
  if (isStandalone()) return null

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '0.95rem' }}>Install app</p>
      <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
        Add Companion to your home screen for quick access and notifications.
      </p>
      {hasPrompt ? (
        <button className="btn btn-primary" onClick={install}>Install Companion</button>
      ) : isIOS ? (
        <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>
          In Safari, tap the <strong>Share</strong> button (⬆️), then choose <strong>Add to Home Screen</strong>.
          On iPad the Share icon is up in the address bar.
        </p>
      ) : (
        <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0, color: 'var(--color-muted)' }}>
          {canInstall
            ? 'Use your browser’s menu and choose "Install app" or "Add to Home screen".'
            : 'Open Companion in Chrome or Safari on your phone to install it to your home screen.'}
        </p>
      )}
    </div>
  )
}

type UpdateState = 'idle' | 'checking' | 'available' | 'latest' | 'error'

function UpdatesCard() {
  const [state, setState] = useState<UpdateState>('idle')
  const [latest, setLatest] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  async function check() {
    setState('checking')
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      const data = (await res.json()) as { version?: string }
      // Also nudge the service worker to fetch a fresh build in the background.
      await navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {})
      if (data.version && data.version !== APP_VERSION) {
        setLatest(data.version)
        setState('available')
      } else {
        setState('latest')
      }
    } catch {
      setState('error')
    }
  }

  async function applyUpdate() {
    setApplying(true)
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg?.waiting) {
      // UpdatePrompt's controllerchange listener reloads once it activates.
      reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      return
    }
    if (reg) {
      try {
        await reg.update()
        const w = reg.waiting ?? reg.installing
        if (w) {
          w.addEventListener('statechange', () => {
            if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          })
          if (reg.waiting) { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); return }
          return
        }
      } catch { /* fall through to hard reload */ }
    }
    window.location.reload()
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '0.95rem' }}>App version</p>
      <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
        You're on <strong>v{APP_VERSION}</strong>.
      </p>

      {state === 'available' ? (
        <>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', color: 'var(--color-ink)' }}>
            Version <strong>v{latest}</strong> is available.
          </p>
          <button className="btn btn-primary" onClick={applyUpdate} disabled={applying}>
            {applying ? <span className="spinner" /> : `Update to v${latest}`}
          </button>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={check} disabled={state === 'checking'}>
            {state === 'checking' ? <span className="spinner" /> : 'Check for updates'}
          </button>
          {state === 'latest' && (
            <span style={{ fontSize: '0.85rem', color: 'var(--color-primary)' }}>You're on the latest version.</span>
          )}
          {state === 'error' && (
            <span style={{ fontSize: '0.85rem', color: 'var(--color-error, #c0392b)' }}>Couldn't check right now — try again.</span>
          )}
        </div>
      )}
    </div>
  )
}

function LinksCard() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isCoordinator = profile?.role === 'coordinator'

  const links: { label: string; path: string }[] = [
    { label: "📋 What's new", path: '/release-notes' },
    ...(isCoordinator ? [
      { label: '🔐 Permissions', path: '/settings/permissions' },
      { label: '💳 Subscription', path: '/account' },
    ] : []),
  ]

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: 0, overflow: 'hidden' }}>
      {links.map((l, i) => (
        <button key={l.path} onClick={() => navigate(l.path)}
          style={{
            display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', justifyContent: 'space-between',
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.9rem 1rem',
            fontSize: '0.9rem', color: 'var(--color-ink)',
            borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
          }}>
          <span>{l.label}</span>
          <span style={{ color: 'var(--color-muted)' }}>›</span>
        </button>
      ))}
    </div>
  )
}

function NotificationsCard() {
  const { permission, subscribing, subscribe, notifyOnEntry, setNotifyOnEntry } = usePushNotifications()

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '0.95rem' }}>Notifications</p>
      <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
        Get a notification on this device when something happens — messages, and optionally each new journal entry.
      </p>

      {permission === 'unsupported' && (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          This device or browser doesn't support notifications.
        </p>
      )}

      {permission === 'denied' && (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          Notifications are blocked. Turn them on for Companion in your device or browser settings, then come back.
        </p>
      )}

      {permission === 'default' && (
        <button className="btn btn-primary" onClick={subscribe} disabled={subscribing}>
          {subscribing ? <span className="spinner" /> : 'Enable notifications'}
        </button>
      )}

      {permission === 'granted' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
            <div>
              <p style={{ margin: 0, fontWeight: 500, fontSize: '0.9rem' }}>New entry alerts</p>
              <p style={{ margin: '0.1rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>
                Notify me when a new journal entry is logged.
              </p>
            </div>
            <Toggle
              checked={!!notifyOnEntry}
              onChange={() => setNotifyOnEntry(!notifyOnEntry)}
              label="New entry alerts"
            />
          </div>
          {notifyOnEntry === null && (
            <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', marginTop: '0.5rem' }}>Loading…</p>
          )}
        </>
      )}
    </div>
  )
}

type TwoFactorStatus = 'loading' | 'off' | 'enrolling' | 'on'

function TwoFactorCard() {
  const [status, setStatus] = useState<TwoFactorStatus>('loading')
  const [factorId, setFactorId] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { refreshStatus() }, [])

  async function refreshStatus() {
    const { data } = await supabase.auth.mfa.listFactors()
    const verified = data?.totp?.find((f) => f.status === 'verified')
    if (verified) {
      setFactorId(verified.id)
      setStatus('on')
    } else {
      setStatus('off')
    }
  }

  async function startEnroll() {
    setError('')
    setBusy(true)
    // Supabase caps how many unverified factors can exist — clear stale ones from
    // abandoned setup attempts before starting a new one.
    const { data: existing } = await supabase.auth.mfa.listFactors()
    const stale = existing?.all.filter((f) => f.factor_type === 'totp' && f.status === 'unverified') ?? []
    for (const f of stale) {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
    const { data, error: enrollErr } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    setBusy(false)
    if (enrollErr || !data) {
      setError(enrollErr?.message ?? 'Could not start setup. Try again.')
      return
    }
    setFactorId(data.id)
    setQrCode(data.totp.qr_code)
    setSecret(data.totp.secret)
    setStatus('enrolling')
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault()
    if (code.length < 6) return
    setBusy(true)
    setError('')
    const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeErr || !challenge) {
      setBusy(false)
      setError(challengeErr?.message ?? 'Something went wrong. Try again.')
      return
    }
    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId, challengeId: challenge.id, code: code.trim(),
    })
    setBusy(false)
    if (verifyErr) {
      setError('Incorrect code. Try again.')
      return
    }
    setCode('')
    setStatus('on')
  }

  async function turnOff() {
    if (!confirm('Turn off two-factor authentication? You\'ll only need your password to sign in.')) return
    setBusy(true)
    await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    setFactorId('')
    setStatus('off')
  }

  function cancelEnroll() {
    setStatus('off')
    setCode('')
    setError('')
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '0.95rem' }}>Two-factor authentication</p>
      <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
        Add a code from an authenticator app (like Google Authenticator, Authy, or 1Password) as a second step when signing in.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

      {status === 'loading' && (
        <div style={{ textAlign: 'center', padding: '1rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
        </div>
      )}

      {status === 'off' && (
        <button className="btn btn-primary" onClick={startEnroll} disabled={busy}>
          {busy ? <span className="spinner" /> : 'Enable two-factor authentication'}
        </button>
      )}

      {status === 'on' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="badge badge-sage">Enabled</span>
          <button className="btn btn-ghost" onClick={turnOff} disabled={busy} style={{ fontSize: '0.85rem' }}>
            {busy ? <span className="spinner" /> : 'Turn off'}
          </button>
        </div>
      )}

      {status === 'enrolling' && (
        <div>
          <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            Scan this code with your authenticator app:
          </p>
          {qrCode && (
            <div style={{ background: '#fff', borderRadius: 8, padding: '1rem', display: 'inline-block', marginBottom: '0.75rem' }}>
              <img src={qrCode} alt="Scan with your authenticator app" width={180} height={180} />
            </div>
          )}
          <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
            Can't scan it? Enter this code manually: <code style={{ wordBreak: 'break-all' }}>{secret}</code>
          </p>
          <form onSubmit={confirmEnroll} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label htmlFor="mfa-enroll-code" style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
              Then enter the 6-digit code it shows:
            </label>
            <MfaCodeInput value={code} onChange={setCode} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-ghost" onClick={cancelEnroll} style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy || code.length < 6} style={{ flex: 2 }}>
                {busy ? <span className="spinner" /> : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function ChangePasswordCard() {
  const { user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setError('')
    setSaved(false)
    if (!currentPassword) { setError('Enter your current password.'); return }
    if (newPassword.length < 6) { setError('New password must be at least 6 characters.'); return }
    if (newPassword !== confirmPassword) { setError('New passwords don\'t match.'); return }
    if (!user?.email) { setError('Could not confirm your account. Try signing in again.'); return }

    setSaving(true)
    // Verifying the current password re-authenticates against it directly —
    // there's no separate "check password" call, and this keeps the session
    // alive rather than signing the user out to test it.
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
    if (verifyErr) {
      setSaving(false)
      setError('Current password is incorrect.')
      return
    }
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
    setSaving(false)
    if (updateErr) { setError(updateErr.message); return }
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    setSaved(true)
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '0.95rem' }}>Change password</p>
      <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
        Update the password you use to sign in.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</div>}
      {saved && <div className="alert alert-success" style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>Password updated.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div className="field">
          <label htmlFor="current-password">Current password</label>
          <input id="current-password" type="password" className="input" autoComplete="current-password"
            value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input id="new-password" type="password" className="input" autoComplete="new-password"
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirm new password</label>
          <input id="confirm-password" type="password" className="input" autoComplete="new-password"
            value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}
          style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}>
          {saving ? <span className="spinner" /> : 'Update password'}
        </button>
      </div>
    </div>
  )
}

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
          <SettingsIcon size={20} /> Settings
        </h1>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '1rem' }}>
        <ChangePasswordCard />
        <ContactNumberCard />
        <NotificationsCard />
        <TwoFactorCard />

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

        <InstallCard />
        <UpdatesCard />
        <LinksCard />
      </div>
    </div>
  )
}
