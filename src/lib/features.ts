import { supabase } from './supabase'

/**
 * The set of feature keys the current user's subscription includes, as decided
 * by MyAppBuddy (the single source of truth). The app declares candidate
 * features in /mab-features.json (published on deploy); an admin assigns them
 * to plans in MAB. This app never keeps its own copy of that mapping.
 *
 * FAIL CLOSED: on any error, or a subscription the hub hasn't decided on, this
 * returns an empty set. Callers must treat "key absent" as NOT included — never
 * as allowed.
 */
export async function fetchFeatures(): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.functions.invoke('check-features')
    if (error || !data?.features || !Array.isArray(data.features)) return new Set()
    return new Set<string>(data.features)
  } catch {
    return new Set()
  }
}

/** Candidate feature keys — must match /mab-features.json. Using these avoids
 * scattering magic strings across the app. */
export const FEATURES = {
  behaviourNotes: 'behaviour_notes',
  therapyCircles: 'therapy_circles',
  ndisExports: 'ndis_exports',
  providerDashboard: 'provider_dashboard',
  recipientLogin: 'recipient_login',
} as const
