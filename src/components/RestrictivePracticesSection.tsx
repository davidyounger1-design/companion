import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { RP_TYPE_LABEL, formatRpDate } from '../lib/restrictivePractices'
import type { RestrictivePractice } from '../types/database'

const AUTHORISED_BADGE = {
  fg: 'var(--color-primary-deep)',
  bg: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
}
const UNAUTHORISED_BADGE = {
  fg: '#c0392b',
  bg: 'color-mix(in srgb, #c0392b 15%, transparent)',
}

export default function RestrictivePracticesSection({ clientId }: { clientId: string }) {
  const { data: practices, isLoading } = useQuery({
    queryKey: ['restrictive-practices', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('restrictive_practices')
        .select('*')
        .eq('client_id', clientId)
        .order('started_at', { ascending: false })
      if (error) throw error
      return data as RestrictivePractice[]
    },
    enabled: !!clientId,
  })

  return (
    <div>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
        </div>
      ) : !practices?.length ? (
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
          No restrictive practices recorded.
        </p>
      ) : (
        <div className="scroll-list">
          {practices.map((rp) => (
            <div key={rp.id} className="card card-sm">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                <span className="badge" style={{ background: 'color-mix(in srgb, var(--color-muted) 15%, transparent)', color: 'var(--color-muted)', fontSize: '0.65rem' }}>
                  {RP_TYPE_LABEL[rp.type]}
                </span>
                <span className="badge" style={{ background: rp.authorised ? AUTHORISED_BADGE.bg : UNAUTHORISED_BADGE.bg, color: rp.authorised ? AUTHORISED_BADGE.fg : UNAUTHORISED_BADGE.fg, fontSize: '0.65rem' }}>
                  {rp.authorised ? 'Authorised' : 'Unauthorised'}
                </span>
                {rp.authorisation_reference && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                    {rp.authorisation_reference}
                  </span>
                )}
              </div>
              {rp.notes && (
                <p style={{ margin: 0, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {rp.notes}
                </p>
              )}
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                {formatRpDate(rp.started_at)}
                {rp.ended_at ? ` — ${formatRpDate(rp.ended_at)}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
