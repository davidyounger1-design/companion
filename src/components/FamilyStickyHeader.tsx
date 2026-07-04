import { useLayoutEffect, useRef } from 'react'
import FamilyHeader from './FamilyHeader'
import ScheduleStatusBar from './ScheduleStatusBar'

/** FamilyHeader + the "up next" banner, stuck to the top and measured so
 * pages with their own secondary sticky sub-header (Schedule, Notices,
 * Timer, Add entry, Edit participant) can offset by --family-header-h
 * instead of overlapping it — same pattern as useKeyboardInset in App.tsx.
 * Used by FamilyLayout for the nested family routes, and directly by
 * Messages (shared with the Worker portal) for family/coordinator users. */
export default function FamilyStickyHeader({ timerOnly = false }: { timerOnly?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => document.documentElement.style.setProperty('--family-header-h', `${el.offsetHeight}px`)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--family-header-h')
    }
  }, [])

  return (
    <div ref={ref} style={{ position: 'sticky', top: 0, zIndex: 10 }}>
      <FamilyHeader />
      <ScheduleStatusBar timerOnly={timerOnly} />
    </div>
  )
}
