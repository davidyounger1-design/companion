import { useAuth } from '../context/AuthContext'

/**
 * Hidden for everyone with exactly one membership (identity-access-model-
 * design.md §1.1, "the plan switcher is hidden when a person belongs to
 * only one plan" — that's every current user). Appears globally, above
 * whichever dashboard is rendered, the moment a profile gets a second
 * profile_orgs row — the only way that happens today is accepting a second
 * invite while already signed in, or being on both sides of a person link.
 */
export default function PlanSwitcherBanner() {
  const { memberships, profile, switchOrg } = useAuth()
  if (memberships.length < 2) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.4rem 0.75rem', background: 'var(--color-primary)', color: '#fff',
      fontSize: '0.8rem', flexWrap: 'wrap',
    }}>
      <span style={{ opacity: 0.85 }}>Viewing:</span>
      <select
        value={profile?.org_id ?? ''}
        onChange={(e) => switchOrg(e.target.value)}
        style={{
          background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: 'var(--radius-sm)', padding: '0.2rem 0.5rem', fontSize: '0.8rem', fontWeight: 600,
        }}
      >
        {memberships.map((m) => (
          <option key={m.org_id} value={m.org_id} style={{ color: '#000' }}>
            {m.org_name} · {m.role}
          </option>
        ))}
      </select>
    </div>
  )
}
