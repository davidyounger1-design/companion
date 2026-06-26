import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabase'

export default function FamilyStep3Done() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const { data: participant } = useQuery({
    queryKey: ['family-participant-name', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_family')
        .select('clients(full_name)')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      return (data?.clients as unknown as { full_name: string } | null)?.full_name ?? null
    },
    enabled: !!user,
  })

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>
        {participant ? `${participant}'s care journal is ready` : 'Your care journal is ready'}
      </h1>
      <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '2.5rem' }}>
        Start adding moments from {participant ? `${participant}'s` : 'their'} day — photos, meals, activities, or just what happened.
      </p>

      <button
        className="btn btn-primary btn-full"
        onClick={() => navigate('/family')}
        style={{ fontSize: '1rem' }}
      >
        Open journal →
      </button>
    </div>
  )
}
