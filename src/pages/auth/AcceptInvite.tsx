import { useState, useEffect, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

interface InviteDetails {
  org_id: string
  org_name: string
  email: string
  name: string | null
  role: string
  expires_at: string
  status: string
}

const ROLE_LABEL: Record<string, string> = {
  support_worker: 'Support Worker',
  coordinator:    'Coordinator',
  family:         'Family Member',
  therapist:      'Therapist',
  recipient:      'Care Recipient',
}

export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [invite, setInvite]         = useState<InviteDetails | null>(null)
  const [lookupError, setLookupError] = useState('')
  const [accepting, setAccepting]   = useState(false)
  const [done, setDone]             = useState(false)

  useEffect(() => {
    if (!token) { setLookupError('No invite token in this link.'); return }
    supabase
      .rpc('lookup_invite', { p_token: token })
      .then(({ data, error }) => {
        if (error || !data || (data as InviteDetails[]).length === 0) {
          setLookupError('This invite link is invalid.')
          return
        }
        const inv = (data as InviteDetails[])[0]
        if (inv.status === 'accepted') {
          setLookupError('This invite has already been used.')
        } else if (inv.status === 'expired' || new Date(inv.expires_at) < new Date()) {
          setLookupError('This invite link has expired. Ask your coordinator to send a new one.')
        } else {
          setInvite(inv)
        }
      })
  }, [token])

  function goToDashboard(role: string) {
    const workerRoles = ['support_worker', 'trusted_support_worker']
    navigate(
      workerRoles.includes(role) ? '/worker' :
      role === 'family' || role === 'recipient' ? '/family' :
      role === 'therapist' ? '/therapist' :
      '/dashboard',
      { replace: true }
    )
  }

  async function handleAccept() {
    setAccepting(true)
    const { data, error } = await supabase.rpc('accept_invite', { p_token: token })
    setAccepting(false)
    const result = data as { error?: string; role?: string } | null
    if (error || result?.error) {
      setLookupError(result?.error ?? error?.message ?? 'Something went wrong.')
      return
    }
    setDone(true)
    setTimeout(() => goToDashboard(result?.role ?? 'family'), 1500)
  }

  if (authLoading || (!invite && !lookupError)) {
    return (
      <Shell>
        <div className="spinner" style={{ margin: '2rem auto', color: 'var(--color-primary)' }} />
      </Shell>
    )
  }

  if (lookupError) {
    return (
      <Shell>
        <div className="alert alert-error" style={{ marginBottom: '1.5rem' }}>{lookupError}</div>
        <Link to="/sign-in" className="btn btn-ghost btn-full">Go to sign in</Link>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>✅</div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 400, marginBottom: '0.5rem' }}>You're in!</h1>
          <p style={{ color: 'var(--color-muted)' }}>Taking you to the journal…</p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🤝</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 400, marginBottom: '0.5rem' }}>You've been invited</h1>
        <p style={{ color: 'var(--color-muted)', lineHeight: 1.7, fontSize: '0.95rem' }}>
          Join <strong>{invite!.org_name}</strong> as a{' '}
          <strong>{ROLE_LABEL[invite!.role] ?? invite!.role}</strong>.
        </p>
      </div>

      {!user ? (
        <InviteSignupForm
          token={token}
          invite={invite!}
          onDone={(role) => { setDone(true); setTimeout(() => goToDashboard(role), 1500) }}
        />
      ) : (
        <>
          <button
            className="btn btn-primary btn-full"
            onClick={handleAccept}
            disabled={accepting}
            style={{ fontSize: '1rem', marginBottom: '0.75rem' }}
          >
            {accepting ? <span className="spinner" /> : 'Accept invitation →'}
          </button>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', textAlign: 'center' }}>
            Signed in as {user.email}
          </p>
        </>
      )}
    </Shell>
  )
}

function InviteSignupForm({
  token,
  invite,
  onDone,
}: {
  token: string
  invite: InviteDetails
  onDone: (role: string) => void
}) {
  const navigate = useNavigate()
  const [name, setName]         = useState(invite.name ?? '')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || password.length < 6) return
    setError('')
    setSubmitting(true)

    // Server-side: create user as pre-confirmed + accept invite in one call
    const { data: redeemData, error: fnErr } = await supabase.functions.invoke('redeem-invite', {
      body: { token, password, name: name.trim() },
    })

    if (fnErr || !redeemData?.ok) {
      // An account already exists for this email — send them to sign in and
      // accept from there, rather than (previously) resetting their password.
      if (redeemData?.error === 'account_exists') {
        navigate(`/sign-in?token=${encodeURIComponent(token)}`, { replace: true })
        return
      }
      setError(redeemData?.message ?? redeemData?.error ?? fnErr?.message ?? 'Could not accept invitation.')
      setSubmitting(false)
      return
    }

    // Sign in now that the account is confirmed
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: invite.email,
      password,
    })
    if (signInError) {
      setError('Account ready — please sign in to continue.')
      setSubmitting(false)
      return
    }

    onDone(redeemData.role ?? 'family')
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="field">
        <label htmlFor="inv-email">Email address</label>
        <input
          id="inv-email"
          type="email"
          className="input"
          value={invite.email}
          readOnly
          style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', cursor: 'default' }}
        />
      </div>

      <div className="field">
        <label htmlFor="inv-name">Your name</label>
        <input
          id="inv-name"
          className="input"
          placeholder="e.g. Sarah Johnson"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
      </div>

      <div className="field">
        <label htmlFor="inv-password">Choose a password</label>
        <input
          id="inv-password"
          type="password"
          className="input"
          placeholder="At least 6 characters"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
      </div>

      {error && (
        <div className="alert alert-error" style={{ fontSize: '0.875rem' }}>{error}</div>
      )}

      <button
        type="submit"
        className="btn btn-primary btn-full"
        disabled={submitting || !name.trim() || password.length < 6}
        style={{ marginTop: '0.25rem', fontSize: '1rem' }}
      >
        {submitting ? <span className="spinner" /> : 'Join the journal →'}
      </button>

      <p style={{ textAlign: 'center', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
        Already have an account?{' '}
        <Link to={`/sign-in?token=${encodeURIComponent(token)}`} style={{ color: 'var(--color-primary)' }}>
          Sign in instead
        </Link>
      </p>
    </form>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--color-bg)', padding: '1rem',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, padding: '2rem' }}>
        {children}
      </div>
    </div>
  )
}
