import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'

// Number of the signed-in user's support tickets awaiting their reply
// (status 'pending'). Shared by the family nav badge and the Help hub's Support
// tab — react-query dedupes on the query key, so both read one fetch.
export function usePendingTickets(): number {
  const { user } = useAuth()
  const { data = 0 } = useQuery({
    queryKey: ['help-pending', user?.email],
    queryFn: async () => {
      if (!user?.email) return 0
      try {
        const res = await fetch(
          `https://myappbuddy.com.au/api/v1/embed/support?app_id=companion&app_ref=${encodeURIComponent(user.email)}`
        )
        const data = await res.json()
        return (data.tickets || []).filter((t: { status: string }) => t.status === 'pending').length
      } catch {
        return 0
      }
    },
    enabled: !!user?.email,
    refetchInterval: 60_000,
  })
  return data
}
