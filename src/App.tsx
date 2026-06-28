import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'

import Landing from './pages/Landing'
import SignUp from './pages/auth/SignUp'
import SignIn from './pages/auth/SignIn'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import AcceptInvite from './pages/auth/AcceptInvite'
import SetupLayout from './pages/setup/SetupLayout'
import Step0Account from './pages/setup/Step0Account'
import Step1Service from './pages/setup/Step1Service'
import Step2Plan from './pages/setup/Step2Plan'
import Step3Team from './pages/setup/Step3Team'
import Step4Clients from './pages/setup/Step4Clients'
import Step5Circles from './pages/setup/Step5Circles'
import Step6GoLive from './pages/setup/Step5GoLive'
import FamilySetupLayout from './pages/setup/family/FamilySetupLayout'
import FamilyStep1Participant from './pages/setup/family/FamilyStep1Participant'
import FamilyStep2Invite from './pages/setup/family/FamilyStep2Invite'
import FamilyStep3Done from './pages/setup/family/FamilyStep3Done'
import FamilyDashboard from './pages/family/FamilyDashboard'
import AddEntry from './pages/family/AddEntry'
import EditParticipant from './pages/family/EditParticipant'
import FamilyNoticeBoard from './pages/family/FamilyNoticeBoard'
import MessagesHub from './pages/messages/MessagesHub'
import MessageThread from './pages/messages/MessageThread'
import WorkerLayout from './pages/worker/WorkerLayout'
import WorkerClients from './pages/worker/WorkerClients'
import WorkerClientDetail from './pages/worker/WorkerClientDetail'
import WorkerNoticeBoard from './pages/worker/WorkerNoticeBoard'
import CoordinatorDashboard from './pages/coordinator/CoordinatorDashboard'
import MembersPage from './pages/members/MembersPage'
import ReleaseNotes from './pages/ReleaseNotes'
import Help from './pages/Help'
import Feedback from './pages/Feedback'
import Account from './pages/Account'
import PermissionsPage from './pages/settings/PermissionsPage'
import Deck from './pages/Deck'
import SiteFooter from './components/SiteFooter'
import { useState, useEffect } from 'react'

function UpdateBanner() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // Fires when a new SW takes over — skipWaiting() makes this happen on next page load
    const handler = () => setReady(true)
    navigator.serviceWorker.addEventListener('controllerchange', handler)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', handler)
  }, [])

  if (!ready) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'var(--color-primary)', color: '#fff',
      padding: '0.75rem 1rem', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: '1rem', fontSize: '0.875rem',
    }}>
      <span>A new version of Companion is ready.</span>
      <button
        onClick={() => window.location.reload()}
        style={{ background: 'rgba(255,255,255,0.25)', border: 'none', color: '#fff', padding: '0.35rem 0.875rem', borderRadius: 6, cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}
      >
        Update now
      </button>
    </div>
  )
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
})

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/sign-in" replace />
  return <>{children}</>
}

function RequireNoAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, profile, org } = useAuth()
  if (loading) return <FullPageSpinner />
  if (user) {
    const role = profile?.role
    if (role === 'support_worker' || role === 'trusted_support_worker') return <Navigate to="/worker" replace />
    if (role === 'family') return <Navigate to="/family" replace />
    if (role === 'coordinator' && org?.org_type === 'family') return <Navigate to="/family" replace />
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}

function FullPageSpinner() {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" style={{ width: 32, height: 32, color: 'var(--color-primary)' }} />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/" element={<Landing />} />
            <Route path="/sign-up" element={<RequireNoAuth><SignUp /></RequireNoAuth>} />
            <Route path="/sign-in" element={<RequireNoAuth><SignIn /></RequireNoAuth>} />
            <Route path="/deck" element={<Deck />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/release-notes" element={<ReleaseNotes />} />
            <Route path="/help" element={<Help />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
            <Route path="/settings/permissions" element={<RequireAuth><PermissionsPage /></RequireAuth>} />

            {/* Provider setup wizard */}
            <Route path="/setup" element={<RequireAuth><SetupLayout /></RequireAuth>}>
              <Route index element={<Navigate to="account" replace />} />
              <Route path="account" element={<Step0Account />} />
              <Route path="service" element={<Step1Service />} />
              <Route path="plan" element={<Step2Plan />} />
              <Route path="team" element={<Step3Team />} />
              <Route path="clients" element={<Step4Clients />} />
              <Route path="circles" element={<Step5Circles />} />
              <Route path="go-live" element={<Step6GoLive />} />
            </Route>

            {/* Family setup wizard */}
            <Route path="/setup/family" element={<RequireAuth><FamilySetupLayout /></RequireAuth>}>
              <Route index element={<Navigate to="participant" replace />} />
              <Route path="participant" element={<FamilyStep1Participant />} />
              <Route path="invite" element={<FamilyStep2Invite />} />
              <Route path="done" element={<FamilyStep3Done />} />
            </Route>

            {/* Unified messaging */}
            <Route path="/messages" element={<RequireAuth><MessagesHub /></RequireAuth>} />
            <Route path="/messages/:userId" element={<RequireAuth><MessageThread /></RequireAuth>} />

            {/* Family journal */}
            <Route path="/family" element={<RequireAuth><FamilyDashboard /></RequireAuth>} />
            <Route path="/family/add" element={<RequireAuth><AddEntry /></RequireAuth>} />
            <Route path="/family/participant" element={<RequireAuth><EditParticipant /></RequireAuth>} />
            <Route path="/family/notices" element={<RequireAuth><FamilyNoticeBoard /></RequireAuth>} />

            {/* Coordinator dashboard */}
            <Route path="/dashboard" element={<RequireAuth><CoordinatorDashboard /></RequireAuth>} />

            {/* Member management */}
            <Route path="/members" element={<RequireAuth><MembersPage /></RequireAuth>} />

            {/* Worker portal */}
            <Route path="/worker" element={<RequireAuth><WorkerLayout /></RequireAuth>}>
              <Route index element={<WorkerClients />} />
              <Route path="clients/:clientId" element={<WorkerClientDetail />} />
            </Route>

            {/* Worker notice board (outside WorkerLayout — full-page) */}
            <Route path="/worker/notices" element={<RequireAuth><WorkerNoticeBoard /></RequireAuth>} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
      <SiteFooter />
      <UpdateBanner />
    </QueryClientProvider>
  )
}
