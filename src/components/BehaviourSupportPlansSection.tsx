import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatBspDate, isReviewOverdue } from '../lib/behaviourSupportPlans'
import type { BehaviourSupportPlan } from '../types/database'

const OVERDUE_BADGE = {
  color: '#c0392b',
  background: 'color-mix(in srgb, #c0392b 15%, transparent)',
}

export default function BehaviourSupportPlansSection({ clientId }: { clientId: string }) {
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                  {plan.review_due ? (
                    <span className="badge" style={overdue ? OVERDUE_BADGE : { background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)', color: 'var(--color-primary-deep)', fontSize: '0.65rem' }}>
                      {overdue ? 'Overdue — review due ' : 'Review due '}{formatBspDate(plan.review_due)}
                    </span>
                  ) : (
                    <span className="badge" style={{ background: 'color-mix(in srgb, var(--color-muted) 15%, transparent)', color: 'var(--color-muted)', fontSize: '0.65rem' }}>
                      No review date
                    </span>
                  )}
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                    Uploaded {formatBspDate(plan.created_at)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
