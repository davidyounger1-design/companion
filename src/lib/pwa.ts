/** True when running as an installed PWA (home-screen app), not a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari exposes this non-standard flag for home-screen apps.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
