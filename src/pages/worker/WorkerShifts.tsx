import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errorMessage'
import { useAuth } from '../../context/AuthContext'
import { useModalOpen } from '../../context/ModalActivityContext'
import { DAY_LABELS_LONG, STATUS_LABEL, STATUS_COLOR, formatTimeRange } from '../../lib/rostering'
import type { ShiftStatus } from '../../lib/rostering'

type Tab = 'mine' | 'open' | 'availability'

export default function WorkerShifts() {
  const [tab, setTab] = useState<Tab>('mine')

  return (
    <div className="page">
      <h1 style={{ fontSize: '1.5rem', fontWeight: 400, marginBottom: '1rem' }}>Shifts</h1>

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.25rem' }}>
        {(['mine', 'open', 'availability'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'btn btn-primary' : 'btn btn-ghost'} style={{ fontSize: '0.82rem' }} onClick={() => setTab(t)}>
            {t === 'mine' ? 'My shifts' : t === 'open' ? 'Open shifts' : 'Availability & skills'}
          </button>
        ))}
      </div>

      {tab === 'mine' && <MyShiftsTab />}
      {tab === 'open' && <OpenShiftsTab />}
      {tab === 'availability' && <AvailabilityTab />}
    </div>
  )
}

type ShiftRow = {
  id: string; program_id: string; starts_at: string; ends_at: string; status: ShiftStatus
  notes: string | null
}

function useProgramNames(programIds: string[]) {
  return useQuery({
    queryKey: ['program-names', programIds.join(',')],
    queryFn: async () => {
      if (!programIds.length) return {} as Record<string, string>
      const { data, error } = await supabase.from('programs').select('id, name').in('id', programIds)
      if (error) throw error
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.name]))
    },
    enabled: programIds.length > 0,
  })
}

function MyShiftsTab() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [handoverFor, setHandoverFor] = useState<ShiftRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const { data: shifts, refetch } = useQuery({
    queryKey: ['worker-my-shifts', user?.id],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('shifts').select('id, program_id, starts_at, ends_at, status, notes')
        .eq('worker_id', user!.id).order('starts_at')
      if (err) throw err
      return data as ShiftRow[]
    },
    enabled: !!user,
  })

  const { data: programNames } = useProgramNames([...new Set((shifts ?? []).map((s) => s.program_id))])

  async function act(shift: ShiftRow, name: 'confirm' | 'start') {
    setBusyId(shift.id); setError('')
    try {
      const { error: err } = await supabase.rpc(name === 'confirm' ? 'rostering_confirm_shift' : 'rostering_start_shift', { p_shift_id: shift.id })
      if (err) throw err
      refetch()
      qc.invalidateQueries({ queryKey: ['worker-today-shift'] })
    } catch (e) {
      setError(errorMessage(e, 'Could not update this shift.'))
    } finally {
      setBusyId(null)
    }
  }

  if (!shifts?.length) {
    return <div className="card" style={{ textAlign: 'center', padding: '2rem' }}><p style={{ color: 'var(--color-muted)' }}>No upcoming shifts.</p></div>
  }

  return (
    <div className="scroll-list">
      {error && <p style={{ fontSize: '0.8rem', color: 'var(--color-error)' }}>{error}</p>}
      {shifts.map((s) => {
        const c = STATUS_COLOR[s.status]
        return (
          <div key={s.id} className="card card-sm">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <div>
                <p style={{ fontWeight: 600, margin: 0 }}>{formatTimeRange(s.starts_at, s.ends_at)}</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: 0 }}>{programNames?.[s.program_id] ?? ''}</p>
              </div>
              <span className="badge" style={{ background: c.bg, color: c.fg }}>{STATUS_LABEL[s.status]}</span>
            </div>
            {s.notes && <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', margin: '0 0 0.4rem' }}>{s.notes}</p>}
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {s.status === 'published' && (
                <button className="btn btn-secondary" style={{ fontSize: '0.78rem' }} disabled={busyId === s.id} onClick={() => act(s, 'confirm')}>
                  {busyId === s.id ? <span className="spinner" /> : 'Confirm'}
                </button>
              )}
              {(s.status === 'published' || s.status === 'confirmed') && (
                <button className="btn btn-primary" style={{ fontSize: '0.78rem' }} disabled={busyId === s.id} onClick={() => act(s, 'start')}>
                  {busyId === s.id ? <span className="spinner" /> : 'Start shift'}
                </button>
              )}
              {s.status === 'in_progress' && (
                <button className="btn btn-primary" style={{ fontSize: '0.78rem' }} onClick={() => setHandoverFor(s)}>
                  End shift
                </button>
              )}
            </div>
          </div>
        )
      })}
      {handoverFor && (
        <HandoverModal shift={handoverFor} onClose={() => setHandoverFor(null)}
          onDone={() => { setHandoverFor(null); refetch(); qc.invalidateQueries({ queryKey: ['worker-today-shift'] }) }} />
      )}
    </div>
  )
}

function HandoverModal({ shift, onClose, onDone }: { shift: ShiftRow; onClose: () => void; onDone: () => void }) {
  useModalOpen()
  const [body, setBody] = useState('')
  const [nothingToHandOver, setNothingToHandOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!nothingToHandOver && !body.trim()) { setError('Add a handover note, or mark nothing to hand over.'); return }
    setSaving(true); setError('')
    try {
      const { error: err } = await supabase.rpc('rostering_end_shift', {
        p_shift_id: shift.id, p_handover_body: nothingToHandOver ? null : body.trim(), p_nothing_to_hand_over: nothingToHandOver,
      })
      if (err) throw err
      onDone()
    } catch (e) {
      setError(errorMessage(e, 'Could not end this shift.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 400, margin: 0 }}>End shift</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="field" style={{ marginBottom: '0.6rem' }}>
          <label>Handover note</label>
          <textarea className="input" rows={4} value={body} disabled={nothingToHandOver}
            onChange={(e) => setBody(e.target.value)} placeholder="What should the next worker know?" />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          <input type="checkbox" checked={nothingToHandOver} onChange={(e) => { setNothingToHandOver(e.target.checked); if (e.target.checked) setBody('') }} />
          Nothing to hand over
        </label>
        {error && <p style={{ fontSize: '0.8rem', color: 'var(--color-error)', marginBottom: '0.6rem' }}>{error}</p>}
        <button className="btn btn-primary btn-full" disabled={saving} onClick={handleSave}>
          {saving ? <span className="spinner" /> : 'End shift'}
        </button>
      </div>
    </div>
  )
}

function OpenShiftsTab() {
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const { data: shifts, refetch } = useQuery({
    queryKey: ['worker-open-shifts'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('shifts').select('id, program_id, starts_at, ends_at, status, notes')
        .eq('is_open', true).eq('status', 'published').order('starts_at')
      if (err) throw err
      return data as ShiftRow[]
    },
  })

  const { data: programNames } = useProgramNames([...new Set((shifts ?? []).map((s) => s.program_id))])

  async function claim(shift: ShiftRow) {
    setBusyId(shift.id); setError('')
    try {
      const { error: err } = await supabase.rpc('rostering_claim_shift', { p_shift_id: shift.id })
      if (err) throw err
      refetch()
      qc.invalidateQueries({ queryKey: ['worker-my-shifts'] })
    } catch (e) {
      setError(errorMessage(e, 'Could not claim this shift.'))
    } finally {
      setBusyId(null)
    }
  }

  if (!shifts?.length) {
    return <div className="card" style={{ textAlign: 'center', padding: '2rem' }}><p style={{ color: 'var(--color-muted)' }}>No open shifts right now.</p></div>
  }

  return (
    <div className="scroll-list">
      {error && <p style={{ fontSize: '0.8rem', color: 'var(--color-error)' }}>{error}</p>}
      {shifts.map((s) => (
        <div key={s.id} className="card card-sm" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontWeight: 600, margin: 0 }}>{formatTimeRange(s.starts_at, s.ends_at)}</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: 0 }}>{programNames?.[s.program_id] ?? ''}</p>
          </div>
          <button className="btn btn-primary" style={{ fontSize: '0.78rem' }} disabled={busyId === s.id} onClick={() => claim(s)}>
            {busyId === s.id ? <span className="spinner" /> : 'Claim'}
          </button>
        </div>
      ))}
    </div>
  )
}

function AvailabilityTab() {
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const { data: existingAvailability } = useQuery({
    queryKey: ['worker-own-availability', user?.id],
    queryFn: async () => {
      const { data, error: err } = await supabase.from('worker_availability').select('*').eq('worker_id', user!.id)
      if (err) throw err
      return data
    },
    enabled: !!user,
  })
  const { data: existingSkills } = useQuery({
    queryKey: ['worker-own-skills', user?.id],
    queryFn: async () => {
      const { data, error: err } = await supabase.from('profile_skills').select('skill').eq('profile_id', user!.id)
      if (err) throw err
      return data
    },
    enabled: !!user,
  })

  const [days, setDays] = useState<Record<number, { enabled: boolean; start: string; end: string }>>(() => {
    const init: Record<number, { enabled: boolean; start: string; end: string }> = {}
    for (let i = 0; i < 7; i++) init[i] = { enabled: false, start: '09:00', end: '17:00' }
    return init
  })
  const [skillsText, setSkillsText] = useState('')
  const [loaded, setLoaded] = useState(false)

  if (!loaded && existingAvailability && existingSkills) {
    const init = { ...days }
    for (const row of existingAvailability) {
      init[row.day_of_week] = { enabled: true, start: row.starts_time.slice(0, 5), end: row.ends_time.slice(0, 5) }
    }
    setDays(init)
    setSkillsText(existingSkills.map((s) => s.skill).join(', '))
    setLoaded(true)
  }

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const payload = Object.entries(days)
        .filter(([, v]) => v.enabled)
        .map(([dow, v]) => ({ day_of_week: Number(dow), starts_time: `${v.start}:00`, ends_time: `${v.end}:00` }))
      const { error: availErr } = await supabase.rpc('rostering_set_availability', { p_days: payload })
      if (availErr) throw availErr

      const skills = skillsText.split(',').map((s) => s.trim()).filter(Boolean)
      const { error: skillsErr } = await supabase.rpc('rostering_set_skills', { p_skills: skills })
      if (skillsErr) throw skillsErr

      setSaved(true)
    } catch (e) {
      setError(errorMessage(e, 'Could not save your availability.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <p className="eyebrow" style={{ marginBottom: '0.75rem' }}>Weekly availability</p>
        {DAY_LABELS_LONG.map((label, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: 110, fontSize: '0.85rem' }}>
              <input type="checkbox" checked={days[i].enabled}
                onChange={(e) => setDays({ ...days, [i]: { ...days[i], enabled: e.target.checked } })} />
              {label}
            </label>
            <input type="time" className="input" style={{ width: 110 }} disabled={!days[i].enabled} value={days[i].start}
              onChange={(e) => setDays({ ...days, [i]: { ...days[i], start: e.target.value } })} />
            <span>–</span>
            <input type="time" className="input" style={{ width: 110 }} disabled={!days[i].enabled} value={days[i].end}
              onChange={(e) => setDays({ ...days, [i]: { ...days[i], end: e.target.value } })} />
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Skills</p>
        <input className="input" value={skillsText} onChange={(e) => setSkillsText(e.target.value)} placeholder="e.g. manual handling, medication, first aid" />
        <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.4rem' }}>Comma-separated. Your coordinator matches these against shifts' required skills.</p>
      </div>

      {error && <p style={{ fontSize: '0.8rem', color: 'var(--color-error)', marginBottom: '0.6rem' }}>{error}</p>}
      {saved && <p style={{ fontSize: '0.8rem', color: '#16a34a', marginBottom: '0.6rem' }}>Saved.</p>}
      <button className="btn btn-primary btn-full" disabled={saving} onClick={handleSave}>
        {saving ? <span className="spinner" /> : 'Save'}
      </button>
    </div>
  )
}
