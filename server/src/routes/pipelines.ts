import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { ensureWonLostStages } from '../services/pipelineService'

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

// ─── Helpers ─────────────────────────────────────────────

/** Réservé aux ADMIN. Renvoie false + 403 sinon. */
function requireAdmin(req: AuthRequest, res: Response): boolean {
  if (req.userRole === 'ADMIN') return true
  res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Réservé aux administrateurs' } })
  return false
}

/**
 * Renvoie true si l'utilisateur peut gérer ce pipeline personnel.
 * - ADMIN : tout pipeline (y compris legacy ownerId=null)
 * - Autre : uniquement ses propres pipelines (ownerId === req.userId)
 * Répond avec 404/403 et renvoie false le cas échéant.
 */
async function canManagePipeline(pipelineId: string, req: AuthRequest, res: Response): Promise<boolean> {
  if (req.userRole === 'ADMIN') return true
  const pipeline = await prisma.pipeline.findUnique({ where: { id: pipelineId }, select: { ownerId: true } })
  if (!pipeline) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pipeline introuvable' } })
    return false
  }
  if (pipeline.ownerId !== req.userId) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Vous ne pouvez gérer que vos propres pipelines' } })
    return false
  }
  return true
}

// ═════════════════════════════════════════════════════════
// TEMPLATES (ADMIN uniquement)
// Déclarés AVANT les routes /:id pour éviter toute collision de routage.
// ═════════════════════════════════════════════════════════

router.get('/templates', requirePermission('pipeline:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return
  try {
    const templates = await prisma.pipeline.findMany({
      where: { isTemplate: true },
      orderBy: [{ isDefault: 'desc' }, { order: 'asc' }, { name: 'asc' }],
      include: { stages: { orderBy: { order: 'asc' } } },
    })
    res.json({ success: true, data: templates })
  } catch (err) { handleRouteError(err, res) }
})

router.post('/templates', requirePermission('pipeline:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return
  try {
    const body = pipelineSchema.parse(req.body)
    const maxOrder = await prisma.pipeline.aggregate({ _max: { order: true }, where: { isTemplate: true } })
    const created = await prisma.pipeline.create({
      data: { ...body, order: body.order ?? (maxOrder._max.order ?? 0) + 1, isTemplate: true, ownerId: null },
    })
    await ensureWonLostStages(created.id)
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: created.id },
      include: { stages: { orderBy: { order: 'asc' } } },
    })
    res.status(201).json({ success: true, data: pipeline })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/templates/:id', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return
  try {
    const body = pipelineSchema.partial().parse(req.body)
    const pipeline = await prisma.pipeline.update({
      where: { id: req.params.id, isTemplate: true },
      data: body,
      include: { stages: { orderBy: { order: 'asc' } } },
    })
    res.json({ success: true, data: pipeline })
  } catch (err) { handleRouteError(err, res) }
})

router.patch('/templates/:id/default', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return
  try {
    await prisma.pipeline.updateMany({ where: { isTemplate: true }, data: { isDefault: false } })
    const pipeline = await prisma.pipeline.update({
      where: { id: req.params.id, isTemplate: true },
      data: { isDefault: true },
      include: { stages: { orderBy: { order: 'asc' } } },
    })
    res.json({ success: true, data: pipeline })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/templates/:id', requirePermission('pipeline:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return
  try {
    const pipeline = await prisma.pipeline.findUnique({ where: { id: req.params.id, isTemplate: true } })
    if (!pipeline) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Template introuvable' } }); return }
    if (pipeline.isDefault) { res.status(400).json({ success: false, error: { code: 'FORBIDDEN', message: 'Impossible de supprimer le template par défaut' } }); return }
    await prisma.pipeline.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Étapes des templates (ADMIN uniquement) ─────────────

router.post('/templates/:id/stages', requirePermission('pipeline:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return
  try {
    const body = stageSchema.parse(req.body)
    const existing = await prisma.pipelineStage.findUnique({ where: { pipelineId_key: { pipelineId: req.params.id, key: body.key } } })
    if (existing) { res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'Une étape avec cette clé existe déjà' } }); return }
    const maxOrder = await prisma.pipelineStage.aggregate({ _max: { order: true }, where: { pipelineId: req.params.id } })
    const order = body.order ?? (maxOrder._max.order ?? 0) + 1
    const stage = await prisma.pipelineStage.create({ data: { ...body, order, pipelineId: req.params.id } })
    res.status(201).json({ success: true, data: stage })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/templates/:id/stages/:stageId', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return
  try {
    const existing = await prisma.pipelineStage.findUnique({ where: { id: req.params.stageId } })
    if (!existing) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Étape introuvable' } }); return }
    if (existing.isWon || existing.isLost) { res.status(400).json({ success: false, error: { code: 'FORBIDDEN', message: 'Impossible de modifier les étapes Gagné/Perdu' } }); return }
    const body = stageSchema.partial().parse(req.body)
    const stage = await prisma.pipelineStage.update({ where: { id: req.params.stageId }, data: body })
    res.json({ success: true, data: stage })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/templates/:id/stages/:stageId', requirePermission('pipeline:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return
  try {
    const stage = await prisma.pipelineStage.findUnique({ where: { id: req.params.stageId } })
    if (!stage) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Étape introuvable' } }); return }
    if (stage.isWon || stage.isLost) { res.status(400).json({ success: false, error: { code: 'FORBIDDEN', message: 'Impossible de supprimer les étapes Gagné/Perdu' } }); return }
    await prisma.pipelineStage.delete({ where: { id: req.params.stageId } })
    res.json({ success: true })
  } catch (err) { handleRouteError(err, res) }
})

// ═════════════════════════════════════════════════════════
// PIPELINES PERSONNELS
// ═════════════════════════════════════════════════════════

// GET / — pipelines personnels de l'utilisateur + pipelines partagés (legacy, ownerId=null)
router.get('/', requirePermission('pipeline:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pipelines = await prisma.pipeline.findMany({
      where: {
        isActive: true,
        isTemplate: false,
        OR: [{ ownerId: req.userId }, { ownerId: null }],
      },
      orderBy: [{ isDefault: 'desc' }, { order: 'asc' }, { name: 'asc' }],
      include: {
        stages: { orderBy: { order: 'asc' } },
        _count: { select: { opportunities: true } },
      },
    })
    res.json({ success: true, data: pipelines })
  } catch (err) { handleRouteError(err, res) }
})

// POST / — crée un pipeline personnel (ownerId = utilisateur courant)
router.post('/', requirePermission('pipeline:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = pipelineSchema.parse(req.body)
    const maxOrder = await prisma.pipeline.aggregate({ _max: { order: true }, where: { isTemplate: false, ownerId: req.userId } })
    const created = await prisma.pipeline.create({
      data: { ...body, order: body.order ?? (maxOrder._max.order ?? 0) + 1, ownerId: req.userId, isTemplate: false },
    })
    await ensureWonLostStages(created.id)
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: created.id },
      include: { stages: { orderBy: { order: 'asc' } } },
    })
    res.status(201).json({ success: true, data: pipeline })
  } catch (err) { handleRouteError(err, res) }
})

// PATCH /reorder — réordonne ses propres pipelines (ADMIN : tous les non-templates)
router.patch('/reorder', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pipelines: items } = z.object({ pipelines: z.array(z.object({ id: z.string(), order: z.number().int() })) }).parse(req.body)
    await Promise.all(items.map(p => prisma.pipeline.updateMany({
      where: { id: p.id, isTemplate: false, ...(req.userRole !== 'ADMIN' ? { ownerId: req.userId } : {}) },
      data: { order: p.order },
    })))
    res.json({ success: true })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/:id', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!await canManagePipeline(req.params.id, req, res)) return
  try {
    const body = pipelineSchema.partial().parse(req.body)
    const pipeline = await prisma.pipeline.update({
      where: { id: req.params.id },
      data: body,
      include: { stages: { orderBy: { order: 'asc' } } },
    })
    res.json({ success: true, data: pipeline })
  } catch (err) { handleRouteError(err, res) }
})

router.patch('/:id/default', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!await canManagePipeline(req.params.id, req, res)) return
  try {
    await prisma.pipeline.updateMany({ where: { isTemplate: false }, data: { isDefault: false } })
    const pipeline = await prisma.pipeline.update({
      where: { id: req.params.id },
      data: { isDefault: true },
      include: { stages: { orderBy: { order: 'asc' } } },
    })
    res.json({ success: true, data: pipeline })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/:id', requirePermission('pipeline:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!await canManagePipeline(req.params.id, req, res)) return
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
  } catch (err) { handleRouteError(err, res) }
})

// ─── Étapes des pipelines personnels ─────────────────────

router.post('/:id/stages', requirePermission('pipeline:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!await canManagePipeline(req.params.id, req, res)) return
  try {
    const body = stageSchema.parse(req.body)
    const existing = await prisma.pipelineStage.findUnique({ where: { pipelineId_key: { pipelineId: req.params.id, key: body.key } } })
    if (existing) { res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'Une étape avec cette clé existe déjà' } }); return }
    const maxOrder = await prisma.pipelineStage.aggregate({ _max: { order: true }, where: { pipelineId: req.params.id } })
    const order = body.order ?? (maxOrder._max.order ?? 0) + 1
    const stage = await prisma.pipelineStage.create({ data: { ...body, order, pipelineId: req.params.id } })
    res.status(201).json({ success: true, data: stage })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/:id/stages/:stageId', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!await canManagePipeline(req.params.id, req, res)) return
  try {
    const existing = await prisma.pipelineStage.findUnique({ where: { id: req.params.stageId } })
    if (!existing) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Étape introuvable' } }); return }
    if (existing.isWon || existing.isLost) { res.status(400).json({ success: false, error: { code: 'FORBIDDEN', message: 'Impossible de modifier les étapes Gagné/Perdu' } }); return }
    const body = stageSchema.partial().parse(req.body)
    const stage = await prisma.pipelineStage.update({ where: { id: req.params.stageId }, data: body })
    res.json({ success: true, data: stage })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/:id/stages/:stageId', requirePermission('pipeline:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!await canManagePipeline(req.params.id, req, res)) return
  try {
    const stage = await prisma.pipelineStage.findUnique({ where: { id: req.params.stageId } })
    if (!stage) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Étape introuvable' } }); return }
    if (stage.isWon || stage.isLost) { res.status(400).json({ success: false, error: { code: 'FORBIDDEN', message: 'Impossible de supprimer les étapes Gagné/Perdu' } }); return }
    const oppsInStage = await prisma.opportunity.count({ where: { pipelineId: req.params.id, stage: stage.key } })
    if (oppsInStage > 0) { res.status(400).json({ success: false, error: { code: 'CONFLICT', message: `${oppsInStage} opportunité(s) dans cette étape` } }); return }
    await prisma.pipelineStage.delete({ where: { id: req.params.stageId } })
    res.json({ success: true })
  } catch (err) { handleRouteError(err, res) }
})

router.patch('/:id/stages/reorder', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!await canManagePipeline(req.params.id, req, res)) return
  try {
    const { stages } = z.object({ stages: z.array(z.object({ id: z.string(), order: z.number().int() })) }).parse(req.body)
    await Promise.all(stages.map(s => prisma.pipelineStage.update({ where: { id: s.id }, data: { order: s.order } })))
    const updated = await prisma.pipelineStage.findMany({ where: { pipelineId: req.params.id }, orderBy: { order: 'asc' } })
    res.json({ success: true, data: updated })
  } catch (err) { handleRouteError(err, res) }
})

export default router
