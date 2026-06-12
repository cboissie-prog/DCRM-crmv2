import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

interface ProtectedRouteProps {
  /** Si fourni, redirige vers /dashboard si l'utilisateur n'a pas cette permission */
  permission?: string
  /** Route de redirection si non authentifié (défaut : /login) */
  redirectTo?: string
}

/**
 * Garde de route qui vérifie l'authentification et optionnellement une permission.
 * Utilisable comme wrapper de <Route> dans App.tsx.
 *
 * @example
 * // Vérifie juste l'auth
 * <Route element={<ProtectedRoute />}>
 *   <Route path="/dashboard" element={<DashboardPage />} />
 * </Route>
 *
 * // Vérifie auth + permission
 * <Route element={<ProtectedRoute permission="users:manage" />}>
 *   <Route path="/users" element={<UsersPage />} />
 * </Route>
 */
export function ProtectedRoute({ permission, redirectTo = '/login' }: ProtectedRouteProps) {
  const { isAuthenticated, hasPermission } = useAuthStore()

  if (!isAuthenticated) return <Navigate to={redirectTo} replace />

  if (permission && !hasPermission(permission)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
