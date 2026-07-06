import { useEffect, useRef, useState } from 'react'

/**
 * Shows a "new version available" banner when a fresh service worker has
 * installed and is waiting. Tapping Refresh tells the waiting worker to take
 * over (SKIP_WAITING) and reloads onto the new version — so an installed PWA
 * updates on demand instead of silently on some future cold start.
 *
 * First-ever install is skipped (no controller yet), so brand-new users don't
 * see a spurious "update" prompt on their first load.
 */
export default function UpdatePrompt() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const reloadingRef = useRef(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // When the new SW takes control after SKIP_WAITING, reload once.
    const onControllerChange = () => {
      if (reloadingRef.current) return
      reloadingRef.current = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    let interval: ReturnType<typeof setInterval> | undefined

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return

      const promote = (sw: ServiceWorker | null) => {
        // Only prompt if there's already a controller — i.e. this is an
        // update to an existing install, not the first-ever registration.
        if (sw && navigator.serviceWorker.controller) setWaiting(sw)
      }

      promote(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        if (!nw) return
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed') promote(nw)
        })
      })

      // Check for a new deploy periodically while the app stays open.
      interval = setInterval(() => { reg.update().catch(() => {}) }, 60_000)
    })

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      if (interval) clearInterval(interval)
    }
  }, [])

  if (!waiting) return null

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(72px + var(--safe-bottom, 0px))',
        zIndex: 200,
        width: 'calc(100% - 2rem)',
        maxWidth: 420,
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.75rem 0.9rem',
        borderRadius: 14,
        background: 'var(--color-primary-deep)',
        color: '#fff',
        boxShadow: '0 8px 28px -8px rgba(0,0,0,0.45)',
      }}
    >
      <span style={{ flex: 1, fontSize: '0.9rem', fontWeight: 500 }}>
        A new version of Companion is ready.
      </span>
      <button
        onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}
        style={{
          flexShrink: 0,
          background: '#fff',
          color: 'var(--color-primary-deep)',
          border: 'none',
          borderRadius: 9,
          padding: '0.5rem 0.9rem',
          fontSize: '0.85rem',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Refresh
      </button>
    </div>
  )
}
