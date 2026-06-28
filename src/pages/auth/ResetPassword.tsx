import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { updatePassword } from '../../lib/auth'
import { supabase } from '../../lib/supabase'

const schema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, {
  message: 'Passwords do not match',
  path: ['confirm'],
})

type FormData = z.infer<typeof schema>

export default function ResetPassword() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setServerError('')
    try {
      await updatePassword(data.password)
      await supabase.auth.signOut()
      navigate('/sign-in')
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not update password. Please try again.')
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Password reset</p>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem', fontWeight: 400 }}>Choose a new password</h1>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
          Pick something strong — at least 8 characters.
        </p>

        {serverError && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{serverError}</div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="field">
            <label htmlFor="password">New password</label>
            <input
              id="password"
              type="password"
              className={`input${errors.password ? ' error' : ''}`}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              autoFocus
              {...register('password')}
            />
            {errors.password && <span className="field-error">{errors.password.message}</span>}
          </div>

          <div className="field">
            <label htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              type="password"
              className={`input${errors.confirm ? ' error' : ''}`}
              placeholder="Repeat your new password"
              autoComplete="new-password"
              {...register('confirm')}
            />
            {errors.confirm && <span className="field-error">{errors.confirm.message}</span>}
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
            {isSubmitting ? <span className="spinner" /> : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  )
}
