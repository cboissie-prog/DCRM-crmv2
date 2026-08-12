import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { fireAutomations } from '../automation-engine'
import { getWonLostStageKeys } from '../services/pipelineService'
import { ensureExists, fetchOrFail, ensureCompanyMatch } from '../lib/relationChecks'

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
    if (!await ensureExists(res, body.contactId, 'CONTACT_NOT_FOUND', 'Contact introuvable', id => prisma.contact.findUnique({ where: { id }, select: { id: true } }))) return
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
    const { pipelineId: bodyPipelineId, stage: bodyStage, value, probability, expectedCloseDate, notes } = z.object({
      pipelineId: z.string().optional(),
      stage: z.string().optional(),
      value: z.number().optional(),
      probability: z.number().int().min(0).max(100).optional(),
      expectedCloseDate: z.string().optional(),
      notes: z.string().optional(),
    }).parse(req.body)
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, include: { contact: true } })
    if (!lead) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Lead introuvable' } }); return }
    // Resolve pipeline: use provided or default
    const pipeline = bodyPipelineId
      ? await prisma.pipeline.findUnique({ where: { id: bodyPipelineId }, include: { stages: { orderBy: { order: 'asc' } } } })
      : await prisma.pipeline.findFirst({ where: { isDefault: true, isActive: true }, include: { stages: { orderBy: { order: 'asc' } } } })
    // Un pipelineId fourni mais inexistant ne doit pas se retrouver silencieusement écrit
    // comme `undefined` — l'opportunité créée sans pipeline sortirait de toute colonne du Kanban.
    if (bodyPipelineId && !pipeline) {
      res.status(400).json({ success: false, error: { code: 'PIPELINE_NOT_FOUND', message: 'Pipeline introuvable' } })
      return
    }
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
        ...(value !== undefined && { value }),
        ...(probability !== undefined && { probability }),
        ...(expectedCloseDate && { expectedCloseDate: new Date(expectedCloseDate) }),
        ...(notes && { notes }),
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

    // ── Cohérence inter-entités ─────────────────────────────────────────────
    const effectiveCompanyId = body.companyId || null
    if (body.contactId) {
      const contact = await fetchOrFail(res, body.contactId, 'CONTACT_NOT_FOUND', 'Contact introuvable', id => prisma.contact.findUnique({ where: { id }, select: { id: true, companyId: true } }))
      if (contact === null) return
      // Cohérence souple : ne bloque que si contact ET opportunité ont chacun une société, et qu'elles diffèrent
      if (contact && !ensureCompanyMatch(res, contact.companyId, effectiveCompanyId, 'CONTACT_COMPANY_MISMATCH', 'Ce contact appartient à une autre entreprise')) return
    }
    if (body.companyId) {
      if (!await ensureExists(res, body.companyId, 'COMPANY_NOT_FOUND', 'Entreprise introuvable', id => prisma.company.findUnique({ where: { id }, select: { id: true } }))) return
    }
    if (body.leadId) {
      if (!await ensureExists(res, body.leadId, 'LEAD_NOT_FOUND', 'Lead introuvable', id => prisma.lead.findUnique({ where: { id }, select: { id: true } }))) return
    }
    if (body.pipelineId) {
      if (!await ensureExists(res, body.pipelineId, 'PIPELINE_NOT_FOUND', 'Pipeline introuvable', id => prisma.pipeline.findUnique({ where: { id }, select: { id: true } }))) return
    }

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
    const current = await prisma.opportunity.findUnique({ where: { id: req.params.id }, select: { stage: true, companyId: true, contactId: true } })
    if (!current) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Opportunité introuvable' } }); return }

    // ── Cohérence inter-entités ─────────────────────────────────────────────
    const effectiveCompanyId = body.companyId !== undefined ? (body.companyId || null) : current.companyId
    const effectiveContactId = body.contactId !== undefined ? (body.contactId || null) : current.contactId
    if (effectiveContactId) {
      const contact = await fetchOrFail(res, effectiveContactId, 'CONTACT_NOT_FOUND', 'Contact introuvable', id => prisma.contact.findUnique({ where: { id }, select: { id: true, companyId: true } }))
      if (contact === null) return
      if (contact && !ensureCompanyMatch(res, contact.companyId, effectiveCompanyId, 'CONTACT_COMPANY_MISMATCH', 'Ce contact appartient à une autre entreprise')) return
    }
    if (body.companyId !== undefined && body.companyId) {
      if (!await ensureExists(res, body.companyId, 'COMPANY_NOT_FOUND', 'Entreprise introuvable', id => prisma.company.findUnique({ where: { id }, select: { id: true } }))) return
    }
    if (body.leadId !== undefined && body.leadId) {
      if (!await ensureExists(res, body.leadId, 'LEAD_NOT_FOUND', 'Lead introuvable', id => prisma.lead.findUnique({ where: { id }, select: { id: true } }))) return
    }
    if (body.pipelineId !== undefined && body.pipelineId) {
      if (!await ensureExists(res, body.pipelineId, 'PIPELINE_NOT_FOUND', 'Pipeline introuvable', id => prisma.pipeline.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const data: Record<string, unknown> = { ...body }
    if (body.expectedCloseDate) data.expectedCloseDate = new Date(body.expectedCloseDate)
    if (body.remindAt) data.remindAt = new Date(body.remindAt)
    else if (body.remindAt === null) data.remindAt = null
    if (body.stage && current.stage !== body.stage) {
      // Ne toucher closedAt que si l'étape change réellement, pour ne pas re-dater
      // la clôture d'une opportunité déjà gagnée/perdue lors d'une simple édition.
      const { wonKeys, lostKeys } = await getWonLostStageKeys()
      data.closedAt = wonKeys.includes(body.stage) || lostKeys.includes(body.stage) ? new Date() : null
    }
    const opp = await prisma.opportunity.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.opportunity.update>[0]['data'] })
    res.json({ success: true, data: opp })
  } catch (err) { handleRouteError(err, res) }
})

router.patch('/opportunities/:id/stage', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { stage, lostReason } = z.object({
      stage: z.string().min(1),
      lostReason: z.string().optional(),
    }).parse(req.body)
    const previous = await prisma.opportunity.findUnique({ where: { id: req.params.id }, select: { stage: true, title: true, value: true, companyId: true, assignedToId: true, pipelineId: true } })
    if (!previous) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Opportunité introuvable' } }); return }

    // La clé d'étape doit correspondre à une étape réelle. Sans ce contrôle, une valeur
    // arbitraire était écrite telle quelle : l'opportunité disparaissait de toutes les colonnes
    // du Kanban, sortait des statistiques gagné/perdu, devenait irrécupérable depuis l'interface,
    // et continuait d'alimenter les relances d'inactivité.
    //
    // On valide contre l'ensemble des pipelines réels, et non contre le seul pipeline de
    // l'opportunité, parce que le modèle autorise déjà l'incohérence : `Opportunity.stage` vaut
    // "NEW" par défaut alors qu'un pipeline créé via l'API ne reçoit que WON et LOST, et
    // `pipelineId` est nullable (cf. /opportunities/reattach-orphans). Un cadrage strict figerait
    // ces lignes existantes. Cela bloque bien l'écriture de clés inventées, qui est la faille ;
    // la cohérence étape↔pipeline reste à traiter côté modèle de données.
    const stageExists = await prisma.pipelineStage.findFirst({
      where: { key: stage, pipeline: { isTemplate: false } },
      select: { id: true },
    })
    if (!stageExists) {
      res.status(400).json({ success: false, error: { code: 'INVALID_STAGE', message: 'Étape inconnue' } })
      return
    }

    const data: Record<string, unknown> = { stage }
    if (lostReason) data.lostReason = lostReason
    if (previous && previous.stage !== stage) {
      const { wonKeys, lostKeys } = await getWonLostStageKeys()
      data.closedAt = wonKeys.includes(stage) || lostKeys.includes(stage) ? new Date() : null
    }
    const opp = await prisma.opportunity.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.opportunity.update>[0]['data'] })
    if (previous && previous.stage !== stage) {
      fireAutomations('OPPORTUNITY_STAGE_CHANGED', {
        opportunity: { id: opp.id, title: opp.title, stage, previousStage: previous.stage, value: opp.value, companyId: opp.companyId, assignedToId: opp.assignedToId },
      }).catch(console.error)
    }
    res.json({ success: true, data: opp })
  } catch (err) { handleRouteError(err, res) }
})

// DELETE /pipeline/opportunities/:id — supprime une opportunité.
// Les produits liés sont supprimés en cascade (onDelete: Cascade) et les activités
// voient leur opportunityId remis à null (onDelete: SetNull) côté schéma Prisma.
router.delete('/opportunities/:id', requirePermission('pipeline:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.opportunity.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { handleRouteError(err, res) }
})

export default router
