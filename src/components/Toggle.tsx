export default function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        padding: 0,
        background: checked ? 'var(--color-primary)' : 'var(--color-border)',
        position: 'relative',
        cursor: disabled ? 'default' : 'pointer',
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 19 : 3,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          transition: 'left 0.15s',
        }}
      />
    </button>
  )
}
