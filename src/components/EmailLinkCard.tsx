import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errorMessage'

type Candidate =
  | { ambiguous: true }
  | {
      person_id: string
      first_name: string
      last_initial: string
      dob: string | null
      org_name: string
    }

// Every error confirm_email_link can raise, in user words. Nothing here
// leaks an internal reason: `not_authorised` and `target_email_mismatch`
// are both defensive (the card should never have been offered) and both
// point at the manual code flow rather than explaining why.
const CARD_ERRORS: Record<string, string> = {
  ambiguous_email_match: 'This email is used by more than one record. Use the linking panel below to link them instead.',
  no_matching_email: 'We couldn\'t match this to another record. Use the linking panel below to link them instead.',
  not_authorised: 'We couldn\'t link these records automatically. Use the linking panel below to link them instead.',
  target_email_mismatch: 'We couldn\'t link these records automatically. Use the linking panel below to link them instead.',
  foreign_recipient_login: 'We couldn\'t link these records automatically. Use the linking panel below to link them instead.',
  cannot_link_to_self: 'These are the same record — nothing to link.',
  target_already_linked: 'These records are already linked.',
}

function messageFor(e: unknown): string {
  const raw = errorMessage(e, '')
  for (const code of Object.keys(CARD_ERRORS)) {
    if (raw.includes(code)) return CARD_ERRORS[code]
  }
  return 'Could not link the records. Try again, or use the linking panel below.'
}

/**
 * Offers a one-tap link when the signed-in account holder's email is
 * recognised on another Companion plan. Rendered only for the
 * participant or their decision-maker — the server enforces that
 * independently (email_link_candidate_for raises 42501 otherwise), this
 * is just where the UI happens to live, not the security boundary.
 *
 * Renders nothing at all when there is no candidate, when the query
 * errors (a family member without authority over this drawer gets a
 * 42501 — silence is the correct output, not an error card), or when
 * this device has already dismissed it.
 */
export default function EmailLinkCard({ clientId, participantName }: { clientId: string; participantName: string }) {
  const qc = useQueryClient()
  const dismissKey = `email-link-dismissed-${clientId}`
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey) === '1')
  const [error, setError] = useState('')

  const { data: candidate, isError } = useQuery({
    queryKey: ['email-link-candidate', clientId],
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc('email_link_candidate_for', { p_client_id: clientId })
      if (rpcError) throw rpcError
      return (data ?? null) as Candidate | null
    },
    retry: false,
  })

  const confirm = useMutation({
    mutationFn: async () => {
      const { error: rpcError } = await supabase.rpc('confirm_email_link', { p_target_client_id: clientId })
      if (rpcError) throw rpcError
    },
    onSuccess: () => {
      setError('')
      qc.invalidateQueries({ queryKey: ['email-link-candidate', clientId] })
      qc.invalidateQueries({ queryKey: ['linked-drawers'] })
    },
    onError: (e) => setError(messageFor(e)),
  })

  function dismiss() {
    // Per-device, deliberately: no server-side dismissal flag, no
    // migration. Re-appearing on another device or a fresh sign-in is
    // harmless — the offer is still true.
    localStorage.setItem(dismissKey, '1')
    setDismissed(true)
  }

  if (dismissed || isError || !candidate) return null

  if ('ambiguous' in candidate) {
    return (
      <div className="card" style={{ marginBottom: '1rem', padding: '0.875rem 1rem' }}>
        <p style={{ fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
          Your email address is used by more than one record on Companion, so we can't tell which one
          to link. Use the "Link to another plan" panel below to link them with a code instead.
        </p>
        <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={dismiss}>
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: '0.875rem 1rem' }}>
      <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
        You already have a record with <strong>{candidate.org_name}</strong> as{' '}
        <strong>{candidate.first_name} {candidate.last_initial}.</strong>
        {candidate.dob && <> Born {new Date(candidate.dob).toLocaleDateString()}.</>}{' '}
        Link them so you see all your plans in one place?
      </p>
      <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: '0 0 0.75rem' }}>
        Linking merges {participantName}'s journal, goals and photos across both plans for you and your
        family. Each plan's staff still only see their own plan.
      </p>
      {error && <div className="alert alert-error" style={{ marginBottom: '0.5rem' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={dismiss}>
          Not now
        </button>
        <button className="btn btn-primary" style={{ fontSize: '0.8rem' }}
          disabled={confirm.isPending} onClick={() => confirm.mutate()}>
          {confirm.isPending ? <span className="spinner" /> : 'Yes, link the records'}
        </button>
      </div>
    </div>
  )
}
