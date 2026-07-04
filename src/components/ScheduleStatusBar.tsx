import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useClientId } from '../hooks/useClientId'
import { CATEGORY_META, toLocalDateStr, timeToMinutes, formatTimeRange, formatCountdown, findCurrentAndNext } from '../lib/schedule'
import type { ScheduleItem } from '../types/database'
import { CATEGORY_ICONS } from './icons'

/**
 * Persistent "what's on now / what's next" strip — shown on every page in the
 * recipient's app shell (Journal, Notices, Help; the Schedule page has its
 * own richer version of the same thing). Recipient-only: family/coordinators
 * already see full schedule context on the Schedule page itself, so this
 * following-you-everywhere banner would just be noise for them.
 */
export default function ScheduleStatusBar() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { clientId } = useClientId()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const isRecipient = profile?.role === 'recipient'

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
    enabled: !!clientId && isRecipient,
  })

  if (!isRecipient || !clientId || items.length === 0) return null

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
