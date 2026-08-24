/** Pull a human-usable message out of whatever a failed call threw.
 *
 * Supabase rejects with a `PostgrestError` — a plain object with
 * `message`/`code`/`details`, NOT an `Error` instance. So the common
 * `e instanceof Error ? e.message : 'Something went wrong'` pattern
 * discards the real reason for every database failure and shows the
 * fallback instead.
 *
 * That is not hypothetical: a check-constraint violation on
 * `log_entries.type` (see migration 075) surfaced to users for months as
 * a bare "Could not save entry.", with the actual cause —
 * `new row for relation "log_entries" violates check constraint` —
 * thrown away at the point it would have been useful. It took a support
 * worker reporting it and a coordinator reproducing it to find something
 * the error text already knew.
 *
 * Prefer this over `instanceof Error` anywhere a Supabase result is in
 * play. */
export function errorMessage(e: unknown, fallback = 'Something went wrong.'): string {
  if (!e) return fallback
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string') return e
  if (typeof e === 'object') {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown }
    if (typeof o.message === 'string' && o.message) return o.message
    if (typeof o.details === 'string' && o.details) return o.details
    if (typeof o.hint === 'string' && o.hint) return o.hint
  }
  return fallback
}
