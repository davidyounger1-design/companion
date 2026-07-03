import { pieSlicePath } from '../lib/timer'

export default function MiniDisk({ fraction, color, size = 40 }: { fraction: number; color: string; size?: number }) {
  const c = size / 2
  const r = c - 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="var(--color-surface)" stroke={color} strokeWidth={1.5} opacity={0.5} />
      {fraction > 0.001 && <path d={pieSlicePath(c, c, r, fraction)} fill={color} />}
    </svg>
  )
}
