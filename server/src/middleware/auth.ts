import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export interface AuthRequest extends Request {
  userId?: string
  userRole?: string
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token manquant' } })
    return
  }
  const token = authHeader.split(' ')[1]
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; role: string }
    req.userId = payload.userId
    req.userRole = payload.role
    next()
  } catch {
    res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token invalide ou expiré' } })
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
