/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

// Bump on releases that must force installed PWAs onto a fresh app shell (the
// precache manifest is content-hashed per build, but this guarantees the SW
// bytes change so a waiting worker is reliably detected for the update prompt).
const SW_VERSION = '0.5.2'
void SW_VERSION

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// A new SW now WAITS instead of activating silently — the app shows an
// "update available" prompt (see UpdatePrompt.tsx) and, when the user taps
// Refresh, the page posts SKIP_WAITING so we activate + reload onto the new
// version. clientsClaim on activate so the freshly-activated SW controls the
// page immediately after the reload.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string })?.type === 'SKIP_WAITING') self.skipWaiting()
})
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  const title: string = data.title ?? 'Companion'
  const options: NotificationOptions = {
    body: data.body ?? 'You have a new message',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag ?? 'companion-msg',
    data: { url: data.url ?? '/messages' },
    requireInteraction: false,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url: string = (event.notification.data as { url?: string })?.url ?? '/messages'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url.includes(url))
        if (existing && 'focus' in existing) return (existing as WindowClient).focus()
        return self.clients.openWindow(url)
      }),
  )
})
