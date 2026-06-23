import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { LogType } from '../../types/database'

const LOG_TYPES: { type: LogType; icon: string; label: string }[] = [
  { type: 'meal',     icon: '🍽️', label: 'Meal' },
  { type: 'activity', icon: '🌿', label: 'Activity' },
  { type: 'mood',     icon: '😊', label: 'Mood' },
  { type: 'photo',    icon: '📷', label: 'Photo' },
]

const schema = z.object({
  label: z.string().min(1, 'Please describe what happened'),
})
type FormData = z.infer<typeof schema>

export default function WorkerClientDetail() {
  const { clientId } = useParams<{ clientId: string }>()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [selectedType, setSelectedType] = useState<LogType>('activity')
  const [showForm, setShowForm] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ['client', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId!)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!clientId,
  })

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['logs', clientId],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('log_entries')
        .select('*')
        .eq('client_id', clientId!)
        .gte('occurred_at', `${today}T00:00:00`)
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!clientId,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const addLog = useMutation({
    mutationFn: async (data: FormData) => {
      const { error } = await supabase.from('log_entries').insert({
        client_id: clientId!,
        org_id: profile!.org_id!,
        author_id: user!.id,
        type: selectedType,
        label: data.label,
        occurred_at: new Date().toISOString(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logs', clientId] })
      qc.invalidateQueries({ queryKey: ['today-logs-worker'] })
      reset()
      setShowForm(false)
      setSuccessMsg('Entry saved!')
      setTimeout(() => setSuccessMsg(''), 3000)
    },
  })

  if (clientLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem' }}>
        <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="page">
        <p style={{ color: 'var(--color-muted)' }}>Client not found.</p>
        <Link to="/worker" className="btn btn-ghost">← Back</Link>
      </div>
    )
  }

  return (
    <div className="page">
      {/* Back */}
      <button
        className="btn btn-ghost"
        onClick={() => navigate('/worker')}
        style={{ padding: '0.25rem 0', marginBottom: '0.75rem', fontSize: '0.875rem' }}
      >
        ← My clients
      </button>

      {/* Client header */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 400, margin: '0 0 0.25rem' }}>{client.full_name}</h1>
        {client.setting && <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', margin: 0 }}>{client.setting}</p>}
        {client.about?.loves && (
          <p style={{ fontSize: '0.85rem', marginTop: '0.75rem', margin: '0.75rem 0 0' }}>
            <span style={{ color: 'var(--color-muted)' }}>Loves: </span>{client.about.loves}
          </p>
        )}
      </div>

      {successMsg && (
        <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
          {successMsg}
        </div>
      )}

      {/* Log entry form */}
      {!showForm ? (
        <button
          className="btn btn-primary btn-full"
          onClick={() => setShowForm(true)}
          style={{ marginBottom: '1.5rem' }}
        >
          + Add log entry
        </button>
      ) : (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.95rem' }}>New log entry</p>

          {/* Type picker */}
          <div className="log-type-grid" style={{ marginBottom: '1rem' }}>
            {LOG_TYPES.map(({ type, icon, label }) => (
              <button
                key={type}
                type="button"
                className={`log-type-btn${selectedType === type ? ' selected' : ''}`}
                onClick={() => setSelectedType(type)}
              >
                <span className="icon">{icon}</span>
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit((d) => addLog.mutate(d))} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="field">
              <label htmlFor="label">
                {selectedType === 'meal' && 'What did they eat?'}
                {selectedType === 'activity' && 'What did they do?'}
                {selectedType === 'mood' && 'How were they feeling?'}
                {selectedType === 'photo' && 'Describe the photo'}
              </label>
              <textarea
                id="label"
                className={`input${errors.label ? ' error' : ''}`}
                rows={3}
                placeholder={
                  selectedType === 'meal' ? 'e.g. Porridge with banana, decaf coffee' :
                  selectedType === 'activity' ? 'e.g. Walked to the park, fed the ducks' :
                  selectedType === 'mood' ? 'e.g. Calm and engaged all morning' :
                  'e.g. Smiling in the garden'
                }
                style={{ resize: 'vertical' }}
                {...register('label')}
              />
              {errors.label && <span className="field-error">{errors.label.message}</span>}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setShowForm(false); reset() }}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={addLog.isPending}
                style={{ flex: 2 }}
              >
                {addLog.isPending ? <span className="spinner" /> : 'Save entry'}
              </button>
            </div>

            {addLog.isError && (
              <div className="alert alert-error">
                {addLog.error instanceof Error ? addLog.error.message : 'Could not save. Try again.'}
              </div>
            )}
          </form>
        </div>
      )}

      {/* Today's log */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '1rem', fontFamily: 'var(--font-ui)', fontWeight: 700, margin: 0 }}>Today so far</h2>
        {logs && <span className="badge badge-muted">{logs.length} {logs.length === 1 ? 'entry' : 'entries'}</span>}
      </div>

      {logsLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
        </div>
      ) : !logs?.length ? (
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
          No entries yet today.
        </p>
      ) : (
        <div className="scroll-list">
          {logs.map((log) => {
            const typeInfo = LOG_TYPES.find((t) => t.type === log.type)
            return (
              <div key={log.id} className="card card-sm" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{typeInfo?.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 500 }}>{log.label}</p>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                    {new Date(log.occurred_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    {typeInfo?.label}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
