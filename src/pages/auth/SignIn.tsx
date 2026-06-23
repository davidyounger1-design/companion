import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { signIn } from '../../lib/auth'
import { supabase } from '../../lib/supabase'

const schema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

type FormData = z.infer<typeof schema>

export default function SignIn() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setServerError('')
    try {
      await signIn(data.email, data.password)

      // Determine where to send the user based on their role
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, org_id')
        .eq('id', user.id)
        .single()

      if (!profile?.org_id) {
        navigate('/setup/account')
      } else if (profile.role === 'support_worker') {
        navigate('/worker')
      } else {
        navigate('/dashboard')
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Sign-in failed. Please check your credentials.')
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Sign in</p>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem', fontWeight: 400 }}>
          Welcome back
        </h1>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
          Sign in to your Companion account.
        </p>

        {serverError && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            {serverError}
          </div>
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
              placeholder="Your password"
              autoComplete="current-password"
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
            {isSubmitting ? <span className="spinner" /> : 'Sign in'}
          </button>

          <p style={{ textAlign: 'center', fontSize: '0.875rem', margin: 0 }}>
            <Link to="/forgot-password" style={{ color: 'var(--color-muted)' }}>Forgot password?</Link>
          </p>
        </form>

        <div className="divider" />

        <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
          New provider?{' '}
          <Link to="/sign-up" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Create an account</Link>
        </p>
      </div>
    </div>
  )
}
