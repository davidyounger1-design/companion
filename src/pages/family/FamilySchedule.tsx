import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { useClientId } from '../../hooks/useClientId'
import { useKeyboardInset } from '../../hooks/useKeyboardInset'
import { useScheduleSkips } from '../../hooks/useScheduleSkips'
import FamilyBottomNav from '../../components/FamilyBottomNav'
import { MobileFooter } from '../../components/SiteFooter'
import ScheduleItemNotes from '../../components/ScheduleItemNotes'
import MiniDisk from '../../components/MiniDisk'
import TimeField from '../../components/TimeField'
import SegmentedControl from '../../components/SegmentedControl'
import UpNextHero from '../../components/UpNextHero'
import { ScheduleIcon, BackIcon, EditIcon, TrashIcon, PlusIcon, CheckIcon, CATEGORY_ICONS } from '../../components/icons'
import type { ScheduleCategory, ScheduleItem, ScheduleRecurrence } from '../../types/database'
import {
  CATEGORY_META, CATEGORY_OPTIONS, WEEKDAY_LABELS, WEEKDAY_LABELS_LONG,
  toLocalDateStr, parseLocalDate, timeToMinutes, formatTimeRange, formatTimeOfDay,
  occursOnDateActive, getItemStatus, itemDiskFraction, normalizeUrl,
} from '../../lib/schedule'
import { themedPageBackground } from '../../lib/timer'

/** What the add/edit sheet is doing:
 *  - new    → create a fresh item
 *  - edit   → change an existing item (whole series, if it recurs)
 *  - detach → make a one-off copy for a single date and skip the series that
 *             day, so "just this Saturday" can differ without touching the rest */
type FormIntent =
  | { mode: 'new' }
  | { mode: 'edit'; item: ScheduleItem }
  | { mode: 'detach'; item: ScheduleItem; date: string }

/** Minutes remaining in the activity if it's running now, else its total duration, else a sensible default. */
function minutesForTimerButton(item: ScheduleItem, status: string | null, nowMinutes: number): number {
  const start = timeToMinutes(item.start_time)
  const end = item.end_time ? timeToMinutes(item.end_time) : null
  if (status === 'current' && end != null) return Math.max(1, end - nowMinutes)
  if (end != null) return Math.max(1, end - start)
  return 15
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
  const [formIntent, setFormIntent] = useState<FormIntent | null>(null)
  // A recurring item's edit/delete can apply to the whole series or just the
  // day being viewed — this holds the pending choice until the user picks.
  const [scopeChoice, setScopeChoice] = useState<{ item: ScheduleItem; action: 'edit' | 'delete' } | null>(null)
  const [copyDayOpen, setCopyDayOpen] = useState(false)
  const [showTimerModal, setShowTimerModal] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const { clientId, participantName, recipientProfileId } = useClientId()
  const skips = useScheduleSkips(clientId)

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
    qc.invalidateQueries({ queryKey: ['schedule-skips', clientId] })
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

  // Remove a recurring item for ONE day, leaving the series intact.
  async function skipOccurrence(item: ScheduleItem, date: string) {
    if (!user || !clientId || !profile?.org_id) return
    await supabase.from('schedule_item_skips').insert({
      schedule_item_id: item.id, occurrence_date: date,
      client_id: clientId, org_id: profile.org_id, created_by: user.id,
    })
    invalidateAll()
  }

  // Copy every item showing on `fromDate` to `toDate` as one-off items.
  async function copyDayTo(fromDate: string, toDate: string) {
    if (!user || !clientId || !profile?.org_id) return
    const source = items
      .filter((i) => occursOnDateActive(i, fromDate, skips))
    if (source.length === 0) return
    const rows = source.map((i) => ({
      title: i.title,
      description: i.description,
      category: i.category,
      start_time: i.start_time,
      end_time: i.end_time,
      url: i.url,
      recurrence: 'once' as const,
      specific_date: toDate,
      days_of_week: null,
      client_id: clientId,
      org_id: profile!.org_id!,
      created_by: user.id,
    }))
    await supabase.from('schedule_items').insert(rows)
    invalidateAll()
  }

  // Edit/delete on a recurring item asks "this day or every week?" first;
  // one-off items act immediately.
  function handleEdit(item: ScheduleItem) {
    if (item.recurrence === 'weekly') setScopeChoice({ item, action: 'edit' })
    else setFormIntent({ mode: 'edit', item })
  }
  function handleDelete(item: ScheduleItem) {
    if (item.recurrence === 'weekly') setScopeChoice({ item, action: 'delete' })
    else deleteItem(item.id)
  }

  async function startRemoteTimer(remoteLabel: string, minutes: number, notify: boolean) {
    if (!clientId || !user || !profile?.org_id) return
    const endsAt = new Date(Date.now() + minutes * 60_000).toISOString()
    await supabase.from('active_timers').upsert({
      client_id: clientId, org_id: profile.org_id, created_by: user.id, label: remoteLabel, ends_at: endsAt,
    }, { onConflict: 'client_id' })
    if (notify && recipientProfileId) {
      await supabase.from('timer_alerts').insert({ user_id: recipientProfileId, org_id: profile.org_id, label: remoteLabel, fires_at: endsAt })
    }
    setShowTimerModal(false)
  }

  const todayStr = toLocalDateStr(new Date())
  const isToday = selectedDate === todayStr
  const nowMinutes = isToday ? new Date(now).getHours() * 60 + new Date(now).getMinutes() : 0

  const dayItems = useMemo(() => {
    return items
      .filter((i) => occursOnDateActive(i, selectedDate, skips))
      .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
  }, [items, selectedDate, skips])

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
    <div style={{ paddingBottom: 'calc(56px + var(--safe-bottom))' }}>
      <div style={{ position: 'sticky', top: 'var(--family-header-h, 0px)', zIndex: 10, background: themedPageBackground() }}>
      <div style={{
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)',
      }}>
        <button className="icon-btn" aria-label="Back" onClick={() => navigate('/family')}><BackIcon /></button>
        <h1 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ScheduleIcon size={20} /> {participantName}'s day
        </h1>
      </div>

      {/* Up next / happening now hero — stuck with the header so it's always visible */}
      {view === 'day' && isToday && (currentItem || nextItem) && (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '0.75rem 1rem' }}>
          <UpNextHero item={(currentItem ?? nextItem)!} isCurrent={!!currentItem} nowMinutes={nowMinutes} />
        </div>
      )}
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '1rem' }}>
        {canManage && clientId && (
          <button onClick={() => setShowTimerModal(true)} className="btn btn-secondary" style={{ width: '100%', marginBottom: '1rem', fontSize: '0.85rem' }}>
            ⏱️ Start a timer for {participantName}
          </button>
        )}

        {/* Today / Day / Week selector */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
          <button onClick={() => { setSelectedDate(todayStr); setView('day') }} className="btn btn-ghost" style={{
            padding: '0.4rem 0.9rem', fontSize: '0.82rem', color: 'var(--color-primary)',
          }}>Today</button>
          <SegmentedControl
            value={view}
            onChange={setView}
            options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]}
          />
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
                canManage={canManage || (isRecipient && item.created_by === user?.id)}
                showTimerButton={isRecipient}
                nowMinutes={nowMinutes}
                onToggleDone={() => toggleComplete(item)}
                onEdit={() => handleEdit(item)}
                onDelete={() => handleDelete(item)}
                onStartTimer={() => navigate(`/family/timer?minutes=${minutesForTimerButton(item, isToday ? getItemStatus(item, nowMinutes) : null, nowMinutes)}&label=${encodeURIComponent(item.title)}`)}
              />
            ))}
            {canManage && dayItems.length > 0 && (
              <button onClick={() => setCopyDayOpen(true)} className="btn btn-ghost" style={{
                width: '100%', marginTop: '0.25rem', fontSize: '0.82rem', color: 'var(--color-primary)',
              }}>Copy this day to another date…</button>
            )}
          </>
        )}

        {view === 'week' && !isLoading && (
          <WeekView
            weekDates={weekDates}
            items={items}
            skips={skips}
            todayStr={todayStr}
            onSelectDay={(date) => { setSelectedDate(date); setView('day') }}
          />
        )}

        <MobileFooter />
      </div>

      {(canManage || isRecipient) && (
        <button onClick={() => setFormIntent({ mode: 'new' })} aria-label="Add to schedule" className="fab">
          <PlusIcon size={22} />
        </button>
      )}

      {formIntent && clientId && profile?.org_id && user && (
        <ScheduleItemForm
          intent={formIntent}
          clientId={clientId}
          orgId={profile.org_id}
          userId={user.id}
          defaultDate={selectedDate}
          onClose={() => setFormIntent(null)}
          onSaved={() => { setFormIntent(null); invalidateAll() }}
        />
      )}

      {scopeChoice && (
        <ScopeChooser
          item={scopeChoice.item}
          action={scopeChoice.action}
          date={selectedDate}
          onClose={() => setScopeChoice(null)}
          onEditSeries={() => { setFormIntent({ mode: 'edit', item: scopeChoice.item }); setScopeChoice(null) }}
          onEditThisDay={() => { setFormIntent({ mode: 'detach', item: scopeChoice.item, date: selectedDate }); setScopeChoice(null) }}
          onDeleteSeries={() => { deleteItem(scopeChoice.item.id); setScopeChoice(null) }}
          onDeleteThisDay={() => { skipOccurrence(scopeChoice.item, selectedDate); setScopeChoice(null) }}
        />
      )}

      {copyDayOpen && (
        <CopyDayModal
          fromDate={selectedDate}
          onClose={() => setCopyDayOpen(false)}
          onCopy={async (toDate) => { await copyDayTo(selectedDate, toDate); setCopyDayOpen(false) }}
        />
      )}

      {showTimerModal && (
        <RemoteTimerModal
          participantName={participantName}
          canNotify={!!recipientProfileId}
          onClose={() => setShowTimerModal(false)}
          onStart={startRemoteTimer}
        />
      )}

      <FamilyBottomNav />
    </div>
  )
}


function WeekView({
  weekDates, items, skips, todayStr, onSelectDay,
}: {
  weekDates: string[]
  items: ScheduleItem[]
  skips: Set<string>
  todayStr: string
  onSelectDay: (date: string) => void
}) {
  return (
    <div>
      {weekDates.map((date) => {
        const dayItems = items
          .filter((i) => occursOnDateActive(i, date, skips))
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
  const Icon = CATEGORY_ICONS[item.category]
  const isCurrent = status === 'current'

  return (
    <div className="card" style={{
      marginBottom: '0.65rem', position: 'relative', padding: '0.9rem 1rem 0.9rem 1.1rem', overflow: 'hidden',
      opacity: done ? 0.6 : 1,
      boxShadow: isCurrent ? `0 0 0 2px color-mix(in srgb, ${meta.color} 55%, transparent), var(--shadow-sm)` : undefined,
      transition: 'opacity .2s',
    }}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: meta.color }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <span className="avatar avatar-sm" style={{ background: meta.color, marginTop: 1 }}><Icon size={15} /></span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
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
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.82rem', color: 'var(--color-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTimeRange(item.start_time, item.end_time)} · <span className={meta.badge} style={{ padding: '0.1rem 0.4rem', borderRadius: 99, fontVariantNumeric: 'initial' }}>{meta.label}</span>
          </p>
          {item.description && (
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.85rem', lineHeight: 1.5 }}>{item.description}</p>
          )}

          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" style={{
              marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem',
              fontSize: '0.82rem', color: meta.color, fontWeight: 700, textDecoration: 'none',
            }}>🔗 Visit website</a>
          )}

          <ScheduleItemNotes scheduleItemId={item.id} occurrenceDate={occurrenceDate} clientId={clientId} orgId={orgId} />

          {showTimerButton && (
            <button onClick={onStartTimer} style={{
              marginTop: '0.5rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: '0.75rem', color: meta.color, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem',
            }}>⏱️ Start a timer for this</button>
          )}
        </div>

        <button
          onClick={onToggleDone}
          aria-label={done ? 'Mark as not done' : 'Mark as done'}
          style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0, padding: 0, cursor: 'pointer',
            border: done ? 'none' : '2px solid color-mix(in srgb, var(--color-muted) 40%, transparent)',
            background: done ? meta.color : 'transparent',
            color: done ? '#fff' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: done ? 'scale(1.05)' : 'scale(1)',
            transition: 'background .25s cubic-bezier(.34,1.5,.4,1), border-color .2s, transform .25s cubic-bezier(.34,1.5,.4,1), color .25s',
          }}
        ><CheckIcon size={13} /></button>

        {canManage && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flexShrink: 0 }}>
            <button onClick={onEdit} aria-label="Edit" className="icon-btn" style={{ width: 30, height: 30 }}><EditIcon size={15} /></button>
            <button onClick={onDelete} aria-label="Delete" className="icon-btn icon-btn-danger" style={{ width: 30, height: 30 }}><TrashIcon size={15} /></button>
          </div>
        )}
      </div>
    </div>
  )
}

function ScheduleItemForm({
  intent, clientId, orgId, userId, defaultDate, onClose, onSaved,
}: {
  intent: FormIntent
  clientId: string
  orgId: string
  userId: string
  defaultDate: string
  onClose: () => void
  onSaved: () => void
}) {
  // For edit/detach we seed from the existing item; for new, blanks.
  const seed = intent.mode === 'new' ? null : intent.item
  const isDetach = intent.mode === 'detach'

  const [title, setTitle] = useState(seed?.title ?? '')
  const [description, setDescription] = useState(seed?.description ?? '')
  const [category, setCategory] = useState<ScheduleCategory>(seed?.category ?? 'other')
  const [startTime, setStartTime] = useState(seed?.start_time?.slice(0, 5) ?? '09:00')
  const [endTime, setEndTime] = useState(seed?.end_time?.slice(0, 5) ?? '')
  // Detach always produces a one-off for the chosen date; the when-picker is hidden.
  const [recurrence, setRecurrence] = useState<ScheduleRecurrence>(isDetach ? 'once' : (seed?.recurrence ?? 'once'))
  const [specificDate, setSpecificDate] = useState(isDetach ? intent.date : (seed?.specific_date ?? defaultDate))
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(isDetach ? [] : (seed?.days_of_week ?? []))
  const [url, setUrl] = useState(seed?.url ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const keyboardInset = useKeyboardInset()

  const detachLabel = isDetach
    ? parseLocalDate(intent.date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
    : ''

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
      url: url.trim() ? normalizeUrl(url) : null,
    }

    let saveError = null
    if (intent.mode === 'edit') {
      ({ error: saveError } = await supabase.from('schedule_items').update(payload).eq('id', intent.item.id))
    } else if (intent.mode === 'detach') {
      // A one-off replacement for just this date, plus a skip so the recurring
      // series doesn't ALSO show that day. Insert the item first; only skip the
      // series once the replacement actually landed.
      const { error: insErr } = await supabase.from('schedule_items')
        .insert({ ...payload, client_id: clientId, org_id: orgId, created_by: userId })
      saveError = insErr
      if (!insErr) {
        const { error: skipErr } = await supabase.from('schedule_item_skips').insert({
          schedule_item_id: intent.item.id, occurrence_date: intent.date,
          client_id: clientId, org_id: orgId, created_by: userId,
        })
        saveError = skipErr
      }
    } else {
      ({ error: saveError } = await supabase.from('schedule_items')
        .insert({ ...payload, client_id: clientId, org_id: orgId, created_by: userId }))
    }

    setSaving(false)
    if (saveError) { setError(saveError.message); return }
    onSaved()
  }

  return (
    <>
      <div onClick={onClose} className="sheet-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'rgba(0,0,0,0.4)' }} />
      <div className="sheet-panel" style={{
        position: 'fixed', bottom: keyboardInset, left: 0, right: 0, zIndex: 100, maxHeight: `calc(88dvh - ${keyboardInset}px)`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'var(--color-surface)', borderRadius: '20px 20px 0 0',
        boxShadow: 'var(--shadow-lg)', maxWidth: 520, margin: '0 auto',
      }}>
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '1rem 1.25rem 0' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
        </div>

        <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '1.05rem' }}>
          {intent.mode === 'detach' ? 'Edit just this day' : intent.mode === 'edit' ? 'Edit schedule item' : 'Add to schedule'}
        </p>
        {isDetach && (
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--color-muted)' }}>
            Changes apply to <strong>{detachLabel}</strong> only — the weekly series stays as it is on other days.
          </p>
        )}

        <div className="field" style={{ marginBottom: '0.75rem' }}>
          <label>Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Physio with Alex" />
        </div>

        <div className="field" style={{ marginBottom: '0.75rem' }}>
          <label>Notes for the schedule (optional)</label>
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Bring swimmers, meet at the front desk" style={{ resize: 'vertical' }} />
        </div>

        <div className="field" style={{ marginBottom: '0.75rem' }}>
          <label>Related website (optional)</label>
          <input className="input" type="text" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="e.g. zoom.us/j/123456789" />
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
            Shown as a link they can tap to open — a video call, a venue's site, anything relevant.
          </p>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div className="field">
            <label>Start time</label>
            <TimeField value={startTime} onChange={setStartTime} />
          </div>
          <div className="field">
            <label>End time (optional)</label>
            <TimeField value={endTime} onChange={setEndTime} optional />
          </div>
        </div>

        {!isDetach && (
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
        )}

        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem', fontSize: '0.82rem' }}>{error}</div>}
        <div style={{ height: '0.75rem' }} />
      </div>

      <div style={{
        display: 'flex', gap: '0.6rem', flexShrink: 0,
        padding: '0.75rem 1.25rem calc(1rem + env(safe-area-inset-bottom))',
        borderTop: '1px solid var(--color-border)',
      }}>
        <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 2 }}>
          {saving ? <span className="spinner" /> : intent.mode === 'new' ? 'Add to schedule' : 'Save changes'}
        </button>
      </div>
      </div>
    </>
  )
}

function RemoteTimerModal({
  participantName, canNotify, onClose, onStart,
}: {
  participantName: string
  canNotify: boolean
  onClose: () => void
  onStart: (label: string, minutes: number, notify: boolean) => Promise<void>
}) {
  const [label, setLabel] = useState('Timer')
  const [minutes, setMinutes] = useState(10)
  const [notify, setNotify] = useState(false)
  const [saving, setSaving] = useState(false)
  const quickPicks = [1, 5, 10, 15, 20, 30]
  const keyboardInset = useKeyboardInset()

  async function handleStart() {
    setSaving(true)
    await onStart(label.trim() || 'Timer', minutes, notify)
    setSaving(false)
  }

  return (
    <>
      <div onClick={onClose} className="sheet-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'rgba(0,0,0,0.4)' }} />
      <div className="sheet-panel" style={{
        position: 'fixed', bottom: keyboardInset, left: 0, right: 0, zIndex: 100, maxHeight: `calc(85dvh - ${keyboardInset}px)`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'var(--color-surface)', borderRadius: '20px 20px 0 0',
        boxShadow: 'var(--shadow-lg)', maxWidth: 480, margin: '0 auto',
      }}>
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '1rem 1.25rem 0' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
        </div>

        <p style={{ margin: '0 0 0.75rem', fontWeight: 700, fontSize: '1.05rem' }}>⏱️ Start a timer for {participantName}</p>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--color-muted)' }}>
          It'll appear counting down on {participantName}'s own Timer screen automatically.
        </p>

        <div className="field" style={{ marginBottom: '0.75rem' }}>
          <label>What's it for?</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Quiet time" />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>Duration</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {quickPicks.map((m) => (
              <button key={m} type="button" onClick={() => setMinutes(m)} style={{
                padding: '0.4rem 0.8rem', borderRadius: 99, fontSize: '0.82rem', cursor: 'pointer', fontWeight: minutes === m ? 700 : 400,
                border: `1.5px solid ${minutes === m ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: minutes === m ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)' : 'transparent',
              }}>{m} min</button>
            ))}
          </div>
        </div>

        {canNotify && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '1rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            🔔 Notify {participantName} even if they're not looking at their phone
          </label>
        )}
      </div>

      <div style={{
        display: 'flex', gap: '0.6rem', flexShrink: 0,
        padding: '0.75rem 1.25rem calc(1rem + env(safe-area-inset-bottom))',
        borderTop: '1px solid var(--color-border)',
      }}>
        <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
        <button className="btn btn-primary" onClick={handleStart} disabled={saving} style={{ flex: 2 }}>
          {saving ? <span className="spinner" /> : 'Start timer'}
        </button>
      </div>
      </div>
    </>
  )
}

/** Asks whether an edit/delete on a recurring item applies to just the day
 * being viewed or the whole weekly series. */
function ScopeChooser({
  item, action, date, onClose, onEditSeries, onEditThisDay, onDeleteSeries, onDeleteThisDay,
}: {
  item: ScheduleItem
  action: 'edit' | 'delete'
  date: string
  onClose: () => void
  onEditSeries: () => void
  onEditThisDay: () => void
  onDeleteSeries: () => void
  onDeleteThisDay: () => void
}) {
  const dayLabel = parseLocalDate(date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
  const keyboardInset = useKeyboardInset()

  return (
    <>
      <div onClick={onClose} className="sheet-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'rgba(0,0,0,0.4)' }} />
      <div className="sheet-panel" style={{
        position: 'fixed', bottom: keyboardInset, left: 0, right: 0, zIndex: 100,
        background: 'var(--color-surface)', borderRadius: '20px 20px 0 0',
        boxShadow: 'var(--shadow-lg)', maxWidth: 480, margin: '0 auto',
        padding: '1rem 1.25rem calc(1rem + env(safe-area-inset-bottom))',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
        </div>
        <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '1.05rem' }}>
          “{item.title}” repeats weekly
        </p>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          {action === 'edit'
            ? `Do you want to change every week, or just ${dayLabel}?`
            : `Remove it from every week, or just ${dayLabel}?`}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {action === 'edit' ? (
            <>
              <button className="btn btn-primary" onClick={onEditThisDay}>Edit just this day</button>
              <button className="btn btn-secondary" onClick={onEditSeries}>Edit every week</button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onDeleteThisDay}>Remove just this day</button>
              <button className="btn btn-ghost" onClick={onDeleteSeries} style={{ color: 'var(--color-error)', fontWeight: 600 }}>Delete every week</button>
            </>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  )
}

/** Copies a whole day's items onto another date. */
function CopyDayModal({
  fromDate, onClose, onCopy,
}: {
  fromDate: string
  onClose: () => void
  onCopy: (toDate: string) => Promise<void>
}) {
  // Default the target to the same day next week — the most common "repeat".
  const defaultTarget = useMemo(() => {
    const d = parseLocalDate(fromDate)
    d.setDate(d.getDate() + 7)
    return toLocalDateStr(d)
  }, [fromDate])
  const [toDate, setToDate] = useState(defaultTarget)
  const [saving, setSaving] = useState(false)
  const keyboardInset = useKeyboardInset()
  const fromLabel = parseLocalDate(fromDate).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

  async function handleCopy() {
    setSaving(true)
    await onCopy(toDate)
    setSaving(false)
  }

  return (
    <>
      <div onClick={onClose} className="sheet-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'rgba(0,0,0,0.4)' }} />
      <div className="sheet-panel" style={{
        position: 'fixed', bottom: keyboardInset, left: 0, right: 0, zIndex: 100,
        background: 'var(--color-surface)', borderRadius: '20px 20px 0 0',
        boxShadow: 'var(--shadow-lg)', maxWidth: 480, margin: '0 auto',
        padding: '1rem 1.25rem calc(1rem + env(safe-area-inset-bottom))',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
        </div>
        <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '1.05rem' }}>Copy this day</p>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          Everything showing on <strong>{fromLabel}</strong> will be copied to the date you choose, as one-off items.
        </p>

        <div className="field" style={{ marginBottom: '1rem' }}>
          <label>Copy to</label>
          <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCopy} disabled={saving || toDate === fromDate} style={{ flex: 2 }}>
            {saving ? <span className="spinner" /> : 'Copy day'}
          </button>
        </div>
      </div>
    </>
  )
}

