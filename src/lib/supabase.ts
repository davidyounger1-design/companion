import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { getActiveOrgId } from './activeOrg'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[Companion] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.\n' +
    'Copy .env.example → .env.local and fill in your Supabase project values.',
  )
}

// Injects the active-plan context (identity-access-model-design.md §2.3)
// on PostgREST requests only. Read fresh per call, not captured once — the
// active org can change mid-session (switchOrg) without recreating the client.
//
// The header must NOT go on edge-function invokes or auth calls: the functions
// gateway's CORS allow-list doesn't include x-active-org-id, so the browser's
// preflight fails and every functions.invoke() dies with
// "Failed to send a request to the Edge Function" (0.5.137).
function fetchWithActiveOrg(input: RequestInfo | URL, init: RequestInit = {}) {
  const activeOrgId = getActiveOrgId()
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!activeOrgId || !url.includes('/rest/v1/')) return fetch(input, init)
  const headers = new Headers(init.headers)
  headers.set('x-active-org-id', activeOrgId)
  return fetch(input, { ...init, headers })
}

export const supabase = createClient<Database, 'companion'>(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder',
  {
    db: {
      schema: 'companion',
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      fetch: fetchWithActiveOrg,
    },
  },
)

export const isSupabaseConfigured =
  !!supabaseUrl &&
  supabaseUrl !== 'https://placeholder.supabase.co' &&
  !!supabaseAnonKey &&
  supabaseAnonKey !== 'placeholder-anon-key'
