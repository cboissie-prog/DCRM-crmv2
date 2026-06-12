import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'

const router = Router()
router.use(authenticate)

const productSchema = z.object({
  reference: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string(),
  type: z.string().optional(),
  price: z.number(),
  vatRate: z.number().optional(),
  unit: z.string().optional(),
  stock: z.number().int().optional(),
  supplier: z.string().optional(),
  imageUrl: z.string().optional(),
  isActive: z.boolean().optional(),
})

router.get('/', requirePermission('products:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, category, type, page, limit } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50))
    const where: Record<string, unknown> = {}
    if (category) where.category = category
    if (type) where.type = type
    if (search) where.OR = [
      { name: { contains: search } },
      { reference: { contains: search } },
      { supplier: { contains: search } },
    ]
    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({ where, skip: (pageNum - 1) * limitNum, take: limitNum, orderBy: { name: 'asc' } }),
    ])
    res.json({ success: true, data: products, meta: { total, page: pageNum, limit: limitNum } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.post('/', requirePermission('products:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = productSchema.parse(req.body)
    const product = await prisma.product.create({ data: body })
    res.status(201).json({ success: true, data: product })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.get('/:id', requirePermission('products:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } })
    if (!product) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Produit introuvable' } }); return }
    res.json({ success: true, data: product })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.put('/:id', requirePermission('products:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = productSchema.partial().parse(req.body)
    const product = await prisma.product.update({ where: { id: req.params.id }, data: body })
    res.json({ success: true, data: product })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.delete('/:id', requirePermission('products:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } })
    res.json({ success: true, data: { message: 'Produit désactivé' } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

export default router
