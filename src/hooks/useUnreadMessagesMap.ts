import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

/**
 * Unread message count per thread, keyed by the other party's profile id
 * (or 'group' for the shared family+coordinator thread). Shared by
 * FamilyBottomNav (which just sums it for a single badge) and
 * MessagesHub (which shows it per contact) so the two totals can never
 * drift apart — they were previously two separately-polled queries with
 * duplicated filter logic that could disagree for a poll cycle or two.
 */
export function useUnreadMessagesMap() {
  const { user, profile } = useAuth()

  return useQuery({
    queryKey: ['msg-unread-map', user?.id],
    queryFn: async () => {
      const lastSeen = localStorage.getItem(`msg_last_seen_${user!.id}`) ?? new Date(0).toISOString()
      const { data } = await supabase
        .from('messages')
        .select('sender_id, recipient_id')
        .eq('org_id', profile!.org_id!)
        .gt('created_at', lastSeen)
        .neq('sender_id', user!.id)
        .or(`recipient_id.eq.${user!.id},recipient_id.is.null`)
      const map: Record<string, number> = {}
      for (const msg of data ?? []) {
        const key = msg.recipient_id === null ? 'group' : msg.sender_id
        map[key] = (map[key] ?? 0) + 1
      }
      return map
    },
    enabled: !!user && !!profile?.org_id,
    refetchInterval: 15000,
  })
}
