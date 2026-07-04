import { useLayoutEffect, useRef, useState } from 'react'

/** A pill toggle with a sliding highlight that follows the active option — used
 * anywhere a set of mutually-exclusive views/modes needs a single control
 * (schedule Day/Week, timer clock style, etc). */
export default function SegmentedControl<T extends string>({
  options, value, onChange, size = 'md',
}: {
  options: { value: T; label: React.ReactNode }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const active = container.querySelector<HTMLElement>('[data-active="true"]')
    if (!active) return
    setThumb({ left: active.offsetLeft, width: active.offsetWidth })
  }, [value, options.length])

  const pad = size === 'sm' ? '0.3rem 0.7rem' : '0.4rem 1rem'
  const fontSize = size === 'sm' ? '0.76rem' : '0.82rem'

  return (
    <div ref={containerRef} style={{
      position: 'relative', display: 'inline-flex', borderRadius: 99,
      background: 'color-mix(in srgb, var(--color-muted) 10%, transparent)', padding: 3,
    }}>
      {thumb && (
        <div style={{
          position: 'absolute', top: 3, bottom: 3, left: thumb.left, width: thumb.width,
          borderRadius: 99, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)',
          transition: 'transform .3s cubic-bezier(.34,1.35,.4,1), width .3s cubic-bezier(.34,1.35,.4,1)',
          transform: 'translateX(0)',
        }} />
      )}
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            data-active={active}
            onClick={() => onChange(opt.value)}
            style={{
              position: 'relative', zIndex: 1, padding: pad, borderRadius: 99, cursor: 'pointer',
              fontSize, fontWeight: 700, border: 'none', background: 'transparent',
              color: active ? 'var(--color-ink)' : 'var(--color-muted)',
              transition: 'color .2s',
            }}
          >{opt.label}</button>
        )
      })}
    </div>
  )
}
