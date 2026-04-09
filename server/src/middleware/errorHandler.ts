import { Request, Response, NextFunction } from 'express'

export const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  console.error(err.stack)
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
