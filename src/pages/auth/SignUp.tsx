import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { signUp } from '../../lib/auth'
import { supabase } from '../../lib/supabase'

const schema = z.object({
  fullName: z.string().min(2, 'Please enter your full name'),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type FormData = z.infer<typeof schema>

export default function SignUp() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('token') ?? ''
  const prefillEmail = searchParams.get('email') ?? ''
  const [serverError, setServerError] = useState('')
  const [confirmEmail, setConfirmEmail] = useState(false)

  const planParam = searchParams.get('plan')
  if (planParam === 'family') localStorage.setItem('companion.intendedPlan', 'family')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: prefillEmail },
  })

  async function onSubmit(data: FormData) {
    setServerError('')
    try {
      const result = await signUp(data.email, data.password, data.fullName)
      if (result.session) {
        // Immediately authenticated — accept invite if present, else go to setup
        if (inviteToken) {
          const { data: inv } = await supabase.rpc('accept_invite', { p_token: inviteToken })
          const r = inv as { ok?: boolean; role?: string } | null
          const workerRoles = ['support_worker', 'trusted_support_worker']
          navigate(workerRoles.includes(r?.role ?? '') ? '/worker' : r?.role === 'family' ? '/family' : '/dashboard', { replace: true })
        } else {
          navigate('/setup/account')
        }
      } else {
        // Email confirmation required — tell the user to check their inbox
        setConfirmEmail(true)
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Sign-up failed. Please try again.')
    }
  }

  if (confirmEmail) {
    return (
      <div className="auth-layout">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📬</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 400, marginBottom: '0.75rem' }}>
            Check your email
          </h1>
          <p style={{ color: 'var(--color-muted)', fontSize: '0.95rem', lineHeight: 1.7 }}>
            We've sent a confirmation link to your inbox. Click it to activate your account,
            then come back here to sign in.
          </p>
          <div className="divider" />
          <Link
            to={inviteToken ? `/sign-in?token=${encodeURIComponent(inviteToken)}` : '/sign-in'}
            className="btn btn-primary btn-full"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.75rem' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--color-primary-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M8 13C8 13 2.5 9.5 2.5 5.5C2.5 3.5 4 2 5.5 2C6.5 2 7.5 2.7 8 3.5C8.5 2.7 9.5 2 10.5 2C12 2 13.5 3.5 13.5 5.5C13.5 9.5 8 13 8 13Z" fill="white" opacity="0.9"/>
              <path d="M6 8C6 8 4 7 4 5.5" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
            </svg>
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 600, color: 'var(--color-ink)' }}>Companion</span>
        </div>
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Create account</p>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem', fontWeight: 400 }}>
          Welcome to Companion
        </h1>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
          Create your account to get started.
        </p>

        {serverError && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="field">
            <label htmlFor="fullName">Full name</label>
            <input
              id="fullName"
              className={`input${errors.fullName ? ' error' : ''}`}
              placeholder="Sarah Johnson"
              autoComplete="name"
              {...register('fullName')}
            />
            {errors.fullName && <span className="field-error">{errors.fullName.message}</span>}
          </div>

          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              className={`input${errors.email ? ' error' : ''}`}
              placeholder="you@example.com"
              autoComplete="email"
              {...register('email')}
            />
            {errors.email && <span className="field-error">{errors.email.message}</span>}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className={`input${errors.password ? ' error' : ''}`}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              {...register('password')}
            />
            {errors.password && <span className="field-error">{errors.password.message}</span>}
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={isSubmitting}
            style={{ marginTop: '0.5rem' }}
          >
            {isSubmitting ? <span className="spinner" /> : 'Create account'}
          </button>
        </form>

        <div className="divider" />

        <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
          Already have an account?{' '}
          <Link to="/sign-in" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
