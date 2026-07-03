import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import FamilyBottomNav from '../../components/FamilyBottomNav'
import { MobileFooter } from '../../components/SiteFooter'
import ScheduleItemNotes from '../../components/ScheduleItemNotes'
import type { ScheduleCategory, ScheduleItem, ScheduleRecurrence } from '../../types/database'
import {
  CATEGORY_META, CATEGORY_OPTIONS, WEEKDAY_LABELS, WEEKDAY_LABELS_LONG,
  toLocalDateStr, parseLocalDate, timeToMinutes, formatTimeRange, formatTimeOfDay,
  occursOnDate, getItemStatus, formatCountdown,
} from '../../lib/schedule'
import { pieSlicePath } from '../../lib/timer'

/** Minutes remaining in the activity if it's running now, else its total duration, else a sensible default. */
function minutesForTimerButton(item: ScheduleItem, status: string | null, nowMinutes: number): number {
  const start = timeToMinutes(item.start_time)
  const end = item.end_time ? timeToMinutes(item.end_time) : null
  if (status === 'current' && end != null) return Math.max(1, end - nowMinutes)
  if (end != null) return Math.max(1, end - start)
  return 15
}

function MiniDisk({ fraction, color, size = 40 }: { fraction: number; color: string; size?: number }) {
  const c = size / 2
  const r = c - 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="var(--color-surface)" stroke={color} strokeWidth={1.5} opacity={0.5} />
      {fraction > 0.001 && <path d={pieSlicePath(c, c, r, fraction)} fill={color} />}
    </svg>
  )
}

export default function FamilySchedule() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const qc = useQueryClient()

  const isCoordinator = profile?.role === 'coordinator'
  const isFamily = profile?.role === 'family'
  const isRecipient = profile?.role === 'recipient'
  const canManage = isCoordinator || isFamily

  const [selectedDate, setSelectedDate] = useState(() => toLocalDateStr(new Date()))
  const [view, setView] = useState<'day' | 'week'>('day')
  const [now, setNow] = useState(() => Date.now())
  const [formItem, setFormItem] = useState<ScheduleItem | 'new' | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Same client-resolution logic as FamilyDashboard: recipients look up their
  // own client row, family/coordinator go via client_family.
  const { data: clientRow } = useQuery({
    queryKey: ['schedule-client', user?.id, profile?.role],
    queryFn: async () => {
      if (profile?.role === 'recipient') {
        const { data } = await supabase
          .from('clients')
          .select('id, full_name')
          .eq('recipient_profile_id', user!.id)
          .maybeSingle()
        return data ? { client_id: data.id, full_name: data.full_name } : null
      }
      const { data } = await supabase
        .from('client_family')
        .select('client_id, clients(full_name)')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clients = data?.clients as any
      return data ? { client_id: data.client_id, full_name: clients?.full_name } : null
    },
    enabled: !!user && !!profile,
  })

  const clientId = clientRow?.client_id
  const participantName = clientRow?.full_name ?? 'their'

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['schedule-items', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_items')
        .select('*')
        .eq('client_id', clientId!)
        .eq('active', true)
      if (error) throw error
      return data as ScheduleItem[]
    },
    enabled: !!clientId,
  })

  const { data: completedIds = new Set<string>() } = useQuery({
    queryKey: ['schedule-completions', clientId, selectedDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_item_completions')
        .select('schedule_item_id')
        .eq('client_id', clientId!)
        .eq('occurrence_date', selectedDate)
      if (error) throw error
      return new Set((data ?? []).map((c) => c.schedule_item_id))
    },
    enabled: !!clientId,
  })

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['schedule-items', clientId] })
    qc.invalidateQueries({ queryKey: ['schedule-completions', clientId] })
  }

  async function toggleComplete(item: ScheduleItem) {
    if (!user || !clientId || !profile?.org_id) return
    if (completedIds.has(item.id)) {
      await supabase.from('schedule_item_completions')
        .delete().eq('schedule_item_id', item.id).eq('occurrence_date', selectedDate)
    } else {
      await supabase.from('schedule_item_completions').insert({
        schedule_item_id: item.id,
        occurrence_date: selectedDate,
        client_id: clientId,
        org_id: profile.org_id,
        completed_by: user.id,
      })
    }
    qc.invalidateQueries({ queryKey: ['schedule-completions', clientId, selectedDate] })
  }

  async function deleteItem(id: string) {
    await supabase.from('schedule_items').delete().eq('id', id)
    invalidateAll()
  }

  const todayStr = toLocalDateStr(new Date())
  const isToday = selectedDate === todayStr
  const nowMinutes = isToday ? new Date(now).getHours() * 60 + new Date(now).getMinutes() : 0

  const dayItems = useMemo(() => {
    return items
      .filter((i) => occursOnDate(i, selectedDate))
      .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
  }, [items, selectedDate])

  const currentItem = isToday
    ? dayItems.find((i) => !completedIds.has(i.id) && getItemStatus(i, nowMinutes) === 'current')
    : undefined
  const nextItem = isToday
    ? dayItems.find((i) => !completedIds.has(i.id) && getItemStatus(i, nowMinutes) === 'upcoming')
    : undefined

  function shiftDay(delta: number) {
    const d = parseLocalDate(selectedDate)
    d.setDate(d.getDate() + delta)
    setSelectedDate(toLocalDateStr(d))
  }

  function shiftWeek(delta: number) {
    const d = parseLocalDate(selectedDate)
    d.setDate(d.getDate() + delta * 7)
    setSelectedDate(toLocalDateStr(d))
  }

  const dateLabel = parseLocalDate(selectedDate).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  // Sunday–Saturday week containing selectedDate, matching the days_of_week (0=Sun..6=Sat) convention.
  const weekDates = useMemo(() => {
    const sunday = parseLocalDate(selectedDate)
    sunday.setDate(sunday.getDate() - sunday.getDay())
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday)
      d.setDate(sunday.getDate() + i)
      return toLocalDateStr(d)
    })
  }, [selectedDate])

  const weekLabel = `${parseLocalDate(weekDates[0]).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${parseLocalDate(weekDates[6]).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: 'calc(56px + var(--safe-bottom))' }}>
      <div style={{
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate('/family')}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>📆 {participantName}'s day</h1>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '1rem' }}>
        {/* Day / Week toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'inline-flex', borderRadius: 99, background: 'color-mix(in srgb, var(--color-muted) 10%, transparent)', padding: 3 }}>
            {(['day', 'week'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '0.35rem 1.1rem', borderRadius: 99, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
                border: 'none', background: view === v ? 'var(--color-surface)' : 'transparent',
                color: view === v ? 'var(--color-ink)' : 'var(--color-muted)',
                boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.12)' : undefined,
              }}>{v === 'day' ? 'Day' : 'Week'}</button>
            ))}
          </div>
        </div>

        {/* Day / Week navigator */}
        {view === 'day' ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.5rem' }}>
            <button className="btn btn-ghost" onClick={() => shiftDay(-1)} style={{ padding: '0.4rem 0.75rem', fontSize: '1rem' }}>←</button>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem' }}>{isToday ? 'Today' : dateLabel}</p>
              {isToday && <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-muted)' }}>{dateLabel}</p>}
              {!isToday && (
                <button onClick={() => setSelectedDate(todayStr)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  fontSize: '0.72rem', color: 'var(--color-primary)', fontWeight: 600,
                }}>Jump to today</button>
              )}
            </div>
            <button className="btn btn-ghost" onClick={() => shiftDay(1)} style={{ padding: '0.4rem 0.75rem', fontSize: '1rem' }}>→</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.5rem' }}>
            <button className="btn btn-ghost" onClick={() => shiftWeek(-1)} style={{ padding: '0.4rem 0.75rem', fontSize: '1rem' }}>←</button>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem' }}>{weekLabel}</p>
              {!weekDates.includes(todayStr) && (
                <button onClick={() => setSelectedDate(todayStr)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  fontSize: '0.72rem', color: 'var(--color-primary)', fontWeight: 600,
                }}>Jump to this week</button>
              )}
            </div>
            <button className="btn btn-ghost" onClick={() => shiftWeek(1)} style={{ padding: '0.4rem 0.75rem', fontSize: '1rem' }}>→</button>
          </div>
        )}

        {/* Up next / happening now hero — only meaningful when looking at today in Day view */}
        {view === 'day' && isToday && (currentItem || nextItem) && (
          <HeroBanner item={(currentItem ?? nextItem)!} isCurrent={!!currentItem} nowMinutes={nowMinutes} />
        )}

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <div className="spinner" style={{ color: 'var(--color-primary)' }} />
          </div>
        )}

        {view === 'day' && !isLoading && (
          <>
            {dayItems.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-muted)' }}>
                <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🌤️</p>
                <p>Nothing scheduled for this day yet.</p>
              </div>
            )}
            {dayItems.map((item) => (
              <ScheduleCard
                key={item.id}
                item={item}
                occurrenceDate={selectedDate}
                clientId={clientId!}
                orgId={profile!.org_id!}
                done={completedIds.has(item.id)}
                status={isToday ? getItemStatus(item, nowMinutes) : null}
                isNext={nextItem?.id === item.id}
                canManage={canManage}
                showTimerButton={isRecipient}
                nowMinutes={nowMinutes}
                onToggleDone={() => toggleComplete(item)}
                onEdit={() => setFormItem(item)}
                onDelete={() => deleteItem(item.id)}
                onStartTimer={() => navigate(`/family/timer?minutes=${minutesForTimerButton(item, isToday ? getItemStatus(item, nowMinutes) : null, nowMinutes)}&label=${encodeURIComponent(item.title)}`)}
              />
            ))}
          </>
        )}

        {view === 'week' && !isLoading && (
          <WeekView
            weekDates={weekDates}
            items={items}
            todayStr={todayStr}
            onSelectDay={(date) => { setSelectedDate(date); setView('day') }}
          />
        )}

        <MobileFooter />
      </div>

      {canManage && (
        <button
          onClick={() => setFormItem('new')}
          aria-label="Add to schedule"
          style={{
            position: 'fixed', right: '1.25rem', bottom: 'calc(72px + var(--safe-bottom))',
            width: 52, height: 52, borderRadius: '50%', border: 'none',
            background: 'var(--color-primary)', color: '#fff', fontSize: '1.5rem',
            boxShadow: '0 4px 14px rgba(0,0,0,0.2)', cursor: 'pointer', zIndex: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >+</button>
      )}

      {formItem && clientId && profile?.org_id && user && (
        <ScheduleItemForm
          item={formItem === 'new' ? null : formItem}
          clientId={clientId}
          orgId={profile.org_id}
          userId={user.id}
          defaultDate={selectedDate}
          onClose={() => setFormItem(null)}
          onSaved={() => { setFormItem(null); invalidateAll() }}
        />
      )}

      <FamilyBottomNav />
    </div>
  )
}

/** Disk fill: for the current item, how much of ITS OWN duration is left; for an upcoming item, how close it is within a 60-min face. */
function itemDiskFraction(item: ScheduleItem, isCurrent: boolean, nowMinutes: number) {
  const start = timeToMinutes(item.start_time)
  const end = item.end_time ? timeToMinutes(item.end_time) : start + 1
  if (isCurrent) {
    const total = Math.max(1, end - start)
    return Math.max(0, (end - nowMinutes) / total)
  }
  return Math.max(0, Math.min(1, (start - nowMinutes) / 60))
}

function HeroBanner({ item, isCurrent, nowMinutes }: { item: ScheduleItem; isCurrent: boolean; nowMinutes: number }) {
  const meta = CATEGORY_META[item.category]
  return (
    <div style={{
      borderRadius: 18, padding: '1.1rem 1.25rem', marginBottom: '1.25rem',
      background: `linear-gradient(135deg, color-mix(in srgb, ${meta.color} 22%, var(--color-surface)), var(--color-surface))`,
      border: `2px solid color-mix(in srgb, ${meta.color} 45%, transparent)`,
    }}>
      <p style={{ margin: '0 0 0.3rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: meta.color }}>
        {isCurrent ? '🟢 Happening now' : '⏰ Up next'}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <MiniDisk fraction={itemDiskFraction(item, isCurrent, nowMinutes)} color={meta.color} size={52} />
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: '1.1rem' }}>{meta.emoji} {item.title}</p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-muted)' }}>
            {formatTimeRange(item.start_time, item.end_time)}
            {!isCurrent && ` · ${formatCountdown(nowMinutes, timeToMinutes(item.start_time))}`}
          </p>
        </div>
      </div>
    </div>
  )
}

function WeekView({
  weekDates, items, todayStr, onSelectDay,
}: {
  weekDates: string[]
  items: ScheduleItem[]
  todayStr: string
  onSelectDay: (date: string) => void
}) {
  return (
    <div>
      {weekDates.map((date) => {
        const dayItems = items
          .filter((i) => occursOnDate(i, date))
          .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
        const isToday = date === todayStr
        const label = parseLocalDate(date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })

        return (
          <button
            key={date}
            onClick={() => onSelectDay(date)}
            className="card"
            style={{
              display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
              marginBottom: '0.6rem', padding: '0.75rem 1rem',
              border: isToday ? '1.5px solid var(--color-primary)' : undefined,
            }}
          >
            <p style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', fontWeight: 700, color: isToday ? 'var(--color-primary)' : 'var(--color-ink)' }}>
              {isToday ? `Today · ${label}` : label}
            </p>
            {dayItems.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-muted)' }}>Nothing scheduled</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {dayItems.map((item) => {
                  const meta = CATEGORY_META[item.category]
                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                      <span style={{ color: 'var(--color-muted)', flexShrink: 0 }}>{formatTimeOfDay(item.start_time)}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.emoji} {item.title}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

function ScheduleCard({
  item, occurrenceDate, clientId, orgId, done, status, isNext, canManage, showTimerButton, nowMinutes,
  onToggleDone, onEdit, onDelete, onStartTimer,
}: {
  item: ScheduleItem
  occurrenceDate: string
  clientId: string
  orgId: string
  done: boolean
  status: 'current' | 'next' | 'upcoming' | 'past' | null
  isNext: boolean
  canManage: boolean
  showTimerButton: boolean
  nowMinutes: number
  onToggleDone: () => void
  onEdit: () => void
  onDelete: () => void
  onStartTimer: () => void
}) {
  const meta = CATEGORY_META[item.category]
  const isCurrent = status === 'current'

  return (
    <div className="card" style={{
      marginBottom: '0.75rem', position: 'relative', padding: '0.9rem 1rem',
      borderLeft: `5px solid ${meta.color}`,
      opacity: done ? 0.65 : 1,
      boxShadow: isCurrent ? `0 0 0 2px color-mix(in srgb, ${meta.color} 55%, transparent)` : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <button
          onClick={onToggleDone}
          aria-label={done ? 'Mark as not done' : 'Mark as done'}
          style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0, marginTop: 2,
            border: `2px solid ${done ? meta.color : 'color-mix(in srgb, var(--color-muted) 35%, transparent)'}`,
            background: done ? meta.color : 'transparent',
            color: done ? '#fff' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.9rem', cursor: 'pointer',
          }}
        >✓</button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.1rem' }}>{meta.emoji}</span>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem', textDecoration: done ? 'line-through' : 'none' }}>
              {item.title}
            </p>
            {isCurrent && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <span className="badge badge-terra">Now</span>
                <MiniDisk fraction={itemDiskFraction(item, true, nowMinutes)} color={meta.color} size={22} />
              </span>
            )}
            {isNext && !isCurrent && <span className="badge badge-sage">Next</span>}
            {item.recurrence === 'weekly' && <span className="badge badge-muted">🔁 Weekly</span>}
          </div>
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
            {formatTimeRange(item.start_time, item.end_time)} · <span className={meta.badge} style={{ padding: '0.1rem 0.4rem', borderRadius: 99 }}>{meta.label}</span>
          </p>
          {item.description && (
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem', lineHeight: 1.5 }}>{item.description}</p>
          )}

          <ScheduleItemNotes scheduleItemId={item.id} occurrenceDate={occurrenceDate} clientId={clientId} orgId={orgId} />

          {showTimerButton && (
            <button onClick={onStartTimer} style={{
              marginTop: '0.5rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: '0.75rem', color: meta.color, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem',
            }}>⏱️ Start a timer for this</button>
          )}
        </div>

        {canManage && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flexShrink: 0 }}>
            <button onClick={onEdit} aria-label="Edit" style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--color-muted)', padding: '0.2rem',
            }}>✏️</button>
            <button onClick={onDelete} aria-label="Delete" style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--color-muted)', padding: '0.2rem',
            }}>✕</button>
          </div>
        )}
      </div>
    </div>
  )
}

function ScheduleItemForm({
  item, clientId, orgId, userId, defaultDate, onClose, onSaved,
}: {
  item: ScheduleItem | null
  clientId: string
  orgId: string
  userId: string
  defaultDate: string
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [category, setCategory] = useState<ScheduleCategory>(item?.category ?? 'other')
  const [startTime, setStartTime] = useState(item?.start_time?.slice(0, 5) ?? '09:00')
  const [endTime, setEndTime] = useState(item?.end_time?.slice(0, 5) ?? '')
  const [recurrence, setRecurrence] = useState<ScheduleRecurrence>(item?.recurrence ?? 'once')
  const [specificDate, setSpecificDate] = useState(item?.specific_date ?? defaultDate)
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(item?.days_of_week ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleDay(d: number) {
    setDaysOfWeek((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort())
  }

  async function handleSave() {
    if (!title.trim()) { setError('Give it a title.'); return }
    if (recurrence === 'weekly' && daysOfWeek.length === 0) { setError('Pick at least one day of the week.'); return }
    setSaving(true)
    setError('')

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      category,
      start_time: startTime,
      end_time: endTime || null,
      recurrence,
      specific_date: recurrence === 'once' ? specificDate : null,
      days_of_week: recurrence === 'weekly' ? daysOfWeek : null,
    }

    const { error: saveError } = item
      ? await supabase.from('schedule_items').update(payload).eq('id', item.id)
      : await supabase.from('schedule_items').insert({ ...payload, client_id: clientId, org_id: orgId, created_by: userId })

    setSaving(false)
    if (saveError) { setError(saveError.message); return }
    onSaved()
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50, maxHeight: '88dvh', overflowY: 'auto',
        background: 'var(--color-surface)', borderRadius: '20px 20px 0 0',
        padding: '1rem 1.25rem calc(1.5rem + env(safe-area-inset-bottom))',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.15)', maxWidth: 520, margin: '0 auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
        </div>

        <p style={{ margin: '0 0 0.75rem', fontWeight: 700, fontSize: '1.05rem' }}>
          {item ? 'Edit schedule item' : 'Add to schedule'}
        </p>

        <div className="field" style={{ marginBottom: '0.75rem' }}>
          <label>Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Physio with Alex" />
        </div>

        <div className="field" style={{ marginBottom: '0.75rem' }}>
          <label>Notes for the schedule (optional)</label>
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Bring swimmers, meet at the front desk" style={{ resize: 'vertical' }} />
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>Category</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {CATEGORY_OPTIONS.map((c) => {
              const meta = CATEGORY_META[c]
              const active = category === c
              return (
                <button key={c} type="button" onClick={() => setCategory(c)} style={{
                  padding: '0.35rem 0.7rem', borderRadius: 99, fontSize: '0.8rem', cursor: 'pointer',
                  border: `1.5px solid ${active ? meta.color : 'color-mix(in srgb, var(--color-muted) 30%, transparent)'}`,
                  background: active ? `color-mix(in srgb, ${meta.color} 18%, transparent)` : 'transparent',
                  fontWeight: active ? 700 : 400,
                }}>{meta.emoji} {meta.label}</button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Start time</label>
            <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>End time (optional)</label>
            <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>When</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <button type="button" onClick={() => setRecurrence('once')} style={{
              flex: 1, padding: '0.5rem', borderRadius: 10, cursor: 'pointer',
              border: `1.5px solid ${recurrence === 'once' ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: recurrence === 'once' ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : 'transparent',
              fontWeight: recurrence === 'once' ? 700 : 400,
            }}>Once-off</button>
            <button type="button" onClick={() => setRecurrence('weekly')} style={{
              flex: 1, padding: '0.5rem', borderRadius: 10, cursor: 'pointer',
              border: `1.5px solid ${recurrence === 'weekly' ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: recurrence === 'weekly' ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : 'transparent',
              fontWeight: recurrence === 'weekly' ? 700 : 400,
            }}>🔁 Every week</button>
          </div>

          {recurrence === 'once' ? (
            <input className="input" type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} />
          ) : (
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
              {WEEKDAY_LABELS.map((label, d) => {
                const active = daysOfWeek.includes(d)
                return (
                  <button key={d} type="button" title={WEEKDAY_LABELS_LONG[d]} onClick={() => toggleDay(d)} style={{
                    width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', fontSize: '0.78rem',
                    border: `1.5px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: active ? 'var(--color-primary)' : 'transparent',
                    color: active ? '#fff' : 'var(--color-text)',
                    fontWeight: 700,
                  }}>{label[0]}</button>
                )
              })}
            </div>
          )}
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem', fontSize: '0.82rem' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 2 }}>
            {saving ? <span className="spinner" /> : item ? 'Save changes' : 'Add to schedule'}
          </button>
        </div>
      </div>
    </>
  )
}
