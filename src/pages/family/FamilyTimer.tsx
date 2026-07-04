import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { useClientId } from '../../hooks/useClientId'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import { useTimerTheme } from '../../hooks/useTimerTheme'
import FamilyBottomNav from '../../components/FamilyBottomNav'
import { MobileFooter } from '../../components/SiteFooter'
import SegmentedControl from '../../components/SegmentedControl'
import UpNextHero from '../../components/UpNextHero'
import { TimerIcon, BackIcon } from '../../components/icons'
import { toLocalDateStr, findCurrentAndNext } from '../../lib/schedule'
import {
  MAX_DIAL_MINUTES, QUICK_PICKS, pieSlicePath, angleToMinutes, formatDuration,
  playChime, vibrate, getTheme, themedPageBackground,
} from '../../lib/timer'
import type { ScheduleItem, ActiveTimer } from '../../types/database'

const DISK_SIZE = 260
const DISK_R = 118
const DISK_C = DISK_SIZE / 2
const DISPLAY_KEY = 'companion_timer_display'

export default function FamilyTimer() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const { clientId } = useClientId()
  const { permission, subscribing, subscribe } = usePushNotifications()
  const qc = useQueryClient()

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // ── Section A: always-on schedule countdown ──────────────────────
  const { data: items = [] } = useQuery({
    queryKey: ['schedule-items', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_items').select('*').eq('client_id', clientId!).eq('active', true)
      if (error) throw error
      return data as ScheduleItem[]
    },
    enabled: !!clientId,
  })
  const todayStr = toLocalDateStr(new Date())
  const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const { current, next } = findCurrentAndNext(items, todayStr, nowMinutes)
  const upcomingItem = current ?? next

  // ── Section B: shared timer, backed by active_timers ──────────────
  const { data: activeTimer, isLoading: timerLoading } = useQuery({
    queryKey: ['active-timer', clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('active_timers').select('*').eq('client_id', clientId!).maybeSingle()
      if (error) throw error
      return data as ActiveTimer | null
    },
    enabled: !!clientId,
    refetchInterval: 8_000,
  })

  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    if (!activeTimer) return
    const id = setInterval(() => setTick(Date.now()), 200)
    return () => clearInterval(id)
  }, [activeTimer?.id])

  const endsAtMs = activeTimer ? new Date(activeTimer.ends_at).getTime() : null
  const startedAtMs = activeTimer ? new Date(activeTimer.created_at).getTime() : null
  const remainingMs = endsAtMs ? Math.max(0, endsAtMs - tick) : 0
  const totalMs = endsAtMs && startedAtMs ? Math.max(1, endsAtMs - startedAtMs) : 1
  const isDone = !!activeTimer && remainingMs <= 0

  const firedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (activeTimer && isDone && firedForRef.current !== activeTimer.id) {
      firedForRef.current = activeTimer.id
      playChime()
      vibrate([200, 100, 200, 100, 400])
    }
  }, [activeTimer, isDone])

  // ── Personalisation — device-local, not shared ─────────────────────
  const [displayMode, setDisplayMode] = useState<'analog' | 'digital'>(
    () => (localStorage.getItem(DISPLAY_KEY) as 'analog' | 'digital') ?? 'analog',
  )
  useEffect(() => localStorage.setItem(DISPLAY_KEY, displayMode), [displayMode])
  const { theme } = useTimerTheme()

  // ── Setup form (only relevant when nothing is running) ─────────────
  const [label, setLabel] = useState('Timer')
  const [durationMinutes, setDurationMinutes] = useState(10)
  const [wantsBackgroundAlert, setWantsBackgroundAlert] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [starting, setStarting] = useState(false)
  const diskRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const qMinutes = Number(searchParams.get('minutes'))
    const qLabel = searchParams.get('label')
    if (qMinutes > 0) setDurationMinutes(Math.min(MAX_DIAL_MINUTES, qMinutes))
    if (qLabel) setLabel(qLabel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function minutesFromPointer(clientX: number, clientY: number) {
    const svg = diskRef.current
    if (!svg) return durationMinutes
    const rect = svg.getBoundingClientRect()
    const scale = DISK_SIZE / rect.width
    return angleToMinutes(DISK_C, DISK_C, (clientX - rect.left) * scale, (clientY - rect.top) * scale)
  }
  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    setDragging(true)
    setDurationMinutes(minutesFromPointer(e.clientX, e.clientY))
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragging) return
    setDurationMinutes(minutesFromPointer(e.clientX, e.clientY))
  }

  async function startTimer() {
    if (!clientId || !user || !profile?.org_id || durationMinutes <= 0) return
    setStarting(true)
    const endsAt = new Date(Date.now() + durationMinutes * 60_000).toISOString()

    await supabase.from('active_timers').upsert({
      client_id: clientId, org_id: profile.org_id, created_by: user.id, label, ends_at: endsAt,
    }, { onConflict: 'client_id' })

    if (wantsBackgroundAlert) {
      if (permission !== 'granted') await subscribe()
      await supabase.from('timer_alerts').insert({ user_id: user.id, org_id: profile.org_id, label, fires_at: endsAt })
    }

    firedForRef.current = null
    setStarting(false)
    qc.invalidateQueries({ queryKey: ['active-timer', clientId] })
  }

  async function cancelTimer() {
    if (!clientId || !user) return
    if (activeTimer) {
      // Best-effort: remove any pending background alert tied to this timer's end time.
      await supabase.from('timer_alerts').delete().eq('user_id', user.id).eq('fires_at', activeTimer.ends_at)
    }
    await supabase.from('active_timers').delete().eq('client_id', clientId)
    qc.invalidateQueries({ queryKey: ['active-timer', clientId] })
  }

  const diskFraction = activeTimer ? remainingMs / totalMs : durationMinutes / MAX_DIAL_MINUTES

  return (
    <div style={{ minHeight: '100dvh', background: themedPageBackground(theme), paddingBottom: 'calc(56px + var(--safe-bottom))' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: themedPageBackground(theme) }}>
      <div style={{
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)',
      }}>
        <button className="icon-btn" aria-label="Back" onClick={() => navigate('/family')}><BackIcon /></button>
        <h1 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <TimerIcon size={20} /> Timer
        </h1>
      </div>

      {/* ── Section A: what's coming up ─────────────────────────── */}
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0.75rem 1rem 0' }}>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>
          What's coming up
        </p>
        {upcomingItem ? (
          <div style={{ marginBottom: '0.75rem' }}>
            <UpNextHero item={upcomingItem} isCurrent={!!current} nowMinutes={nowMinutes} theme={theme} compact />
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>Nothing else scheduled for today.</p>
        )}
      </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0.75rem 1rem 1.25rem' }}>
        <div className="divider" />

        {/* ── Section B: my timer ─────────────────────────────────── */}
        <p style={{ margin: '1rem 0 0.75rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-muted)' }}>
          My timer
        </p>

        {timerLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <div className="spinner" style={{ color: 'var(--color-primary)' }} />
          </div>
        ) : activeTimer ? (
          <RunningTimer
            activeTimer={activeTimer}
            isDone={isDone}
            remainingMs={remainingMs}
            diskFraction={diskFraction}
            displayMode={displayMode}
            theme={theme}
            onCancel={cancelTimer}
          />
        ) : (
          <TimerSetup
            label={label} setLabel={setLabel}
            durationMinutes={durationMinutes} setDurationMinutes={setDurationMinutes}
            displayMode={displayMode} setDisplayMode={setDisplayMode}
            theme={theme}
            diskFraction={diskFraction}
            diskRef={diskRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={() => setDragging(false)}
            wantsBackgroundAlert={wantsBackgroundAlert}
            setWantsBackgroundAlert={setWantsBackgroundAlert}
            pushPermission={permission}
            subscribing={subscribing}
            starting={starting}
            onStart={startTimer}
          />
        )}

        <MobileFooter />
      </div>

      <FamilyBottomNav />
    </div>
  )
}

function ThemedDisk({ fraction, theme, big, children }: {
  fraction: number; theme: ReturnType<typeof getTheme>; big?: boolean; children?: React.ReactNode
}) {
  const size = DISK_SIZE
  const c = DISK_C
  const r = DISK_R
  const gradId = `timer-grad-${theme.id}`
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {theme.particles.map((p, i) => {
        const angle = (i / theme.particles.length) * 360
        const dist = size / 2 + 18
        const x = 50 + (dist / size) * 100 * Math.cos((angle - 90) * Math.PI / 180)
        const y = 50 + (dist / size) * 100 * Math.sin((angle - 90) * Math.PI / 180)
        return (
          <span key={i} style={{
            position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)',
            fontSize: '1.4rem', animation: `timer-float 3s ease-in-out ${i * 0.4}s infinite`,
          }}>{p}</span>
        )
      })}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={theme.diskColors[0]} />
            <stop offset="100%" stopColor={theme.diskColors[1]} />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth={2} />
        {Array.from({ length: 12 }, (_, i) => {
          const angle = (i * 30 - 90) * (Math.PI / 180)
          const x1 = c + (r - 6) * Math.cos(angle), y1 = c + (r - 6) * Math.sin(angle)
          const x2 = c + r * Math.cos(angle), y2 = c + r * Math.sin(angle)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-muted)" strokeWidth={1.5} opacity={0.35} />
        })}
        {fraction > 0.001 && <path d={pieSlicePath(c, c, r - 3, fraction)} fill={`url(#${gradId})`} opacity={0.9} />}
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-border)" strokeWidth={2} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: big ? 34 : 30, fontWeight: 700, color: '#fff', mixBlendMode: 'difference', textAlign: 'center', padding: '0 1rem',
      }}>
        {children}
      </div>
      <style>{`@keyframes timer-float { 0%,100% { transform: translate(-50%,-50%) translateY(0); opacity: 0.85; } 50% { transform: translate(-50%,-50%) translateY(-8px); opacity: 1; } }`}</style>
    </div>
  )
}

function DigitalDisplay({ remainingMs, theme, label }: { remainingMs: number; theme: ReturnType<typeof getTheme>; label: string }) {
  return (
    <div style={{ position: 'relative', textAlign: 'center' }}>
      {theme.particles.map((p, i) => (
        <span key={i} style={{
          position: 'absolute', left: `${10 + i * 22}%`, top: i % 2 === 0 ? '-10px' : 'auto', bottom: i % 2 === 1 ? '-10px' : 'auto',
          fontSize: '1.4rem', animation: `timer-float 3s ease-in-out ${i * 0.4}s infinite`,
        }}>{p}</span>
      ))}
      <div style={{
        borderRadius: 24, padding: '2rem 1.5rem',
        background: `linear-gradient(135deg, ${theme.diskColors[0]}, ${theme.diskColors[1]})`,
        boxShadow: 'var(--shadow-lg)',
      }}>
        <p style={{ margin: '0 0 0.4rem', fontSize: '0.85rem', fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{label}</p>
        <p style={{ margin: 0, fontSize: '3rem', fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>
          {formatDuration(remainingMs / 1000)}
        </p>
      </div>
      <style>{`@keyframes timer-float { 0%,100% { transform: translateY(0); opacity: 0.85; } 50% { transform: translateY(-8px); opacity: 1; } }`}</style>
    </div>
  )
}

function RunningTimer({
  activeTimer, isDone, remainingMs, diskFraction, displayMode, theme, onCancel,
}: {
  activeTimer: ActiveTimer
  isDone: boolean
  remainingMs: number
  diskFraction: number
  displayMode: 'analog' | 'digital'
  theme: ReturnType<typeof getTheme>
  onCancel: () => void
}) {
  return (
    <div className="card" style={{
      textAlign: 'center', padding: '1.5rem 1rem',
      background: `linear-gradient(160deg, color-mix(in srgb, ${theme.bgColors[0]} 25%, var(--color-surface)), var(--color-surface))`,
    }}>
      {isDone ? (
        <>
          <p style={{ fontSize: '3rem', margin: '0 0 0.5rem', animation: 'timer-pulse 1s ease-in-out infinite' }}>{theme.doneEmoji}</p>
          <p style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 1.25rem' }}>{theme.doneMessage}</p>
        </>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
          {displayMode === 'analog'
            ? <ThemedDisk fraction={diskFraction} theme={theme}>{formatDuration(remainingMs / 1000)}</ThemedDisk>
            : <DigitalDisplay remainingMs={remainingMs} theme={theme} label={activeTimer.label} />}
        </div>
      )}
      {displayMode === 'analog' && !isDone && (
        <p style={{ fontWeight: 700, fontSize: '1.05rem', margin: '0 0 1.25rem' }}>{activeTimer.label}</p>
      )}
      <button className="btn btn-ghost" onClick={onCancel} style={{ width: '100%', maxWidth: 280 }}>
        {isDone ? 'New timer' : 'Cancel'}
      </button>
      <style>{`@keyframes timer-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.12); } }`}</style>
    </div>
  )
}

function TimerSetup({
  label, setLabel, durationMinutes, setDurationMinutes, displayMode, setDisplayMode,
  theme, diskFraction, diskRef, onPointerDown, onPointerMove, onPointerUp,
  wantsBackgroundAlert, setWantsBackgroundAlert, pushPermission, subscribing, starting, onStart,
}: {
  label: string; setLabel: (v: string) => void
  durationMinutes: number; setDurationMinutes: (v: number) => void
  displayMode: 'analog' | 'digital'; setDisplayMode: (v: 'analog' | 'digital') => void
  theme: ReturnType<typeof getTheme>
  diskFraction: number
  diskRef: React.RefObject<SVGSVGElement | null>
  onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void
  onPointerUp: () => void
  wantsBackgroundAlert: boolean; setWantsBackgroundAlert: (v: boolean) => void
  pushPermission: string
  subscribing: boolean
  starting: boolean
  onStart: () => void
}) {
  return (
    <div className="card" style={{
      textAlign: 'center', padding: '1.5rem 1rem',
      background: `linear-gradient(160deg, color-mix(in srgb, ${theme.bgColors[0]} 18%, var(--color-surface)), var(--color-surface))`,
    }}>
      <input
        className="input"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="What's this timer for?"
        style={{ textAlign: 'center', fontWeight: 600, marginBottom: '1.25rem', maxWidth: 280 }}
      />

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
        {displayMode === 'analog' ? (
          <svg
            ref={diskRef}
            viewBox={`0 0 ${DISK_SIZE} ${DISK_SIZE}`} width={DISK_SIZE} height={DISK_SIZE}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            style={{ touchAction: 'none', cursor: 'grab' }}
          >
            <defs>
              <linearGradient id={`setup-grad-${theme.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={theme.diskColors[0]} />
                <stop offset="100%" stopColor={theme.diskColors[1]} />
              </linearGradient>
            </defs>
            <circle cx={DISK_C} cy={DISK_C} r={DISK_R} fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth={2} />
            {Array.from({ length: 12 }, (_, i) => {
              const angle = (i * 30 - 90) * (Math.PI / 180)
              const x1 = DISK_C + (DISK_R - 6) * Math.cos(angle), y1 = DISK_C + (DISK_R - 6) * Math.sin(angle)
              const x2 = DISK_C + DISK_R * Math.cos(angle), y2 = DISK_C + DISK_R * Math.sin(angle)
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-muted)" strokeWidth={1.5} opacity={0.4} />
            })}
            {diskFraction > 0.001 && <path d={pieSlicePath(DISK_C, DISK_C, DISK_R - 3, diskFraction)} fill={`url(#setup-grad-${theme.id})`} opacity={0.85} />}
            <circle cx={DISK_C} cy={DISK_C} r={DISK_R} fill="none" stroke="var(--color-border)" strokeWidth={2} />
            <text x={DISK_C} y={DISK_C + 8} textAnchor="middle" fontSize={30} fontWeight={700} fill="var(--color-ink)">
              {durationMinutes} min
            </text>
          </svg>
        ) : (
          <div style={{
            borderRadius: 24, padding: '2rem 2.5rem',
            background: `linear-gradient(135deg, ${theme.diskColors[0]}, ${theme.diskColors[1]})`,
            boxShadow: 'var(--shadow-lg)',
          }}>
            <p style={{ margin: 0, fontSize: '3rem', fontWeight: 800, color: '#fff' }}>{durationMinutes} min</p>
          </div>
        )}
      </div>

      <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: '0 0 0.75rem' }}>
        {displayMode === 'analog' ? 'Drag the dial, or pick a time' : 'Pick a time'}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginBottom: '1.25rem' }}>
        {QUICK_PICKS.map((m) => (
          <button key={m} onClick={() => setDurationMinutes(m)} style={{
            padding: '0.5rem 0.9rem', borderRadius: 99, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
            border: `2px solid ${durationMinutes === m ? theme.diskColors[0] : 'transparent'}`,
            background: `color-mix(in srgb, ${theme.diskColors[0]} ${durationMinutes === m ? 28 : 15}%, transparent)`,
            color: 'var(--color-ink)',
          }}>{m} min</button>
        ))}
      </div>

      {/* Clock face / digital toggle */}
      <div style={{ marginBottom: '1.25rem' }}>
        <p style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-muted)', margin: '0 0 0.5rem' }}>Clock style</p>
        <SegmentedControl
          value={displayMode}
          onChange={setDisplayMode}
          options={[{ value: 'analog', label: '🕐 Clock face' }, { value: 'digital', label: '🔢 Digital' }]}
        />
      </div>

      {(pushPermission === 'granted' || pushPermission === 'default') && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '1.25rem', cursor: 'pointer', justifyContent: 'center' }}>
          <input type="checkbox" checked={wantsBackgroundAlert} onChange={(e) => setWantsBackgroundAlert(e.target.checked)} />
          🔔 Alert me even if I close the app
        </label>
      )}

      <button className="btn btn-primary" onClick={onStart} disabled={subscribing || starting} style={{ width: '100%', maxWidth: 280 }}>
        {subscribing || starting ? <span className="spinner" /> : 'Start'}
      </button>
    </div>
  )
}
