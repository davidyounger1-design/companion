import { Outlet, useLocation } from 'react-router-dom'
import FamilyStickyHeader from '../../components/FamilyStickyHeader'
import { themedPageBackground } from '../../lib/timer'

/** Shared shell for the whole family/recipient portal — the branded header
 * and the "up next" schedule banner stay stuck to the top on every page
 * (Journal, Schedule, Notices, Timer, Add entry, Edit participant), not just
 * the Journal. Mirrors WorkerLayout's Outlet pattern.
 *
 * The Schedule page already shows its own full "up next" hero inline, so the
 * compact banner there is timer-only — otherwise they'd duplicate. */
export default function FamilyLayout() {
  const { pathname } = useLocation()

  return (
    <div style={{ minHeight: '100dvh', background: themedPageBackground() }}>
      <FamilyStickyHeader timerOnly={pathname === '/family/schedule'} />
      <Outlet />
    </div>
  )
}
