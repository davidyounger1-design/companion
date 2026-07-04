import { CATEGORY_META, formatTimeRange, formatCountdown, timeToMinutes, itemDiskFraction } from '../lib/schedule'
import { CATEGORY_ICONS } from './icons'
import type { ScheduleItem } from '../types/database'
import type { TimerTheme } from '../lib/timer'

/** The "happening now / up next" hero — a dark gradient card tinted by the
 * item's category, with a countdown ring and a live status chip. Shared by
 * the Schedule page (full size) and the Timer page's "what's coming up"
 * section (compact), so the same activity reads identically everywhere. */
export default function UpNextHero({
  item, isCurrent, nowMinutes, theme, compact = false,
}: {
  item: ScheduleItem
  isCurrent: boolean
  nowMinutes: number
  theme: TimerTheme
  compact?: boolean
}) {
  const meta = CATEGORY_META[item.category]
  const Icon = CATEGORY_ICONS[item.category]
  const fraction = itemDiskFraction(item, isCurrent, nowMinutes)
  const ringSize = compact ? 48 : 58
  const minutesLeft = item.end_time ? Math.max(0, timeToMinutes(item.end_time) - nowMinutes) : null

  return (
    <div style={{
      position: 'relative', overflow: 'hidden', borderRadius: compact ? 20 : 24,
      padding: compact ? '0.9rem 1rem' : '1.15rem 1.3rem',
      background: `radial-gradient(circle at 100% 0%, color-mix(in srgb, ${meta.color} 38%, transparent), transparent 55%), `
        + `radial-gradient(circle at 0% 100%, color-mix(in srgb, ${meta.color} 28%, transparent), transparent 60%), #263229`,
      color: '#fff',
      boxShadow: '0 18px 30px -16px rgba(20,26,22,.55)',
    }}>
      {theme.particles.map((p, i) => (
        <span key={i} aria-hidden style={{
          position: 'absolute', right: `${8 + i * 22}%`, top: i % 2 === 0 ? 6 : 'auto', bottom: i % 2 === 1 ? 6 : 'auto',
          fontSize: '1.05rem', opacity: 0.5,
        }}>{p}</span>
      ))}

      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.68rem', fontWeight: 700,
        background: 'rgba(255,255,255,.16)', padding: '0.28rem 0.6rem 0.28rem 0.5rem', borderRadius: 99,
        marginBottom: compact ? '0.6rem' : '0.8rem',
      }}>
        {isCurrent && (
          <span aria-hidden style={{
            width: 6, height: 6, borderRadius: '50%', background: '#8fd9a0',
            boxShadow: '0 0 0 0 rgba(143,217,160,.6)', animation: 'up-next-pulse 1.8s ease-in-out infinite',
          }} />
        )}
        {isCurrent ? 'Happening now' : 'Up next'}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? '0.65rem' : '0.85rem' }}>
        <div style={{
          position: 'relative', width: ringSize, height: ringSize, borderRadius: '50%', flexShrink: 0,
          background: `conic-gradient(#f4c542 ${fraction}turn, rgba(255,255,255,.18) ${fraction}turn)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            position: 'absolute', inset: 5, borderRadius: '50%', background: '#263229',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={compact ? 18 : 22} />
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <p className="font-display-round" style={{ margin: 0, fontWeight: 800, fontSize: compact ? '1.02rem' : '1.15rem', letterSpacing: '-0.01em' }}>
            {item.title}
          </p>
          <p style={{ margin: '0.1rem 0 0', fontSize: compact ? '0.78rem' : '0.82rem', color: 'rgba(255,255,255,.72)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTimeRange(item.start_time, item.end_time)}
            {isCurrent && minutesLeft != null && ` · ${minutesLeft}m left`}
            {!isCurrent && ` · ${formatCountdown(nowMinutes, timeToMinutes(item.start_time))}`}
          </p>
        </div>
      </div>

      <style>{`@keyframes up-next-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(143,217,160,.55); } 50% { box-shadow: 0 0 0 5px rgba(143,217,160,0); } }`}</style>
    </div>
  )
}
