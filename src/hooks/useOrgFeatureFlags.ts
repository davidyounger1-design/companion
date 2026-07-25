import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

/**
 * Reads org-level feature toggles from `org_settings.feature_flags`.
 *
 * DEFAULT ON (opt-out): when a key is absent from the stored flags, `isEnabled`
 * returns `true` — the feature is on by default when the plan includes it, and
 * the coordinator must explicitly turn it off.
 *
 * FAIL CLOSED: while loading or on any error, `isEnabled` returns `false`.
 * Combine with MAB-level `has()`: both must be true for a feature to render.
 */
export function useOrgFeatureFlags() {
  const { profile } = useAuth()
  const qc = useQueryClient()

  const { data: flags, isLoading } = useQuery({
    queryKey: ['org-feature-flags', profile?.org_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('org_settings')
        .select('feature_flags')
        .eq('org_id', profile!.org_id!)
        .maybeSingle()
      return (data?.feature_flags ?? {}) as Record<string, boolean>
    },
    enabled: !!profile?.org_id,
    staleTime: 60_000,
  })

  const setFlag = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      const next = { ...(flags ?? {}), [key]: value }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('org_settings') as any)
        .upsert(
          { org_id: profile!.org_id!, feature_flags: next },
          { onConflict: 'org_id' },
        )
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-feature-flags', profile?.org_id] }),
  })

  return {
    flags: flags ?? {},
    isLoading,
    /** True when the org-level flag is NOT explicitly set to false. */
    isEnabled: (key: string) => (flags?.[key] ?? true) !== false,
    setFlag,
  }
}
