import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from './components/layout/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'

// ── Lazy page imports ────────────────────────────────────────────────────────
const LoginPage = lazy(() =>
  import('./pages/auth/LoginPage').then(m => ({ default: m.LoginPage }))
)
const ForgotPasswordPage = lazy(() =>
  import('./pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage }))
)
const ResetPasswordPage = lazy(() =>
  import('./pages/auth/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage }))
)
const DashboardPage = lazy(() =>
  import('./pages/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage }))
)
const ContactsPage = lazy(() =>
  import('./pages/contacts/ContactsPage').then(m => ({ default: m.ContactsPage }))
)
const ContactDetailPage = lazy(() =>
  import('./pages/contacts/ContactDetailPage').then(m => ({ default: m.ContactDetailPage }))
)
const CompaniesPage = lazy(() =>
  import('./pages/companies/CompaniesPage').then(m => ({ default: m.CompaniesPage }))
)
const CompanyDetailPage = lazy(() =>
  import('./pages/companies/CompanyDetailPage').then(m => ({ default: m.CompanyDetailPage }))
)
const CompanyMapPage = lazy(() =>
  import('./pages/companies/CompanyMapPage').then(m => ({ default: m.CompanyMapPage }))
)
const PipelinePage = lazy(() =>
  import('./pages/pipeline/PipelinePage').then(m => ({ default: m.PipelinePage }))
)
const LeadsPage = lazy(() =>
  import('./pages/pipeline/LeadsPage').then(m => ({ default: m.LeadsPage }))
)
const TicketsListView = lazy(() =>
  import('./pages/tickets/TicketsPage').then(m => ({ default: m.TicketsListView }))
)
const TicketDetailPage = lazy(() =>
  import('./pages/tickets/TicketsPage').then(m => ({ default: m.TicketDetailPage }))
)
const UsersPage = lazy(() =>
  import('./pages/users/UsersPage').then(m => ({ default: m.UsersPage }))
)
const SettingsPage = lazy(() =>
  import('./pages/settings/SettingsPage').then(m => ({ default: m.SettingsPage }))
)
const ContractsPage = lazy(() =>
  import('./pages/contracts/ContractsPage').then(m => ({ default: m.ContractsPage }))
)
const EquipmentPage = lazy(() =>
  import('./pages/equipment/EquipmentPage').then(m => ({ default: m.EquipmentPage }))
)
const LicensesPage = lazy(() =>
  import('./pages/licenses/LicensesPage').then(m => ({ default: m.LicensesPage }))
)
const KnowledgePage = lazy(() =>
  import('./pages/knowledge/KnowledgePage').then(m => ({ default: m.KnowledgePage }))
)
const NpsPage = lazy(() =>
  import('./pages/nps/NpsPage').then(m => ({ default: m.NpsPage }))
)
const AutomationsPage = lazy(() =>
  import('./pages/automations/AutomationsPage').then(m => ({ default: m.AutomationsPage }))
)
const ActivitiesPage = lazy(() =>
  import('./pages/activities/ActivitiesPage').then(m => ({ default: m.ActivitiesPage }))
)
const AppointmentsPage = lazy(() =>
  import('./pages/appointments/AppointmentsPage').then(m => ({ default: m.AppointmentsPage }))
)
const ProductsPage = lazy(() =>
  import('./pages/products/ProductsPage').then(m => ({ default: m.ProductsPage }))
)
const NotificationsPage = lazy(() =>
  import('./pages/notifications/NotificationsPage').then(m => ({ default: m.NotificationsPage }))
)
const ParcOverviewPage = lazy(() =>
  import('./pages/parc/ParcOverviewPage').then(m => ({ default: m.ParcOverviewPage }))
)
const ParcClientPage = lazy(() =>
  import('./pages/parc/ParcClientPage').then(m => ({ default: m.ParcClientPage }))
)
const ReportsPage = lazy(() =>
  import('./pages/reports/ReportsPage').then(m => ({ default: m.ReportsPage }))
)
const TargetsPage = lazy(() =>
  import('./pages/targets/TargetsPage').then(m => ({ default: m.TargetsPage }))
)
const RolesPage = lazy(() =>
  import('./pages/settings/RolesPage').then(m => ({ default: m.RolesPage }))
)
const CallsPage = lazy(() =>
  import('./pages/calls/CallsPage').then(m => ({ default: m.CallsPage }))
)
const CallDetailPage = lazy(() =>
  import('./pages/calls/CallsPage').then(m => ({ default: m.CallDetailPage }))
)
const GoogleCallbackPage = lazy(() =>
  import('./pages/auth/GoogleCallbackPage').then(m => ({ default: m.GoogleCallbackPage }))
)

// ── Query client ─────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
})

// ── Loading fallback ──────────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-slate-50">
      <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/google/success" element={<GoogleCallbackPage />} />

            {/* Protected routes — Layout handles auth check and redirect */}
            <Route element={<Layout />}>
              {/* No permission guard — auth only (handled by Layout) */}
              <Route path="/" element={<DashboardPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />

              {/* contacts:read */}
              <Route element={<ProtectedRoute permission="contacts:read" />}>
                <Route path="/contacts" element={<ContactsPage />} />
                <Route path="/contacts/:id" element={<ContactDetailPage />} />
              </Route>

              {/* companies:read */}
              <Route element={<ProtectedRoute permission="companies:read" />}>
                <Route path="/companies" element={<CompaniesPage />} />
                <Route path="/companies/map" element={<CompanyMapPage />} />
                <Route path="/companies/:id" element={<CompanyDetailPage />} />
              </Route>

              {/* pipeline:read */}
              <Route element={<ProtectedRoute permission="pipeline:read" />}>
                <Route path="/pipeline" element={<PipelinePage />} />
                <Route path="/leads" element={<LeadsPage />} />
              </Route>

              {/* tickets:read */}
              <Route element={<ProtectedRoute permission="tickets:read" />}>
                <Route path="/tickets" element={<TicketsListView />} />
                <Route path="/tickets/:id" element={<TicketDetailPage />} />
              </Route>

              {/* users:read */}
              <Route element={<ProtectedRoute permission="users:read" />}>
                <Route path="/users" element={<UsersPage />} />
              </Route>

              {/* settings:write */}
              <Route element={<ProtectedRoute permission="settings:write" />}>
                <Route path="/settings" element={<SettingsPage />} />
              </Route>

              {/* settings:roles */}
              <Route element={<ProtectedRoute permission="settings:roles" />}>
                <Route path="/settings/roles" element={<RolesPage />} />
              </Route>

              {/* contracts:read */}
              <Route element={<ProtectedRoute permission="contracts:read" />}>
                <Route path="/contracts" element={<ContractsPage />} />
              </Route>

              {/* equipment:read */}
              <Route element={<ProtectedRoute permission="equipment:read" />}>
                <Route path="/parc" element={<ParcOverviewPage />} />
                <Route path="/parc/:companyId" element={<ParcClientPage />} />
                <Route path="/equipment" element={<EquipmentPage />} />
                <Route path="/licenses" element={<LicensesPage />} />
              </Route>

              {/* knowledge:read */}
              <Route element={<ProtectedRoute permission="knowledge:read" />}>
                <Route path="/knowledge" element={<KnowledgePage />} />
              </Route>

              {/* dashboard:read */}
              <Route element={<ProtectedRoute permission="dashboard:read" />}>
                <Route path="/nps" element={<NpsPage />} />
              </Route>

              {/* automation:read */}
              <Route element={<ProtectedRoute permission="automation:read" />}>
                <Route path="/automations" element={<AutomationsPage />} />
              </Route>

              {/* activities:read */}
              <Route element={<ProtectedRoute permission="activities:read" />}>
                <Route path="/activities" element={<ActivitiesPage />} />
              </Route>

              {/* appointments:read */}
              <Route element={<ProtectedRoute permission="appointments:read" />}>
                <Route path="/appointments" element={<AppointmentsPage />} />
              </Route>

              {/* products:read */}
              <Route element={<ProtectedRoute permission="products:read" />}>
                <Route path="/products" element={<ProductsPage />} />
              </Route>

              {/* reports:read */}
              <Route element={<ProtectedRoute permission="reports:read" />}>
                <Route path="/reports" element={<ReportsPage />} />
              </Route>

              {/* targets:read */}
              <Route element={<ProtectedRoute permission="targets:read" />}>
                <Route path="/targets" element={<TargetsPage />} />
              </Route>

              {/* calls:read */}
              <Route element={<ProtectedRoute permission="calls:read" />}>
                <Route path="/calls" element={<CallsPage />} />
                <Route path="/calls/:id" element={<CallDetailPage />} />
              </Route>
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
