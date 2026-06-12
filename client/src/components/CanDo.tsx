import { useAuthStore } from '../store/authStore'

interface CanDoProps {
  permission: string
  children: React.ReactNode
  /** Ce qui est affiché si l'utilisateur n'a pas la permission (null par défaut) */
  fallback?: React.ReactNode
}

/**
 * Affiche `children` uniquement si l'utilisateur connecté possède `permission`.
 * Affiche `fallback` (null par défaut) sinon.
 * Les ADMIN voient toujours les enfants (bypass automatique).
 *
 * @example
 * <CanDo permission="tickets:create">
 *   <Button>Nouveau ticket</Button>
 * </CanDo>
 */
export function CanDo({ permission, children, fallback = null }: CanDoProps) {
  const hasPermission = useAuthStore(state => state.hasPermission)
  if (!hasPermission(permission)) return <>{fallback}</>
  return <>{children}</>
}
