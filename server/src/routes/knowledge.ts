import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { ciContains } from '../lib/query'

const router = Router()
router.use(authenticate)

const articleSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.string(),
  tags: z.string().optional(),
  isPublished: z.boolean().optional(),
})

// GET /knowledge/categories — compteurs par catégorie
router.get('/categories', requirePermission('knowledge:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isEditor = req.userRole === 'ADMIN' || req.userRole === 'MANAGER'
    const baseWhere = isEditor ? {} : { isPublished: true }
    const groups = await prisma.knowledgeArticle.groupBy({
      by: ['category'],
      where: baseWhere,
      _count: { id: true },
    })
    const total = await prisma.knowledgeArticle.count({ where: baseWhere })
    res.json({ success: true, data: { total, categories: groups.map(g => ({ category: g.category, count: g._count.id })) } })
  } catch (err) { handleRouteError(err, res) }
})

router.get('/', requirePermission('knowledge:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, category, page, limit } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25))
    const isEditor = req.userRole === 'ADMIN' || req.userRole === 'MANAGER'
    const where: Record<string, unknown> = isEditor ? {} : { isPublished: true }
    if (category) where.category = category
    if (search) where.OR = [{ title: ciContains(search) }, { content: ciContains(search) }, { tags: ciContains(search) }]
    const [total, articles] = await Promise.all([
      prisma.knowledgeArticle.count({ where }),
      prisma.knowledgeArticle.findMany({ where, skip: (pageNum - 1) * limitNum, take: limitNum, orderBy: { updatedAt: 'desc' } }),
    ])
    res.json({ success: true, data: articles, meta: { total, page: pageNum, limit: limitNum } })
  } catch (err) { handleRouteError(err, res) }
})

router.post('/', requirePermission('knowledge:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = articleSchema.parse(req.body)
    const article = await prisma.knowledgeArticle.create({ data: body })
    res.status(201).json({ success: true, data: article })
  } catch (err) { handleRouteError(err, res) }
})

router.get('/:id', requirePermission('knowledge:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const article = await prisma.knowledgeArticle.findUnique({ where: { id: req.params.id } })
    if (!article) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Article introuvable' } }); return }
    await prisma.knowledgeArticle.update({ where: { id: req.params.id }, data: { views: { increment: 1 } } })
    res.json({ success: true, data: article })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/:id', requirePermission('knowledge:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = articleSchema.partial().parse(req.body)
    const article = await prisma.knowledgeArticle.update({ where: { id: req.params.id }, data: body })
    res.json({ success: true, data: article })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/:id', requirePermission('knowledge:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.knowledgeArticle.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: { message: 'Article supprimé' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
