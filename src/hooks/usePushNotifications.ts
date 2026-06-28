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
  const [notifyOnEntry, setNotifyOnEntryState] = useState<boolean | null>(null)

  useEffect(() => {
    if (!('Notification' in window)) {
      setPermission('unsupported')
    } else {
      setPermission(Notification.permission as PushState)
    }
  }, [])

  // Load notify_on_entry preference from the user's subscription row
  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase as any)
      .from('push_subscriptions')
      .select('notify_on_entry')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }: { data: { notify_on_entry: boolean } | null }) => {
        if (data != null) setNotifyOnEntryState(data.notify_on_entry ?? false)
      })
  }, [user])

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

      // Load preference after subscribing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('push_subscriptions')
        .select('notify_on_entry')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()
      if (data != null) setNotifyOnEntryState(data.notify_on_entry ?? false)

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
    setNotifyOnEntryState(null)
  }

  async function setNotifyOnEntry(value: boolean) {
    if (!user) return
    setNotifyOnEntryState(value)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('push_subscriptions')
      .update({ notify_on_entry: value })
      .eq('user_id', user.id)
  }

  return { permission, subscribing, subscribe, unsubscribe, notifyOnEntry, setNotifyOnEntry }
}
