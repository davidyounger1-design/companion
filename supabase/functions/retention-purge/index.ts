// Nightly retention enforcement for the `retention_<n>` MAB entitlement.
//
// Invoked by migration 085's pg_cron job (`retention-purge-dispatch`, 3:17 AM
// daily) with a service_role Bearer token. Reads
// companion.organisations.entitlements directly — no MAB round-trip, no
// client involvement — and purges log_entries older than the shortest
// `retention_<n>` window the org's plan includes. An org with no retention
// key is left untouched (keep forever — the documented fail-safe, see
// migration 052).
//
// ALWAYS returns HTTP 200 with `{ ok, error?, orgs? }` — the cron logs a
// non-2xx rather than retrying, so errors surface in the body instead of
// being swallowed by the gateway.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Inlined copy of retentionDaysFromFeatures() from src/lib/features.ts so
// this function deploys as a single file (the dashboard editor doesn't bundle
// relative imports — same convention as timer-alert-notify's inlined webpush
// helpers). Semantics must stay in lockstep with the frontend: shortest
// positive `retention_<n>` window wins; null = keep forever.
function retentionDaysFromFeatures(keys: string[]): number | null {
  let days: number | null = null
  for (const key of keys) {
    const m = /^retention_(\d+)$/.exec(key)
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (n > 0 && (days === null || n < days)) days = n
  }
  return days
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

type OrgResult = {
  org_id: string
  retention_days: number | null
  deleted_entries: number
  deleted_photos: number
  storage_error?: string
  error?: string
}

// Purges one org's expired entries (and their journal-photos storage
// objects). Returns the per-org result; errors are recorded on it rather
// than thrown, and processing stops for this org at the first failure.
async function purgeOrg(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  days: number,
): Promise<OrgResult> {
  const result: OrgResult = { org_id: orgId, retention_days: days, deleted_entries: 0, deleted_photos: 0 }
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()

  // Page over the org's expired entries (delete happens per page, so a
  // large backlog can't blow up the request).
  let from = 0
  for (;;) {
    const { data: expired, error: selectErr } = await supabase
      .from('log_entries')
      .select('id, photo_path')
      .eq('org_id', orgId)
      .lt('occurred_at', cutoff)
      .range(from, from + 999)
    if (selectErr) {
      result.error = `log_entries select failed: ${selectErr.message}`
      return result
    }
    if (!expired?.length) return result
    from += expired.length

    // Storage first, then the rows — mirrors migration 025's original purge
    // body (storage.objects where name = log_entries.photo_path in the
    // journal-photos bucket). Storage cleanup is best-effort: an orphaned
    // encrypted blob is harmless, but a broken photo reference is not, so a
    // storage error is recorded per-org and the entry rows are still purged
    // (the entitlement's promise is that the entries go).
    const paths = [...new Set(expired.flatMap((e) => (e.photo_path ? [e.photo_path] : [])))]
    for (const batch of chunks(paths, 500)) {
      const { error: rmErr } = await supabase.storage.from('journal-photos').remove(batch)
      if (rmErr) result.storage_error = result.storage_error ?? `journal-photos remove failed: ${rmErr.message}`
      else result.deleted_photos += batch.length
    }

    const ids = expired.map((e) => e.id)
    for (const batch of chunks(ids, 500)) {
      const { error: delErr } = await supabase.from('log_entries').delete().in('id', batch)
      if (delErr) {
        result.error = `log_entries delete failed: ${delErr.message}`
        return result
      }
      result.deleted_entries += batch.length
    }
  }
}

Deno.serve(async () => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

  try {
    // Service role: bypasses RLS on both log_entries and Storage. This is the
    // whole point — the function must see (and delete) every org's rows.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { db: { schema: 'companion' } },
    )

    const { data: orgs, error } = await supabase
      .from('organisations')
      .select('id, entitlements')

    if (error) return json({ ok: false, error: `organisations read failed: ${error.message}` })

    const results: OrgResult[] = []
    for (const org of orgs ?? []) {
      const entitlements: unknown = org.entitlements
      const keys = Array.isArray(entitlements)
        ? entitlements.filter((k): k is string => typeof k === 'string')
        : []
      const days = retentionDaysFromFeatures(keys)

      // No retention key — keep forever (the documented fail-safe).
      if (days === null) {
        results.push({ org_id: org.id, retention_days: null, deleted_entries: 0, deleted_photos: 0 })
        continue
      }
      results.push(await purgeOrg(supabase, org.id, days))
    }

    return json({
      ok: true,
      retention_orgs: results.filter((r) => r.retention_days !== null).length,
      orgs: results,
    })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message })
  }
})
