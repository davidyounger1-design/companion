import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import BehaviourNotesSection from './BehaviourNotesSection'
import { useFeatures } from '../hooks/useFeatures'
import { FEATURES } from '../lib/features'

type Kind = 'self' | 'guardian' | 'nominee'
type Candidate = { id: string; full_name: string; source: 'family' | 'recipient' }

export default function ClientManagePanel({
  clientId,
  participantName,
}: {
  clientId: string
  participantName: string
}) {
  const qc = useQueryClient()
  const { has } = useFeatures()

  const { data: client } = useQuery({
    queryKey: ['client-manage', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('decision_maker_id, decision_maker_kind, recipient_profile_id')
        .eq('id', clientId)
        .single()
      if (error) throw error
      return data
    },
  })

  const { data: familyMembers } = useQuery({
    queryKey: ['client-family-members', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_family')
        .select('family_id, profiles!family_id(full_name)')
        .eq('client_id', clientId)
        .eq('status', 'active')
      if (error) throw error
      return (data ?? []) as unknown as { family_id: string; profiles: { full_name: string } | null }[]
    },
  })

  const { data: recipientProfile } = useQuery({
    queryKey: ['recipient-profile', client?.recipient_profile_id],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('full_name').eq('id', client!.recipient_profile_id!).maybeSingle()
      return data
    },
    enabled: !!client?.recipient_profile_id,
  })

  const { data: circle } = useQuery({
    queryKey: ['client-circle-manage', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_circle')
        .select('id, therapist_id, profiles!therapist_id(full_name)')
        .eq('client_id', clientId)
        .eq('status', 'in_circle')
      if (error) throw error
      return (data ?? []) as unknown as { id: string; therapist_id: string; profiles: { full_name: string } | null }[]
    },
  })

  const candidates: Candidate[] = [
    ...(familyMembers ?? []).map((f) => ({ id: f.family_id, full_name: f.profiles?.full_name ?? 'Family member', source: 'family' as const })),
    ...(client?.recipient_profile_id && recipientProfile
      ? [{ id: client.recipient_profile_id, full_name: recipientProfile.full_name, source: 'recipient' as const }]
      : []),
  ]

  const [decisionMakerId, setDecisionMakerId] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>('guardian')
  const [initialised, setInitialised] = useState(false)

  if (client && !initialised) {
    setDecisionMakerId(client.decision_maker_id)
    setKind((client.decision_maker_kind as Kind) ?? 'guardian')
    setInitialised(true)
  }

  const saveDecisionMaker = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('clients')
        .update({ decision_maker_id: decisionMakerId, decision_maker_kind: decisionMakerId ? kind : null })
        .eq('id', clientId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-manage', clientId] })
      qc.invalidateQueries({ queryKey: ['client-decision-maker', clientId] })
    },
  })

  const removeFromCircle = useMutation({
    mutationFn: async (circleId: string) => {
      const { error } = await supabase.from('client_circle').update({ status: 'removed' }).eq('id', circleId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-circle-manage', clientId] }),
  })

  return (
    <div style={{ padding: '1rem', borderTop: '1px solid var(--color-border)' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Decision maker</p>
        <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
          Controls who can share {participantName}'s behaviour notes with therapists, and who can revoke access.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select className="input" style={{ flex: '1 1 180px' }} value={decisionMakerId ?? ''}
            onChange={(e) => setDecisionMakerId(e.target.value || null)}>
            <option value="">None assigned</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name}{c.source === 'recipient' ? ' (participant)' : ''}</option>
            ))}
          </select>
          {decisionMakerId && (
            <select className="input" style={{ flex: '0 0 140px' }} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="self">Self</option>
              <option value="guardian">Guardian</option>
              <option value="nominee">Nominee</option>
            </select>
          )}
          <button className="btn btn-primary" disabled={saveDecisionMaker.isPending} onClick={() => saveDecisionMaker.mutate()}>
            {saveDecisionMaker.isPending ? <span className="spinner" /> : 'Save'}
          </button>
        </div>
        {saveDecisionMaker.isSuccess && (
          <p style={{ fontSize: '0.78rem', color: 'var(--color-primary)', marginTop: '0.4rem' }}>Saved.</p>
        )}
      </div>

      {has(FEATURES.therapyCircles) && <div style={{ marginBottom: '1.5rem' }}>
        <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Therapist circle</p>
        {!circle?.length ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
            No therapists in the circle yet. Invite one from Members.
          </p>
        ) : (
          circle.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--color-border)' }}>
              <span style={{ fontSize: '0.85rem' }}>{c.profiles?.full_name ?? 'Therapist'}</span>
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                disabled={removeFromCircle.isPending}
                onClick={() => removeFromCircle.mutate(c.id)}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>}

      {has(FEATURES.behaviourNotes) && <BehaviourNotesSection clientId={clientId} participantName={participantName} />}
    </div>
  )
}
