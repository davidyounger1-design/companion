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
  const [success, setSuccess] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setServerError('')
    try {
      await signUp(data.email, data.password, data.fullName)
      setSuccess(true)
      setTimeout(() => navigate('/setup/account'), 1500)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Sign-up failed. Please try again.')
    }
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

        {success && (
          <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
            Account created! Taking you to setup…
          </div>
        )}

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
