import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'
import { sendPasswordResetEmail } from '../services/mailer'

const router = Router()

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
  path: '/api/auth',
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

function generateTokens(userId: string, role: string, permissions: string[]) {
  const accessToken = jwt.sign({ userId, role, permissions }, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  } as jwt.SignOptions)
  const refreshToken = jwt.sign({ userId, role }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  } as jwt.SignOptions)
  return { accessToken, refreshToken }
}

// POST /auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = loginSchema.parse(req.body)
    // Un seul findUnique avec include pour éviter la double requête
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: {
        roleRef: {
          include: {
            permissions: {
              include: { permission: true }
            }
          }
        }
      }
    })
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' } })
      return
    }
    const valid = await bcrypt.compare(body.password, user.password)
    if (!valid) {
      res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' } })
      return
    }
    // Bypass ADMIN : accès total symbolisé par ['*']
    const permissions: string[] = user.role === 'ADMIN'
      ? ['*']
      : (user.roleRef?.permissions.map(rp => rp.permission.key) ?? [])
    const { accessToken, refreshToken } = generateTokens(user.id, user.role, permissions)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id, expiresAt } })
    const { password: _, roleRef: __, ...userWithoutPassword } = user
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS)
    res.json({ success: true, data: { user: { ...userWithoutPassword, permissions }, accessToken } })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } })
      return
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// POST /auth/refresh
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken
    if (!refreshToken) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Refresh token manquant' } })
      return
    }
    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken }, include: { user: true } })
    if (!stored || stored.expiresAt < new Date()) {
      res.clearCookie('refreshToken', { path: '/api/auth' })
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Refresh token invalide' } })
      return
    }
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { userId: string; role: string }
    const userWithPermissions = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        roleRef: {
          include: {
            permissions: { include: { permission: true } }
          }
        }
      }
    })
    if (!userWithPermissions) {
      res.clearCookie('refreshToken', { path: '/api/auth' })
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Utilisateur introuvable' } })
      return
    }
    // Bypass ADMIN : accès total symbolisé par ['*']
    const permissions: string[] = userWithPermissions.role === 'ADMIN'
      ? ['*']
      : (userWithPermissions.roleRef?.permissions.map(rp => rp.permission.key) ?? [])
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(userWithPermissions.id, userWithPermissions.role, permissions)
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } })
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.refreshToken.create({ data: { token: newRefreshToken, userId: userWithPermissions.id, expiresAt } })
    res.cookie('refreshToken', newRefreshToken, REFRESH_COOKIE_OPTIONS)
    res.json({ success: true, data: { accessToken } })
  } catch {
    res.clearCookie('refreshToken', { path: '/api/auth' })
    res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token invalide' } })
  }
})

// POST /auth/logout
router.post('/logout', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken
    if (refreshToken) await prisma.refreshToken.deleteMany({ where: { token: refreshToken } })
    res.clearCookie('refreshToken', { path: '/api/auth' })
    res.json({ success: true, data: { message: 'Déconnecté avec succès' } })
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// POST /auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  // Délai constant pour éviter l'énumération d'emails par timing (user existant vs non existant)
  const minDelay = new Promise(r => setTimeout(r, 300))
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body)
    const user = await prisma.user.findUnique({ where: { email } })
    if (user && user.isActive) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })
      const token = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1h
      await prisma.passwordResetToken.create({ data: { token, userId: user.id, expiresAt } })
      await sendPasswordResetEmail(user.email, token)
    }
    await minDelay
    res.json({ success: true, data: { message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' } })
  } catch (err) {
    await minDelay
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } })
      return
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// POST /auth/reset-password
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = z.object({
      token: z.string().min(1),
      password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères'),
    }).parse(req.body)
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    })
    if (!resetToken || resetToken.expiresAt < new Date()) {
      res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Lien invalide ou expiré' } })
      return
    }
    const hashedPassword = await bcrypt.hash(password, 12)
    await prisma.user.update({ where: { id: resetToken.userId }, data: { password: hashedPassword } })
    await prisma.passwordResetToken.delete({ where: { token } })
    await prisma.refreshToken.deleteMany({ where: { userId: resetToken.userId } })
    res.clearCookie('refreshToken', { path: '/api/auth' })
    res.json({ success: true, data: { message: 'Mot de passe réinitialisé avec succès' } })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } })
      return
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// GET /auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: {
      id: true, email: true, firstName: true, lastName: true, phone: true, avatar: true, role: true, isActive: true, createdAt: true
    }})
    if (!user) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Utilisateur introuvable' } }); return }
    res.json({ success: true, data: user })
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

export default router
