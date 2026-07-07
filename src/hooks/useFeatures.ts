import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { fetchFeatures } from '../lib/features'

/**
 * Reads the current subscription's included features from MyAppBuddy and
 * exposes a `has(key)` check. FAIL CLOSED: while loading, on error, or for any
 * key the hub hasn't included, `has` returns false. Gate premium capability on
 * `has('some_key')` — never on a local plan string.
 *
 * NOTE: gating an existing, already-shipped feature on `has()` will hide it for
 * every customer until that feature key is assigned to their plan in MAB Admin.
 * Coordinate the admin assignment with turning on each gate.
 */
export function useFeatures() {
  const { user } = useAuth()

  const { data: features, isLoading } = useQuery({
    queryKey: ['mab-features', user?.id],
    queryFn: fetchFeatures,
    enabled: !!user,
    staleTime: 5 * 60_000,
  })

  return {
    isLoading,
    features: features ?? new Set<string>(),
    has: (key: string) => (features ?? new Set<string>()).has(key),
  }
}
