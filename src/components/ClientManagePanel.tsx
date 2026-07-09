import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BehaviourNotesSection from './BehaviourNotesSection'
import IncidentForm from './IncidentForm'
import IncidentsSection from './IncidentsSection'
import NdisRecordsSection from './NdisRecordsSection'
import { useFeatures } from '../hooks/useFeatures'
import { FEATURES } from '../lib/features'

type Kind = 'self' | 'guardian' | 'nominee'
type Candidate = { id: string; full_name: string; source: 'family' | 'recipient' }

export default function ClientManagePanel({
  clientId,
  participantName,
  orgId,
  onRemoved,
}: {
  clientId: string
  participantName: string
  orgId: string
  /** Called after the participant is deactivated or permanently deleted, so the parent can collapse/refresh its list. */
  onRemoved: () => void
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { has } = useFeatures()
  const [addingWorkerId, setAddingWorkerId] = useState('')
  const [showIncidentForm, setShowIncidentForm] = useState(false)
  const [dangerMode, setDangerMode] = useState<'deactivate' | 'delete' | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

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

  // Workers assigned to THIS participant — the fix for the gap where an
  // invited worker had no reliable way to ever get linked to a client.
  const { data: assignedWorkers } = useQuery({
    queryKey: ['client-workers-manage', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_workers')
        .select('worker_id, profiles!worker_id(full_name)')
        .eq('client_id', clientId)
      if (error) throw error
      return (data ?? []) as unknown as { worker_id: string; profiles: { full_name: string } | null }[]
    },
  })

  // Every worker in the org NOT already assigned here, for the "add" picker.
  const { data: unassignedWorkers } = useQuery({
    queryKey: ['org-unassigned-workers', clientId, orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('org_id', orgId)
        .in('role', ['support_worker', 'trusted_support_worker'])
        .order('full_name')
      if (error) throw error
      const assignedIds = new Set((assignedWorkers ?? []).map((w) => w.worker_id))
      return (data ?? []).filter((w) => !assignedIds.has(w.id))
    },
    enabled: !!orgId,
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

  const addWorker = useMutation({
    mutationFn: async (workerId: string) => {
      const { error } = await supabase.from('client_workers').insert({ client_id: clientId, worker_id: workerId })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-workers-manage', clientId] })
      qc.invalidateQueries({ queryKey: ['org-unassigned-workers', clientId, orgId] })
      setAddingWorkerId('')
    },
  })

  const removeWorker = useMutation({
    mutationFn: async (workerId: string) => {
      const { error } = await supabase.from('client_workers').delete().eq('client_id', clientId).eq('worker_id', workerId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-workers-manage', clientId] })
      qc.invalidateQueries({ queryKey: ['org-unassigned-workers', clientId, orgId] })
    },
  })

  const removeFromCircle = useMutation({
    mutationFn: async (circleId: string) => {
      const { error } = await supabase.from('client_circle').update({ status: 'removed' }).eq('id', circleId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-circle-manage', clientId] }),
  })

  const deactivateClient = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('clients').update({ active: false }).eq('id', clientId)
      if (error) throw error
    },
    onSuccess: onRemoved,
  })

  const deleteClientPermanently = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('clients').delete().eq('id', clientId)
      if (error) throw error
    },
    onSuccess: onRemoved,
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

      <div style={{ marginBottom: '1.5rem' }}>
        <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Assigned workers</p>
        {!assignedWorkers?.length ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
            No workers assigned yet — {participantName} won't appear in any worker's client list until one is added.
          </p>
        ) : (
          assignedWorkers.map((w) => (
            <div key={w.worker_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--color-border)' }}>
              <span style={{ fontSize: '0.85rem' }}>{w.profiles?.full_name ?? 'Worker'}</span>
              <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                disabled={removeWorker.isPending}
                onClick={() => removeWorker.mutate(w.worker_id)}>
                Remove
              </button>
            </div>
          ))
        )}
        {!!unassignedWorkers?.length && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <select className="input" style={{ flex: 1 }} value={addingWorkerId}
              onChange={(e) => setAddingWorkerId(e.target.value)}>
              <option value="">Add a worker…</option>
              {unassignedWorkers.map((w) => (
                <option key={w.id} value={w.id}>{w.full_name}</option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={!addingWorkerId || addWorker.isPending}
              onClick={() => addWorker.mutate(addingWorkerId)}>
              {addWorker.isPending ? <span className="spinner" /> : 'Add'}
            </button>
          </div>
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

      {has(FEATURES.incidentWorkflows) && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <p style={{ fontWeight: 700, fontSize: '0.85rem', margin: 0 }}>Incidents</p>
            {!showIncidentForm && (
              <button className="btn btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
                onClick={() => setShowIncidentForm(true)}>
                + Report incident
              </button>
            )}
          </div>
          {showIncidentForm && (
            <IncidentForm
              clientId={clientId}
              orgId={orgId}
              authorId={user!.id}
              onSaved={() => setShowIncidentForm(false)}
              onCancel={() => setShowIncidentForm(false)}
            />
          )}
          <IncidentsSection clientId={clientId} canManage />
        </div>
      )}

      {has(FEATURES.ndisRecords) && (
        <div style={{ marginBottom: '1.5rem' }}>
          <NdisRecordsSection clientId={clientId} orgId={orgId} authorId={user!.id} canManageGoals />
        </div>
      )}

      {has(FEATURES.behaviourNotes) && <BehaviourNotesSection clientId={clientId} participantName={participantName} />}

      <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--color-border)' }}>
        <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--color-error)' }}>Danger zone</p>

        {dangerMode === null && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => setDangerMode('deactivate')}>
              Deactivate participant
            </button>
            <button className="btn btn-ghost" style={{ fontSize: '0.8rem', color: 'var(--color-error)' }} onClick={() => setDangerMode('delete')}>
              Delete permanently
            </button>
          </div>
        )}

        {dangerMode === 'deactivate' && (
          <div className="card card-sm" style={{ background: 'color-mix(in srgb, var(--color-error) 8%, transparent)' }}>
            <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              {participantName} will be hidden from dashboards and worker/family views, and their seat will be freed.
              Their history is kept — you can reactivate them later from the "inactive participants" list.
            </p>
            {deactivateClient.isError && (
              <p style={{ fontSize: '0.8rem', color: 'var(--color-error)', marginBottom: '0.5rem' }}>
                {(deactivateClient.error as Error).message}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-ghost" onClick={() => setDangerMode(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: 'var(--color-error)' }} disabled={deactivateClient.isPending}
                onClick={() => deactivateClient.mutate()}>
                {deactivateClient.isPending ? <span className="spinner" /> : `Deactivate ${participantName}`}
              </button>
            </div>
          </div>
        )}

        {dangerMode === 'delete' && (
          <div className="card card-sm" style={{ background: 'color-mix(in srgb, var(--color-error) 8%, transparent)' }}>
            <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              This permanently deletes {participantName} and ALL their records — journal entries, behaviour notes,
              incidents, goals, schedule, and messages. This cannot be undone. If you just want to free up a seat or
              pause billing for them, use Deactivate instead.
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
              Type <strong>DELETE</strong> to confirm.
            </p>
            {deleteClientPermanently.isError && (
              <p style={{ fontSize: '0.8rem', color: 'var(--color-error)', marginBottom: '0.5rem' }}>
                {(deleteClientPermanently.error as Error).message}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: '1 1 140px' }} value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="DELETE" />
              <button className="btn btn-ghost" onClick={() => { setDangerMode(null); setDeleteConfirmText('') }}>Cancel</button>
              <button className="btn btn-primary" style={{ background: 'var(--color-error)' }}
                disabled={deleteConfirmText !== 'DELETE' || deleteClientPermanently.isPending}
                onClick={() => deleteClientPermanently.mutate()}>
                {deleteClientPermanently.isPending ? <span className="spinner" /> : 'Delete permanently'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
