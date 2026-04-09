import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requireRole } from '../middleware/auth'

const router = Router()
router.use(authenticate)

const licenseSchema = z.object({
  companyId: z.string(),
  equipmentId: z.string().optional(),
  software: z.string().min(1),
  vendor: z.string().optional(),
  licenseKey: z.string().optional(),
  seats: z.number().int().optional(),
  type: z.string().optional(),
  purchaseDate: z.string().optional(),
  expiryDate: z.string().optional(),
  cost: z.number().optional(),
  notes: z.string().optional(),
})

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { companyId, type, expiringSoon, page, limit } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50))
    const where: Record<string, unknown> = {}
    if (companyId) where.companyId = companyId
    if (type) where.type = type
    if (expiringSoon === 'true') {
      const in60Days = new Date()
      in60Days.setDate(in60Days.getDate() + 60)
      where.expiryDate = { lte: in60Days, gte: new Date() }
    }
    const [total, licenses] = await Promise.all([
      prisma.license.count({ where }),
      prisma.license.findMany({
        where, skip: (pageNum - 1) * limitNum, take: limitNum,
        orderBy: { expiryDate: 'asc' },
        include: {
          company: { select: { id: true, name: true } },
          equipment: { select: { id: true, type: true, brand: true, model: true } },
        },
      }),
    ])
    res.json({ success: true, data: licenses, meta: { total, page: pageNum, limit: limitNum } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.post('/', requireRole(['ADMIN', 'MANAGER', 'TECHNICIEN']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = licenseSchema.parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.purchaseDate) data.purchaseDate = new Date(body.purchaseDate)
    if (body.expiryDate) data.expiryDate = new Date(body.expiryDate)
    const license = await prisma.license.create({
      data: data as Parameters<typeof prisma.license.create>[0]['data'],
      include: { company: { select: { id: true, name: true } } },
    })
    res.status(201).json({ success: true, data: license })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.put('/:id', requireRole(['ADMIN', 'MANAGER', 'TECHNICIEN']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = licenseSchema.partial().parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.purchaseDate) data.purchaseDate = new Date(body.purchaseDate)
    if (body.expiryDate) data.expiryDate = new Date(body.expiryDate)
    const license = await prisma.license.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.license.update>[0]['data'] })
    res.json({ success: true, data: license })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.delete('/:id', requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.license.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: { message: 'Licence supprimée' } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

export default router
