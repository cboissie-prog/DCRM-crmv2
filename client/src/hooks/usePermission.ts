import { useAuthStore } from '../store/authStore'

/**
 * Retourne true si l'utilisateur connecté possède la permission donnée.
 * Les ADMIN ont toutes les permissions (bypass automatique dans le store).
 */
export function usePermission(permission: string): boolean {
  return useAuthStore(state => state.hasPermission(permission))
}

/**
 * Retourne un objet { [permission]: boolean } pour une liste de permissions.
 * Pratique pour vérifier plusieurs permissions en une fois.
 */
export function usePermissions(permissions: string[]): Record<string, boolean> {
  const hasPermission = useAuthStore(state => state.hasPermission)
  return Object.fromEntries(permissions.map(p => [p, hasPermission(p)]))
}
