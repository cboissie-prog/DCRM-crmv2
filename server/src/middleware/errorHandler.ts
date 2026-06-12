import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import logger from '../lib/logger'

export const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  logger.error({ err }, err.stack)
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Erreur serveur interne',
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
