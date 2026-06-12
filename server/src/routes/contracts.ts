import { Router, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'

const router = Router()
router.use(authenticate)

async function generateContractRef(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.contract.count()
  const year = new Date().getFullYear()
  return `CTR-${year}-${String(count + 1).padStart(4, '0')}`
}

const contractSchema = z.object({
  companyId: z.string(),
  type: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  renewalDate: z.string().optional(),
  monthlyAmount: z.number().optional(),
  annualAmount: z.number().optional(),
  slaResponseTime: z.number().int().optional(),
  slaWorkingHours: z.string().optional(),
  autoRenewal: z.boolean().optional(),
  notes: z.string().optional(),
})

router.get('/', requirePermission('contracts:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, type, companyId, expiringSoon, page, limit } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25))
    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (type) where.type = type
    if (companyId) where.companyId = companyId
    if (expiringSoon === 'true') {
      const in60Days = new Date()
      in60Days.setDate(in60Days.getDate() + 60)
      where.endDate = { lte: in60Days }
      where.status = 'ACTIVE'
    }
    const [total, contracts] = await Promise.all([
      prisma.contract.count({ where }),
      prisma.contract.findMany({
        where, skip: (pageNum - 1) * limitNum, take: limitNum,
        orderBy: { endDate: 'asc' },
        include: { company: { select: { id: true, name: true } }, _count: { select: { tickets: true, equipments: true } } },
      }),
    ])
    res.json({ success: true, data: contracts, meta: { total, page: pageNum, limit: limitNum } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.post('/', requirePermission('contracts:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = contractSchema.parse(req.body)
    const contract = await prisma.$transaction(async (tx) => {
      const reference = await generateContractRef(tx)
      return tx.contract.create({
        data: {
          ...body,
          reference,
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          renewalDate: body.renewalDate ? new Date(body.renewalDate) : undefined,
        },
        include: { company: { select: { id: true, name: true } } },
      })
    })
    res.status(201).json({ success: true, data: contract })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.get('/:id', requirePermission('contracts:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: {
        company: true,
        lines: { include: { product: true } },
        tickets: { orderBy: { createdAt: 'desc' }, take: 10 },
        equipments: true,
        renewalAlerts: true,
      },
    })
    if (!contract) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Contrat introuvable' } }); return }
    res.json({ success: true, data: contract })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.put('/:id', requirePermission('contracts:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = contractSchema.partial().parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.startDate) data.startDate = new Date(body.startDate)
    if (body.endDate) data.endDate = new Date(body.endDate)
    if (body.renewalDate) data.renewalDate = new Date(body.renewalDate)
    const contract = await prisma.contract.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.contract.update>[0]['data'] })
    res.json({ success: true, data: contract })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.delete('/:id', requirePermission('contracts:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.contract.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: { message: 'Contrat supprimé' } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

// MRR / ARR stats
router.get('/stats/mrr', requirePermission('contracts:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const activeContracts = await prisma.contract.findMany({ where: { status: 'ACTIVE' } })
    const mrr = activeContracts.reduce((sum, c) => sum + (c.monthlyAmount || c.annualAmount / 12), 0)
    const arr = mrr * 12
    const byType = activeContracts.reduce((acc: Record<string, number>, c) => {
      acc[c.type] = (acc[c.type] || 0) + (c.monthlyAmount || c.annualAmount / 12)
      return acc
    }, {})
    res.json({ success: true, data: { mrr: Math.round(mrr * 100) / 100, arr: Math.round(arr * 100) / 100, byType, total: activeContracts.length } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

export default router
