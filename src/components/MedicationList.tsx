import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import MedicationForm from './MedicationForm'
import MedicationLog from './MedicationLog'
import { ROUTE_LABEL } from '../lib/medications'
import type { Medication as MedType } from '../types/database'

export default function MedicationList({
  clientId,
  orgId,
  canManage,
}: {
  clientId: string
  orgId: string
  canManage: boolean
}) {
  const qc = useQueryClient()
  const queryKey = ['medications', clientId]
  const [showForm, setShowForm] = useState(false)
  const [editingMed, setEditingMed] = useState<MedType | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: meds, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medications')
        .select('*')
        .eq('client_id', clientId)
        .eq('active', true)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as MedType[]
    },
    enabled: !!clientId,
  })

  const deactivate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('medications').update({ active: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  })

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: '1rem' }}><div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} /></div>
  }

  return (
    <div>
      {/* Add / Edit form */}
      {canManage && (showForm || editingMed) ? (
        <MedicationForm
          clientId={clientId}
          orgId={orgId}
          medication={editingMed ?? undefined}
          onSaved={() => { setShowForm(false); setEditingMed(null) }}
          onCancel={() => { setShowForm(false); setEditingMed(null) }}
        />
      ) : null}

      {/* Add button (canManage only, when form isn't showing) */}
      {canManage && !showForm && !editingMed && (
        <button className="btn btn-primary btn-full" onClick={() => setShowForm(true)}
          style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>
          + Add medication
        </button>
      )}

      {/* Medication list */}
      {!meds?.length ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', textAlign: 'center', padding: '1rem 0' }}>
          No medications recorded yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {meds.map((med) => {
            const isExpanded = expandedId === med.id
            return (
              <div key={med.id} className="card card-sm">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : med.id)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    width: '100%', background: 'none', border: 'none', padding: 0,
                    cursor: 'pointer', textAlign: 'left', gap: '0.5rem',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>{med.name}</p>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>
                      {med.dosage && <>{med.dosage} · </>}
                      {med.frequency}
                      {med.route && <> · {ROUTE_LABEL[med.route]}</>}
                    </p>
                    {med.instructions && (
                      <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', fontStyle: 'italic' }}>
                        {med.instructions}
                      </p>
                    )}
                    {med.prescriber && (
                      <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                        Prescribed by {med.prescriber}
                      </p>
                    )}
                  </div>
                  <span style={{ fontSize: '0.7rem', opacity: 0.6, flexShrink: 0, paddingTop: 2 }}>
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </button>

                {/* Expanded: show admin log + manage actions */}
                {isExpanded && (
                  <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
                    <MedicationLog medicationId={med.id} clientId={clientId} orgId={orgId} />

                    {canManage && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                        <button className="btn btn-ghost" style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem' }}
                          onClick={(e) => { e.stopPropagation(); setEditingMed(med) }}>
                          Edit
                        </button>
                        <button className="btn btn-ghost" style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem', color: 'var(--color-error)' }}
                          disabled={deactivate.isPending}
                          onClick={(e) => { e.stopPropagation(); if (confirm(`Remove ${med.name}?`)) deactivate.mutate(med.id) }}>
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
