import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(
    window.matchMedia('(display-mode: standalone)').matches
  )

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)

    const mq = window.matchMedia('(display-mode: standalone)')
    const mqHandler = (e: MediaQueryListEvent) => {
      if (e.matches) setIsInstalled(true)
    }
    mq.addEventListener('change', mqHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      mq.removeEventListener('change', mqHandler)
    }
  }, [])

  // iPadOS Safari has masqueraded as desktop macOS Safari (no "iPad" in the
  // UA string) since iPadOS 13, so the UA regex alone misses every iPad on
  // its default settings — catch it via the touch-screen "Mac" heuristic.
  const isIPadDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || isIPadDesktopMode
  // Safari never fires beforeinstallprompt, so iOS/iPadOS always needs the
  // manual "Add to Home Screen" instructions. Android usually gets a captured
  // `prompt`, but browsers that don't support the event (Firefox, some
  // Samsung Internet versions) or a user who dismissed it once need the same
  // manual fallback instead of silently showing nothing.
  const isAndroid = /android/i.test(navigator.userAgent)
  const canInstall = !isInstalled && (!!prompt || isIOS || isAndroid)

  async function install() {
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setPrompt(null)
  }

  return { canInstall, isInstalled, isIOS, isAndroid, hasPrompt: !!prompt, install }
}
