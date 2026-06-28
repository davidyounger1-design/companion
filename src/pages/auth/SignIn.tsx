import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { signIn } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { checkPlan, isFamilyPlan } from '../../lib/planCheck'

const schema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

type FormData = z.infer<typeof schema>

export default function SignIn() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('token') ?? ''
  const [serverError, setServerError] = useState('')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function navigateAfterSignIn() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Accept a pending invite if one is in the URL
    if (inviteToken) {
      const { data: result } = await supabase.rpc('accept_invite', { p_token: inviteToken })
      const r = result as { ok?: boolean; role?: string; error?: string } | null
      if (r?.ok) {
        const workerRoles = ['support_worker', 'trusted_support_worker']
        navigate(workerRoles.includes(r.role ?? '') ? '/worker' : r.role === 'family' ? '/family' : '/dashboard', { replace: true })
        return
      }
    }

    const [{ data: profile }, planInfo] = await Promise.all([
      supabase.from('profiles').select('role, org_id').eq('id', user.id).single(),
      checkPlan().catch(() => ({ plan: null })),
    ])

    const planIsFamily = isFamilyPlan(planInfo.plan)

    if (!profile?.org_id) {
      navigate('/setup/account')
      return
    }

    let orgType: string | null = null
    if (profile.org_id) {
      const { data: org } = await supabase
        .from('organisations')
        .select('org_type')
        .eq('id', profile.org_id)
        .single()
      orgType = org?.org_type ?? null
    }

    const isCoordinator = profile.role === 'coordinator'
    const isFamilyOrg = orgType === 'family'

    if (planIsFamily && isCoordinator && !isFamilyOrg) {
      navigate('/setup/family/participant')
    } else if (!planIsFamily && planInfo.plan !== null && profile.role === 'family') {
      navigate('/setup/service')
    } else if (profile.role === 'family') {
      navigate('/family')
    } else if (profile.role === 'support_worker' || profile.role === 'trusted_support_worker') {
      navigate('/worker')
    } else if (isCoordinator && isFamilyOrg) {
      navigate('/family')
    } else {
      navigate('/dashboard')
    }
  }

  async function onSubmit(data: FormData) {
    setServerError('')
    try {
      // Step 1: already have an account — sign in directly
      await signIn(data.email, data.password)
      await navigateAfterSignIn()
    } catch {
      // Step 2: check if this email is a registered MAB subscriber; if so, auto-create account
      try {
        const { data: regData, error: regErr } = await supabase.functions.invoke('auto-register', {
          body: { email: data.email, password: data.password },
        })

        if (!regErr && regData?.ok) {
          // Account created — sign in with the same credentials
          await signIn(data.email, data.password)
          await navigateAfterSignIn()
          return
        }

        if (!regErr && regData?.error === 'account_exists') {
          setServerError('Incorrect password. Please try again or use "Forgot password?".')
          return
        }
      } catch {
        // auto-register network failure — fall through to invite check
      }

      // Step 3: check for a pending invite for this email
      try {
        const { data: inviteCheck } = await supabase.rpc('check_pending_invite', { p_email: data.email })
        if ((inviteCheck as { found?: boolean })?.found) {
          setServerError('We found a pending invitation for this email. Please check your inbox for the invite link to complete registration.')
          return
        }
      } catch {
        // ignore RPC error — fall through to step 4
      }

      // Step 4: no account, no subscription, no invite — block
      setServerError('No account found for this email address. Please check your email or contact your coordinator.')
    }
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
          Don't have an account?{' '}
          <Link to="/sign-up" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Create one</Link>
        </p>
      </div>
    </div>
  )
}
