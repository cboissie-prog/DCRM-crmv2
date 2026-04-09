import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requireRole } from '../middleware/auth'

const router = Router()
router.use(authenticate)

const pipelineSchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional(),
  color:       z.string().optional(),
  order:       z.number().int().optional(),
})

const stageSchema = z.object({
  key:   z.string().min(1),
  name:  z.string().min(1),
  color: z.string().optional(),
  order: z.number().int().optional(),
  isWon:  z.boolean().optional(),
  isLost: z.boolean().optional(),
})

// ─── PIPELINES ───────────────────────────────────────────

router.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pipelines = await prisma.pipeline.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { order: 'asc' }, { name: 'asc' }],
      include: {
        stages: { orderBy: { order: 'asc' } },
        _count: { select: { opportunities: true } },
      },
    })
    res.json({ success: true, data: pipelines })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.post('/', requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = pipelineSchema.parse(req.body)
    const maxOrder = await prisma.pipeline.aggregate({ _max: { order: true } })
    const pipeline = await prisma.pipeline.create({
      data: { ...body, order: body.order ?? (maxOrder._max.order ?? 0) + 1 },
      include: { stages: { orderBy: { order: 'asc' } } },
    })
    res.status(201).json({ success: true, data: pipeline })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.put('/:id', requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = pipelineSchema.partial().parse(req.body)
    const pipeline = await prisma.pipeline.update({
      where: { id: req.params.id },
      data: body,
      include: { stages: { orderBy: { order: 'asc' } } },
    })
    res.json({ success: true, data: pipeline })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.patch('/:id/default', requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.pipeline.updateMany({ data: { isDefault: false } })
    const pipeline = await prisma.pipeline.update({
      where: { id: req.params.id },
      data: { isDefault: true },
      include: { stages: { orderBy: { order: 'asc' } } },
    })
    res.json({ success: true, data: pipeline })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.delete('/:id', requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { opportunities: true } } },
    })
    if (!pipeline) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pipeline introuvable' } }); return }
    if (pipeline.isDefault) { res.status(400).json({ success: false, error: { code: 'FORBIDDEN', message: 'Impossible de supprimer le pipeline par défaut' } }); return }
    if (pipeline._count.opportunities > 0) { res.status(400).json({ success: false, error: { code: 'CONFLICT', message: `Ce pipeline contient ${pipeline._count.opportunities} opportunité(s)` } }); return }
    await prisma.pipeline.update({ where: { id: req.params.id }, data: { isActive: false } })
    res.json({ success: true })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

// ─── STAGES ──────────────────────────────────────────────

router.post('/:id/stages', requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = stageSchema.parse(req.body)
    // Check key uniqueness in this pipeline
    const existing = await prisma.pipelineStage.findUnique({ where: { pipelineId_key: { pipelineId: req.params.id, key: body.key } } })
    if (existing) { res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'Une étape avec cette clé existe déjà' } }); return }
    const maxOrder = await prisma.pipelineStage.aggregate({ _max: { order: true }, where: { pipelineId: req.params.id } })
    const order = body.order ?? (maxOrder._max.order ?? 0) + 1
    const stage = await prisma.pipelineStage.create({ data: { ...body, order, pipelineId: req.params.id } })
    res.status(201).json({ success: true, data: stage })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.put('/:id/stages/:stageId', requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = stageSchema.partial().parse(req.body)
    const stage = await prisma.pipelineStage.update({ where: { id: req.params.stageId }, data: body })
    res.json({ success: true, data: stage })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.delete('/:id/stages/:stageId', requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stage = await prisma.pipelineStage.findUnique({ where: { id: req.params.stageId } })
    if (!stage) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Étape introuvable' } }); return }
    if (stage.isWon || stage.isLost) { res.status(400).json({ success: false, error: { code: 'FORBIDDEN', message: 'Impossible de supprimer les étapes Gagné/Perdu' } }); return }
    const oppsInStage = await prisma.opportunity.count({ where: { pipelineId: req.params.id, stage: stage.key } })
    if (oppsInStage > 0) { res.status(400).json({ success: false, error: { code: 'CONFLICT', message: `${oppsInStage} opportunité(s) dans cette étape` } }); return }
    await prisma.pipelineStage.delete({ where: { id: req.params.stageId } })
    res.json({ success: true })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.patch('/:id/stages/reorder', requireRole(['ADMIN', 'MANAGER']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { stages } = z.object({ stages: z.array(z.object({ id: z.string(), order: z.number().int() })) }).parse(req.body)
    await Promise.all(stages.map(s => prisma.pipelineStage.update({ where: { id: s.id }, data: { order: s.order } })))
    const updated = await prisma.pipelineStage.findMany({ where: { pipelineId: req.params.id }, orderBy: { order: 'asc' } })
    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

export default router
