import prisma from '../prisma/client'
import logger from './logger'
import type { AuthRequest } from '../middleware/auth'

/**
 * Enregistre une action sensible dans la piste d'audit.
 * Fire-and-forget : n'attend pas la DB et ne bloque JAMAIS la requête appelante.
 */
export function audit(
  req: AuthRequest,
  action: string,
  entity: string,
  entityId?: string,
  meta?: Record<string, unknown>,
): void {
  prisma.auditLog
    .create({
      data: {
        userId:   req.userId ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        meta:     meta ? JSON.stringify(meta) : null,
      },
    })
    .catch((err: unknown) =>
      logger.error({ err, action, entity, entityId }, 'Échec de l\'écriture dans la piste d\'audit'),
    )
}
