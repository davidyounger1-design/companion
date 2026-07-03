import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import FamilyBottomNav from '../../components/FamilyBottomNav'
import { MobileFooter } from '../../components/SiteFooter'
import {
  MAX_DIAL_MINUTES, QUICK_PICKS, pieSlicePath, angleToMinutes,
  formatDuration, playChime, vibrate,
} from '../../lib/timer'

const QUICK_PICK_COLORS = [
  'var(--color-sage)', 'var(--color-amber)', 'var(--color-terracotta)',
  'var(--color-sky)', 'var(--color-lavender)', 'var(--color-rose)',
  'var(--color-sage-deep)', 'var(--color-primary)',
]

type Phase = 'setup' | 'running' | 'paused' | 'done'
type StoredState = { endAt: number; durationMinutes: number; label: string; alertId: string | null }

const STORAGE_KEY = 'companion_timer_state'
const DISK_SIZE = 260
const DISK_R = 118
const DISK_C = DISK_SIZE / 2

export default function FamilyTimer() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const { permission, subscribing, subscribe } = usePushNotifications()

  const [phase, setPhase] = useState<Phase>('setup')
  const [durationMinutes, setDurationMinutes] = useState(10)
  const [label, setLabel] = useState('Timer')
  const [endAt, setEndAt] = useState<number | null>(null)
  const [pausedRemainingMs, setPausedRemainingMs] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [wantsBackgroundAlert, setWantsBackgroundAlert] = useState(false)
  const [alertId, setAlertId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const diskRef = useRef<SVGSVGElement>(null)
  const firedRef = useRef(false)

  // Restore an in-flight timer, or prefill from ?minutes=&label= (e.g. from a schedule item).
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const stored = JSON.parse(raw) as StoredState
        if (stored.endAt > Date.now()) {
          setDurationMinutes(stored.durationMinutes)
          setLabel(stored.label)
          setEndAt(stored.endAt)
          setAlertId(stored.alertId)
          setPhase('running')
          return
        }
      } catch { /* ignore malformed state */ }
      localStorage.removeItem(STORAGE_KEY)
    }

    const qMinutes = Number(searchParams.get('minutes'))
    const qLabel = searchParams.get('label')
    if (qMinutes > 0) {
      setDurationMinutes(Math.min(MAX_DIAL_MINUTES, qMinutes))
      if (qLabel) setLabel(qLabel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick while running/paused-display; smooth enough for the disk without wasting cycles.
  useEffect(() => {
    if (phase !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [phase])

  const totalMs = durationMinutes * 60_000
  const remainingMs = phase === 'running' && endAt
    ? Math.max(0, endAt - now)
    : phase === 'paused' && pausedRemainingMs != null
    ? pausedRemainingMs
    : totalMs

  const displayFraction = phase === 'setup'
    ? durationMinutes / MAX_DIAL_MINUTES
    : remainingMs / 60 / 60_000 // remaining time expressed against the same 60-min face used in setup

  useEffect(() => {
    if (phase === 'running' && remainingMs <= 0 && !firedRef.current) {
      firedRef.current = true
      playChime()
      vibrate([200, 100, 200, 100, 400])
      setPhase('done')
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [phase, remainingMs])

  const clearBackgroundAlert = useCallback(async (id: string | null) => {
    if (id) await supabase.from('timer_alerts').delete().eq('id', id)
  }, [])

  function minutesFromPointer(clientX: number, clientY: number) {
    const svg = diskRef.current
    if (!svg) return durationMinutes
    const rect = svg.getBoundingClientRect()
    const scale = DISK_SIZE / rect.width
    const x = (clientX - rect.left) * scale
    const y = (clientY - rect.top) * scale
    return angleToMinutes(DISK_C, DISK_C, x, y)
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (phase !== 'setup') return
    setDragging(true)
    setDurationMinutes(minutesFromPointer(e.clientX, e.clientY))
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragging) return
    setDurationMinutes(minutesFromPointer(e.clientX, e.clientY))
  }
  function handlePointerUp() {
    setDragging(false)
  }

  async function startTimer() {
    if (durationMinutes <= 0) return
    firedRef.current = false
    const at = Date.now() + durationMinutes * 60_000

    let newAlertId: string | null = null
    if (wantsBackgroundAlert && user && profile?.org_id) {
      if (permission !== 'granted') await subscribe()
      const { data } = await supabase.from('timer_alerts').insert({
        user_id: user.id,
        org_id: profile.org_id,
        label,
        fires_at: new Date(at).toISOString(),
      }).select('id').single()
      newAlertId = data?.id ?? null
    }

    setAlertId(newAlertId)
    setEndAt(at)
    setPhase('running')
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ endAt: at, durationMinutes, label, alertId: newAlertId } satisfies StoredState))
  }

  function pauseTimer() {
    if (!endAt) return
    setPausedRemainingMs(Math.max(0, endAt - Date.now()))
    setPhase('paused')
    localStorage.removeItem(STORAGE_KEY)
  }

  function resumeTimer() {
    if (pausedRemainingMs == null) return
    const at = Date.now() + pausedRemainingMs
    setEndAt(at)
    setPhase('running')
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ endAt: at, durationMinutes, label, alertId } satisfies StoredState))
  }

  function resetTimer() {
    clearBackgroundAlert(alertId)
    localStorage.removeItem(STORAGE_KEY)
    setPhase('setup')
    setEndAt(null)
    setPausedRemainingMs(null)
    setAlertId(null)
    firedRef.current = false
  }

  const diskColor = phase === 'done' ? 'var(--color-terracotta)' : 'var(--color-primary)'

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: 'calc(56px + var(--safe-bottom))' }}>
      <div style={{
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate('/family')}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>⏱️ Timer</h1>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        {phase === 'setup' && (
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What's this timer for?"
            style={{ textAlign: 'center', fontWeight: 600, marginBottom: '1.5rem', maxWidth: 280 }}
          />
        )}
        {phase !== 'setup' && (
          <p style={{ fontWeight: 700, fontSize: '1.15rem', margin: '0 0 1rem', textAlign: 'center' }}>{label}</p>
        )}

        <svg
          ref={diskRef}
          viewBox={`0 0 ${DISK_SIZE} ${DISK_SIZE}`}
          width={DISK_SIZE} height={DISK_SIZE}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            touchAction: 'none', cursor: phase === 'setup' ? 'grab' : 'default',
            filter: phase === 'done' ? 'drop-shadow(0 0 18px color-mix(in srgb, var(--color-terracotta) 60%, transparent))' : undefined,
            animation: phase === 'done' ? 'timer-pulse 1s ease-in-out infinite' : undefined,
          }}
        >
          <circle cx={DISK_C} cy={DISK_C} r={DISK_R} fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth={2} />
          {/* Minute ticks around the 60-minute face */}
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i * 30 - 90) * (Math.PI / 180)
            const x1 = DISK_C + (DISK_R - 6) * Math.cos(angle)
            const y1 = DISK_C + (DISK_R - 6) * Math.sin(angle)
            const x2 = DISK_C + DISK_R * Math.cos(angle)
            const y2 = DISK_C + DISK_R * Math.sin(angle)
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-muted)" strokeWidth={1.5} opacity={0.4} />
          })}
          {displayFraction > 0.001 && (
            <path d={pieSlicePath(DISK_C, DISK_C, DISK_R - 3, displayFraction)} fill={diskColor} opacity={0.85} />
          )}
          <circle cx={DISK_C} cy={DISK_C} r={DISK_R} fill="none" stroke="var(--color-border)" strokeWidth={2} />
          <text x={DISK_C} y={DISK_C + 8} textAnchor="middle" fontSize={phase === 'setup' ? 30 : 34} fontWeight={700}
            fill={phase === 'setup' ? 'var(--color-ink)' : '#fff'} style={{ mixBlendMode: phase === 'setup' ? 'normal' : 'difference' }}>
            {phase === 'setup' ? `${durationMinutes} min` : phase === 'done' ? "Time's up!" : formatDuration(remainingMs / 1000)}
          </text>
        </svg>
        <style>{`@keyframes timer-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }`}</style>

        {phase === 'setup' && (
          <>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: '0.75rem 0 1rem' }}>Drag the dial, or pick a time</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginBottom: '1.5rem' }}>
              {QUICK_PICKS.map((m, i) => (
                <button key={m} onClick={() => setDurationMinutes(m)} style={{
                  padding: '0.5rem 0.9rem', borderRadius: 99, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                  border: `2px solid ${durationMinutes === m ? QUICK_PICK_COLORS[i % QUICK_PICK_COLORS.length] : 'transparent'}`,
                  background: `color-mix(in srgb, ${QUICK_PICK_COLORS[i % QUICK_PICK_COLORS.length]} ${durationMinutes === m ? 28 : 15}%, transparent)`,
                  color: 'var(--color-ink)',
                }}>{m} min</button>
              ))}
            </div>

            {(permission === 'granted' || permission === 'default') && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '1.25rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={wantsBackgroundAlert} onChange={(e) => setWantsBackgroundAlert(e.target.checked)} />
                🔔 Alert me even if I close the app
              </label>
            )}

            <button className="btn btn-primary" onClick={startTimer} disabled={subscribing} style={{ width: '100%', maxWidth: 280, fontSize: '1rem' }}>
              {subscribing ? <span className="spinner" /> : 'Start'}
            </button>
          </>
        )}

        {(phase === 'running' || phase === 'paused') && (
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', width: '100%', maxWidth: 280 }}>
            {phase === 'running'
              ? <button className="btn btn-ghost" onClick={pauseTimer} style={{ flex: 1 }}>Pause</button>
              : <button className="btn btn-primary" onClick={resumeTimer} style={{ flex: 1 }}>Resume</button>}
            <button className="btn btn-ghost" onClick={resetTimer} style={{ flex: 1 }}>Cancel</button>
          </div>
        )}

        {phase === 'done' && (
          <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
            <p style={{ fontSize: '1.5rem', margin: '0 0 1rem' }}>🎉 Great job!</p>
            <button className="btn btn-primary" onClick={resetTimer} style={{ width: '100%', maxWidth: 280 }}>New timer</button>
          </div>
        )}

        <MobileFooter />
      </div>

      <FamilyBottomNav />
    </div>
  )
}
