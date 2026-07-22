import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

interface ModalActivityValue {
  anyOpen: boolean
  register: () => void
  unregister: () => void
}

const ModalActivityContext = createContext<ModalActivityValue | null>(null)

/**
 * Tracks how many popup modals/sheets are open across the whole app, so
 * background auto-refresh (notice/message polling, "up next" countdown
 * ticks, etc.) can pause while someone's mid-form in one — e.g. inviting a
 * member or editing a day note shouldn't get interrupted by data quietly
 * refreshing underneath. A count rather than a boolean flag so nested/
 * concurrent popups don't prematurely re-enable refresh when only one of
 * them closes.
 */
export function ModalActivityProvider({ children }: { children: ReactNode }) {
  const countRef = useRef(0)
  const [anyOpen, setAnyOpen] = useState(false)

  const register = useCallback(() => {
    countRef.current += 1
    setAnyOpen(true)
  }, [])

  const unregister = useCallback(() => {
    countRef.current = Math.max(0, countRef.current - 1)
    setAnyOpen(countRef.current > 0)
  }, [])

  return (
    <ModalActivityContext.Provider value={{ anyOpen, register, unregister }}>
      {children}
    </ModalActivityContext.Provider>
  )
}

/** Call unconditionally from a modal/popup/bottom-sheet component — it
 * registers for as long as that component stays mounted (i.e. only while
 * actually shown) and unregisters on close/unmount. */
export function useModalOpen() {
  const ctx = useContext(ModalActivityContext)
  useEffect(() => {
    if (!ctx) return
    ctx.register()
    return () => ctx.unregister()
  }, [ctx])
}

/** True while at least one component mounted via useModalOpen() is open. */
export function useAnyModalOpen(): boolean {
  return useContext(ModalActivityContext)?.anyOpen ?? false
}
