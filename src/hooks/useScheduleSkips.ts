import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { skipKey } from '../lib/schedule'

/**
 * Set of skipped occurrences for a client, keyed by `${itemId}|${date}`.
 * A skip means a recurring item was removed for that ONE day (or replaced by
 * an edited one-off), so the occurrence should not be shown. Fail-open to an
 * empty set — a load failure shouldn't make the whole schedule vanish.
 */
export function useScheduleSkips(clientId: string | null | undefined) {
  const { data: skips = new Set<string>() } = useQuery({
    queryKey: ['schedule-skips', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_item_skips')
        .select('schedule_item_id, occurrence_date')
        .eq('client_id', clientId!)
      if (error) throw error
      return new Set((data ?? []).map((s) => skipKey(s.schedule_item_id, s.occurrence_date)))
    },
    enabled: !!clientId,
  })
  return skips
}
