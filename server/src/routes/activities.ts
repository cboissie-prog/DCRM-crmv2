import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'

const router = Router()
router.use(authenticate)

const activitySchema = z.object({
  type: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  opportunityId: z.string().optional(),
  dueDate: z.string().optional(),
})

router.get('/', requirePermission('activities:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { contactId, companyId, opportunityId, type, page, limit } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25))
    const where: Record<string, unknown> = {}
    if (contactId) where.contactId = contactId
    if (companyId) where.companyId = companyId
    if (opportunityId) where.opportunityId = opportunityId
    if (type) where.type = type
    const [total, activities] = await Promise.all([
      prisma.activity.count({ where }),
      prisma.activity.findMany({
        where, skip: (pageNum - 1) * limitNum, take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
          company: { select: { id: true, name: true } },
        },
      }),
    ])
    res.json({ success: true, data: activities, meta: { total, page: pageNum, limit: limitNum } })
  } catch (err) { handleRouteError(err, res) }
})

router.post('/', requirePermission('activities:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = activitySchema.parse(req.body)
    const data: Record<string, unknown> = { ...body, userId: req.userId }
    if (body.dueDate) data.dueDate = new Date(body.dueDate)
    const activity = await prisma.activity.create({
      data: data as Parameters<typeof prisma.activity.create>[0]['data'],
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    })
    res.status(201).json({ success: true, data: activity })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/:id', requirePermission('activities:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = activitySchema.partial().parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.dueDate) data.dueDate = new Date(body.dueDate)
    if (req.body.completedAt) data.completedAt = new Date(req.body.completedAt)
    const activity = await prisma.activity.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.activity.update>[0]['data'] })
    res.json({ success: true, data: activity })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/:id', requirePermission('activities:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.activity.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: { message: 'Activité supprimée' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
