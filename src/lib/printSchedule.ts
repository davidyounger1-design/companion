/** True when running as an installed/home-screen PWA rather than a regular
 * browser tab. iOS/Android standalone webviews generally can't invoke the
 * system print dialog at all — window.print() silently no-ops — so callers
 * need to escape to a real browser tab instead. */
export function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/**
 * Print the current page, or — when running standalone, where the system
 * print dialog isn't reachable — open the given URL in a real browser tab
 * instead. That URL should carry whatever state (date, view, tab) plus a
 * print=1 marker the destination page needs to restore itself and trigger
 * window.print() once loaded there, where printing actually works.
 */
export function printOrEscapeToBrowser(printUrl: string) {
  if (isStandaloneDisplay()) {
    window.open(printUrl, '_blank')
  } else {
    window.print()
  }
}
