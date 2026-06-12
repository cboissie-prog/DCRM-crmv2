import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'

const router = Router()
router.use(authenticate)


const userSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères'),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'COMMERCIAL', 'TECHNICIEN']).optional(),
})

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'COMMERCIAL', 'TECHNICIEN']).optional(),
  isActive: z.boolean().optional(),
})

// GET / — liste users (ADMIN, MANAGER)
router.get('/', requirePermission('users:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, avatar: true, role: true, isActive: true, createdAt: true },
      orderBy: { firstName: 'asc' },
    })
    res.json({ success: true, data: users })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

// POST / — créer un user (ADMIN seulement)
router.post('/', requirePermission('users:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = userSchema.parse(req.body)
    const hashedPassword = await bcrypt.hash(body.password, 12)
    const roleRecord = body.role ? await prisma.role.findUnique({ where: { name: body.role } }) : null
    const user = await prisma.user.create({
      data: { ...body, password: hashedPassword, roleId: roleRecord?.id ?? null },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, isActive: true, createdAt: true },
    })
    res.status(201).json({ success: true, data: user })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// GET /targets — objectifs de vente (ADMIN, MANAGER)
router.get('/targets', requirePermission('reports:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targets = await prisma.salesTarget.findMany({
      include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
      orderBy: { period: 'desc' },
    })
    res.json({ success: true, data: targets })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

const targetSchema = z.object({
  userId: z.string().min(1),
  period: z.string().min(1),
  target: z.number().positive(),
})

// POST /targets — définir un objectif (ADMIN, MANAGER)
router.post('/targets', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId, period, target } = targetSchema.parse(req.body)
    const existing = await prisma.salesTarget.findFirst({ where: { userId, period } })
    const t = existing
      ? await prisma.salesTarget.update({ where: { id: existing.id }, data: { target } })
      : await prisma.salesTarget.create({ data: { userId, period, target } })
    res.json({ success: true, data: t })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// GET /:id — un user (ADMIN, MANAGER ou soi-même)
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isSelf = req.params.id === req.userId
    const isAdminOrManager = req.userRole === 'ADMIN' || req.userRole === 'MANAGER'
    if (!isSelf && !isAdminOrManager) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Accès refusé' } })
      return
    }
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, avatar: true, role: true, isActive: true, createdAt: true },
    })
    if (!user) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Utilisateur introuvable' } }); return }
    res.json({ success: true, data: user })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

// PUT /:id — modifier (ADMIN ou soi-même pour son profil)
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isSelf = req.params.id === req.userId
    const isAdmin = req.userRole === 'ADMIN'
    if (!isSelf && !isAdmin) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Accès refusé' } })
      return
    }
    // Seul ADMIN peut modifier le rôle ou isActive
    const body = updateUserSchema.parse(req.body)
    if (!isAdmin) {
      delete body.role
      delete body.isActive
    }
    const roleRecord = body.role ? await prisma.role.findUnique({ where: { name: body.role } }) : undefined
    const user = await prisma.user.update({
      where: { id: req.params.id as string },
      data: { ...body, ...(roleRecord ? { roleId: roleRecord.id } : {}) },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, isActive: true },
    })
    res.json({ success: true, data: user })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// DELETE /:id — désactiver (ADMIN seulement, soft delete)
router.delete('/:id', requirePermission('users:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.params.id === req.userId) { res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Impossible de se désactiver soi-même' } }); return }
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } })
    res.json({ success: true, data: { message: 'Utilisateur désactivé' } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

// PATCH /:id/password — changer son propre mot de passe
router.patch('/:id/password', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isSelf = req.params.id === req.userId
    const isAdmin = req.userRole === 'ADMIN'
    if (!isSelf && !isAdmin) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Accès refusé' } })
      return
    }
    const { currentPassword, newPassword } = req.body
    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Le nouveau mot de passe doit faire au moins 8 caractères' } })
      return
    }
    // Si c'est soi-même (et pas admin), vérifier l'ancien mot de passe
    if (isSelf && !isAdmin) {
      const user = await prisma.user.findUnique({ where: { id: req.params.id } })
      if (!user) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Utilisateur introuvable' } }); return }
      const valid = await bcrypt.compare(currentPassword, user.password)
      if (!valid) { res.status(401).json({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Mot de passe actuel incorrect' } }); return }
    }
    const hashedPassword = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id: req.params.id }, data: { password: hashedPassword } })
    res.json({ success: true, data: { message: 'Mot de passe mis à jour' } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

export default router
