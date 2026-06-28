import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

/** Returns the org's AES-256-GCM photo encryption key (hex). Cached for the session. */
export function usePhotoKey() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['org-photo-key'],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('get_or_create_photo_key')
      if (error) throw error
      return data as string
    },
    enabled: !!user,
    staleTime: Infinity,
  })
}
