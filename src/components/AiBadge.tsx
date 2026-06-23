interface AiBadgeProps {
  reason: string
  variant?: 'inline' | 'header'
}

/**
 * Shown wherever AI generated or materially assisted content.
 * - variant="inline"  → small pill on an individual row
 * - variant="header"  → banner above a section where every entry is AI-generated
 */
export default function AiBadge({ reason, variant = 'inline' }: AiBadgeProps) {
  if (variant === 'header') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.6rem',
        padding: '0.65rem 0.9rem',
        borderRadius: 'var(--radius-md)',
        background: 'color-mix(in srgb, var(--color-amber) 12%, var(--color-surface))',
        border: '1px solid color-mix(in srgb, var(--color-amber) 30%, transparent)',
        marginBottom: '1rem',
      }}>
        <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '0.05rem' }}>✦</span>
        <div>
          <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, fontFamily: 'var(--font-ui)', color: 'var(--color-ink)', letterSpacing: '0.03em' }}>
            AI-GENERATED
          </p>
          <p style={{ margin: '0.1rem 0 0', fontSize: '0.8rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>
            {reason}
          </p>
        </div>
      </div>
    )
  }

  return (
    <span
      title={reason}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.2rem',
        fontSize: '0.7rem',
        fontWeight: 700,
        fontFamily: 'var(--font-ui)',
        letterSpacing: '0.04em',
        color: 'color-mix(in srgb, var(--color-amber) 80%, var(--color-ink))',
        background: 'color-mix(in srgb, var(--color-amber) 14%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)',
        borderRadius: 99,
        padding: '0.1rem 0.45rem',
        verticalAlign: 'middle',
        cursor: 'default',
      }}
    >
      ✦ AI · {reason}
    </span>
  )
}
