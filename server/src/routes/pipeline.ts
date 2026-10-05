import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { checkReferences } from '../lib/references'
import { ciContains } from '../lib/query'
import { normalizePhone } from '../lib/phone'
import { fireAutomations } from '../automation-engine'
import { getWonLostStageKeys } from '../services/pipelineService'
import { ensureExists, fetchOrFail, ensureCompanyMatch } from '../lib/relationChecks'
import { audit } from '../lib/audit'

const router = Router()
router.use(authenticate)

const PROSPECT_STATUSES = ['TODO', 'NO_ANSWER', 'REACHED', 'CALLBACK'] as const

const opportunitySchema = z.object({
  title: z.string().min(1),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
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
  source: z.string().optional(),
  prospectStatus: z.enum(PROSPECT_STATUSES).optional(),
  nextAction: z.string().optional().nullable(),
})

// Tri autorisé pour GET /opportunities — liste blanche (évite une clé arbitraire
// transmise telle quelle à Prisma `orderBy`). `company` trie sur le nom de la société liée.
const OPP_SORT_FIELDS = new Set([
  'createdAt', 'updatedAt', 'title', 'value', 'remindAt', 'lastContactedAt', 'prospectStatus', 'stage', 'company',
])

// ─── OPPORTUNITIES ──────────────────────────────────────

router.get('/opportunities', requirePermission('pipeline:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      stage, assignedToId, companyId, pipelineId, archived = 'all', page = '1', limit = '50',
      prospectStatus, source, remindToday, neverContacted, staleDays, search, sortBy, sortOrder,
    } = req.query as Record<string, string>
    const where: Record<string, unknown> = {}
    if (stage) where.stage = stage
    if (assignedToId) where.assignedToId = assignedToId
    if (companyId) where.companyId = companyId
    if (pipelineId) where.pipelineId = pipelineId
    if (prospectStatus) where.prospectStatus = prospectStatus
    if (source) where.source = source
    // `archived` par défaut à 'all' : comportement strictement inchangé pour les appelants
    // existants (dashboard, objectifs, exports) qui n'envoient jamais ce paramètre.
    if (archived === 'exclude') where.archivedAt = null
    else if (archived === 'only') where.archivedAt = { not: null }

    if (remindToday === 'true') {
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999)
      where.remindAt = { gte: startOfDay, lte: endOfDay }
    }
    if (neverContacted === 'true') where.lastContactedAt = null

    // `staleDays` et `search` introduisent chacun un OR : on les combine dans un AND
    // explicite pour ne pas s'écraser mutuellement ni écraser un éventuel futur OR.
    const andFilters: Record<string, unknown>[] = []
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
    let orderBy: Record<string, unknown> = archived === 'only' ? { closedAt: 'desc' as const } : { createdAt: 'desc' as const }
    if (sortBy && OPP_SORT_FIELDS.has(sortBy)) {
      orderBy = sortBy === 'company' ? { company: { name: validSortOrder } } : { [sortBy]: validSortOrder }
    }

    const [total, opportunities] = await Promise.all([
      prisma.opportunity.count({ where }),
      prisma.opportunity.findMany({
        where, skip: (parseInt(page) - 1) * parseInt(limit), take: parseInt(limit),
        orderBy: orderBy as Record<string, unknown>,
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, phone: true, mobile: true } },
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

    const refError = await checkReferences([{ domain: 'lead_source', value: body.source }])
    if (refError) { res.status(400).json({ success: false, error: { code: 'INVALID_REFERENCE', message: refError } }); return }

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
    if (body.pipelineId) {
      if (!await ensureExists(res, body.pipelineId, 'PIPELINE_NOT_FOUND', 'Pipeline introuvable', id => prisma.pipeline.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const data: Record<string, unknown> = { ...body }
    if (body.expectedCloseDate) data.expectedCloseDate = new Date(body.expectedCloseDate)
    if (body.remindAt) data.remindAt = new Date(body.remindAt)
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

// GET /pipeline/opportunities/archives/count — compte des opportunités archivées par type
// d'étape (gagné/perdu), pour les liens « N archivées » en pied de colonnes du Kanban.
// Déclarée AVANT /opportunities/:id pour ne pas être capturée par le paramètre :id.
router.get('/opportunities/archives/count', requirePermission('pipeline:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pipelineId } = req.query as Record<string, string>
    let wonKeys: string[]
    let lostKeys: string[]
    if (pipelineId) {
      // Scopé au pipeline demandé : une même clé d'étape peut avoir un sens différent
      // (gagné/perdu/ouvert) selon le pipeline.
      const stages = await prisma.pipelineStage.findMany({
        where: { pipelineId, OR: [{ isWon: true }, { isLost: true }] },
        select: { key: true, isWon: true, isLost: true },
      })
      wonKeys = stages.filter(s => s.isWon).map(s => s.key)
      lostKeys = stages.filter(s => s.isLost).map(s => s.key)
    } else {
      const keys = await getWonLostStageKeys()
      wonKeys = keys.wonKeys
      lostKeys = keys.lostKeys
    }
    const baseWhere: Record<string, unknown> = { archivedAt: { not: null } }
    if (pipelineId) baseWhere.pipelineId = pipelineId
    const [won, lost] = await Promise.all([
      prisma.opportunity.count({ where: { ...baseWhere, stage: { in: wonKeys } } }),
      prisma.opportunity.count({ where: { ...baseWhere, stage: { in: lostKeys } } }),
    ])
    res.json({ success: true, data: { won, lost } })
  } catch (err) { handleRouteError(err, res) }
})

// POST /pipeline/opportunities/bulk — actions groupées depuis la vue Liste (sélection
// multiple). Déclarée AVANT /opportunities/:id par cohérence avec les autres routes fixes.
router.post('/opportunities/bulk', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = z.object({
      ids: z.array(z.string()).min(1).max(200),
      action: z.enum(['assign', 'stage', 'archive', 'prospectStatus']),
      value: z.string().optional().nullable(),
    }).parse(req.body)

    if ((body.action === 'stage' || body.action === 'prospectStatus') && !body.value) {
      res.status(400).json({ success: false, error: { code: 'VALUE_REQUIRED', message: 'value est requis pour cette action' } })
      return
    }

    let updated = 0
    let skipped = 0

    if (body.action === 'assign') {
      const result = await prisma.opportunity.updateMany({
        where: { id: { in: body.ids } },
        data: { assignedToId: body.value || null },
      })
      updated = result.count
    } else if (body.action === 'prospectStatus') {
      if (!PROSPECT_STATUSES.includes(body.value as typeof PROSPECT_STATUSES[number])) {
        res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: 'Statut de prospection invalide' } })
        return
      }
      const result = await prisma.opportunity.updateMany({
        where: { id: { in: body.ids } },
        data: { prospectStatus: body.value as string },
      })
      updated = result.count
    } else if (body.action === 'stage') {
      const stageExists = await prisma.pipelineStage.findFirst({
        where: { key: body.value as string, pipeline: { isTemplate: false } },
        select: { id: true },
      })
      if (!stageExists) {
        res.status(400).json({ success: false, error: { code: 'INVALID_STAGE', message: 'Étape inconnue' } })
        return
      }
      const { wonKeys, lostKeys } = await getWonLostStageKeys()
      const isClosed = wonKeys.includes(body.value as string) || lostKeys.includes(body.value as string)
      const result = await prisma.opportunity.updateMany({
        where: { id: { in: body.ids } },
        data: {
          stage: body.value as string,
          closedAt: isClosed ? new Date() : null,
          ...(isClosed ? {} : { archivedAt: null, autoArchive: true }),
        },
      })
      updated = result.count
    } else if (body.action === 'archive') {
      const { wonKeys, lostKeys } = await getWonLostStageKeys()
      const opps = await prisma.opportunity.findMany({ where: { id: { in: body.ids } }, select: { id: true, stage: true } })
      const closedIds = opps.filter(o => wonKeys.includes(o.stage) || lostKeys.includes(o.stage)).map(o => o.id)
      skipped = body.ids.length - closedIds.length
      if (closedIds.length > 0) {
        const result = await prisma.opportunity.updateMany({ where: { id: { in: closedIds } }, data: { archivedAt: new Date() } })
        updated = result.count
      }
    }

    res.json({ success: true, data: { updated, skipped } })
  } catch (err) { handleRouteError(err, res) }
})

// POST /pipeline/opportunities/import/csv — import de prospects (entreprise + contact +
// opportunité) depuis un CSV déjà mis en correspondance côté client. Transaction par lots
// de 50 lignes. Déclarée AVANT /opportunities/:id.
const importCsvRowSchema = z.object({
  companyName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  title: z.string().optional(),
  value: z.union([z.string(), z.number()]).optional(),
  notes: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  website: z.string().optional(),
  siret: z.string().optional(),
})

router.post('/opportunities/import/csv', requirePermission('pipeline:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = z.object({
      pipelineId: z.string().optional(),
      stage: z.string().optional(),
      source: z.string().optional(),
      assignedToId: z.string().optional(),
      rows: z.array(importCsvRowSchema).min(1).max(500),
    }).parse(req.body)

    const refError = await checkReferences([{ domain: 'lead_source', value: body.source }])
    if (refError) { res.status(400).json({ success: false, error: { code: 'INVALID_REFERENCE', message: refError } }); return }

    if (body.assignedToId) {
      if (!await ensureExists(res, body.assignedToId, 'USER_NOT_FOUND', 'Utilisateur introuvable', id => prisma.user.findUnique({ where: { id }, select: { id: true } }))) return
    }

    // Résolution du pipeline et de l'étape de départ — même logique que POST /opportunities.
    const pipeline = body.pipelineId
      ? await prisma.pipeline.findUnique({ where: { id: body.pipelineId }, include: { stages: { orderBy: { order: 'asc' } } } })
      : (await prisma.pipeline.findFirst({ where: { isDefault: true, isActive: true }, include: { stages: { orderBy: { order: 'asc' } } } })) ??
        (await prisma.pipeline.findFirst({ where: { isActive: true }, orderBy: { order: 'asc' }, include: { stages: { orderBy: { order: 'asc' } } } }))
    if (body.pipelineId && !pipeline) {
      res.status(400).json({ success: false, error: { code: 'PIPELINE_NOT_FOUND', message: 'Pipeline introuvable' } })
      return
    }
    const stageExists = pipeline?.stages.some(s => s.key === body.stage) ?? false
    const firstOpenStage = pipeline?.stages.find(s => !s.isWon && !s.isLost) ?? pipeline?.stages[0]
    const resolvedStage = body.stage && stageExists ? body.stage : (firstOpenStage?.key ?? 'NEW')
    const resolvedPipelineId = pipeline?.id ?? null
    const source = body.source || 'MANUAL'

    const { wonKeys, lostKeys } = await getWonLostStageKeys()

    // Pré-résolution des entreprises déjà existantes (insensible à la casse, cf. lib/query.ts
    // ciContains — un seul aller-retour DB, filtré ensuite en JS pour une égalité exacte car
    // `contains` autoriserait des correspondances partielles).
    const uniqueCompanyNames = [...new Set(
      body.rows.map(r => r.companyName?.trim()).filter((v): v is string => !!v)
    )]
    const candidateCompanies = uniqueCompanyNames.length > 0
      ? await prisma.company.findMany({
          where: { OR: uniqueCompanyNames.map(n => ({ name: ciContains(n) })) },
          select: { id: true, name: true },
        })
      : []
    const companyByName = new Map<string, string>()
    for (const c of candidateCompanies) companyByName.set(c.name.toLowerCase(), c.id)

    const errors: { row: number; reason: string }[] = []
    let skipped = 0
    let createdCompanies = 0
    let createdContacts = 0
    let createdOpportunities = 0

    for (let batchStart = 0; batchStart < body.rows.length; batchStart += 50) {
      const batch = body.rows.slice(batchStart, batchStart + 50)
      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < batch.length; i++) {
          const rowIndex = batchStart + i
          const row = batch[i]
          try {
            const companyName = row.companyName?.trim()
            if (!companyName) {
              errors.push({ row: rowIndex, reason: 'Entreprise manquante' })
              continue
            }

            const cacheKey = companyName.toLowerCase()
            let companyId = companyByName.get(cacheKey)
            if (!companyId) {
              const created = await tx.company.create({
                data: {
                  name: companyName,
                  city: row.city?.trim() || undefined,
                  postalCode: row.postalCode?.trim() || undefined,
                  website: row.website?.trim() || undefined,
                  siret: row.siret?.trim() || undefined,
                },
              })
              companyId = created.id
              companyByName.set(cacheKey, companyId)
              createdCompanies++
            }

            // Doublon : opportunité non archivée, étape ouverte, même entreprise et même pipeline.
            const existingOpen = await tx.opportunity.findFirst({
              where: {
                companyId,
                pipelineId: resolvedPipelineId,
                archivedAt: null,
                stage: { notIn: [...wonKeys, ...lostKeys] },
              },
              select: { id: true },
            })
            if (existingOpen) { skipped++; continue }

            // Contact : email, puis nom + prénom dans l'entreprise, sinon création.
            let contactId: string | undefined
            const email = row.email?.trim()
            if (email) {
              const existing = await tx.contact.findFirst({ where: { email }, select: { id: true } })
              if (existing) contactId = existing.id
            }
            const firstName = row.firstName?.trim() || ''
            const lastName = row.lastName?.trim() || ''
            if (!contactId && (firstName || lastName)) {
              const candidates = await tx.contact.findMany({
                where: { companyId },
                select: { id: true, firstName: true, lastName: true },
              })
              const match = candidates.find(c =>
                c.firstName.toLowerCase() === firstName.toLowerCase() &&
                c.lastName.toLowerCase() === lastName.toLowerCase()
              )
              if (match) contactId = match.id
            }
            if (!contactId && (firstName || lastName)) {
              const phone = row.phone?.trim() || undefined
              const createdContact = await tx.contact.create({
                data: {
                  firstName: firstName || '—',
                  lastName: lastName || '—',
                  email: email || undefined,
                  phone,
                  phoneNormalized: normalizePhone(phone),
                  companyId,
                  source,
                  status: 'PROSPECT',
                },
              })
              contactId = createdContact.id
              createdContacts++
            }

            const rawValue = row.value
            const parsedValue = rawValue === undefined || rawValue === '' ? 0 : Number(rawValue)

            await tx.opportunity.create({
              data: {
                title: row.title?.trim() || companyName,
                companyId,
                contactId,
                pipelineId: resolvedPipelineId,
                stage: resolvedStage,
                value: Number.isFinite(parsedValue) ? parsedValue : 0,
                source,
                prospectStatus: 'TODO',
                assignedToId: body.assignedToId,
                notes: row.notes?.trim() || undefined,
              },
            })
            createdOpportunities++
          } catch (rowErr) {
            errors.push({ row: rowIndex, reason: rowErr instanceof Error ? rowErr.message : 'Erreur inconnue' })
          }
        }
      })
    }

    res.json({
      success: true,
      data: {
        created: { companies: createdCompanies, contacts: createdContacts, opportunities: createdOpportunities },
        skipped,
        errors,
      },
    })
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
      },
    })
    if (!opp) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Opportunité introuvable' } }); return }
    res.json({ success: true, data: opp })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/opportunities/:id', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = opportunitySchema.partial().parse(req.body)
    const refError = await checkReferences([{ domain: 'lead_source', value: body.source }])
    if (refError) { res.status(400).json({ success: false, error: { code: 'INVALID_REFERENCE', message: refError } }); return }

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
      const isClosed = wonKeys.includes(stage) || lostKeys.includes(stage)
      data.closedAt = isClosed ? new Date() : null
      // Réouverture d'une affaire : une opportunité qui revient vers une étape ouverte
      // ne doit plus être archivée, et redevient éligible à l'archivage automatique futur.
      if (!isClosed) {
        data.archivedAt = null
        data.autoArchive = true
      }
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

// PATCH /pipeline/opportunities/:id/prospect — statut de prospection à un clic (vue Liste).
// NO_ANSWER/REACHED posent lastContactedAt + incrémentent callAttempts et journalisent un
// appel (Activity type CALL). CALLBACK exige un remindAt. TODO ne touche pas aux compteurs.
router.patch('/opportunities/:id/prospect', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = z.object({
      prospectStatus: z.enum(PROSPECT_STATUSES).optional(),
      remindAt: z.string().optional().nullable(),
      nextAction: z.string().optional().nullable(),
    }).parse(req.body)

    if (body.prospectStatus === 'CALLBACK' && !body.remindAt) {
      res.status(400).json({ success: false, error: { code: 'REMIND_AT_REQUIRED', message: 'Une date de rappel est requise pour "À rappeler"' } })
      return
    }

    const current = await prisma.opportunity.findUnique({ where: { id: req.params.id }, select: { id: true, contactId: true, callAttempts: true } })
    if (!current) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Opportunité introuvable' } }); return }

    const isCallOutcome = body.prospectStatus === 'NO_ANSWER' || body.prospectStatus === 'REACHED'

    const data: Record<string, unknown> = {}
    if (body.prospectStatus !== undefined) data.prospectStatus = body.prospectStatus
    if (body.nextAction !== undefined) data.nextAction = body.nextAction
    if (body.remindAt !== undefined) data.remindAt = body.remindAt ? new Date(body.remindAt) : null
    if (isCallOutcome) {
      data.lastContactedAt = new Date()
      data.callAttempts = current.callAttempts + 1
    }

    const updated = await prisma.opportunity.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.opportunity.update>[0]['data'] })

    if (isCallOutcome) {
      await prisma.activity.create({
        data: {
          type: 'CALL',
          title: body.prospectStatus === 'NO_ANSWER' ? 'Appel sans réponse' : 'Joint par téléphone',
          opportunityId: updated.id,
          contactId: current.contactId ?? undefined,
          userId: req.userId,
          completedAt: new Date(),
        },
      }).catch(console.error)
    }

    res.json({ success: true, data: updated })
  } catch (err) { handleRouteError(err, res) }
})

// PATCH /pipeline/opportunities/:id/archive — archivage manuel (menu Actions des cartes
// gagnées/perdues du Kanban). Refuse une opportunité dont l'étape n'est ni gagnée ni perdue.
router.patch('/opportunities/:id/archive', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const opp = await prisma.opportunity.findUnique({ where: { id: req.params.id }, select: { id: true, stage: true } })
    if (!opp) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Opportunité introuvable' } }); return }

    const { wonKeys, lostKeys } = await getWonLostStageKeys()
    if (!wonKeys.includes(opp.stage) && !lostKeys.includes(opp.stage)) {
      res.status(400).json({ success: false, error: { code: 'NOT_CLOSED', message: 'Seule une opportunité gagnée ou perdue peut être archivée' } })
      return
    }

    const updated = await prisma.opportunity.update({ where: { id: opp.id }, data: { archivedAt: new Date() } })
    audit(req, 'OPPORTUNITY_ARCHIVED', 'Opportunity', opp.id)
    res.json({ success: true, data: updated })
  } catch (err) { handleRouteError(err, res) }
})

// PATCH /pipeline/opportunities/:id/unarchive — désarchivage manuel. Pose autoArchive=false
// pour que l'automate ne la range pas à nouveau la nuit suivante.
router.patch('/opportunities/:id/unarchive', requirePermission('pipeline:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const opp = await prisma.opportunity.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!opp) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Opportunité introuvable' } }); return }

    const updated = await prisma.opportunity.update({ where: { id: opp.id }, data: { archivedAt: null, autoArchive: false } })
    audit(req, 'OPPORTUNITY_UNARCHIVED', 'Opportunity', opp.id)
    res.json({ success: true, data: updated })
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
