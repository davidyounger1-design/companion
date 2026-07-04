import { useEffect, useState } from 'react'

/** How much the on-screen keyboard currently overlaps the bottom of the
 * layout viewport, in px. iOS/Android keep `position: fixed` elements
 * pinned to the full layout height rather than the visual viewport, so a
 * fixed bottom sheet ends up hidden behind the keyboard unless it's lifted
 * by this amount while the keyboard is open. */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    function update() {
      const offset = window.innerHeight - vv!.height - vv!.offsetTop
      setInset(Math.max(0, Math.round(offset)))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
