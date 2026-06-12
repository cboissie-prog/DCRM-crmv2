/**
 * calendar-visibility.ts
 * Logique de visibilité des calendriers personnels.
 *
 * Règle :
 *   Un utilisateur V peut voir le calendrier d'un utilisateur O si :
 *     - V == O, OU
 *     - V a la permission '*' (ADMIN), OU
 *     - il existe CalendarAccess(viewerId=V, ownerId=O)
 *
 *   Un RDV est visible par V si :
 *     - il a AU MOINS UN participant dont V peut voir le calendrier, OU
 *     - il a été créé par V (createdById), OU
 *     - il n'a AUCUN participant utilisateur (RDV orphelin)
 */
import prisma from '../prisma/client'
import type { AuthRequest } from '../middleware/auth'

/**
 * Retourne la liste des ownerIds que l'appelant peut voir.
 * 'all' si l'utilisateur a la permission '*' (ADMIN).
 */
export async function getVisibleOwnerIds(req: AuthRequest): Promise<string[] | 'all'> {
  if (req.permissions?.includes('*')) return 'all'

  const viewerId = req.userId!

  // Récupère tous les ownerIds partagés avec ce viewer
  const accesses = await prisma.calendarAccess.findMany({
    where: { viewerId },
    select: { ownerId: true },
  })

  // Le viewer peut toujours voir son propre calendrier
  const ownerIds = [viewerId, ...accesses.map(a => a.ownerId)]
  // Déduplique (au cas où viewerId serait parmi les accès)
  return [...new Set(ownerIds)]
}

/**
 * Construit le fragment `where` Prisma pour filtrer les RDV visibles par l'appelant.
 *
 * Pour 'all' (ADMIN) → {} (pas de filtre)
 * Sinon → OR :
 *   - Au moins un participant dont le calendrier est visible
 *   - Créé par cet utilisateur
 *   - Aucun participant utilisateur (RDV orphelin)
 */
export function appointmentVisibilityWhere(
  visible: string[] | 'all',
  userId: string,
): Record<string, unknown> {
  if (visible === 'all') return {}

  return {
    OR: [
      // Au moins un participant dont V peut voir le calendrier
      { users: { some: { userId: { in: visible } } } },
      // Créé par V
      { createdById: userId },
      // Aucun participant (RDV orphelin)
      { users: { none: {} } },
    ],
  }
}
