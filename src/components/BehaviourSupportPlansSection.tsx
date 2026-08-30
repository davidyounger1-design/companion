import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errorMessage'
import { BSP_BUCKET, formatBspDate, isReviewOverdue } from '../lib/behaviourSupportPlans'
import type { BehaviourSupportPlan } from '../types/database'

const OVERDUE_BADGE = {
  color: '#c0392b',
  background: 'color-mix(in srgb, #c0392b 15%, transparent)',
}
const REVIEW_BADGE = {
  color: 'var(--color-primary-deep)',
  background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
}
const NO_REVIEW_BADGE = {
  color: 'var(--color-muted)',
  background: 'color-mix(in srgb, var(--color-muted) 15%, transparent)',
}

/** How long a resolved download URL stays valid, in seconds. */
const SIGNED_URL_TTL = 600 // 10 minutes

export default function BehaviourSupportPlansSection({ clientId }: { clientId: string }) {
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<{ planId: string; message: string } | null>(null)

  // Same degradation pattern as the restrictive-practices section: while 087 is
  // not yet applied the query errors (missing table), so this renders the quiet
  // empty state — no crash, no error banner. retry: false makes that empty
  // state appear immediately instead of after the default retry backoff.
  const { data: plans, isLoading } = useQuery({
    queryKey: ['behaviour-support-plans', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('behaviour_support_plans')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as BehaviourSupportPlan[]
    },
    enabled: !!clientId,
    retry: false,
  })

  // Resolved on demand (not pre-fetched per row) so the list stays quiet while
  // the bsp-documents bucket doesn't exist yet — only an actual Open click
  // surfaces the storage error, inline on that card.
  async function openPlan(plan: BehaviourSupportPlan) {
    setOpeningId(plan.id)
    setOpenError(null)
    try {
      // Same call shape as the journal-photo flow (CoordinatorClientDetail
      // MediaCell): resolve a time-limited URL, then hand it to the browser.
      const { data, error } = await supabase.storage
        .from(BSP_BUCKET)
        .createSignedUrl(plan.file_path, SIGNED_URL_TTL)
      if (error) throw error
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      // Pre-bucket/pre-SQL degradation: surface the real backend error quietly
      // on the card — never crash or hang the list.
      setOpenError({ planId: plan.id, message: errorMessage(e, 'Could not open the document.') })
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <div>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
        </div>
      ) : !plans?.length ? (
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
          No behaviour support plans uploaded.
        </p>
      ) : (
        <div className="scroll-list">
          {plans.map((plan) => {
            const overdue = isReviewOverdue(plan.review_due)
            return (
              <div key={plan.id} className="card card-sm">
                <p style={{ margin: 0, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {plan.file_name}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginTop: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', minWidth: 0 }}>
                    {plan.review_due ? (
                      <span className="badge" style={overdue ? OVERDUE_BADGE : REVIEW_BADGE}>
                        {overdue ? 'Overdue — review due ' : 'Review due '}{formatBspDate(plan.review_due)}
                      </span>
                    ) : (
                      <span className="badge" style={NO_REVIEW_BADGE}>
                        No review date
                      </span>
                    )}
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                      Uploaded {formatBspDate(plan.created_at)}
                    </span>
                  </div>
                  <button type="button" className="btn btn-ghost"
                    style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', whiteSpace: 'nowrap' }}
                    onClick={() => openPlan(plan)} disabled={openingId === plan.id}>
                    {openingId === plan.id ? <span className="spinner" /> : 'Open'}
                  </button>
                </div>
                {openError?.planId === plan.id && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-error)', margin: '0.35rem 0 0' }}>
                    {openError.message}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
