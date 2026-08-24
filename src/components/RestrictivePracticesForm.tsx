import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errorMessage'
import { RP_TYPE_LABEL } from '../lib/restrictivePractices'
import type { RestrictivePracticeType } from '../types/database'

const RP_TYPES: RestrictivePracticeType[] = ['chemical', 'environmental', 'mechanical', 'physical', 'seclusion']

export default function RestrictivePracticesForm({
  clientId,
  orgId,
  authorId,
  onSaved,
  onCancel,
}: {
  clientId: string
  orgId: string
  authorId: string
  onSaved: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const [type, setType] = useState<RestrictivePracticeType>('chemical')
  const [authorised, setAuthorised] = useState(false)
  const [authorisationReference, setAuthorisationReference] = useState('')
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString().slice(0, 16))
  const [endedAt, setEndedAt] = useState('')
  const [bspId, setBspId] = useState('')
  const [notes, setNotes] = useState('')

  // Behaviour-support-plan linking arrives with 087, which may not be applied
  // yet. Degrade gracefully: any error here (missing table, no access) means
  // the selector is hidden and bsp_id is omitted from the insert payload —
  // the register works standalone.
  const { data: bspPlans } = useQuery({
    queryKey: ['client-bsp-plans', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('behaviour_support_plans')
        .select('id, file_name')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (error) return null
      return (data ?? []) as { id: string; file_name: string }[]
    },
    enabled: !!clientId,
    retry: false,
  })
  const bspAvailable = !!bspPlans?.length

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('restrictive_practices').insert({
        client_id: clientId,
        org_id: orgId,
        recorded_by: authorId,
        type,
        authorised,
        authorisation_reference: authorised && authorisationReference.trim() ? authorisationReference.trim() : null,
        ...(startedAt ? { started_at: new Date(startedAt).toISOString() } : {}),
        ended_at: endedAt ? new Date(endedAt).toISOString() : null,
        notes: notes.trim() || null,
        ...(bspId ? { bsp_id: bspId } : {}),
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['restrictive-practices', clientId] })
      // An unauthorised practice auto-creates an incident via 086's trigger —
      // refresh the incidents section on the same page too.
      qc.invalidateQueries({ queryKey: ['incidents', clientId] })
      qc.invalidateQueries({ queryKey: ['open-incidents'] })
      onSaved()
    },
  })

  const missingAuthorisation = authorised && !authorisationReference.trim()

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.95rem' }}>Record a restrictive practice</p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (missingAuthorisation) return
          save.mutate()
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="rp-type">Type of practice</label>
            <select id="rp-type" className="input" value={type}
              onChange={(e) => setType(e.target.value as RestrictivePracticeType)}>
              {RP_TYPES.map((t) => <option key={t} value={t}>{RP_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="rp-started">Started</label>
            <input id="rp-started" type="datetime-local" className="input" value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="rp-ended">Ended <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span></label>
            <input id="rp-ended" type="datetime-local" className="input" value={endedAt}
              onChange={(e) => setEndedAt(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', paddingBottom: '0.5rem' }}>
              <input id="rp-authorised" type="checkbox" checked={authorised}
                onChange={(e) => setAuthorised(e.target.checked)} />
              Authorised practice
            </label>
          </div>
        </div>

        {authorised && (
          <div className="field">
            <label htmlFor="rp-auth-ref">Authorisation reference</label>
            <input id="rp-auth-ref" className="input"
              placeholder="e.g. authorisation ID or approving document reference"
              value={authorisationReference} onChange={(e) => setAuthorisationReference(e.target.value)} autoFocus />
          </div>
        )}

        {bspAvailable && (
          <div className="field">
            <label htmlFor="rp-bsp">Linked behaviour support plan <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span></label>
            <select id="rp-bsp" className="input" value={bspId} onChange={(e) => setBspId(e.target.value)}>
              <option value="">No plan linked</option>
              {bspPlans!.map((p) => <option key={p.id} value={p.id}>{p.file_name}</option>)}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="rp-notes">Notes <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span></label>
          <textarea id="rp-notes" className="input" rows={3} style={{ resize: 'vertical' }}
            placeholder="Context, de-escalation used, review of the practice…"
            value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {missingAuthorisation && (
          <p style={{ fontSize: '0.8rem', color: 'var(--color-error)' }}>
            An authorised practice needs its authorisation reference.
          </p>
        )}

        {save.isError && (
          <div className="alert alert-error">
            {errorMessage(save.error, 'Could not save. Try again.')}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending || missingAuthorisation} style={{ flex: 2 }}>
            {save.isPending ? <span className="spinner" /> : 'Save record'}
          </button>
        </div>
      </form>
    </div>
  )
}
