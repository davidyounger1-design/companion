import type { BehaviourNote } from '../types/database'

// Minimal inline SVG line chart — mood_after (falling back to mood_before)
// plotted oldest → newest. No charting library needed for five points on a scale of 1-5.
export default function MoodTrendChart({ notes }: { notes: BehaviourNote[] }) {
  const points = notes
    .filter((n) => n.mood_after != null || n.mood_before != null)
    .slice()
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())

  if (points.length < 2) {
    return (
      <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', textAlign: 'center', padding: '1.5rem 0' }}>
        Not enough mood data yet to show a trend.
      </p>
    )
  }

  const w = 100
  const h = 36
  const scores = points.map((n) => (n.mood_after ?? n.mood_before)!)
  const coords = scores.map((s, i) => {
    const x = points.length === 1 ? w / 2 : (i / (points.length - 1)) * w
    const y = h - ((s - 1) / 4) * h
    return `${x},${y}`
  })

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 100, display: 'block' }}>
        <polyline
          points={coords.join(' ')}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {coords.map((c, i) => {
          const [x, y] = c.split(',').map(Number)
          return <circle key={i} cx={x} cy={y} r={1.6} fill="var(--color-primary)" />
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--color-muted)', marginTop: '0.25rem' }}>
        <span>{new Date(points[0].occurred_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
        <span>{new Date(points[points.length - 1].occurred_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
      </div>
    </div>
  )
}
