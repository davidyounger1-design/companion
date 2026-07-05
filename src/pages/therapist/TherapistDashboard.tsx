import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { signOut } from '../../lib/auth'
import { SettingsIcon } from '../../components/icons'
import ColorModePill from '../../components/ColorModePill'
import BehaviourNoteCard from '../../components/BehaviourNoteCard'
import BehaviourNoteDetail from '../../components/BehaviourNoteDetail'
import type { BehaviourNote } from '../../types/database'

type SharedNote = BehaviourNote & { clients: { full_name: string } | null }

export default function TherapistDashboard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<SharedNote | null>(null)

  const { data: notes, isLoading } = useQuery({
    queryKey: ['therapist-shared-notes', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('behaviour_notes')
        .select('*, clients(full_name)')
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as SharedNote[]
    },
    enabled: !!profile,
  })

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)' }}>
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid color-mix(in srgb, var(--color-muted) 20%, transparent)',
        padding: '1rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 600 }}>Companion</span>
          <span className="badge badge-sage" style={{ marginLeft: '0.6rem' }}>Therapist</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
          <ColorModePill />
          <button className="icon-btn" aria-label="Display settings" title="Display settings" onClick={() => navigate('/settings/display')} style={{ flexShrink: 0 }}>
            <SettingsIcon size={18} />
          </button>
          <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
            Sign out
          </button>
        </div>
      </header>

      <main style={{ padding: '1.5rem', maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 400, marginBottom: '0.25rem' }}>Shared with you</h1>
        <p style={{ color: 'var(--color-muted)', marginBottom: '1.75rem', fontSize: '0.9rem' }}>
          Behaviour notes a decision-maker has explicitly shared with you. Access can be revoked at any time.
        </p>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
          </div>
        ) : !notes?.length ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <p style={{ color: 'var(--color-muted)' }}>Nothing has been shared with you yet.</p>
          </div>
        ) : (
          <div className="scroll-list">
            {notes.map((note) => (
              <BehaviourNoteCard key={note.id} note={note} subtitle={note.clients?.full_name} onClick={() => setSelected(note)} />
            ))}
          </div>
        )}
      </main>

      {selected && (
        <BehaviourNoteDetail
          note={selected}
          clientId={selected.client_id}
          canShare={false}
          canViewAccessLog={false}
          logViewAsTherapist={true}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
