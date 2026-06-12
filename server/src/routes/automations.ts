import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'

const router = Router()
router.use(authenticate)

const automationSchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional(),
  trigger:     z.string().min(1),
  conditions:  z.string().optional().default('{}'),
  actions:     z.string().min(2, 'Au moins une action requise'),
  isActive:    z.boolean().optional().default(true),
})

// GET /automations
router.get('/', requirePermission('automation:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const automations = await prisma.automation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true, success: true },
        },
      },
    })

    const enriched = await Promise.all(automations.map(async (a) => {
      const [successCount, errorCount] = await Promise.all([
        prisma.automationLog.count({ where: { automationId: a.id, success: true } }),
        prisma.automationLog.count({ where: { automationId: a.id, success: false } }),
      ])
      const { logs, ...rest } = a
      return { ...rest, successCount, errorCount, lastRunAt: logs[0]?.createdAt ?? null }
    }))

    res.json({ success: true, data: enriched })
  } catch (err) { handleRouteError(err, res) }
})

// POST /automations
router.post('/', requirePermission('automation:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = automationSchema.parse(req.body)
    const automation = await prisma.automation.create({ data: body })
    res.status(201).json({ success: true, data: automation })
  } catch (err) { handleRouteError(err, res) }
})

// GET /automations/:id/logs
router.get('/:id/logs', requirePermission('automation:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const logs = await prisma.automationLog.findMany({
      where: { automationId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { firstName: true, lastName: true } } },
    })
    res.json({ success: true, data: logs })
  } catch (err) { handleRouteError(err, res) }
})

// PUT /automations/:id
router.put('/:id', requirePermission('automation:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = automationSchema.partial().parse(req.body)
    const automation = await prisma.automation.update({ where: { id: req.params.id }, data: body })
    res.json({ success: true, data: automation })
  } catch (err) { handleRouteError(err, res) }
})

// PATCH /automations/:id (toggle active)
router.patch('/:id', requirePermission('automation:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { isActive } = req.body
    const automation = await prisma.automation.update({ where: { id: req.params.id }, data: { isActive } })
    res.json({ success: true, data: automation })
  } catch (err) { handleRouteError(err, res) }
})

// DELETE /automations/:id
router.delete('/:id', requirePermission('automation:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.automation.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) { handleRouteError(err, res) }
})

export default router
