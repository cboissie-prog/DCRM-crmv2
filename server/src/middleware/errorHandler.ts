import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import logger from '../lib/logger'

export const errorHandler = (
  err: Error & { status?: number; statusCode?: number; type?: string },
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error({ err }, err.stack)
  // body-parser (413 entity.too.large, 400 JSON malformé) et le callback CORS portent
  // un status propre — le respecter plutôt que de tout aplatir en 500.
  const status = err.status ?? err.statusCode ?? 500
  const code =
    err.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE'
    : err.message === 'CORS' ? 'CORS_FORBIDDEN'
    : status === 500 ? 'INTERNAL_ERROR'
    : 'REQUEST_ERROR'
  res.status(err.message === 'CORS' ? 403 : status).json({
    success: false,
    error: {
      code,
      message:
        process.env.NODE_ENV === 'development' ? err.message
        : status === 500 ? 'Erreur serveur interne'
        : err.message,
    },
  })
}

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route introuvable' } })
}

export function handleRouteError(err: unknown, res: Response): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } })
    return
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Cette valeur existe déjà (contrainte d\'unicité)' } })
      return
    }
    if (err.code === 'P2025') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ressource introuvable' } })
      return
    }
    if (err.code === 'P2003') {
      res.status(400).json({ success: false, error: { code: 'INVALID_REFERENCE', message: 'Référence invalide vers une ressource liée' } })
      return
    }
  }
  logger.error({ err }, '[API ERROR]')
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
}
