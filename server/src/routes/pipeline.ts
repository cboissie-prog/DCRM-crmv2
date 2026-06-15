import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { fireAutomations } from '../automation-engine'

const router = Router()
router.use(authenticate)

const opportunitySchema = z.object({
  title: z.string().min(1),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  leadId: z.string().optional(),
  pipelineId: z.string().optional(),
  stage: z.string().optional(),
  value: z.number().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().optional(),
  assignedToId: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional().nullable(),
  lostReason: z.string().optional(),
  remindAt: z.string().optional().nullable(),
})

const leadSchema = z.object({
  contactId: z.string(),
  source: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  score: z.number().int().min(0).max(100).optional(),
})

// ─── LEADS ───────────────────────────────────────────────

router.get('/leads', requirePermission('pipeline:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, source, page, limit } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25))
    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (source) where.source = source
    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where, skip: (pageNum - 1) * limitNum, take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: { contact: { include: { company: { select: { id: true, name: true } } } } },
      }),
    ])
    res.json({ success: true, data: leads, meta: { total, page: pageNum, limit: limitNum } })
  } catch (err) { handleRouteError(err, res) }
})

router.post('/leads', requirePermission('pipeline:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = leadSchema.parse(req.body)
    const lead = await prisma.lead.create({ data: body, include: { contact: { include: { company: { select: { id: true, name: true } } } } } })
    if (lead.score > 0) {
      fireAutomations('LEAD_SCORE_THRESHOLD', {
        triggeredBy: req.userId,
        lead: { id: lead.id, contactId: lead.contactId, score: lead.score },
      }).catch(console.error)
    }
    res.status(201).json({ success: true, data: lead })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/leads/:id', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = leadSchema.partial().parse(req.body)
    const lead = await prisma.lead.update({ where: { id: req.params.id }, data: body, include: { contact: true } })
    if (body.score !== undefined && lead.score > 0) {
      fireAutomations('LEAD_SCORE_THRESHOLD', {
        triggeredBy: req.userId,
        lead: { id: lead.id, contactId: lead.contactId, score: lead.score },
      }).catch(console.error)
    }
    res.json({ success: true, data: lead })
  } catch (err) { handleRouteError(err, res) }
})

router.patch('/leads/:id/status', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = z.object({
      status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'UNREACHABLE']),
    }).parse(req.body)
    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { status },
      include: { contact: { include: { company: { select: { id: true, name: true } } } } },
    })
    res.json({ success: true, data: lead })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/leads/:id', requirePermission('pipeline:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.lead.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) { handleRouteError(err, res) }
})

router.post('/leads/:id/convert', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pipelineId: bodyPipelineId, stage: bodyStage } = z.object({
      pipelineId: z.string().optional(),
      stage: z.string().optional(),
    }).parse(req.body)
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, include: { contact: true } })
    if (!lead) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Lead introuvable' } }); return }
    // Resolve pipeline: use provided or default
    const pipeline = bodyPipelineId
      ? await prisma.pipeline.findUnique({ where: { id: bodyPipelineId }, include: { stages: { orderBy: { order: 'asc' } } } })
      : await prisma.pipeline.findFirst({ where: { isDefault: true, isActive: true }, include: { stages: { orderBy: { order: 'asc' } } } })
    const firstStage = pipeline?.stages.find(s => !s.isWon && !s.isLost)
    const opportunity = await prisma.opportunity.create({
      data: {
        title: lead.title,
        contactId: lead.contactId,
        companyId: lead.contact.companyId || undefined,
        leadId: lead.id,
        pipelineId: pipeline?.id,
        stage: bodyStage ?? firstStage?.key ?? 'QUALIFICATION',
        assignedToId: req.userId,
      },
    })
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'CONVERTED' } })
    fireAutomations('OPPORTUNITY_CREATED', {
      triggeredBy: req.userId,
      opportunity: { id: opportunity.id, title: opportunity.title, stage: opportunity.stage, value: opportunity.value, companyId: opportunity.companyId, assignedToId: opportunity.assignedToId },
    }).catch(console.error)
    res.json({ success: true, data: opportunity })
  } catch (err) { handleRouteError(err, res) }
})

// ─── OPPORTUNITIES ──────────────────────────────────────

router.get('/opportunities', requirePermission('pipeline:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { stage, assignedToId, companyId, pipelineId, page = '1', limit = '50' } = req.query as Record<string, string>
    const where: Record<string, unknown> = {}
    if (stage) where.stage = stage
    if (assignedToId) where.assignedToId = assignedToId
    if (companyId) where.companyId = companyId
    if (pipelineId) where.pipelineId = pipelineId
    const [total, opportunities] = await Promise.all([
      prisma.opportunity.count({ where }),
      prisma.opportunity.findMany({
        where, skip: (parseInt(page) - 1) * parseInt(limit), take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
          company: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          products: { include: { product: { select: { id: true, name: true } } } },
        },
      }),
    ])
    res.json({ success: true, data: opportunities, meta: { total, page: parseInt(page), limit: parseInt(limit) } })
  } catch (err) { handleRouteError(err, res) }
})

router.post('/opportunities', requirePermission('pipeline:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = opportunitySchema.parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.expectedCloseDate) data.expectedCloseDate = new Date(body.expectedCloseDate)
    // Rattacher au pipeline par défaut si non précisé : évite les opportunités « orphelines »
    // (pipelineId null) qui n'apparaissent dans aucune colonne du Kanban.
    if (!body.pipelineId) {
      const defaultPipeline =
        (await prisma.pipeline.findFirst({
          where: { isDefault: true, isActive: true },
          include: { stages: { orderBy: { order: 'asc' } } },
        })) ??
        (await prisma.pipeline.findFirst({
          where: { isActive: true },
          orderBy: { order: 'asc' },
          include: { stages: { orderBy: { order: 'asc' } } },
        }))
      if (defaultPipeline) {
        data.pipelineId = defaultPipeline.id
        // Si le stage fourni n'existe pas dans ce pipeline, prendre sa première étape réelle
        const stageExists = defaultPipeline.stages.some(s => s.key === body.stage)
        if (!body.stage || !stageExists) {
          const firstStage = defaultPipeline.stages.find(s => !s.isWon && !s.isLost) ?? defaultPipeline.stages[0]
          if (firstStage) data.stage = firstStage.key
        }
      }
    }
    const opp = await prisma.opportunity.create({ data: data as Parameters<typeof prisma.opportunity.create>[0]['data'] })
    fireAutomations('OPPORTUNITY_CREATED', {
      triggeredBy: req.userId,
      opportunity: { id: opp.id, title: opp.title, stage: opp.stage, value: opp.value, companyId: opp.companyId, assignedToId: opp.assignedToId },
    }).catch(console.error)
    res.status(201).json({ success: true, data: opp })
  } catch (err) { handleRouteError(err, res) }
})

// POST /pipeline/opportunities/reattach-orphans — rattache au pipeline par défaut les
// opportunités sans pipeline (pipelineId null), qui n'apparaissent dans aucune colonne du Kanban.
router.post('/opportunities/reattach-orphans', requirePermission('pipeline:update'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const def =
      (await prisma.pipeline.findFirst({ where: { isDefault: true, isActive: true }, include: { stages: { orderBy: { order: 'asc' } } } })) ??
      (await prisma.pipeline.findFirst({ where: { isActive: true }, orderBy: { order: 'asc' }, include: { stages: { orderBy: { order: 'asc' } } } }))
    if (!def) {
      res.status(400).json({ success: false, error: { code: 'NO_PIPELINE', message: 'Aucun pipeline actif disponible' } })
      return
    }
    const firstStage = def.stages.find(s => !s.isWon && !s.isLost) ?? def.stages[0]
    const orphans = await prisma.opportunity.findMany({ where: { pipelineId: null }, select: { id: true, stage: true } })
    let reattached = 0
    for (const o of orphans) {
      // Si le stage de l'orpheline n'existe pas dans le pipeline par défaut, la placer sur la 1re étape
      const stageOk = def.stages.some(s => s.key === o.stage)
      await prisma.opportunity.update({
        where: { id: o.id },
        data: { pipelineId: def.id, ...(stageOk ? {} : firstStage ? { stage: firstStage.key } : {}) },
      })
      reattached++
    }
    res.json({ success: true, data: { reattached, pipeline: def.name } })
  } catch (err) { handleRouteError(err, res) }
})

router.get('/opportunities/:id', requirePermission('pipeline:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const opp = await prisma.opportunity.findUnique({
      where: { id: req.params.id },
      include: {
        contact: true,
        company: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        products: { include: { product: true } },
        activities: { orderBy: { createdAt: 'desc' }, take: 20 },
        lead: true,
      },
    })
    if (!opp) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Opportunité introuvable' } }); return }
    res.json({ success: true, data: opp })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/opportunities/:id', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = opportunitySchema.partial().parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.expectedCloseDate) data.expectedCloseDate = new Date(body.expectedCloseDate)
    if (body.remindAt) data.remindAt = new Date(body.remindAt)
    else if (body.remindAt === null) data.remindAt = null
    if (body.stage === 'WON' || body.stage === 'LOST') data.closedAt = new Date()
    const opp = await prisma.opportunity.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.opportunity.update>[0]['data'] })
    res.json({ success: true, data: opp })
  } catch (err) { handleRouteError(err, res) }
})

router.patch('/opportunities/:id/stage', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { stage, lostReason } = req.body
    const previous = await prisma.opportunity.findUnique({ where: { id: req.params.id }, select: { stage: true, title: true, value: true, companyId: true, assignedToId: true } })
    const data: Record<string, unknown> = { stage }
    if (lostReason) data.lostReason = lostReason
    if (stage === 'WON' || stage === 'LOST') data.closedAt = new Date()
    const opp = await prisma.opportunity.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.opportunity.update>[0]['data'] })
    if (previous && previous.stage !== stage) {
      fireAutomations('OPPORTUNITY_STAGE_CHANGED', {
        opportunity: { id: opp.id, title: opp.title, stage, previousStage: previous.stage, value: opp.value, companyId: opp.companyId, assignedToId: opp.assignedToId },
      }).catch(console.error)
    }
    res.json({ success: true, data: opp })
  } catch (err) { handleRouteError(err, res) }
})

export default router
