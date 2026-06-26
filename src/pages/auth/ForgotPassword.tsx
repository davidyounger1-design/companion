import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { resetPassword } from '../../lib/auth'

const schema = z.object({
  email: z.string().email('Please enter a valid email'),
})
type FormData = z.infer<typeof schema>

export default function ForgotPassword() {
  const [sent, setSent] = useState(false)
  const [serverError, setServerError] = useState('')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setServerError('')
    try {
      await resetPassword(data.email)
      setSent(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      const isUsable = msg && msg !== '{}' && msg !== '[object Object]'
      setServerError(isUsable ? msg : 'Could not send reset email. Please try again.')
    }
  }

  if (sent) {
    return (
      <div className="auth-layout">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📨</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 400, marginBottom: '0.75rem' }}>Check your email</h1>
          <p style={{ color: 'var(--color-muted)', fontSize: '0.95rem', lineHeight: 1.7 }}>
            If that address is in our system, you'll receive a password reset link shortly.
          </p>
          <div className="divider" />
          <Link to="/sign-in" className="btn btn-primary btn-full">Back to sign in</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Password reset</p>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem', fontWeight: 400 }}>Forgot your password?</h1>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
          Enter your email and we'll send you a reset link.
        </p>

        {serverError && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{serverError}</div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              className={`input${errors.email ? ' error' : ''}`}
              placeholder="you@yourorg.com.au"
              autoComplete="email"
              autoFocus
              {...register('email')}
            />
            {errors.email && <span className="field-error">{errors.email.message}</span>}
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
            {isSubmitting ? <span className="spinner" /> : 'Send reset link'}
          </button>
        </form>

        <div className="divider" />

        <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
          Remembered it?{' '}
          <Link to="/sign-in" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
