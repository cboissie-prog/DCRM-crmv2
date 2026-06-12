import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'

const router = Router()
router.use(authenticate)

const equipmentSchema = z.object({
  companyId: z.string(),
  contractId: z.string().optional(),
  type: z.string(),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  purchaseDate: z.string().optional(),
  warrantyExpiry: z.string().optional(),
  location: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
})

router.get('/', requirePermission('equipment:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { companyId, type, status, warrantyExpiringSoon, page, limit } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50))
    const where: Record<string, unknown> = {}
    if (companyId) where.companyId = companyId
    if (type) where.type = type
    if (status) where.status = status
    if (warrantyExpiringSoon === 'true') {
      const in90Days = new Date()
      in90Days.setDate(in90Days.getDate() + 90)
      where.warrantyExpiry = { lte: in90Days, gte: new Date() }
    }
    const [total, equipments] = await Promise.all([
      prisma.equipment.count({ where }),
      prisma.equipment.findMany({
        where, skip: (pageNum - 1) * limitNum, take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true } },
          contract: { select: { id: true, reference: true, title: true } },
          _count: { select: { tickets: true, licenses: true } },
        },
      }),
    ])
    res.json({ success: true, data: equipments, meta: { total, page: pageNum, limit: limitNum } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.post('/', requirePermission('equipment:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = equipmentSchema.parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.purchaseDate) data.purchaseDate = new Date(body.purchaseDate)
    if (body.warrantyExpiry) data.warrantyExpiry = new Date(body.warrantyExpiry)
    const equipment = await prisma.equipment.create({
      data: data as Parameters<typeof prisma.equipment.create>[0]['data'],
      include: { company: { select: { id: true, name: true } } },
    })
    res.status(201).json({ success: true, data: equipment })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.get('/:id', requirePermission('equipment:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const equipment = await prisma.equipment.findUnique({
      where: { id: req.params.id },
      include: {
        company: true,
        contract: true,
        tickets: { orderBy: { createdAt: 'desc' }, take: 10 },
        licenses: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!equipment) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Équipement introuvable' } }); return }
    res.json({ success: true, data: equipment })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.put('/:id', requirePermission('equipment:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = equipmentSchema.partial().parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.purchaseDate) data.purchaseDate = new Date(body.purchaseDate)
    if (body.warrantyExpiry) data.warrantyExpiry = new Date(body.warrantyExpiry)
    const equipment = await prisma.equipment.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.equipment.update>[0]['data'] })
    res.json({ success: true, data: equipment })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.delete('/:id', requirePermission('equipment:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.equipment.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: { message: 'Équipement supprimé' } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

export default router
