import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errorMessage'
import { ROUTE_LABEL } from '../lib/medications'
import type { MedicationRoute, Medication } from '../types/database'

const ROUTES = Object.keys(ROUTE_LABEL) as MedicationRoute[]

export default function MedicationForm({
  clientId,
  orgId,
  medication,
  onSaved,
  onCancel,
}: {
  clientId: string
  orgId: string
  medication?: Medication
  onSaved: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const editing = !!medication
  const [name, setName] = useState(medication?.name ?? '')
  const [dosage, setDosage] = useState(medication?.dosage ?? '')
  const [frequency, setFrequency] = useState(medication?.frequency ?? '')
  const [instructions, setInstructions] = useState(medication?.instructions ?? '')
  const [route, setRoute] = useState<MedicationRoute | ''>(medication?.route ?? '')
  const [prescriber, setPrescriber] = useState(medication?.prescriber ?? '')

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        client_id: clientId,
        org_id: orgId,
        name: name.trim(),
        dosage: dosage.trim() || null,
        frequency: frequency.trim(),
        instructions: instructions.trim() || null,
        route: route || null,
        prescriber: prescriber.trim() || null,
      }
      if (editing) {
        const { error } = await supabase.from('medications').update({
          name: name.trim(),
          dosage: dosage.trim() || null,
          frequency: frequency.trim(),
          instructions: instructions.trim() || null,
          route: route || null,
          prescriber: prescriber.trim() || null,
        }).eq('id', medication!.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('medications').insert({
          ...payload,
          created_by: (await supabase.auth.getUser()).data.user!.id,
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['medications', clientId] })
      onSaved()
    },
  })

  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.95rem' }}>
        {editing ? 'Edit medication' : 'Add medication'}
      </p>
      <form
        onSubmit={(e) => { e.preventDefault(); if (!name.trim() || !frequency.trim()) return; save.mutate() }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        <div className="field">
          <label htmlFor="med-name">Medication name</label>
          <input id="med-name" className="input" placeholder="e.g. Paracetamol 500mg"
            value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="med-dosage">
              Dosage <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
            </label>
            <input id="med-dosage" className="input" placeholder="e.g. 2 tablets"
              value={dosage} onChange={(e) => setDosage(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="med-route">
              Route <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
            </label>
            <select id="med-route" className="input" value={route}
              onChange={(e) => setRoute(e.target.value as MedicationRoute | '')}>
              <option value="">Select…</option>
              {ROUTES.map((r) => <option key={r} value={r}>{ROUTE_LABEL[r]}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="med-frequency">Frequency</label>
          <input id="med-frequency" className="input" placeholder="e.g. Twice daily, Every 6 hours"
            value={frequency} onChange={(e) => setFrequency(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="med-instructions">
            Instructions <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
          </label>
          <input id="med-instructions" className="input" placeholder="e.g. With food, Avoid alcohol"
            value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="med-prescriber">
            Prescriber <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
          </label>
          <input id="med-prescriber" className="input" placeholder="e.g. Dr Smith"
            value={prescriber} onChange={(e) => setPrescriber(e.target.value)} />
        </div>
        {save.isError && (
          <div className="alert alert-error">
            {errorMessage(save.error, 'Could not save. Try again.')}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
          <button type="submit" className="btn btn-primary"
            disabled={save.isPending || !name.trim() || !frequency.trim()}
            style={{ flex: 2 }}>
            {save.isPending ? <span className="spinner" /> : editing ? 'Save changes' : 'Add medication'}
          </button>
        </div>
      </form>
    </div>
  )
}
