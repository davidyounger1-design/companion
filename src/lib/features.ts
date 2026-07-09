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
  moodTracking: 'mood_tracking',
  messaging: 'messaging',
  incidentWorkflows: 'incident_workflows',
  ndisRecords: 'ndis_records',
} as const

/**
 * Retention window (in days) for the current subscription, parsed from a
 * `retention_<n>` feature (e.g. `retention_30`). Assign such a feature to a
 * plan in MAB to cap how long journal entries are kept; omit it to keep
 * entries forever.
 *
 * FAIL SAFE: returns null (= keep forever, never delete) when no retention
 * feature is present — including while features are loading or on any error.
 * If several are somehow assigned, the most restrictive (smallest) wins.
 * Data is only ever purged when a positive window is explicitly present.
 */
export function retentionDaysFromFeatures(features: Set<string>): number | null {
  let days: number | null = null
  for (const key of features) {
    const m = /^retention_(\d+)$/.exec(key)
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (n > 0 && (days === null || n < days)) days = n
  }
  return days
}
