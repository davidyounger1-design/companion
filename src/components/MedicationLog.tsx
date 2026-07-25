import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { STATUS_LABEL, STATUS_COLOR, formatMedicationDate } from '../lib/medications'
import type { MedicationLog as MedicationLogType, MedicationLogStatus } from '../types/database'

const STATUSES = Object.keys(STATUS_LABEL) as MedicationLogStatus[]

export default function MedicationLog({
  medicationId,
  clientId,
  orgId,
}: {
  medicationId: string
  clientId: string
  orgId: string
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const queryKey = ['medication-logs', medicationId]

  const [showForm, setShowForm] = useState(false)
  const [status, setStatus] = useState<MedicationLogStatus>('taken')
  const [note, setNote] = useState('')

  const { data: logs } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medication_logs')
        .select('*')
        .eq('medication_id', medicationId)
        .order('administered_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as MedicationLogType[]
    },
    enabled: !!medicationId,
  })

  const addLog = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('medication_logs').insert({
        medication_id: medicationId,
        client_id: clientId,
        org_id: orgId,
        administered_by: user!.id,
        administered_at: new Date().toISOString(),
        status,
        note: note.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey })
      setShowForm(false)
      setStatus('taken')
      setNote('')
    },
  })

  return (
    <div style={{ marginTop: '0.75rem' }}>
      {!showForm ? (
        <button className="btn btn-ghost" onClick={() => setShowForm(true)}
          style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
          + Log administration
        </button>
      ) : (
        <div className="card card-sm" style={{ marginBottom: '0.75rem' }}>
          <form onSubmit={(e) => { e.preventDefault(); addLog.mutate() }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="field">
              <label htmlFor={`log-status-${medicationId}`}>Status</label>
              <select id={`log-status-${medicationId}`} className="input" value={status}
                onChange={(e) => setStatus(e.target.value as MedicationLogStatus)}>
                {STATUSES.filter(s => s !== 'missed').map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`log-note-${medicationId}`}>
                Note <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
              </label>
              <input id={`log-note-${medicationId}`} className="input"
                placeholder="e.g. Given with breakfast"
                value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {addLog.isError && (
              <div className="alert alert-error" style={{ fontSize: '0.8rem' }}>
                {addLog.error instanceof Error ? addLog.error.message : 'Could not save.'}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1, fontSize: '0.85rem' }}
                onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 2, fontSize: '0.85rem' }}
                disabled={addLog.isPending}>
                {addLog.isPending ? <span className="spinner" /> : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {!logs?.length ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: '0.5rem' }}>
          No administrations logged yet.
        </p>
      ) : (
        <div style={{ marginTop: '0.5rem' }}>
          {logs.map((log) => (
            <div key={log.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
              padding: '0.4rem 0', borderBottom: '1px solid var(--color-border)',
              fontSize: '0.8rem',
            }}>
              <span style={{
                flexShrink: 0, fontSize: '0.68rem', fontWeight: 600, padding: '0.15rem 0.45rem',
                borderRadius: 99, background: STATUS_COLOR[log.status].bg, color: STATUS_COLOR[log.status].fg,
              }}>
                {STATUS_LABEL[log.status]}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {log.note && <p style={{ margin: 0, fontSize: '0.8rem' }}>{log.note}</p>}
                <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-muted)' }}>
                  {formatMedicationDate(log.administered_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
