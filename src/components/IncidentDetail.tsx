import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useModalOpen } from '../context/ModalActivityContext'
import { SEVERITY_LABEL, SEVERITY_COLOR, STATUS_LABEL, STATUS_COLOR, CATEGORY_LABEL, formatIncidentDate } from '../lib/incidents'
import type { Incident } from '../types/database'

export default function IncidentDetail({
  incident,
  canManage,
  onClose,
}: {
  incident: Incident
  canManage: boolean
  onClose: () => void
}) {
  useModalOpen()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [resolutionNotes, setResolutionNotes] = useState(incident.resolution_notes ?? '')
  const sev = SEVERITY_COLOR[incident.severity]
  const st = STATUS_COLOR[incident.status]

  const setStatus = useMutation({
    mutationFn: async (status: 'escalated' | 'resolved') => {
      const { error } = await supabase.from('incidents').update(
        status === 'escalated'
          ? { status, escalated_at: new Date().toISOString(), escalated_by: user?.id ?? null }
          : { status, resolved_at: new Date().toISOString(), resolved_by: user?.id ?? null, resolution_notes: resolutionNotes.trim() || null }
      ).eq('id', incident.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents', incident.client_id] })
      qc.invalidateQueries({ queryKey: ['open-incidents'] })
      onClose()
    },
  })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <div>
            <p className="eyebrow" style={{ marginBottom: '0.35rem' }}>Incident report</p>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 400, margin: 0 }}>{CATEGORY_LABEL[incident.category]}</h2>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
          <span className="badge" style={{ background: sev.bg, color: sev.fg, fontSize: '0.7rem' }}>{SEVERITY_LABEL[incident.severity]}</span>
          <span className="badge" style={{ background: st.bg, color: st.fg, fontSize: '0.7rem' }}>{STATUS_LABEL[incident.status]}</span>
        </div>

        <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', marginBottom: '1rem' }}>
          {formatIncidentDate(incident.occurred_at)}
        </p>

        <div style={{ marginBottom: '0.9rem' }}>
          <p style={{ fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)', margin: '0 0 0.25rem' }}>
            What happened
          </p>
          <p style={{ fontSize: '0.9rem', lineHeight: 1.6, margin: 0, background: 'var(--color-surface)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
            {incident.description}
          </p>
        </div>

        {incident.immediate_action && (
          <div style={{ marginBottom: '0.9rem' }}>
            <p style={{ fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)', margin: '0 0 0.25rem' }}>
              Immediate action taken
            </p>
            <p style={{ fontSize: '0.9rem', lineHeight: 1.6, margin: 0, background: 'var(--color-surface)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
              {incident.immediate_action}
            </p>
          </div>
        )}

        {incident.status === 'resolved' && incident.resolution_notes && (
          <div style={{ marginBottom: '0.9rem' }}>
            <p style={{ fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)', margin: '0 0 0.25rem' }}>
              Resolution
            </p>
            <p style={{ fontSize: '0.9rem', lineHeight: 1.6, margin: 0, background: 'var(--color-surface)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
              {incident.resolution_notes}
            </p>
          </div>
        )}

        {canManage && incident.status !== 'resolved' && (
          <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
            <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Manage this incident</p>
            {incident.status === 'open' && (
              <button className="btn btn-secondary btn-full" style={{ marginBottom: '0.6rem' }}
                disabled={setStatus.isPending} onClick={() => setStatus.mutate('escalated')}>
                Escalate
              </button>
            )}
            <div className="field" style={{ marginBottom: '0.6rem' }}>
              <label htmlFor="inc-resolution">Resolution notes</label>
              <textarea id="inc-resolution" className="input" rows={2} style={{ resize: 'vertical' }}
                placeholder="What was done to resolve this?"
                value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-full" disabled={setStatus.isPending} onClick={() => setStatus.mutate('resolved')}>
              {setStatus.isPending ? <span className="spinner" /> : 'Mark resolved'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
