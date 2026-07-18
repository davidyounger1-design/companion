import { useAuth } from '../../context/AuthContext'
import { useClientId } from '../../hooks/useClientId'
import NdisRecordsSection from '../../components/NdisRecordsSection'
import { MobileFooter } from '../../components/SiteFooter'

export default function FamilyGoals() {
  const { user, profile, org } = useAuth()
  const { clientId, participantName, isLoading } = useClientId()
  const isCoordinator = profile?.role === 'coordinator'
  const isFamily = profile?.role === 'family'

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0' }}>
        <div className="spinner" style={{ width: 28, height: 28, color: 'var(--color-primary)' }} />
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 'calc(56px + var(--safe-bottom))' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '1rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <p className="eyebrow" style={{ margin: 0 }}>Goals</p>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>{participantName}'s goals</h1>
        </div>

        {clientId && org && user && (
          <NdisRecordsSection
            clientId={clientId}
            orgId={org.id}
            authorId={user.id}
            canManageAny={isCoordinator || isFamily}
          />
        )}

        <MobileFooter />
      </div>
    </div>
  )
}
