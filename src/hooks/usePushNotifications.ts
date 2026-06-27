import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export type PushState = 'unsupported' | 'denied' | 'granted' | 'default'

export function usePushNotifications() {
  const { user, profile } = useAuth()
  const [permission, setPermission] = useState<PushState>('default')
  const [subscribing, setSubscribing] = useState(false)

  useEffect(() => {
    if (!('Notification' in window)) {
      setPermission('unsupported')
    } else {
      setPermission(Notification.permission as PushState)
    }
  }, [])

  async function subscribe(): Promise<boolean> {
    if (!user || !('serviceWorker' in navigator) || !VAPID_PUBLIC) return false
    setSubscribing(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm as PushState)
      if (perm !== 'granted') return false

      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC).buffer as ArrayBuffer,
      })

      const json = sub.toJSON()
      const keys = json.keys as { p256dh: string; auth: string }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('push_subscriptions').upsert({
        user_id:  user.id,
        org_id:   profile?.org_id ?? null,
        endpoint: sub.endpoint,
        p256dh:   keys.p256dh,
        auth:     keys.auth,
      }, { onConflict: 'user_id,endpoint' })

      return true
    } catch (err) {
      console.warn('Push subscribe failed:', err)
      return false
    } finally {
      setSubscribing(false)
    }
  }

  async function unsubscribe() {
    if (!user) return
    const reg = await navigator.serviceWorker.ready.catch(() => null)
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await sub.unsubscribe()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('push_subscriptions')
        .delete()
        .eq('user_id', user.id)
        .eq('endpoint', sub.endpoint)
    }
    setPermission('default')
  }

  return { permission, subscribing, subscribe, unsubscribe }
}
