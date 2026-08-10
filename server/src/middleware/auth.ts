import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import prisma from '../prisma/client'
import logger from '../lib/logger'

export interface AuthRequest extends Request {
  userId?: string
  userRole?: string
  permissions?: string[]
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  // ── API Key (X-API-Key header) ───────────────────────────────────────────────
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined
  if (apiKeyHeader) {
    try {
      const hash = hashKey(apiKeyHeader)
      const record = await prisma.apiKey.findUnique({
        where: { keyHash: hash },
        include: {
          user: {
            include: {
              roleRef: {
                include: { permissions: { include: { permission: true } } },
              },
            },
          },
        },
      })

      if (!record || !record.isActive || !record.user.isActive) {
        res.status(401).json({ success: false, error: { code: 'INVALID_API_KEY', message: 'Clé API invalide ou révoquée' } })
        return
      }

      if (record.expiresAt && record.expiresAt < new Date()) {
        res.status(401).json({ success: false, error: { code: 'EXPIRED_API_KEY', message: 'Clé API expirée' } })
        return
      }

      // Mise à jour lastUsedAt en arrière-plan (non bloquant)
      prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {})

      const user = record.user
      const permissions: string[] =
        user.role === 'ADMIN'
          ? []
          : user.roleRef?.permissions.map((rp: { permission: { key: string } }) => rp.permission.key) ?? []

      req.userId = user.id
      req.userRole = user.role
      req.permissions = user.role === 'ADMIN' ? ['*'] : permissions
      next()
      return
    } catch (e) {
      logger.error({ err: e }, 'Erreur d\'authentification par clé API')
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
      return
    }
  }

  // ── Bearer JWT ───────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token manquant' } })
    return
  }
  const token = authHeader.split(' ')[1]
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as { userId: string; role: string; permissions?: string[]; tokenVersion?: number; typ?: string }
    // Les jetons d'accès n'ont pas de claim `typ`. Tout jeton typé est un jeton à usage
    // spécifique (state OAuth, etc.) et ne doit jamais authentifier une requête, même s'il
    // se trouvait signé avec ce secret.
    if (payload.typ !== undefined) {
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token invalide ou expiré' } })
      return
    }
    // tokenVersion : invalidation immédiate des access tokens à la désactivation, au changement
    // de rôle ou de mot de passe (sinon un token déjà émis restait valide jusqu'à 15 min).
    // `?? 0` : les tokens émis avant l'introduction du claim restent valides (version initiale 0).
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { isActive: true, tokenVersion: true },
    })
    if (!user || !user.isActive || (payload.tokenVersion ?? 0) !== user.tokenVersion) {
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token invalide ou expiré' } })
      return
    }
    req.userId = payload.userId
    req.userRole = payload.role
    req.permissions = payload.permissions ?? []
    next()
  } catch {
    res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token invalide ou expiré' } })
  }
}

/** Vérification de permission en dehors d'un middleware (checks conditionnels dans une route). */
export function hasPermission(req: AuthRequest, permission: string): boolean {
  if (req.permissions?.includes('*')) return true
  return req.permissions?.includes(permission) ?? false
}

export const requirePermission = (permission: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    // ADMIN via API key a '*' comme permissions (bypass total)
    if (req.permissions?.includes('*')) { next(); return }
    if (!req.permissions || !req.permissions.includes(permission)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Permission insuffisante' }
      })
      return
    }
    next()
  }
}

export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Accès refusé' } })
      return
    }
    next()
  }
}
