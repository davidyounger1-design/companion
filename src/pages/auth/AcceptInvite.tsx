import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

interface InviteDetails {
  org_id: string
  org_name: string
  email: string
  role: string
  expires_at: string
  status: string
}

const ROLE_LABEL: Record<string, string> = {
  support_worker: 'Support Worker',
  coordinator:    'Coordinator',
  family:         'Family Member',
  therapist:      'Therapist',
}

export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [invite, setInvite]       = useState<InviteDetails | null>(null)
  const [lookupError, setLookupError] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [done, setDone]           = useState(false)

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
    setTimeout(() => {
      navigate(result?.role === 'support_worker' ? '/worker' : '/dashboard', { replace: true })
    }, 1800)
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
          <p style={{ color: 'var(--color-muted)' }}>Taking you to your dashboard…</p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🤝</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 400, marginBottom: '0.5rem' }}>You've been invited</h1>
        <p style={{ color: 'var(--color-muted)', lineHeight: 1.7, fontSize: '0.95rem' }}>
          <strong>{invite!.org_name}</strong> has invited you to join as a{' '}
          <strong>{ROLE_LABEL[invite!.role] ?? invite!.role}</strong>.
        </p>
      </div>

      {!user ? (
        <>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: '1rem', textAlign: 'center' }}>
            Create an account or sign in to accept this invitation.
          </p>
          <Link
            to={`/sign-up?email=${encodeURIComponent(invite!.email)}&token=${encodeURIComponent(token)}`}
            className="btn btn-primary btn-full"
            style={{ marginBottom: '0.75rem' }}
          >
            Create account &amp; accept →
          </Link>
          <Link
            to={`/sign-in?token=${encodeURIComponent(token)}`}
            className="btn btn-ghost btn-full"
          >
            I already have an account
          </Link>
        </>
      ) : (
        <button
          className="btn btn-primary btn-full"
          onClick={handleAccept}
          disabled={accepting}
          style={{ fontSize: '1rem' }}
        >
          {accepting ? <span className="spinner" /> : 'Accept invitation →'}
        </button>
      )}
    </Shell>
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
