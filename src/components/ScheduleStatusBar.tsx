import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useClientId } from '../hooks/useClientId'
import { useTimerTheme } from '../hooks/useTimerTheme'
import { CATEGORY_META, toLocalDateStr, timeToMinutes, formatTimeRange, formatCountdown, findCurrentAndNext } from '../lib/schedule'
import { formatDuration } from '../lib/timer'
import type { ScheduleItem, ActiveTimer } from '../types/database'
import { CATEGORY_ICONS, TimerIcon } from './icons'

/**
 * Persistent "what's on now / what's next" strip — shown on every page in the
 * recipient's app shell (Journal, Schedule, Notices, Help). Recipient-only:
 * family/coordinators already see full schedule context on the Schedule
 * page itself, so this following-you-everywhere banner would just be noise
 * for them. A running timer takes priority over schedule info, since it's
 * the more immediate thing the recipient started themselves — and it's the
 * whole reason this needs to follow them off the Timer page in the first
 * place.
 */
export default function ScheduleStatusBar({ timerOnly = false }: { timerOnly?: boolean } = {}) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { clientId } = useClientId()
  const { theme } = useTimerTheme()
  const [now, setNow] = useState(() => Date.now())

  const isRecipient = profile?.role === 'recipient'

  const { data: activeTimer } = useQuery({
    queryKey: ['active-timer', clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('active_timers').select('*').eq('client_id', clientId!).maybeSingle()
      if (error) throw error
      return data as ActiveTimer | null
    },
    enabled: !!clientId && isRecipient,
    refetchInterval: 8_000,
  })

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), activeTimer ? 1_000 : 30_000)
    return () => clearInterval(id)
  }, [activeTimer?.id])

  const { data: items = [] } = useQuery({
    queryKey: ['schedule-items', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_items')
        .select('*')
        .eq('client_id', clientId!)
        .eq('active', true)
      if (error) throw error
      return data as ScheduleItem[]
    },
    enabled: !!clientId && isRecipient && !timerOnly,
  })

  if (!isRecipient || !clientId) return null

  const endsAtMs = activeTimer ? new Date(activeTimer.ends_at).getTime() : null
  const remainingMs = endsAtMs ? Math.max(0, endsAtMs - now) : 0
  const timerRunning = !!activeTimer && remainingMs > 0

  if (timerRunning) {
    return (
      <button
        onClick={() => navigate('/family/timer')}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.65rem', width: '100%', textAlign: 'left',
          padding: '0.55rem 1rem', cursor: 'pointer', border: 'none',
          borderBottom: `1px solid color-mix(in srgb, ${theme.diskColors[0]} 30%, transparent)`,
          background: `linear-gradient(90deg, color-mix(in srgb, ${theme.diskColors[0]} 16%, var(--color-bg)), var(--color-bg))`,
        }}
      >
        <span className="avatar avatar-sm" style={{ background: theme.diskColors[0] }}><TimerIcon size={14} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className="chip" style={{ padding: 0, background: 'none', color: theme.diskColors[1] }}>
            <span className="chip-dot" style={{ color: theme.diskColors[0] }} />
            Timer running
          </span>
          <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeTimer.label} · {formatDuration(remainingMs / 1000)} left
          </p>
        </div>
      </button>
    )
  }

  if (timerOnly || items.length === 0) return null

  const todayStr = toLocalDateStr(new Date())
  const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const { current, next } = findCurrentAndNext(items, todayStr, nowMinutes)
  const item = current ?? next
  if (!item) return null

  const meta = CATEGORY_META[item.category]
  const Icon = CATEGORY_ICONS[item.category]
  const isCurrent = !!current

  return (
    <button
      onClick={() => navigate('/family/schedule')}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.65rem', width: '100%', textAlign: 'left',
        padding: '0.55rem 1rem', cursor: 'pointer', border: 'none',
        borderBottom: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)`,
        background: `linear-gradient(90deg, color-mix(in srgb, ${meta.color} 14%, var(--color-bg)), var(--color-bg))`,
      }}
    >
      <span className="avatar avatar-sm" style={{ background: meta.color }}><Icon size={14} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <span className="chip" style={{ padding: 0, background: 'none', color: meta.color, marginBottom: 1 }}>
          {isCurrent && <span className="chip-dot" />}
          {isCurrent ? 'Happening now' : 'Up next'}
        </span>
        <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title} · {formatTimeRange(item.start_time, item.end_time)}
          {!isCurrent && ` · ${formatCountdown(nowMinutes, timeToMinutes(item.start_time))}`}
        </p>
      </div>
    </button>
  )
}
