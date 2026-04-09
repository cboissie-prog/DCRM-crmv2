import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requireRole } from '../middleware/auth'
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

router.get('/leads', async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.post('/leads', requireRole(['ADMIN', 'MANAGER', 'COMMERCIAL']), async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.put('/leads/:id', requireRole(['ADMIN', 'MANAGER', 'COMMERCIAL']), async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.patch('/leads/:id/status', requireRole(['ADMIN', 'MANAGER', 'COMMERCIAL']), async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.delete('/leads/:id', requireRole(['ADMIN', 'MANAGER', 'COMMERCIAL']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.lead.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.post('/leads/:id/convert', requireRole(['ADMIN', 'MANAGER', 'COMMERCIAL']), async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

// ─── OPPORTUNITIES ──────────────────────────────────────

router.get('/opportunities', async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.post('/opportunities', requireRole(['ADMIN', 'MANAGER', 'COMMERCIAL']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = opportunitySchema.parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.expectedCloseDate) data.expectedCloseDate = new Date(body.expectedCloseDate)
    const opp = await prisma.opportunity.create({ data: data as Parameters<typeof prisma.opportunity.create>[0]['data'] })
    fireAutomations('OPPORTUNITY_CREATED', {
      triggeredBy: req.userId,
      opportunity: { id: opp.id, title: opp.title, stage: opp.stage, value: opp.value, companyId: opp.companyId, assignedToId: opp.assignedToId },
    }).catch(console.error)
    res.status(201).json({ success: true, data: opp })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.get('/opportunities/:id', async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.put('/opportunities/:id', requireRole(['ADMIN', 'MANAGER', 'COMMERCIAL']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = opportunitySchema.partial().parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.expectedCloseDate) data.expectedCloseDate = new Date(body.expectedCloseDate)
    if (body.remindAt) data.remindAt = new Date(body.remindAt)
    else if (body.remindAt === null) data.remindAt = null
    if (body.stage === 'WON' || body.stage === 'LOST') data.closedAt = new Date()
    const opp = await prisma.opportunity.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.opportunity.update>[0]['data'] })
    res.json({ success: true, data: opp })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.patch('/opportunities/:id/stage', requireRole(['ADMIN', 'MANAGER', 'COMMERCIAL']), async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

export default router
