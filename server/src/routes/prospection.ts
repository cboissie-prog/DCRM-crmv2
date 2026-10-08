/**
 * prospection.ts — module Prospection (spec
 * docs/superpowers/specs/2026-10-08-prospection-module-design.md, §4).
 *
 * Monté sur `/api/prospection`. Un prospect et une opportunité sont la même fiche
 * `Opportunity` : « en prospection » tant que `pipelineId` est `null`. Les actions
 * rapides et la qualification réutilisent `services/prospectActions.ts` (partagé
 * avec `POST /pipeline/opportunities/:id/actions`).
 */
import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission, hasPermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { checkReferences } from '../lib/references'
import { ciContains } from '../lib/query'
import { ensureExists, fetchOrFail, ensureCompanyMatch } from '../lib/relationChecks'
import { resolveDefaultPipeline } from '../services/pipelineService'
import { importProspectRows, importCsvRowSchema, ImportProspectRow } from '../services/prospectImport'
import { applyAction, ProspectActionError } from '../services/prospectActions'

const router = Router()
router.use(authenticate)

const LIST_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
const PROSPECT_SORT_FIELDS = new Set([
  'createdAt', 'updatedAt', 'title', 'value', 'remindAt', 'lastContactedAt', 'lastActivityAt', 'prospectStatus', 'company',
])

// ════════════════════════════════════════════════════════════════════════
// LISTES — /api/prospection/lists
// ════════════════════════════════════════════════════════════════════════

const listSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  source: z.string().optional(),
  pipelineId: z.string().optional().nullable(),
  assignedToId: z.string().optional().nullable(),
})

// GET /prospection/lists — listes actives par défaut (+ ?status=ARCHIVED), avec compteurs.
router.get('/lists', requirePermission('prospection:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.query as Record<string, string>
    const where: Record<string, unknown> = { status: status && LIST_STATUSES.includes(status as typeof LIST_STATUSES[number]) ? status : 'ACTIVE' }

    const lists = await prisma.prospectList.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        pipeline: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    })

    const listIds = lists.map(l => l.id)
    const grouped = listIds.length > 0
      ? await prisma.opportunity.groupBy({ by: ['listId', 'prospectStatus'], where: { listId: { in: listIds } }, _count: { _all: true } })
      : []

    type Counts = { total: number; todo: number; contacted: number; callback: number; qualified: number; rejected: number; unreachable: number }
    const countsByList = new Map<string, Counts>()
    for (const l of lists) countsByList.set(l.id, { total: 0, todo: 0, contacted: 0, callback: 0, qualified: 0, rejected: 0, unreachable: 0 })
    for (const g of grouped) {
      if (!g.listId) continue
      const c = countsByList.get(g.listId)
      if (!c) continue
      c.total += g._count._all
      if (g.prospectStatus === 'TODO') c.todo += g._count._all
      else if (g.prospectStatus === 'REACHED') c.contacted += g._count._all
      else if (g.prospectStatus === 'CALLBACK') c.callback += g._count._all
      else if (g.prospectStatus === 'QUALIFIED') c.qualified += g._count._all
      else if (g.prospectStatus === 'NOT_INTERESTED') c.rejected += g._count._all
      else if (g.prospectStatus === 'UNREACHABLE') c.unreachable += g._count._all
    }

    const data = lists.map(l => ({ ...l, counts: countsByList.get(l.id) }))
    res.json({ success: true, data })
  } catch (err) { handleRouteError(err, res) }
})

// POST /prospection/lists — crée une liste de prospection.
router.post('/lists', requirePermission('prospection:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = listSchema.parse(req.body)
    const refError = await checkReferences([{ domain: 'lead_source', value: body.source }])
    if (refError) { res.status(400).json({ success: false, error: { code: 'INVALID_REFERENCE', message: refError } }); return }
    if (body.pipelineId) {
      if (!await ensureExists(res, body.pipelineId, 'PIPELINE_NOT_FOUND', 'Pipeline introuvable', id => prisma.pipeline.findUnique({ where: { id }, select: { id: true } }))) return
    }
    if (body.assignedToId) {
      if (!await ensureExists(res, body.assignedToId, 'USER_NOT_FOUND', 'Utilisateur introuvable', id => prisma.user.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const list = await prisma.prospectList.create({
      data: {
        name: body.name,
        description: body.description ?? undefined,
        source: body.source || 'COLD_CALL',
        pipelineId: body.pipelineId ?? undefined,
        assignedToId: body.assignedToId ?? undefined,
        createdById: req.userId,
      },
    })
    res.status(201).json({ success: true, data: list })
  } catch (err) { handleRouteError(err, res) }
})

// PUT /prospection/lists/:id — met à jour une liste (partiel).
router.put('/lists/:id', requirePermission('prospection:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.prospectList.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!existing) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Liste introuvable' } }); return }

    const body = listSchema.partial().parse(req.body)
    const refError = await checkReferences([{ domain: 'lead_source', value: body.source }])
    if (refError) { res.status(400).json({ success: false, error: { code: 'INVALID_REFERENCE', message: refError } }); return }
    if (body.pipelineId) {
      if (!await ensureExists(res, body.pipelineId, 'PIPELINE_NOT_FOUND', 'Pipeline introuvable', id => prisma.pipeline.findUnique({ where: { id }, select: { id: true } }))) return
    }
    if (body.assignedToId) {
      if (!await ensureExists(res, body.assignedToId, 'USER_NOT_FOUND', 'Utilisateur introuvable', id => prisma.user.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const data: Record<string, unknown> = {}
    if (body.name !== undefined) data.name = body.name
    if (body.description !== undefined) data.description = body.description
    if (body.source !== undefined) data.source = body.source
    if (body.pipelineId !== undefined) data.pipelineId = body.pipelineId
    if (body.assignedToId !== undefined) data.assignedToId = body.assignedToId

    const list = await prisma.prospectList.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.prospectList.update>[0]['data'] })
    res.json({ success: true, data: list })
  } catch (err) { handleRouteError(err, res) }
})

// PATCH /prospection/lists/:id/archive
router.patch('/lists/:id/archive', requirePermission('prospection:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.prospectList.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!existing) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Liste introuvable' } }); return }
    const list = await prisma.prospectList.update({ where: { id: req.params.id }, data: { status: 'ARCHIVED' } })
    res.json({ success: true, data: list })
  } catch (err) { handleRouteError(err, res) }
})

// PATCH /prospection/lists/:id/unarchive
router.patch('/lists/:id/unarchive', requirePermission('prospection:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.prospectList.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!existing) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Liste introuvable' } }); return }
    const list = await prisma.prospectList.update({ where: { id: req.params.id }, data: { status: 'ACTIVE' } })
    res.json({ success: true, data: list })
  } catch (err) { handleRouteError(err, res) }
})

// POST /prospection/lists/:id/import — même règles que POST /pipeline/opportunities/import/csv,
// mais listId = :id, pipelineId = null, source = celle de la liste (sauf surcharge),
// assignedToId = celui du corps ou de la liste (spec §4).
router.post('/lists/:id/import', requirePermission('prospection:write'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.prospectList.findUnique({ where: { id: req.params.id } })
    if (!list) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Liste introuvable' } }); return }

    const body = z.object({
      source: z.string().optional(),
      assignedToId: z.string().optional(),
      rows: z.array(importCsvRowSchema).min(1).max(500),
    }).parse(req.body)

    const source = body.source || list.source
    const refError = await checkReferences([{ domain: 'lead_source', value: source }])
    if (refError) { res.status(400).json({ success: false, error: { code: 'INVALID_REFERENCE', message: refError } }); return }

    const assignedToId = body.assignedToId || list.assignedToId || undefined
    if (assignedToId) {
      if (!await ensureExists(res, assignedToId, 'USER_NOT_FOUND', 'Utilisateur introuvable', id => prisma.user.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const result = await importProspectRows(body.rows as ImportProspectRow[], {
      listId: list.id,
      pipelineId: null,
      stage: 'NEW',
      source,
      assignedToId,
    })
    res.json({ success: true, data: result })
  } catch (err) { handleRouteError(err, res) }
})

// ════════════════════════════════════════════════════════════════════════
// SUIVI — GET /api/prospection/stats
// ════════════════════════════════════════════════════════════════════════

const STATS_ACTIVITY_TYPES = ['CALL_NO_ANSWER', 'CALL_REACHED', 'UNREACHABLE', 'CALLBACK_SET', 'DOC_SENT', 'MEETING_SET', 'QUALIFIED', 'NOT_INTERESTED'] as const

router.get('/stats', requirePermission('prospection:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { listId, from, to } = req.query as Record<string, string>
    const canManage = hasPermission(req, 'prospection:manage')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { type: { in: STATS_ACTIVITY_TYPES } }
    if (listId) where.opportunity = { listId }
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from)
      if (to) where.createdAt.lte = new Date(to)
    }
    // Sans prospection:manage, la vue est restreinte à l'utilisateur courant (spec §4).
    if (!canManage) where.userId = req.userId

    const activities = await prisma.activity.findMany({ where, select: { userId: true, type: true } })

    type Row = { calls: number; reached: number; callbacks: number; docsSent: number; meetings: number; qualified: number; rejected: number }
    const byUser = new Map<string, Row>()
    const emptyRow = (): Row => ({ calls: 0, reached: 0, callbacks: 0, docsSent: 0, meetings: 0, qualified: 0, rejected: 0 })
    if (!canManage && req.userId) byUser.set(req.userId, emptyRow())

    for (const a of activities) {
      if (!a.userId) continue
      if (!byUser.has(a.userId)) byUser.set(a.userId, emptyRow())
      const row = byUser.get(a.userId)!
      if (a.type === 'CALL_NO_ANSWER' || a.type === 'CALL_REACHED' || a.type === 'UNREACHABLE') row.calls++
      if (a.type === 'CALL_REACHED') row.reached++
      if (a.type === 'CALLBACK_SET') row.callbacks++
      if (a.type === 'DOC_SENT') row.docsSent++
      if (a.type === 'MEETING_SET') row.meetings++
      if (a.type === 'QUALIFIED') row.qualified++
      if (a.type === 'NOT_INTERESTED') row.rejected++
    }

    const userIds = [...byUser.keys()]
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : []
    const data = users.map(u => ({ userId: u.id, firstName: u.firstName, lastName: u.lastName, ...byUser.get(u.id)! }))
    res.json({ success: true, data })
  } catch (err) { handleRouteError(err, res) }
})

// ════════════════════════════════════════════════════════════════════════
// PROSPECTS — /api/prospection/prospects
// ════════════════════════════════════════════════════════════════════════

const createProspectSchema = z.object({
  listId: z.string().optional(),
  title: z.string().optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  assignedToId: z.string().optional(),
  notes: z.string().optional(),
})

// GET /prospection/prospects — fiches en prospection (pipelineId = null), filtrables.
router.get('/prospects', requirePermission('prospection:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      listId, prospectStatus, assignedToId, mine, today, search, neverContacted, staleDays,
      page = '1', limit = '50', sortBy, sortOrder,
    } = req.query as Record<string, string>

    const where: Record<string, unknown> = { pipelineId: null }
    if (listId) where.listId = listId
    if (prospectStatus) where.prospectStatus = prospectStatus
    if (mine === 'true') where.assignedToId = req.userId
    else if (assignedToId) where.assignedToId = assignedToId
    if (neverContacted === 'true') where.lastContactedAt = null

    const andFilters: Record<string, unknown>[] = []
    if (today === 'true') {
      const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999)
      andFilters.push({
        OR: [
          { remindAt: { lte: endOfDay } },
          { AND: [{ lastContactedAt: null }, { assignedToId: req.userId }] },
        ],
      })
    }
    if (staleDays) {
      const n = parseInt(staleDays, 10)
      if (!Number.isNaN(n)) {
        const threshold = new Date(Date.now() - n * 24 * 60 * 60 * 1000)
        andFilters.push({ OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: threshold } }] })
      }
    }
    if (search) {
      andFilters.push({
        OR: [
          { title: ciContains(search) },
          { company: { name: ciContains(search) } },
          { contact: { firstName: ciContains(search) } },
          { contact: { lastName: ciContains(search) } },
        ],
      })
    }
    if (andFilters.length > 0) where.AND = andFilters

    const validSortOrder = sortOrder === 'asc' ? 'asc' : 'desc'
    let orderBy: Record<string, unknown> = { createdAt: 'desc' as const }
    if (sortBy && PROSPECT_SORT_FIELDS.has(sortBy)) {
      orderBy = sortBy === 'company' ? { company: { name: validSortOrder } } : { [sortBy]: validSortOrder }
    }

    const [total, prospects] = await Promise.all([
      prisma.opportunity.count({ where }),
      prisma.opportunity.findMany({
        where, skip: (parseInt(page) - 1) * parseInt(limit), take: parseInt(limit),
        orderBy: orderBy as Record<string, unknown>,
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, phone: true, mobile: true, email: true } },
          company: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          list: { select: { id: true, name: true } },
        },
      }),
    ])
    res.json({ success: true, data: prospects, meta: { total, page: parseInt(page), limit: parseInt(limit) } })
  } catch (err) { handleRouteError(err, res) }
})

// POST /prospection/prospects — création manuelle (titre, entreprise ou contact).
router.post('/prospects', requirePermission('prospection:write'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createProspectSchema.parse(req.body)
    if (!body.title && !body.companyId && !body.contactId) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Titre, entreprise ou contact requis' } })
      return
    }

    let list: { id: string; source: string; assignedToId: string | null } | null = null
    if (body.listId) {
      list = await prisma.prospectList.findUnique({ where: { id: body.listId }, select: { id: true, source: true, assignedToId: true } })
      if (!list) { res.status(400).json({ success: false, error: { code: 'LIST_NOT_FOUND', message: 'Liste introuvable' } }); return }
    }

    const company = await fetchOrFail(res, body.companyId, 'COMPANY_NOT_FOUND', 'Entreprise introuvable', id => prisma.company.findUnique({ where: { id }, select: { id: true, name: true } }))
    if (company === null) return
    const contact = await fetchOrFail(res, body.contactId, 'CONTACT_NOT_FOUND', 'Contact introuvable', id => prisma.contact.findUnique({ where: { id }, select: { id: true, companyId: true, firstName: true, lastName: true } }))
    if (contact === null) return
    if (contact && !ensureCompanyMatch(res, contact.companyId, body.companyId, 'CONTACT_COMPANY_MISMATCH', 'Ce contact appartient à une autre entreprise')) return

    if (body.assignedToId) {
      if (!await ensureExists(res, body.assignedToId, 'USER_NOT_FOUND', 'Utilisateur introuvable', id => prisma.user.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const title = body.title?.trim() || company?.name || (contact ? `${contact.firstName} ${contact.lastName}`.trim() : undefined) || 'Nouveau prospect'

    const prospect = await prisma.opportunity.create({
      data: {
        title,
        companyId: body.companyId,
        contactId: body.contactId,
        listId: body.listId,
        pipelineId: null,
        stage: 'NEW',
        source: list?.source || 'MANUAL',
        prospectStatus: 'TODO',
        assignedToId: body.assignedToId || list?.assignedToId || undefined,
        notes: body.notes,
      },
    })
    res.status(201).json({ success: true, data: prospect })
  } catch (err) { handleRouteError(err, res) }
})

// GET /prospection/prospects/:id — fiche de suivi (panneau partagé prospect/opportunité).
router.get('/prospects/:id', requirePermission('prospection:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prospect = await prisma.opportunity.findUnique({
      where: { id: req.params.id },
      include: {
        contact: true,
        company: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        list: true,
        activities: { orderBy: { createdAt: 'desc' }, take: 50, include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } } },
        appointments: { orderBy: { startAt: 'desc' } },
      },
    })
    if (!prospect) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Prospect introuvable' } }); return }
    res.json({ success: true, data: prospect })
  } catch (err) { handleRouteError(err, res) }
})

// POST /prospection/prospects/:id/actions — actions rapides (table complète, spec §4).
router.post('/prospects/:id/actions', requirePermission('prospection:write'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = z.object({
      action: z.string(),
      nextAction: z.string().nullable().optional(),
      remindAt: z.string().nullable().optional(),
      note: z.string().optional(),
      document: z.string().optional(),
      startAt: z.string().optional(),
      title: z.string().optional(),
      criteria: z.record(z.union([z.boolean(), z.null()])).optional(),
      reason: z.string().optional(),
    }).parse(req.body)
    const { action, ...payload } = body
    const updated = await applyAction(req.params.id, action, payload, req.userId!)
    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof ProspectActionError) {
      res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } })
      return
    }
    handleRouteError(err, res)
  }
})

// POST /prospection/prospects/:id/qualify — passage au pipeline (spec §4).
router.post('/prospects/:id/qualify', requirePermission('prospection:write'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = z.object({
      pipelineId: z.string().optional(),
      stage: z.string().optional(),
      title: z.string().optional(),
      value: z.number().optional(),
      expectedCloseDate: z.string().optional().nullable(),
      nextAction: z.string().optional().nullable(),
      remindAt: z.string().optional().nullable(),
    }).parse(req.body)

    const prospect = await prisma.opportunity.findUnique({
      where: { id: req.params.id },
      include: { list: { select: { pipelineId: true } } },
    })
    if (!prospect) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Prospect introuvable' } }); return }
    if (prospect.pipelineId) { res.status(400).json({ success: false, error: { code: 'ALREADY_QUALIFIED', message: 'Ce prospect est déjà dans le pipeline' } }); return }

    let pipeline
    if (body.pipelineId) {
      pipeline = await prisma.pipeline.findUnique({ where: { id: body.pipelineId }, include: { stages: { orderBy: { order: 'asc' } } } })
      if (!pipeline) { res.status(400).json({ success: false, error: { code: 'PIPELINE_NOT_FOUND', message: 'Pipeline introuvable' } }); return }
    } else if (prospect.list?.pipelineId) {
      pipeline = await prisma.pipeline.findUnique({ where: { id: prospect.list.pipelineId }, include: { stages: { orderBy: { order: 'asc' } } } })
    }
    if (!pipeline) pipeline = await resolveDefaultPipeline()
    if (!pipeline) { res.status(400).json({ success: false, error: { code: 'NO_PIPELINE', message: 'Aucun pipeline disponible' } }); return }

    const stageExists = pipeline.stages.some(s => s.key === body.stage)
    const firstOpenStage = pipeline.stages.find(s => !s.isWon && !s.isLost) ?? pipeline.stages[0]
    const resolvedStage = body.stage && stageExists ? body.stage : (firstOpenStage?.key ?? 'NEW')

    const data: Record<string, unknown> = {
      pipelineId: pipeline.id,
      stage: resolvedStage,
      prospectStatus: 'QUALIFIED',
      qualifiedAt: new Date(),
      lastActivityAt: new Date(),
    }
    if (body.title) data.title = body.title
    if (body.value !== undefined) data.value = body.value
    if (body.expectedCloseDate !== undefined) data.expectedCloseDate = body.expectedCloseDate ? new Date(body.expectedCloseDate) : null
    if (body.nextAction !== undefined) data.nextAction = body.nextAction
    if (body.remindAt !== undefined) data.remindAt = body.remindAt ? new Date(body.remindAt) : null
    // closedAt inchangé (spec §4) : la qualification ne clôture jamais l'affaire.

    const updated = await prisma.opportunity.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.opportunity.update>[0]['data'] })

    await prisma.activity.create({
      data: {
        type: 'QUALIFIED',
        title: 'Qualifié — passage au pipeline',
        userId: req.userId,
        opportunityId: updated.id,
        contactId: updated.contactId ?? undefined,
        companyId: updated.companyId ?? undefined,
        completedAt: new Date(),
      },
    })

    res.json({ success: true, data: updated })
  } catch (err) { handleRouteError(err, res) }
})

export default router
