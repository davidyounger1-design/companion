import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabase'
import InviteMemberModal from '../../../components/InviteMemberModal'

export default function FamilyStep2Invite() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [showInvite, setShowInvite] = useState(false)
  const [sent, setSent] = useState<string[]>([])

  // Use distinct key from FamilyDashboard (which selects full_name+dob) to avoid cache collision
  const { data: clientId, isLoading: clientLoading } = useQuery({
    queryKey: ['family-client-id', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_family')
        .select('client_id')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      return data?.client_id ?? null
    },
    enabled: !!user,
  })

  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Step 2 of 3</p>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>
        Invite family members
      </h1>
      <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
        Anyone you invite can add journal entries. You can also do this later.
      </p>

      {sent.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          {sent.map((e) => (
            <div key={e} className="alert" style={{
              background: 'var(--color-success-bg, #f0fdf4)',
              color: 'var(--color-success, #166534)',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
            }}>
              Invite sent to {e}
            </div>
          ))}
        </div>
      )}

      <button
        className="btn btn-secondary btn-full"
        onClick={() => setShowInvite(true)}
        disabled={clientLoading || !clientId}
        style={{ marginBottom: '1.5rem' }}
      >
        {clientLoading ? <span className="spinner" /> : '+ Invite a family member'}
      </button>

      <button
        className="btn btn-primary btn-full"
        onClick={() => navigate('/setup/family/done')}
        style={{ fontSize: '1rem' }}
      >
        {sent.length > 0 ? 'Continue →' : 'Skip for now →'}
      </button>

      {showInvite && profile?.org_id && clientId && (
        <InviteMemberModal
          orgId={profile.org_id}
          allowedRoles={['family']}
          clients={[]}
          subRoles={[]}
          pinnedRole="family"
          pinnedClientId={clientId}
          onSent={(email) => setSent((prev) => [...prev, email])}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  )
}
