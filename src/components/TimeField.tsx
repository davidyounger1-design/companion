import { useMemo } from 'react'

/**
 * A 5-minute-increment time picker that works on every platform.
 *
 * Native <input type="time"> ignores `step` for minutes on iOS/Android (the
 * OS wheel always shows every minute), so we render our own hour / minute /
 * AM-PM selects. Value is a 24-hour 'HH:MM' string (or '' when optional and
 * unset), matching what the schedule stores.
 */
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1))

function parse(value: string) {
  if (!value) return { h12: '', min: '', mer: 'AM' as 'AM' | 'PM' }
  const [hStr, mStr] = value.split(':')
  const h24 = parseInt(hStr, 10)
  return { h12: String(h24 % 12 || 12), min: mStr, mer: h24 >= 12 ? 'PM' : 'AM' as 'AM' | 'PM' }
}

function build(h12: string, min: string, mer: 'AM' | 'PM') {
  if (!h12 || !min) return ''
  let h = parseInt(h12, 10) % 12
  if (mer === 'PM') h += 12
  return `${String(h).padStart(2, '0')}:${min}`
}

const sel: React.CSSProperties = { flex: 1, minWidth: 0, paddingLeft: '0.6rem', paddingRight: '1.6rem', minHeight: 44 }

export default function TimeField({
  value, onChange, optional = false,
}: {
  value: string
  onChange: (v: string) => void
  optional?: boolean
}) {
  const { h12, min, mer } = parse(value)

  // Preserve a legacy off-grid minute (e.g. an old 09:03) so editing doesn't
  // silently shift it — it just shows as an extra option until changed.
  const minuteOptions = useMemo(
    () => (min && !MINUTES.includes(min) ? [min, ...MINUTES] : MINUTES),
    [min],
  )

  const noHour = !h12
  return (
    <div style={{ display: 'flex', gap: '0.4rem' }}>
      <select
        className="input" style={sel} value={h12}
        onChange={(e) => onChange(e.target.value ? build(e.target.value, min || '00', mer) : '')}
      >
        {optional && <option value="">--</option>}
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select
        className="input" style={sel} value={min} disabled={noHour}
        onChange={(e) => onChange(build(h12 || '12', e.target.value, mer))}
      >
        {noHour && <option value="">--</option>}
        {minuteOptions.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select
        className="input" style={sel} value={mer} disabled={noHour}
        onChange={(e) => onChange(build(h12 || '12', min || '00', e.target.value as 'AM' | 'PM'))}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}
