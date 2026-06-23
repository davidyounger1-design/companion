import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { signUp } from '../../lib/auth'

const schema = z.object({
  fullName: z.string().min(2, 'Please enter your full name'),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type FormData = z.infer<typeof schema>

export default function SignUp() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')
  const [confirmEmail, setConfirmEmail] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setServerError('')
    try {
      const result = await signUp(data.email, data.password, data.fullName)
      if (result.session) {
        // Immediately authenticated — go to setup
        navigate('/setup/account')
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
          <Link to="/sign-in" className="btn btn-primary btn-full">
            Go to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Provider sign-up</p>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem', fontWeight: 400 }}>
          Welcome to Companion
        </h1>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
          Set up your organisation in minutes.
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
              placeholder="sarah@yourorg.com.au"
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
