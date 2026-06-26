export function moodEmoji(score: number) {
  if (score < 20) return '😔'
  if (score < 40) return '😕'
  if (score < 60) return '😐'
  if (score < 80) return '🙂'
  return '😊'
}

export function moodColor(score: number) {
  if (score < 25) return '#ef4444'
  if (score < 50) return '#f59e0b'
  if (score < 75) return '#84cc16'
  return '#22c55e'
}

export function MoodBar({ score }: { score: number | null | undefined }) {
  if (score == null) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.4rem' }}>
      <span style={{ fontSize: '0.8rem' }}>{moodEmoji(score)}</span>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--color-border)' }}>
        <div style={{ width: `${score}%`, height: '100%', borderRadius: 2, background: moodColor(score), transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)', width: 24, textAlign: 'right' }}>{score}</span>
    </div>
  )
}

export default function MoodSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
        <label style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Mood rating</label>
        <span style={{ fontSize: '0.9rem' }}>{moodEmoji(value)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.85rem' }}>😔</span>
        <input
          type="range"
          min={0} max={100} step={1}
          value={value}
          onChange={(e) => onChange(+e.target.value)}
          style={{
            flex: 1, height: 4, borderRadius: 2, cursor: 'pointer',
            accentColor: moodColor(value),
          }}
        />
        <span style={{ fontSize: '0.85rem' }}>😊</span>
      </div>
    </div>
  )
}
