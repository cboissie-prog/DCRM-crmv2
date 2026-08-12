import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { getWonLostStageKeys } from '../services/pipelineService'

const router = Router()
router.use(authenticate)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
}

function parsePeriod(period: string): { start: Date; end: Date } {
  if (/^\d{4}$/.test(period)) {
    const year = parseInt(period)
    return { start: new Date(year, 0, 1), end: new Date(year, 12, 0, 23, 59, 59, 999) }
  }
  if (/^\d{4}-Q[1-4]$/.test(period)) {
    const year = parseInt(period)
    const q    = parseInt(period.split('-Q')[1])
    const m    = (q - 1) * 3
    return { start: new Date(year, m, 1), end: new Date(year, m + 3, 0, 23, 59, 59, 999) }
  }
  // Monthly: "2026-01"
  const [y, mo] = period.split('-').map(Number)
  return { start: new Date(y, mo - 1, 1), end: new Date(y, mo, 0, 23, 59, 59, 999) }
}

/** Mois ("YYYY-MM") composant un trimestre "YYYY-QN" */
function monthsOfQuarter(quarter: string): string[] {
  const year = quarter.slice(0, 4)
  const q    = parseInt(quarter.split('-Q')[1])
  return [0, 1, 2].map(i => `${year}-${String((q - 1) * 3 + i + 1).padStart(2, '0')}`)
}

/** Trimestres composant une période entreprise (année → 4 trimestres, trimestre → lui-même, mois → aucun) */
function quartersOfPeriod(period: string): string[] {
  if (/^\d{4}$/.test(period))       return [1, 2, 3, 4].map(q => `${period}-Q${q}`)
  if (/^\d{4}-Q[1-4]$/.test(period)) return [period]
  return []
}

/** Trimestres du plus ancien au plus récent : `past` en arrière (trimestre courant inclus) + `future` en avant */
function quartersAround(past: number, future: number): string[] {
  const now = new Date()
  let year = now.getFullYear()
  let q = Math.ceil((now.getMonth() + 1) / 3)
  // Recule jusqu'au premier trimestre de la fenêtre
  for (let i = 0; i < past - 1; i++) { q--; if (q === 0) { q = 4; year-- } }
  const quarters: string[] = []
  for (let i = 0; i < past + future; i++) {
    quarters.push(`${year}-Q${q}`)
    q++
    if (q === 5) { q = 1; year++ }
  }
  return quarters
}

const userSelect = { id: true, firstName: true, lastName: true, avatar: true, role: true }

/** Peut voir les objectifs/prévisions de toute l'équipe (sinon : uniquement les siens) */
const canReadAll = (req: AuthRequest): boolean =>
  req.permissions?.includes('*') || req.permissions?.includes('targets:read_all') || false

// ─── Schemas ──────────────────────────────────────────────────────────────────
// Le « réalisé » n'est plus saisi : il est calculé depuis les opportunités gagnées.

const createSchema = z.object({
  userId:     z.string().min(1),
  period:     z.string().regex(/^\d{4}-Q[1-4]$|^\d{4}-\d{2}$/, 'Format: 2026-Q1 ou 2026-01'),
  target:     z.number().positive('Objectif doit être positif'),
  pipelineId: z.string().min(1).nullable().optional(), // null/absent = objectif global
})

const updateSchema = z.object({
  target:     z.number().positive(),
  pipelineId: z.string().min(1).nullable().optional(),
})

// Objectif d'entreprise : accepte aussi la période annuelle ("2026")
const COMPANY_PERIOD_REGEX = /^\d{4}$|^\d{4}-Q[1-4]$|^\d{4}-\d{2}$/

const companyCreateSchema = z.object({
  period:     z.string().regex(COMPANY_PERIOD_REGEX, 'Format: 2026, 2026-Q1 ou 2026-01'),
  target:     z.number().positive('Objectif doit être positif'),
  pipelineId: z.string().min(1).nullable().optional(), // null/absent = objectif global
})

const companyUpdateSchema = z.object({
  target:     z.number().positive(),
  pipelineId: z.string().min(1).nullable().optional(),
})

// ─── GET /targets/periods ─────────────────────────────────────────────────────

router.get('/periods', requirePermission('targets:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  // 8 trimestres passés (courant inclus) + 4 futurs pour planifier les objectifs à venir
  res.json({ success: true, data: quartersAround(8, 4) })
})

// ─── GET /targets/eligible-users ──────────────────────────────────────────────
// Utilisateurs pouvant recevoir un objectif : ceux dont le rôle donne accès
// à l'onglet Objectifs & Prévisions (permission targets:read), ADMIN inclus.

router.get('/eligible-users', requirePermission('targets:write'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: 'ADMIN' }, // ADMIN a toutes les permissions implicitement
          { roleRef: { permissions: { some: { permission: { key: 'targets:read' } } } } },
        ],
      },
      select: userSelect,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    })
    res.json({ success: true, data: users })
  } catch (err) { handleRouteError(err, res) }
})

// ─── GET /targets?period=2026-Q2 ──────────────────────────────────────────────

router.get('/', requirePermission('targets:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const period = (req.query.period as string) || currentPeriod()

    // Sans targets:read_all, on ne voit que ses propres objectifs
    const where: Record<string, unknown> = { period }
    if (!canReadAll(req)) where.userId = req.userId

    const targets = await prisma.salesTarget.findMany({
      where,
      include: {
        user:     { select: userSelect },
        pipeline: { select: { id: true, name: true, color: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Réalisé calculé depuis les opportunités gagnées de la période,
    // ventilé par pipeline pour les objectifs liés à un pipeline
    const { wonKeys } = await getWonLostStageKeys()
    const { start, end } = parsePeriod(period)
    const wonGroups = targets.length > 0 && wonKeys.length > 0
      ? await prisma.opportunity.groupBy({
          by: ['assignedToId', 'pipelineId'],
          _sum: { value: true },
          where: {
            stage:        { in: wonKeys },
            closedAt:     { gte: start, lte: end },
            assignedToId: { in: targets.map(t => t.userId) },
          },
        })
      : []
    const computedFor = (userId: string, pipelineId: string | null) => pipelineId
      ? wonGroups.find(w => w.assignedToId === userId && w.pipelineId === pipelineId)?._sum.value ?? 0
      : wonGroups.filter(w => w.assignedToId === userId).reduce((s, w) => s + (w._sum.value ?? 0), 0)
    const enriched = targets.map(t => ({ ...t, computedActual: computedFor(t.userId, t.pipelineId) }))

    res.json({ success: true, data: enriched, meta: { period } })
  } catch (err) { handleRouteError(err, res) }
})

// ─── GET /targets/forecast?period=&pipelineId= ────────────────────────────────

router.get('/forecast', requirePermission('targets:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const period     = (req.query.period as string) || currentPeriod()
    const pipelineId = (req.query.pipelineId as string) || undefined
    const { start, end } = parsePeriod(period)
    const { wonKeys, lostKeys } = await getWonLostStageKeys()

    // Sans targets:read_all, la prévision est limitée à ses propres opportunités
    const pipelineFilter: Record<string, unknown> = pipelineId ? { pipelineId } : {}
    if (!canReadAll(req)) pipelineFilter.assignedToId = req.userId
    const [openOpps, wonOpps, stages] = await Promise.all([
      prisma.opportunity.findMany({
        where: { stage: { notIn: [...wonKeys, ...lostKeys] }, ...pipelineFilter },
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          company:    { select: { id: true, name: true } },
        },
        orderBy: { value: 'desc' },
      }),
      prisma.opportunity.findMany({
        where: { stage: { in: wonKeys }, closedAt: { gte: start, lte: end }, ...pipelineFilter },
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
      }),
      // Métadonnées d'étapes (nom, couleur, ordre) — pipeline par défaut prioritaire
      prisma.pipelineStage.findMany({
        where: pipelineId ? { pipelineId } : {},
        orderBy: [{ pipeline: { isDefault: 'desc' } }, { order: 'asc' }],
      }),
    ])

    const stageMeta = new Map<string, { name: string; color: string; order: number }>()
    for (const s of stages) {
      if (!stageMeta.has(s.key)) stageMeta.set(s.key, { name: s.name, color: s.color, order: s.order })
    }

    // Summary
    const weightedTotal = openOpps.reduce((s, o) => s + o.value * o.probability / 100, 0)
    const rawTotal      = openOpps.reduce((s, o) => s + o.value, 0)
    const wonTotal      = wonOpps.reduce((s, o) => s + o.value, 0)

    // By stage
    const stageMap = new Map<string, { stage: string; count: number; rawValue: number; weightedValue: number; probaSum: number }>()
    for (const o of openOpps) {
      const s = stageMap.get(o.stage) ?? { stage: o.stage, count: 0, rawValue: 0, weightedValue: 0, probaSum: 0 }
      s.count++
      s.rawValue      += o.value
      s.weightedValue += o.value * o.probability / 100
      s.probaSum      += o.probability
      stageMap.set(o.stage, s)
    }
    const byStage = [...stageMap.values()]
      .map(({ probaSum, ...s }) => ({
        ...s,
        stageName:  stageMeta.get(s.stage)?.name  ?? s.stage,
        stageColor: stageMeta.get(s.stage)?.color ?? '#6366f1',
        avgProba:   s.count > 0 ? Math.round(probaSum / s.count) : 0,
      }))
      .sort((a, b) => (stageMeta.get(a.stage)?.order ?? 99) - (stageMeta.get(b.stage)?.order ?? 99))

    // By user (open opps + won in period)
    type UserEntry = {
      userId:        string
      firstName:     string
      lastName:      string
      avatar:        string | null
      count:         number
      rawValue:      number
      weightedValue: number
      wonValue:      number
    }
    const userMap = new Map<string, UserEntry>()
    for (const o of openOpps) {
      const key = o.assignedToId ?? '__unassigned__'
      const u   = userMap.get(key) ?? {
        userId: key, firstName: o.assignedTo?.firstName ?? '?', lastName: o.assignedTo?.lastName ?? '',
        avatar: o.assignedTo?.avatar ?? null, count: 0, rawValue: 0, weightedValue: 0, wonValue: 0,
      }
      u.count++
      u.rawValue      += o.value
      u.weightedValue += o.value * o.probability / 100
      userMap.set(key, u)
    }
    for (const o of wonOpps) {
      const key = o.assignedToId ?? '__unassigned__'
      const u   = userMap.get(key) ?? {
        userId: key, firstName: o.assignedTo?.firstName ?? '?', lastName: o.assignedTo?.lastName ?? '',
        avatar: null, count: 0, rawValue: 0, weightedValue: 0, wonValue: 0,
      }
      u.wonValue += o.value
      userMap.set(key, u)
    }
    const byUser = [...userMap.values()].sort((a, b) => b.weightedValue - a.weightedValue)

    // Top opportunities (prob ≥ 50)
    const topOpportunities = openOpps
      .filter(o => o.probability >= 50)
      .slice(0, 8)
      .map(o => ({
        id:               o.id,
        title:            o.title,
        value:            o.value,
        probability:      o.probability,
        weighted:         Math.round(o.value * o.probability / 100),
        stage:            o.stage,
        expectedCloseDate: o.expectedCloseDate,
        assignedTo:       o.assignedTo,
        company:          o.company,
      }))

    res.json({
      success: true,
      data: {
        period,
        summary: {
          weightedTotal: Math.round(weightedTotal),
          rawTotal,
          wonTotal,
          count: openOpps.length,
        },
        byStage,
        byUser,
        topOpportunities,
      },
    })
  } catch (err) { handleRouteError(err, res) }
})

// ─── GET /targets/performance?period=2026-Q2 ─────────────────────────────────
// Classement des commerciaux — nécessite la vue équipe.

router.get('/performance', requirePermission('targets:read_all'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const period = (req.query.period as string) || undefined
    const dates  = period ? parsePeriod(period) : null
    const { wonKeys, lostKeys } = await getWonLostStageKeys()

    const users = await prisma.user.findMany({
      where: { isActive: true, role: { in: ['COMMERCIAL', 'MANAGER', 'ADMIN'] } },
      select: userSelect,
    })

    const performance = await Promise.all(users.map(async user => {
      const baseWhere = dates
        ? { assignedToId: user.id, closedAt: { gte: dates.start, lte: dates.end } }
        : { assignedToId: user.id }

      const [wonResult, lostCount, activeCount, createdCount] = await Promise.all([
        prisma.opportunity.aggregate({
          _sum: { value: true }, _count: { id: true },
          where: { ...baseWhere, stage: { in: wonKeys } },
        }),
        prisma.opportunity.count({ where: { ...baseWhere, stage: { in: lostKeys } } }),
        prisma.opportunity.count({ where: { assignedToId: user.id, stage: { notIn: [...wonKeys, ...lostKeys] } } }),
        prisma.opportunity.count({
          where: dates
            ? { assignedToId: user.id, createdAt: { gte: dates.start, lte: dates.end } }
            : { assignedToId: user.id },
        }),
      ])

      const wonCount    = wonResult._count.id
      const wonValue    = wonResult._sum.value ?? 0
      const closedCount = wonCount + lostCount
      const winRate     = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0
      const avgDeal     = wonCount > 0 ? wonValue / wonCount : 0

      return { user, wonCount, wonValue, lostCount, activeCount, createdCount, winRate, avgDeal }
    }))

    const active = performance.filter(p => p.createdCount > 0 || p.wonCount > 0 || p.activeCount > 0)
    active.sort((a, b) => b.wonValue - a.wonValue)

    res.json({ success: true, data: active })
  } catch (err) { handleRouteError(err, res) }
})

// ─── OBJECTIF D'ENTREPRISE ────────────────────────────────────────────────────
// Cible collective par période, alimentée par les opportunités gagnées de tous
// les commerciaux. `allocatedTarget` mesure la couverture de la cible par les
// objectifs individuels déjà répartis.

const companyPipelineInclude = { pipeline: { select: { id: true, name: true, color: true } } }

/**
 * Somme des objectifs individuels couvrant la période entreprise, sans double comptage :
 * - temps : l'objectif trimestriel d'un commercial prime sur ses objectifs mensuels du
 *   même trimestre (période annuelle : trimestres d'abord, puis mois non couverts) ;
 * - périmètre : pour une cible entreprise globale, l'objectif global d'un commercial
 *   prime sur ses objectifs par pipeline ; pour une cible par pipeline, seuls les
 *   objectifs individuels de ce pipeline comptent.
 */
async function computeAllocatedTarget(period: string, pipelineId: string | null): Promise<number> {
  const quarters   = quartersOfPeriod(period)
  const months     = quarters.length > 0 ? quarters.flatMap(monthsOfQuarter) : [period]
  const allPeriods = [...quarters, ...months]

  const rows = await prisma.salesTarget.findMany({
    where: {
      period: { in: allPeriods },
      ...(pipelineId ? { pipelineId } : {}),
    },
    select: { userId: true, period: true, target: true, pipelineId: true },
  })

  // Quota effectif d'un commercial sur une même fenêtre de temps
  const effective = (list: typeof rows): number => {
    if (pipelineId) return list.reduce((s, t) => s + t.target, 0)
    const global = list.find(t => t.pipelineId === null)
    return global ? global.target : list.reduce((s, t) => s + t.target, 0)
  }

  const byUser = new Map<string, typeof rows>()
  for (const t of rows) {
    const list = byUser.get(t.userId) ?? []
    list.push(t)
    byUser.set(t.userId, list)
  }

  let total = 0
  for (const list of byUser.values()) {
    if (quarters.length === 0) { total += effective(list); continue } // période mensuelle
    for (const q of quarters) {
      const qTargets = list.filter(t => t.period === q)
      if (qTargets.length > 0) { total += effective(qTargets); continue }
      for (const m of monthsOfQuarter(q)) {
        const mTargets = list.filter(t => t.period === m)
        if (mTargets.length > 0) total += effective(mTargets)
      }
    }
  }
  return total
}

// ─── GET /targets/company?period=2026-Q3 ──────────────────────────────────────

router.get('/company', requirePermission('company_targets:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const period = (req.query.period as string) || currentPeriod()
    if (!COMPANY_PERIOD_REGEX.test(period)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Période invalide (formats : 2026, 2026-Q1, 2026-01)' } })
      return
    }

    const targets = await prisma.companyTarget.findMany({
      where: { period },
      include: companyPipelineInclude,
      orderBy: { createdAt: 'asc' },
    })

    // Réalisé collectif : opportunités gagnées de la période, tous commerciaux
    const { wonKeys } = await getWonLostStageKeys()
    const { start, end } = parsePeriod(period)
    const wonGroups = targets.length > 0 && wonKeys.length > 0
      ? await prisma.opportunity.groupBy({
          by: ['pipelineId'],
          _sum: { value: true },
          where: { stage: { in: wonKeys }, closedAt: { gte: start, lte: end } },
        })
      : []
    const actualFor = (pid: string | null) => pid
      ? wonGroups.find(w => w.pipelineId === pid)?._sum.value ?? 0
      : wonGroups.reduce((s, w) => s + (w._sum.value ?? 0), 0)

    const enriched = await Promise.all(targets.map(async t => ({
      ...t,
      computedActual:  actualFor(t.pipelineId),
      allocatedTarget: await computeAllocatedTarget(period, t.pipelineId),
    })))

    res.json({ success: true, data: enriched, meta: { period } })
  } catch (err) { handleRouteError(err, res) }
})

// ─── POST /targets/company ────────────────────────────────────────────────────

router.post('/company', requirePermission('company_targets:write'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = companyCreateSchema.parse(req.body)
    const pipelineId = body.pipelineId ?? null
    // Upsert par period + pipeline (null = objectif global)
    const existing = await prisma.companyTarget.findFirst({ where: { period: body.period, pipelineId } })
    const target = existing
      ? await prisma.companyTarget.update({
          where: { id: existing.id },
          data: { target: body.target },
          include: companyPipelineInclude,
        })
      : await prisma.companyTarget.create({
          data: { period: body.period, target: body.target, pipelineId },
          include: companyPipelineInclude,
        })
    res.status(201).json({ success: true, data: target })
  } catch (err) { handleRouteError(err, res) }
})

// ─── PUT /targets/company/:id ─────────────────────────────────────────────────

router.put('/company/:id', requirePermission('company_targets:write'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body   = companyUpdateSchema.parse(req.body)
    const target = await prisma.companyTarget.update({
      where:   { id: req.params.id as string },
      data:    body,
      include: companyPipelineInclude,
    })
    res.json({ success: true, data: target })
  } catch (err) { handleRouteError(err, res) }
})

// ─── DELETE /targets/company/:id ──────────────────────────────────────────────

router.delete('/company/:id', requirePermission('company_targets:write'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.companyTarget.delete({ where: { id: req.params.id as string } })
    res.json({ success: true })
  } catch (err) { handleRouteError(err, res) }
})

// ─── POST /targets ────────────────────────────────────────────────────────────

router.post('/', requirePermission('targets:write'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body)
    const pipelineId = body.pipelineId ?? null
    // Upsert par userId + period + pipeline (null = objectif global)
    const existing = await prisma.salesTarget.findFirst({
      where: { userId: body.userId, period: body.period, pipelineId },
    })
    const include = {
      user:     { select: userSelect },
      pipeline: { select: { id: true, name: true, color: true } },
    }
    let target
    if (existing) {
      target = await prisma.salesTarget.update({
        where: { id: existing.id },
        data: { target: body.target },
        include,
      })
    } else {
      target = await prisma.salesTarget.create({
        data: { userId: body.userId, period: body.period, target: body.target, pipelineId },
        include,
      })
    }
    res.status(201).json({ success: true, data: target })
  } catch (err) { handleRouteError(err, res) }
})

// ─── PUT /targets/:id ─────────────────────────────────────────────────────────

router.put('/:id', requirePermission('targets:write'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body   = updateSchema.parse(req.body)
    const id     = req.params.id as string
    const target = await prisma.salesTarget.update({
      where: { id },
      data:  body,
      include: {
        user:     { select: userSelect },
        pipeline: { select: { id: true, name: true, color: true } },
      },
    })
    res.json({ success: true, data: target })
  } catch (err) { handleRouteError(err, res) }
})

// ─── DELETE /targets/:id ──────────────────────────────────────────────────────

router.delete('/:id', requirePermission('targets:write'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.salesTarget.delete({ where: { id: req.params.id as string } })
    res.json({ success: true })
  } catch (err) { handleRouteError(err, res) }
})

export default router
