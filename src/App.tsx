import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'

import Landing from './pages/Landing'
import SignUp from './pages/auth/SignUp'
import SignIn from './pages/auth/SignIn'
import SetupLayout from './pages/setup/SetupLayout'
import Step0Account from './pages/setup/Step0Account'
import Step1Service from './pages/setup/Step1Service'
import WorkerLayout from './pages/worker/WorkerLayout'
import WorkerClients from './pages/worker/WorkerClients'
import WorkerClientDetail from './pages/worker/WorkerClientDetail'
import CoordinatorDashboard from './pages/coordinator/CoordinatorDashboard'

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
  const { user, loading, profile } = useAuth()
  if (loading) return <FullPageSpinner />
  if (user) {
    // Redirect based on role
    if (profile?.role === 'support_worker') return <Navigate to="/worker" replace />
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
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/" element={<Landing />} />
            <Route path="/sign-up" element={<RequireNoAuth><SignUp /></RequireNoAuth>} />
            <Route path="/sign-in" element={<RequireNoAuth><SignIn /></RequireNoAuth>} />

            {/* Provider setup wizard */}
            <Route path="/setup" element={<RequireAuth><SetupLayout /></RequireAuth>}>
              <Route index element={<Navigate to="account" replace />} />
              <Route path="account" element={<Step0Account />} />
              <Route path="service" element={<Step1Service />} />
            </Route>

            {/* Coordinator dashboard */}
            <Route
              path="/dashboard"
              element={<RequireAuth><CoordinatorDashboard /></RequireAuth>}
            />

            {/* Worker portal */}
            <Route path="/worker" element={<RequireAuth><WorkerLayout /></RequireAuth>}>
              <Route index element={<WorkerClients />} />
              <Route path="clients/:clientId" element={<WorkerClientDetail />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
