import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { signOut } from '../../lib/auth'
import ClientFeedback from '../../components/ClientFeedback'

export default function RecipientDashboard() {
  const { user } = useAuth()

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ['recipient-client', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, org_id, full_name')
        .eq('recipient_profile_id', user!.id)
        .maybeSingle()
      return data
    },
    enabled: !!user,
  })

  async function handleSignOut() {
    await signOut()
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)' }}>
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid color-mix(in srgb, var(--color-muted) 20%, transparent)',
        padding: '0.875rem 1.25rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600 }}>Companion</span>
          <span className="badge badge-sage" style={{ marginLeft: '0.5rem', fontSize: '0.65rem' }}>Recipient</span>
        </div>
        <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}>
          Sign out
        </button>
      </header>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '1rem' }}>
        <p className="eyebrow" style={{ margin: '0 0 0.25rem' }}>Your feedback</p>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 1rem' }}>
          {client?.full_name ? `Hi, ${client.full_name.split(' ')[0]}` : 'Hi'}
        </h1>

        {clientLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
            <div className="spinner" style={{ width: 28, height: 28, color: 'var(--color-primary)' }} />
          </div>
        )}

        {!clientLoading && !client && (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--color-muted)' }}>
            <p>We couldn't find a linked care record for your account. Ask your coordinator or family contact for help.</p>
          </div>
        )}

        {client && (
          <ClientFeedback
            clientId={client.id}
            orgId={client.org_id}
            placeholder="How are things going? Share anything you'd like your care team to know."
          />
        )}
      </div>
    </div>
  )
}
