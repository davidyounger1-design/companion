import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { signIn } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { checkPlan, isFamilyPlan } from '../../lib/planCheck'
import { checkMfaRequired } from '../../lib/mfa'
import MfaCodeInput from '../../components/MfaCodeInput'

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
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaVerifying, setMfaVerifying] = useState(false)
  const [mfaError, setMfaError] = useState('')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function proceedAfterSignIn() {
    const factorId = await checkMfaRequired()
    if (factorId) {
      setMfaFactorId(factorId)
      return
    }
    await navigateAfterSignIn()
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!mfaFactorId || mfaCode.length < 6) return
    setMfaVerifying(true)
    setMfaError('')
    const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId })
    if (challengeErr || !challenge) {
      setMfaVerifying(false)
      setMfaError(challengeErr?.message ?? 'Could not start verification. Try again.')
      return
    }
    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId, challengeId: challenge.id, code: mfaCode.trim(),
    })
    setMfaVerifying(false)
    if (verifyErr) {
      setMfaError('Incorrect code. Try again.')
      return
    }
    await navigateAfterSignIn()
  }

  async function navigateAfterSignIn() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Accept a pending invite if one is in the URL
    if (inviteToken) {
      const { data: result } = await supabase.rpc('accept_invite', { p_token: inviteToken })
      const r = result as { ok?: boolean; role?: string; error?: string } | null
      if (r?.ok) {
        const workerRoles = ['support_worker', 'trusted_support_worker']
        navigate(
          workerRoles.includes(r.role ?? '') ? '/worker' :
          (r.role === 'family' || r.role === 'recipient') ? '/family' :
          r.role === 'therapist' ? '/therapist' :
          '/dashboard',
          { replace: true }
        )
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
    } else if (profile.role === 'family' || profile.role === 'recipient') {
      navigate('/family')
    } else if (profile.role === 'support_worker' || profile.role === 'trusted_support_worker') {
      navigate('/worker')
    } else if (profile.role === 'therapist') {
      navigate('/therapist')
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
      await proceedAfterSignIn()
    } catch {
      // Step 2: check if this email is a registered MAB subscriber; if so, auto-create account
      try {
        const { data: regData, error: regErr } = await supabase.functions.invoke('auto-register', {
          body: { email: data.email, password: data.password },
        })

        if (!regErr && regData?.ok) {
          // Account created — sign in with the same credentials
          await signIn(data.email, data.password)
          await proceedAfterSignIn()
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

      // Step 4: no auto-register match, no pending invite — but we genuinely
      // can't tell "no account" from "wrong password" here. Supabase's
      // sign-in returns the identical generic error for both (deliberately,
      // to prevent email enumeration), so asserting "no account found" would
      // be actively wrong for anyone who simply mistyped their password.
      setServerError('We couldn’t sign you in with that email and password. If you already have an account, double-check your password or use "Forgot password?" below. If you’re new, check your email for an invite link or contact your coordinator.')
    }
  }

  if (mfaFactorId) {
    return (
      <div className="auth-layout">
        <div className="auth-card">
          <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Two-factor authentication</p>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', fontWeight: 400 }}>Enter your code</h1>
          <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
            Open your authenticator app and enter the 6-digit code for Companion.
          </p>

          {mfaError && (
            <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{mfaError}</div>
          )}

          <form onSubmit={handleMfaVerify} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <MfaCodeInput value={mfaCode} onChange={setMfaCode} autoFocus />
            <button type="submit" className="btn btn-primary btn-full" disabled={mfaVerifying || mfaCode.length < 6}>
              {mfaVerifying ? <span className="spinner" /> : 'Verify'}
            </button>
          </form>

          <div className="divider" />

          <button className="btn btn-ghost btn-full" onClick={async () => {
            await supabase.auth.signOut()
            setMfaFactorId(null); setMfaCode(''); setMfaError('')
          }}>
            ← Back to sign in
          </button>
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
