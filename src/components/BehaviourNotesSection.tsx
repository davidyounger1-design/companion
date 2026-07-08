import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useFeatures } from '../hooks/useFeatures'
import { FEATURES } from '../lib/features'
import type { BehaviourNote } from '../types/database'
import { notesToCsv, downloadCsv } from '../lib/behaviourNotes'
import BehaviourNoteCard from './BehaviourNoteCard'
import BehaviourNoteDetail from './BehaviourNoteDetail'
import MoodTrendChart from './MoodTrendChart'

export default function BehaviourNotesSection({
  clientId,
  participantName,
}: {
  clientId: string
  participantName?: string
}) {
  const { user, profile } = useAuth()
  const { has } = useFeatures()
  const canExport = has(FEATURES.ndisExports)
  const [selected, setSelected] = useState<BehaviourNote | null>(null)
  const [showChart, setShowChart] = useState(false)

  const { data: notes, isLoading } = useQuery({
    queryKey: ['behaviour-notes', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('behaviour_notes')
        .select('*')
        .eq('client_id', clientId)
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return data as BehaviourNote[]
    },
    enabled: !!clientId,
  })

  const { data: client } = useQuery({
    queryKey: ['client-decision-maker', clientId],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('decision_maker_id').eq('id', clientId).maybeSingle()
      return data
    },
    enabled: !!clientId,
  })

  const isDecisionMaker = !!user && !!client && client.decision_maker_id === user.id
  const isCoordinator = profile?.role === 'coordinator'
  const canShare = isDecisionMaker
  const canViewAccessLog = isDecisionMaker || isCoordinator

  function exportCsv() {
    if (!notes?.length) return
    downloadCsv(`behaviour-notes-${(participantName ?? 'notes').toLowerCase().replace(/\s+/g, '-')}.csv`, notesToCsv(notes))
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1rem', fontFamily: 'var(--font-ui)', fontWeight: 700, margin: 0 }}>Behaviour notes</h2>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {!!notes?.length && (
            <button className="btn btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} onClick={() => setShowChart((x) => !x)}>
              {showChart ? 'Hide pattern' : 'Pattern view'}
            </button>
          )}
          {!!notes?.length && canExport && (
            <button className="btn btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} onClick={exportCsv}>
              Export CSV
            </button>
          )}
        </div>
      </div>

      {showChart && !!notes?.length && (
        <div className="card card-sm" style={{ marginBottom: '1rem' }}>
          <MoodTrendChart notes={notes} />
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
        </div>
      ) : !notes?.length ? (
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
          No behaviour notes yet.
        </p>
      ) : (
        <div className="scroll-list">
          {notes.map((note) => (
            <BehaviourNoteCard key={note.id} note={note} onClick={() => setSelected(note)} />
          ))}
        </div>
      )}

      {selected && (
        <BehaviourNoteDetail
          note={selected}
          clientId={clientId}
          canShare={canShare}
          canViewAccessLog={canViewAccessLog}
          logViewAsTherapist={false}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
