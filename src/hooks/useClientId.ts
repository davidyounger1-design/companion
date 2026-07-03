import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

/**
 * Resolves the client record for the signed-in user: recipients look up
 * their own client row, family/coordinator go via client_family. Shared
 * by the schedule, the global status bar, and the timer, all of which
 * need the same clientId (and the recipient's own profile id, so
 * family/coordinator can attribute a remote timer's background alert to
 * the recipient rather than themselves).
 */
export function useClientId() {
  const { user, profile } = useAuth()

  const { data, isLoading } = useQuery({
    queryKey: ['client-id', user?.id, profile?.role],
    queryFn: async () => {
      if (profile?.role === 'recipient') {
        const { data } = await supabase
          .from('clients')
          .select('id, full_name, recipient_profile_id')
          .eq('recipient_profile_id', user!.id)
          .maybeSingle()
        return data ? { client_id: data.id, full_name: data.full_name, recipient_profile_id: data.recipient_profile_id } : null
      }
      const { data } = await supabase
        .from('client_family')
        .select('client_id, clients(full_name, recipient_profile_id)')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clients = data?.clients as any
      return data ? { client_id: data.client_id, full_name: clients?.full_name, recipient_profile_id: clients?.recipient_profile_id } : null
    },
    enabled: !!user && !!profile,
  })

  return {
    clientId: data?.client_id,
    participantName: data?.full_name ?? 'their',
    recipientProfileId: data?.recipient_profile_id as string | null | undefined,
    isLoading,
  }
}
