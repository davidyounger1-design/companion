import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errorMessage'
import { useAuth } from '../../context/AuthContext'
import { useModalOpen } from '../../context/ModalActivityContext'
import { BackIcon } from '../../components/icons'
import {
  STATUS_LABEL, STATUS_COLOR, DAY_LABELS_SHORT,
  weekStartOf, addDaysToIsoDate, isoDateDow, utcDayOf, formatTimeRange, formatWeekRange,
  type WeekGridShift, type RosteringWarnings,
} from '../../lib/rostering'

export default function Rostering() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [weekStart, setWeekStart] = useState(() => weekStartOf(new Date()))
  const [programId, setProgramId] = useState<string | null>(null)
  const [createFor, setCreateFor] = useState<{ dayIso: string; workerId: string | null } | null>(null)
  const [editingShift, setEditingShift] = useState<WeekGridShift | null>(null)
  const [detailShift, setDetailShift] = useState<WeekGridShift | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showCopyForward, setShowCopyForward] = useState(false)
  const [dragShiftId, setDragShiftId] = useState<string | null>(null)

  const { data: programs } = useQuery({
    queryKey: ['rostering-programs', profile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('programs').select('id, name, kind, active')
        .eq('org_id', profile!.org_id!).eq('active', true).order('name')
      if (error) throw error
      return data
    },
    enabled: !!profile?.org_id,
  })

  useEffect(() => {
    if (!programId && programs?.length) setProgramId(programs[0].id)
  }, [programs, programId])

  const { data: workers } = useQuery({
    queryKey: ['rostering-program-workers', programId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('program_workers')
        .select('worker_id, profiles:worker_id(id, full_name)')
        .eq('program_id', programId!).is('removed_at', null)
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({ id: r.worker_id as string, full_name: (r.profiles?.full_name ?? 'Worker') as string }))
    },
    enabled: !!programId,
  })

  const { data: participants } = useQuery({
    queryKey: ['rostering-program-participants', programId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('program_participants')
        .select('participant_id, clients:participant_id(id, full_name)')
        .eq('program_id', programId!).is('left_at', null)
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({ id: r.participant_id as string, full_name: (r.clients?.full_name ?? 'Participant') as string }))
    },
    enabled: !!programId,
  })

  const { data: availability } = useQuery({
    queryKey: ['rostering-availability', workers?.map((w) => w.id).join(',')],
    queryFn: async () => {
      const ids = (workers ?? []).map((w) => w.id)
      if (!ids.length) return []
      const { data, error } = await supabase
        .from('worker_availability').select('worker_id, day_of_week, starts_time, ends_time').in('worker_id', ids)
      if (error) throw error
      return data ?? []
    },
    enabled: !!workers?.length,
  })

  const { data: skills } = useQuery({
    queryKey: ['rostering-skills', workers?.map((w) => w.id).join(',')],
    queryFn: async () => {
      const ids = (workers ?? []).map((w) => w.id)
      if (!ids.length) return []
      const { data, error } = await supabase.from('profile_skills').select('profile_id, skill').in('profile_id', ids)
      if (error) throw error
      return data ?? []
    },
    enabled: !!workers?.length,
  })

  const gridQueryKey = ['rostering-week-grid', programId, weekStart]
  const { data: shifts, isLoading: gridLoading } = useQuery({
    queryKey: gridQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rostering_week_grid', { p_week_start: weekStart, p_program_id: programId! })
      if (error) throw error
      return (data ?? []) as WeekGridShift[]
    },
    enabled: !!programId,
  })

  const warningsQueryKey = ['rostering-warnings', programId, weekStart]
  const { data: warnings } = useQuery({
    queryKey: warningsQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rostering_warnings', { p_week_start: weekStart, p_program_id: programId! })
      if (error) throw error
      return data as RosteringWarnings
    },
    enabled: !!programId,
  })

  // Realtime — the grid updates without polling (MessagesHub pattern).
  useEffect(() => {
    if (!profile?.org_id) return
    const ch = supabase.channel('rostering-shifts')
      .on('postgres_changes', { event: '*', schema: 'companion', table: 'shifts', filter: `org_id=eq.${profile.org_id}` }, () => {
        qc.invalidateQueries({ queryKey: ['rostering-week-grid'] })
        qc.invalidateQueries({ queryKey: ['rostering-warnings'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [profile?.org_id, qc])

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysToIsoDate(weekStart, i)), [weekStart])

  // Week summary — client-side only, from the grid result already fetched (§5.3, no new RPC).
  const summary = useMemo(() => {
    const byWorker = new Map<string, { name: string; hours: number; count: number; unconfirmed: number }>()
    for (const s of shifts ?? []) {
      if (!s.worker_id || s.status === 'cancelled') continue
      const hours = (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 3_600_000
      const row = byWorker.get(s.worker_id) ?? { name: s.worker_name ?? 'Worker', hours: 0, count: 0, unconfirmed: 0 }
      row.hours += hours
      row.count += 1
      if (s.status === 'published') row.unconfirmed += 1
      byWorker.set(s.worker_id, row)
    }
    return Array.from(byWorker.values())
  }, [shifts])

  function shiftsFor(dayIso: string, workerId: string | null) {
    return (shifts ?? []).filter((s) => utcDayOf(s.starts_at) === dayIso && s.worker_id === workerId)
  }
  const openShiftsByDay = useMemo(() => {
    const map = new Map<string, WeekGridShift[]>()
    for (const s of shifts ?? []) {
      if (!s.is_open) continue
      const day = utcDayOf(s.starts_at)
      map.set(day, [...(map.get(day) ?? []), s])
    }
    return map
  }, [shifts])

  async function handleDrop(dayIso: string, workerId: string | null) {
    const shiftId = dragShiftId
    setDragShiftId(null)
    if (!shiftId) return
    const shift = (shifts ?? []).find((s) => s.id === shiftId)
    if (!shift) return
    if (shift.worker_id === workerId && utcDayOf(shift.starts_at) === dayIso) return

    const dayDelta = isoDateDow(dayIso) - isoDateDow(utcDayOf(shift.starts_at))
    // Simple day-of-week delta isn't safe across week boundaries — recompute
    // via full date diff instead.
    const oldDay = utcDayOf(shift.starts_at)
    const msDelta = new Date(dayIso + 'T00:00:00Z').getTime() - new Date(oldDay + 'T00:00:00Z').getTime()
    const newStarts = new Date(new Date(shift.starts_at).getTime() + msDelta).toISOString()
    const newEnds = new Date(new Date(shift.ends_at).getTime() + msDelta).toISOString()
    void dayDelta

    try {
      if (shift.status === 'draft') {
        const { error } = await supabase.rpc('rostering_update_shift', {
          p_shift_id: shift.id, p_worker_id: workerId, p_starts_at: newStarts, p_ends_at: newEnds,
          p_participant_ids: (shift.participants ?? []).map((p) => p.id),
        })
        if (error) throw error
      } else {
        // Published/confirmed: cancel + recreate (§3 restricts schedule edits to draft).
        const { error: cancelErr } = await supabase.rpc('rostering_cancel_shift', { p_shift_id: shift.id, p_reason: 'Rescheduled via drag-and-drop' })
        if (cancelErr) throw cancelErr
        const { error: createErr } = await supabase.rpc('rostering_create_shift', {
          p_program_id: programId!, p_worker_id: workerId, p_starts_at: newStarts, p_ends_at: newEnds,
          p_participant_ids: (shift.participants ?? []).map((p) => p.id), p_notes: shift.notes,
        })
        if (createErr) throw createErr
      }
      qc.invalidateQueries({ queryKey: gridQueryKey })
      qc.invalidateQueries({ queryKey: warningsQueryKey })
    } catch (e) {
      alert(errorMessage(e, 'Could not move this shift.'))
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)' }}>
      <header style={{
        background: 'var(--color-surface)', borderBottom: '1px solid color-mix(in srgb, var(--color-muted) 20%, transparent)',
        padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button className="icon-btn" aria-label="Back" onClick={() => navigate('/dashboard')}><BackIcon /></button>
        <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>Rostering</h1>
        <div style={{ flex: 1 }} />
        {programs && programs.length > 0 && (
          <select className="input" style={{ width: 'auto' }} value={programId ?? ''} onChange={(e) => setProgramId(e.target.value)}>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </header>

      <main style={{ padding: '1.25rem', maxWidth: 1200, margin: '0 auto' }}>
        {!programs?.length ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <p style={{ color: 'var(--color-muted)', marginBottom: '0.5rem' }}>No programs exist yet.</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
              Rostering is organised by program. Programs are created directly for now — ask your MyAppBuddy contact
              to set up your first program before rostering shifts.
            </p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button className="icon-btn" aria-label="Previous week" onClick={() => setWeekStart(addDaysToIsoDate(weekStart, -7))}>‹</button>
                <span style={{ fontWeight: 600, minWidth: 140, textAlign: 'center' }}>{formatWeekRange(weekStart)}</span>
                <button className="icon-btn" aria-label="Next week" onClick={() => setWeekStart(addDaysToIsoDate(weekStart, 7))}>›</button>
                <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => setWeekStart(weekStartOf(new Date()))}>This week</button>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => setShowTemplates(true)}>Templates</button>
                <button className="btn btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => setShowCopyForward(true)}>Copy last week</button>
                <button className="btn btn-primary" style={{ fontSize: '0.85rem' }}
                  onClick={() => setCreateFor({ dayIso: weekStart, workerId: workers?.[0]?.id ?? null })}>
                  + Add shift
                </button>
              </div>
            </div>

            {warnings && (warnings.overlaps.length > 0 || warnings.uncovered.length > 0 || warnings.unconfirmed.length > 0) && (
              <WarningsPanel warnings={warnings} workers={workers ?? []} participants={participants ?? []} />
            )}

            {summary.length > 0 && (
              <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
                <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Week summary</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem' }}>
                  {summary.map((row) => (
                    <div key={row.name} style={{ fontSize: '0.82rem' }}>
                      <strong>{row.name}</strong>: {row.hours.toFixed(1)}h · {row.count} shift{row.count === 1 ? '' : 's'}
                      {row.unconfirmed > 0 && <span style={{ color: 'var(--color-error)' }}> · {row.unconfirmed} unconfirmed</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {gridLoading ? (
              <div style={{ textAlign: 'center', padding: '3rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.5rem', fontSize: '0.78rem', color: 'var(--color-muted)' }}>Worker</th>
                      {days.map((d, i) => (
                        <th key={d} style={{ textAlign: 'left', padding: '0.5rem', fontSize: '0.78rem', color: 'var(--color-muted)', minWidth: 130 }}>
                          {DAY_LABELS_SHORT[isoDateDow(d)]} {d.slice(8, 10)}
                          {i === 0 && ` `}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(workers ?? []).map((w) => (
                      <tr key={w.id}>
                        <td style={{ padding: '0.5rem', fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{w.full_name}</td>
                        {days.map((d) => (
                          <td key={d}
                            style={{ padding: '0.35rem', verticalAlign: 'top', border: '1px solid color-mix(in srgb, var(--color-muted) 12%, transparent)' }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleDrop(d, w.id)}
                          >
                            {shiftsFor(d, w.id).map((s) => (
                              <ShiftBlock key={s.id} shift={s}
                                draggable={s.status !== 'completed' && s.status !== 'cancelled'}
                                onDragStart={() => setDragShiftId(s.id)}
                                onClick={() => (s.status === 'draft' ? setEditingShift(s) : setDetailShift(s))} />
                            ))}
                            <button className="btn btn-ghost" style={{ fontSize: '0.7rem', padding: '0.1rem 0.3rem', opacity: 0.6 }}
                              onClick={() => setCreateFor({ dayIso: d, workerId: w.id })}>+ shift</button>
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <td style={{ padding: '0.5rem', fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-muted)' }}>Open shifts</td>
                      {days.map((d) => (
                        <td key={d} style={{ padding: '0.35rem', verticalAlign: 'top', border: '1px solid color-mix(in srgb, var(--color-muted) 12%, transparent)' }}>
                          {(openShiftsByDay.get(d) ?? []).map((s) => (
                            <ShiftBlock key={s.id} shift={s} draggable={false} onClick={() => setDetailShift(s)} />
                          ))}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>

      {createFor && programId && (
        <CreateShiftModal
          programId={programId} dayIso={createFor.dayIso} defaultWorkerId={createFor.workerId}
          workers={workers ?? []} participants={participants ?? []} availability={availability ?? []} skills={skills ?? []}
          onClose={() => setCreateFor(null)}
          onSaved={() => { setCreateFor(null); qc.invalidateQueries({ queryKey: gridQueryKey }); qc.invalidateQueries({ queryKey: warningsQueryKey }) }}
        />
      )}
      {editingShift && programId && (
        <CreateShiftModal
          programId={programId} dayIso={utcDayOf(editingShift.starts_at)} defaultWorkerId={editingShift.worker_id}
          editingShift={editingShift}
          workers={workers ?? []} participants={participants ?? []} availability={availability ?? []} skills={skills ?? []}
          onClose={() => setEditingShift(null)}
          onSaved={() => { setEditingShift(null); qc.invalidateQueries({ queryKey: gridQueryKey }); qc.invalidateQueries({ queryKey: warningsQueryKey }) }}
        />
      )}
      {detailShift && (
        <ShiftDetailModal shift={detailShift} onClose={() => setDetailShift(null)}
          onChanged={() => { setDetailShift(null); qc.invalidateQueries({ queryKey: gridQueryKey }); qc.invalidateQueries({ queryKey: warningsQueryKey }) }} />
      )}
      {showTemplates && programId && (
        <TemplateManagerModal programId={programId} workers={workers ?? []} participants={participants ?? []} onClose={() => setShowTemplates(false)} />
      )}
      {showCopyForward && programId && (
        <CopyForwardModal weekStart={weekStart} onClose={() => setShowCopyForward(false)}
          onDone={() => { setShowCopyForward(false); qc.invalidateQueries({ queryKey: gridQueryKey }); qc.invalidateQueries({ queryKey: warningsQueryKey }) }} />
      )}
    </div>
  )
}

function ShiftBlock({ shift, draggable, onDragStart, onClick }: {
  shift: WeekGridShift; draggable: boolean; onDragStart?: () => void; onClick: () => void
}) {
  const c = STATUS_COLOR[shift.status]
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      style={{
        background: c.bg, color: c.fg, borderRadius: 6, padding: '0.3rem 0.4rem', marginBottom: '0.25rem',
        fontSize: '0.72rem', cursor: 'pointer', lineHeight: 1.35,
      }}
      title={shift.notes ?? undefined}
    >
      <div style={{ fontWeight: 600 }}>{formatTimeRange(shift.starts_at, shift.ends_at)}</div>
      <div>{shift.is_open ? 'Open shift' : STATUS_LABEL[shift.status]}</div>
      {shift.participants && shift.participants.length > 0 && (
        <div style={{ opacity: 0.85 }}>{shift.participants.map((p) => p.full_name).join(', ')}</div>
      )}
    </div>
  )
}

function WarningsPanel({ warnings, workers, participants }: {
  warnings: RosteringWarnings
  workers: Array<{ id: string; full_name: string }>
  participants: Array<{ id: string; full_name: string }>
}) {
  const workerName = (id: string) => workers.find((w) => w.id === id)?.full_name ?? 'Worker'
  const participantName = (id: string) => participants.find((p) => p.id === id)?.full_name ?? 'Participant'
  return (
    <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', border: '1px solid color-mix(in srgb, var(--color-error) 30%, transparent)' }}>
      <p className="eyebrow" style={{ marginBottom: '0.5rem', color: 'var(--color-error)' }}>Warnings</p>
      {warnings.overlaps.length > 0 && (
        <p style={{ fontSize: '0.82rem', margin: '0.25rem 0' }}>
          ⚠ {warnings.overlaps.length} overlapping shift{warnings.overlaps.length === 1 ? '' : 's'}: {warnings.overlaps.map((o) => workerName(o.worker_id)).join(', ')}
        </p>
      )}
      {warnings.uncovered.length > 0 && (
        <p style={{ fontSize: '0.82rem', margin: '0.25rem 0' }}>
          ⚠ {warnings.uncovered.length} day{warnings.uncovered.length === 1 ? '' : 's'} with no cover: {[...new Set(warnings.uncovered.map((u) => participantName(u.participant_id)))].join(', ')}
        </p>
      )}
      {warnings.unconfirmed.length > 0 && (
        <p style={{ fontSize: '0.82rem', margin: '0.25rem 0' }}>
          ⚠ {warnings.unconfirmed.length} published shift{warnings.unconfirmed.length === 1 ? '' : 's'} not yet confirmed
        </p>
      )}
    </div>
  )
}

function CreateShiftModal({
  programId, dayIso, defaultWorkerId, editingShift, workers, participants, availability, skills, onClose, onSaved,
}: {
  programId: string
  dayIso: string
  defaultWorkerId: string | null
  editingShift?: WeekGridShift
  workers: Array<{ id: string; full_name: string }>
  participants: Array<{ id: string; full_name: string }>
  availability: Array<{ worker_id: string; day_of_week: number; starts_time: string; ends_time: string }>
  skills: Array<{ profile_id: string; skill: string }>
  onClose: () => void
  onSaved: () => void
}) {
  useModalOpen()
  const [workerId, setWorkerId] = useState<string>(editingShift?.worker_id ?? defaultWorkerId ?? '')
  const [startTime, setStartTime] = useState(editingShift ? new Date(editingShift.starts_at).toISOString().slice(11, 16) : '09:00')
  const [endTime, setEndTime] = useState(editingShift ? new Date(editingShift.ends_at).toISOString().slice(11, 16) : '17:00')
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>(editingShift?.participants?.map((p) => p.id) ?? [])
  const [notes, setNotes] = useState(editingShift?.notes ?? '')
  const [requiredSkills, setRequiredSkills] = useState((editingShift?.required_skills ?? []).join(', '))
  const [overrideNote, setOverrideNote] = useState('')
  const [overlapError, setOverlapError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const dow = isoDateDow(dayIso)
  const workerAvailability = availability.filter((a) => a.worker_id === workerId && a.day_of_week === dow)
  const workerSkills = new Set(skills.filter((s) => s.profile_id === workerId).map((s) => s.skill))
  const wantedSkills = requiredSkills.split(',').map((s) => s.trim()).filter(Boolean)
  const missingSkills = wantedSkills.filter((s) => !workerSkills.has(s))

  async function handleSave() {
    setSaving(true); setError(''); setOverlapError(null)
    const startsAt = new Date(`${dayIso}T${startTime}:00Z`).toISOString()
    const endsAt = new Date(`${dayIso}T${endTime}:00Z`).toISOString()
    try {
      if (editingShift) {
        const { error: err } = await supabase.rpc('rostering_update_shift', {
          p_shift_id: editingShift.id, p_worker_id: workerId || null, p_starts_at: startsAt, p_ends_at: endsAt,
          p_participant_ids: selectedParticipants, p_notes: notes || null, p_override_note: overrideNote || null,
        })
        if (err) throw err
      } else {
        const { error: err } = await supabase.rpc('rostering_create_shift', {
          p_program_id: programId, p_worker_id: workerId || null, p_starts_at: startsAt, p_ends_at: endsAt,
          p_participant_ids: selectedParticipants, p_notes: notes || null, p_override_note: overrideNote || null,
        })
        if (err) throw err
      }
      onSaved()
    } catch (e) {
      const msg = errorMessage(e, 'Could not save this shift.')
      if (msg.includes('overlaps')) setOverlapError(msg)
      else setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 400, margin: 0 }}>{editingShift ? 'Edit shift' : 'Add shift'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <div className="field" style={{ marginBottom: '0.6rem' }}>
          <label>Worker</label>
          <select className="input" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
            <option value="">— Open shift (unassigned) —</option>
            {workers.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
          </select>
          {workerId && workerAvailability.length === 0 && (
            <p style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.25rem' }}>
              ⚠ No availability recorded for this worker on {DAY_LABELS_SHORT[dow]}s.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.6rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Start time</label>
            <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>End time</label>
            <input type="time" className="input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>

        <div className="field" style={{ marginBottom: '0.6rem' }}>
          <label>Required skills (comma-separated, optional)</label>
          <input className="input" value={requiredSkills} onChange={(e) => setRequiredSkills(e.target.value)} placeholder="e.g. manual handling, medication" />
          {workerId && missingSkills.length > 0 && (
            <p style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.25rem' }}>
              ⚠ This worker is missing: {missingSkills.join(', ')}
            </p>
          )}
        </div>

        <div className="field" style={{ marginBottom: '0.6rem' }}>
          <label>Participants</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {participants.map((p) => {
              const selected = selectedParticipants.includes(p.id)
              return (
                <button key={p.id} type="button"
                  className="badge" style={{ background: selected ? 'var(--color-primary)' : 'color-mix(in srgb, var(--color-muted) 15%, transparent)', color: selected ? '#fff' : 'var(--color-ink)', cursor: 'pointer', border: 'none' }}
                  onClick={() => setSelectedParticipants((prev) => selected ? prev.filter((id) => id !== p.id) : [...prev, p.id])}>
                  {p.full_name}
                </button>
              )
            })}
          </div>
        </div>

        <div className="field" style={{ marginBottom: '0.6rem' }}>
          <label>Notes (optional)</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {overlapError && (
          <div className="field" style={{ marginBottom: '0.6rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-error)', marginBottom: '0.3rem' }}>{overlapError}</p>
            <label>Override reason (required to save anyway)</label>
            <input className="input" value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} placeholder="Why override this warning?" />
          </div>
        )}
        {error && <p style={{ fontSize: '0.8rem', color: 'var(--color-error)', marginBottom: '0.6rem' }}>{error}</p>}

        <button className="btn btn-primary btn-full" disabled={saving} onClick={handleSave}>
          {saving ? <span className="spinner" /> : editingShift ? 'Save changes' : 'Create shift'}
        </button>
      </div>
    </div>
  )
}

function ShiftDetailModal({ shift, onClose, onChanged }: { shift: WeekGridShift; onClose: () => void; onChanged: () => void }) {
  useModalOpen()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const { data: handovers } = useQuery({
    queryKey: ['shift-handovers', shift.id],
    queryFn: async () => {
      const { data, error: err } = await supabase.from('shift_handovers').select('*').eq('shift_id', shift.id).order('created_at', { ascending: false })
      if (err) throw err
      return data
    },
  })

  async function act(name: 'publish' | 'cancel' | 'delete') {
    setBusy(name); setError('')
    try {
      if (name === 'publish') {
        const { error: err } = await supabase.rpc('rostering_publish_shift', { p_shift_id: shift.id })
        if (err) throw err
      } else if (name === 'cancel') {
        const reason = prompt('Reason for cancelling this shift?') ?? ''
        const { error: err } = await supabase.rpc('rostering_cancel_shift', { p_shift_id: shift.id, p_reason: reason })
        if (err) throw err
      } else {
        if (!confirm('Delete this shift? This cannot be undone.')) { setBusy(null); return }
        const { error: err } = await supabase.rpc('rostering_delete_shift', { p_shift_id: shift.id })
        if (err) throw err
      }
      onChanged()
    } catch (e) {
      setError(errorMessage(e, 'Could not update this shift.'))
      setBusy(null)
    }
  }

  const c = STATUS_COLOR[shift.status]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 400, margin: 0 }}>{formatTimeRange(shift.starts_at, shift.ends_at)}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <span className="badge" style={{ background: c.bg, color: c.fg, marginBottom: '0.75rem', display: 'inline-block' }}>
          {shift.is_open ? 'Open shift' : STATUS_LABEL[shift.status]}
        </span>

        {shift.worker_name && <p style={{ fontSize: '0.9rem' }}><strong>Worker:</strong> {shift.worker_name}</p>}
        {shift.participants && shift.participants.length > 0 && (
          <p style={{ fontSize: '0.9rem' }}><strong>Participants:</strong> {shift.participants.map((p) => p.full_name).join(', ')}</p>
        )}
        {shift.notes && <p style={{ fontSize: '0.9rem' }}><strong>Notes:</strong> {shift.notes}</p>}

        {handovers && handovers.length > 0 && (
          <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
            <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>Handover (read-only)</p>
            {handovers.map((h) => (
              <p key={h.id} style={{ fontSize: '0.85rem', background: 'var(--color-surface)', borderRadius: 8, padding: '0.5rem 0.65rem', marginBottom: '0.4rem' }}>
                {h.nothing_to_hand_over ? 'Nothing to hand over.' : h.body}
              </p>
            ))}
          </div>
        )}

        {error && <p style={{ fontSize: '0.8rem', color: 'var(--color-error)', marginTop: '0.6rem' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          {shift.status === 'draft' && (
            <button className="btn btn-primary" disabled={!!busy} onClick={() => act('publish')}>
              {busy === 'publish' ? <span className="spinner" /> : 'Publish'}
            </button>
          )}
          {(shift.status === 'draft' || shift.status === 'published' || shift.status === 'confirmed') && (
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => act('cancel')}>
              {busy === 'cancel' ? <span className="spinner" /> : 'Cancel shift'}
            </button>
          )}
          {(shift.status === 'draft' || shift.status === 'published' || shift.status === 'confirmed') && (
            <button className="btn btn-ghost" style={{ color: 'var(--color-error)' }} disabled={!!busy} onClick={() => act('delete')}>
              {busy === 'delete' ? <span className="spinner" /> : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CopyForwardModal({ weekStart, onClose, onDone }: { weekStart: string; onClose: () => void; onDone: () => void }) {
  useModalOpen()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)
  const sourceWeek = addDaysToIsoDate(weekStart, -7)

  async function handleCopy() {
    setSaving(true); setError('')
    try {
      const { data, error: err } = await supabase.rpc('rostering_copy_forward', { p_source_week: sourceWeek, p_target_week: weekStart })
      if (err) throw err
      setResult(data as { created: number; skipped: number })
    } catch (e) {
      setError(errorMessage(e, 'Could not copy last week forward.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 400, margin: 0 }}>Copy last week forward</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
          Copies {formatWeekRange(sourceWeek)} into {formatWeekRange(weekStart)} as new draft shifts. Shifts whose
          worker no longer staffs the program, or that would conflict with an existing shift, are skipped.
        </p>
        {result ? (
          <>
            <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>Created {result.created}, skipped {result.skipped}.</p>
            <button className="btn btn-primary btn-full" onClick={() => { onDone() }}>Done</button>
          </>
        ) : (
          <>
            {error && <p style={{ fontSize: '0.8rem', color: 'var(--color-error)', marginBottom: '0.6rem' }}>{error}</p>}
            <button className="btn btn-primary btn-full" disabled={saving} onClick={handleCopy}>
              {saving ? <span className="spinner" /> : 'Copy forward'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function TemplateManagerModal({ programId, workers, participants, onClose }: {
  programId: string
  workers: Array<{ id: string; full_name: string }>
  participants: Array<{ id: string; full_name: string }>
  onClose: () => void
}) {
  useModalOpen()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)

  const { data: templates, refetch } = useQuery({
    queryKey: ['shift-templates', programId],
    queryFn: async () => {
      const { data, error } = await supabase.from('shift_templates').select('*').eq('program_id', programId).order('day_of_week')
      if (error) throw error
      return data
    },
  })

  const pauseMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.rpc('rostering_pause_template', { p_id: id, p_active: active })
      if (error) throw error
    },
    onSuccess: () => refetch(),
  })
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('rostering_delete_template', { p_id: id })
      if (error) throw error
    },
    onSuccess: () => refetch(),
  })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 400, margin: 0 }}>Recurring shift templates</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        {!templates?.length ? (
          <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>No recurring templates yet.</p>
        ) : (
          <div className="scroll-list" style={{ marginBottom: '1rem' }}>
            {templates.map((t) => (
              <div key={t.id} className="card card-sm" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontWeight: 600, margin: 0, fontSize: '0.9rem' }}>
                    {DAY_LABELS_SHORT[t.day_of_week]} {t.starts_time.slice(0, 5)}–{t.ends_time.slice(0, 5)}
                  </p>
                  <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: 0 }}>
                    {workers.find((w) => w.id === t.worker_id)?.full_name ?? 'Worker'}
                    {t.end_date && ` · until ${t.end_date}`}
                    {!t.active && ' · paused'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button className="btn btn-ghost" style={{ fontSize: '0.78rem' }}
                    onClick={() => pauseMutation.mutate({ id: t.id, active: !t.active })}>
                    {t.active ? 'Pause' : 'Resume'}
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: '0.78rem', color: 'var(--color-error)' }}
                    onClick={() => { if (confirm('Delete this template? Already-generated shifts are kept.')) deleteMutation.mutate(t.id) }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {creating ? (
          <NewTemplateForm programId={programId} workers={workers} participants={participants}
            onDone={() => { setCreating(false); refetch(); qc.invalidateQueries({ queryKey: ['shift-templates', programId] }) }} />
        ) : (
          <button className="btn btn-secondary btn-full" onClick={() => setCreating(true)}>+ New template</button>
        )}
      </div>
    </div>
  )
}

function NewTemplateForm({ programId, workers, participants, onDone }: {
  programId: string
  workers: Array<{ id: string; full_name: string }>
  participants: Array<{ id: string; full_name: string }>
  onDone: () => void
}) {
  const [workerId, setWorkerId] = useState(workers[0]?.id ?? '')
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [endDate, setEndDate] = useState('')
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!workerId) { setError('Choose a worker.'); return }
    setSaving(true); setError('')
    try {
      const { error: err } = await supabase.rpc('rostering_create_template', {
        p_program_id: programId, p_worker_id: workerId, p_day_of_week: dayOfWeek,
        p_starts_time: `${startTime}:00`, p_ends_time: `${endTime}:00`,
        p_end_date: endDate || null, p_participant_ids: selectedParticipants,
      })
      if (err) throw err
      onDone()
    } catch (e) {
      setError(errorMessage(e, 'Could not create this template.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
      <div className="field" style={{ marginBottom: '0.5rem' }}>
        <label>Worker</label>
        <select className="input" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
          {workers.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
        </select>
      </div>
      <div className="field" style={{ marginBottom: '0.5rem' }}>
        <label>Day of week</label>
        <select className="input" value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
          {DAY_LABELS_SHORT.map((d, i) => <option key={i} value={i}>{d}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.5rem' }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Start time</label>
          <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>End time</label>
          <input type="time" className="input" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      </div>
      <div className="field" style={{ marginBottom: '0.5rem' }}>
        <label>Ends on (optional — blank generates indefinitely)</label>
        <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: '0.6rem' }}>
        <label>Participants</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {participants.map((p) => {
            const selected = selectedParticipants.includes(p.id)
            return (
              <button key={p.id} type="button"
                className="badge" style={{ background: selected ? 'var(--color-primary)' : 'color-mix(in srgb, var(--color-muted) 15%, transparent)', color: selected ? '#fff' : 'var(--color-ink)', cursor: 'pointer', border: 'none' }}
                onClick={() => setSelectedParticipants((prev) => selected ? prev.filter((id) => id !== p.id) : [...prev, p.id])}>
                {p.full_name}
              </button>
            )
          })}
        </div>
      </div>
      {error && <p style={{ fontSize: '0.8rem', color: 'var(--color-error)', marginBottom: '0.5rem' }}>{error}</p>}
      <button className="btn btn-primary btn-full" disabled={saving} onClick={handleSave}>
        {saving ? <span className="spinner" /> : 'Create template'}
      </button>
    </div>
  )
}
