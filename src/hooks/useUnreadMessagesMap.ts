import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

/**
 * Unread message count per thread, keyed by the other party's profile id
 * (or 'group' for the shared family+coordinator thread). Shared by the
 * nav badges (which just sum it) and MessagesHub (which shows it per
 * contact) so the two totals can never drift apart — they were
 * previously two separately-polled queries with duplicated filter logic
 * that could disagree for a poll cycle or two.
 *
 * 1:1 messages from senders who have since left the org are excluded:
 * MessagesHub only lists current org members, so there's no row (and no
 * way to open the thread) for a removed member — counting their unread
 * messages made the badge total permanently exceed what the list shows.
 * Group-thread messages count regardless of sender, since the group
 * thread renders its full history and always has a row.
 */
export function useUnreadMessagesMap() {
  const { user, profile } = useAuth()

  return useQuery({
    queryKey: ['msg-unread-map', user?.id],
    queryFn: async () => {
      const lastSeen = localStorage.getItem(`msg_last_seen_${user!.id}`) ?? new Date(0).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('messages')
        .select('sender_id, recipient_id, sender:profiles!sender_id(org_id)')
        .eq('org_id', profile!.org_id!)
        .gt('created_at', lastSeen)
        .neq('sender_id', user!.id)
        .or(`recipient_id.eq.${user!.id},recipient_id.is.null`)
      const map: Record<string, number> = {}
      for (const msg of data ?? []) {
        if (msg.recipient_id === null) {
          map['group'] = (map['group'] ?? 0) + 1
        } else if (msg.sender?.org_id === profile!.org_id) {
          map[msg.sender_id] = (map[msg.sender_id] ?? 0) + 1
        }
      }
      return map
    },
    enabled: !!user && !!profile?.org_id,
    refetchInterval: 15000,
  })
}
