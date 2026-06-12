import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'

const router = Router()
router.use(authenticate)

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse period string 'YYYY-QN' → { start, end } dates */
function periodToDates(period: string): { start: Date; end: Date } | null {
  const m = period.match(/^(\d{4})-Q([1-4])$/)
  if (!m) return null
  const year = parseInt(m[1])
  const q = parseInt(m[2])
  const startMonth = (q - 1) * 3
  const start = new Date(year, startMonth, 1)
  const end = new Date(year, startMonth + 3, 1)
  return { start, end }
}

/** Generate last N quarters from today */
function lastNQuarters(n: number): string[] {
  const quarters: string[] = []
  const now = new Date()
  let year = now.getFullYear()
  let q = Math.ceil((now.getMonth() + 1) / 3)
  for (let i = 0; i < n; i++) {
    quarters.unshift(`${year}-Q${q}`)
    q--
    if (q === 0) { q = 4; year-- }
  }
  return quarters
}

// ─── SALES TARGETS ────────────────────────────────────────────────────────────

// GET /api/reports/sales-targets
router.get('/sales-targets', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { period, userId } = req.query as Record<string, string>

    const where: Record<string, unknown> = {}
    if (period) where.period = period
    // Non-ADMIN users can only see their own targets
    if (req.userRole !== 'ADMIN' && req.userRole !== 'MANAGER') where.userId = req.userId
    else if (userId) where.userId = userId

    const targets = await prisma.salesTarget.findMany({
      where,
      include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true, role: true } } },
      orderBy: [{ period: 'desc' }, { user: { lastName: 'asc' } }],
    })

    // Compute actual from WON opportunities for each target
    const wonStageKeys = (await prisma.pipelineStage.findMany({ where: { isWon: true } })).map(s => s.key)

    const enriched = await Promise.all(targets.map(async t => {
      const dates = periodToDates(t.period)
      let computedActual = t.actual
      if (dates && wonStageKeys.length > 0) {
        const result = await prisma.opportunity.aggregate({
          _sum: { value: true },
          where: {
            assignedToId: t.userId,
            stage: { in: wonStageKeys },
            closedAt: { gte: dates.start, lt: dates.end },
          },
        })
        computedActual = result._sum.value ?? 0
      }
      return { ...t, computedActual }
    }))

    res.json({ success: true, data: enriched })
  } catch (err) { handleRouteError(err, res) }
})

// POST /api/reports/sales-targets
router.post('/sales-targets', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = z.object({
      userId: z.string().min(1),
      period: z.string().regex(/^\d{4}-Q[1-4]$/, 'Format requis: YYYY-QN (ex: 2026-Q2)'),
      target: z.number().min(0),
    }).parse(req.body)

    // Check duplicate
    const existing = await prisma.salesTarget.findFirst({ where: { userId: body.userId, period: body.period } })
    if (existing) { res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'Un objectif existe déjà pour ce commercial et cette période' } }); return }

    const target = await prisma.salesTarget.create({
      data: body,
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    })
    res.status(201).json({ success: true, data: target })
  } catch (err) { handleRouteError(err, res) }
})

// PUT /api/reports/sales-targets/:id
router.put('/sales-targets/:id', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { target } = z.object({ target: z.number().min(0) }).parse(req.body)
    const updated = await prisma.salesTarget.update({
      where: { id: req.params.id },
      data: { target },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    })
    res.json({ success: true, data: updated })
  } catch (err) { handleRouteError(err, res) }
})

// DELETE /api/reports/sales-targets/:id
router.delete('/sales-targets/:id', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.salesTarget.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) { handleRouteError(err, res) }
})

// ─── PIPELINE FORECAST ────────────────────────────────────────────────────────

// GET /api/reports/pipeline-forecast?pipelineId=
router.get('/pipeline-forecast', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pipelineId } = req.query as Record<string, string>

    // Get stages for this pipeline (or default)
    const pipeline = pipelineId
      ? await prisma.pipeline.findUnique({ where: { id: pipelineId }, include: { stages: { orderBy: { order: 'asc' } } } })
      : await prisma.pipeline.findFirst({ where: { isDefault: true }, include: { stages: { orderBy: { order: 'asc' } } } })

    if (!pipeline) { res.json({ success: true, data: { stages: [], total: { count: 0, value: 0, weighted: 0 } } }); return }

    const wonStageKeys = pipeline.stages.filter(s => s.isWon).map(s => s.key)
    const lostStageKeys = pipeline.stages.filter(s => s.isLost).map(s => s.key)

    // Aggregate by stage
    const opps = await prisma.opportunity.findMany({
      where: { pipelineId: pipeline.id },
      select: { stage: true, value: true, probability: true },
    })

    const stageData = pipeline.stages.map(stage => {
      const stageOpps = opps.filter(o => o.stage === stage.key)
      const count = stageOpps.length
      const totalValue = stageOpps.reduce((s, o) => s + o.value, 0)
      const weighted = stageOpps.reduce((s, o) => s + (o.value * o.probability) / 100, 0)
      const avgProba = count > 0 ? Math.round(stageOpps.reduce((s, o) => s + o.probability, 0) / count) : 0
      return { stageKey: stage.key, stageName: stage.name, stageColor: stage.color, isWon: stage.isWon, isLost: stage.isLost, count, totalValue, weighted, avgProba }
    })

    const activeData = stageData.filter(s => !s.isWon && !s.isLost)
    const total = {
      count: activeData.reduce((s, d) => s + d.count, 0),
      value: activeData.reduce((s, d) => s + d.totalValue, 0),
      weighted: activeData.reduce((s, d) => s + d.weighted, 0),
    }

    res.json({ success: true, data: { pipelineId: pipeline.id, pipelineName: pipeline.name, stages: stageData, total } })
  } catch (err) { handleRouteError(err, res) }
})

// ─── COMMERCIAL PERFORMANCE ───────────────────────────────────────────────────

// GET /api/reports/commercial-performance?period=2026-Q2
router.get('/commercial-performance', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { period } = req.query as Record<string, string>
    const dates = period ? periodToDates(period) : null

    const wonStageKeys = (await prisma.pipelineStage.findMany({ where: { isWon: true } })).map(s => s.key)
    const lostStageKeys = (await prisma.pipelineStage.findMany({ where: { isLost: true } })).map(s => s.key)

    const users = await prisma.user.findMany({
      where: { isActive: true, role: { in: ['COMMERCIAL', 'MANAGER', 'ADMIN'] } },
      select: { id: true, firstName: true, lastName: true, avatar: true, role: true },
    })

    const performance = await Promise.all(users.map(async user => {
      const baseWhere = dates
        ? { assignedToId: user.id, closedAt: { gte: dates.start, lt: dates.end } }
        : { assignedToId: user.id }

      const [wonResult, lostCount, activeCount, createdCount] = await Promise.all([
        prisma.opportunity.aggregate({
          _sum: { value: true }, _count: { id: true },
          where: { ...baseWhere, stage: { in: wonStageKeys } },
        }),
        prisma.opportunity.count({ where: { ...baseWhere, stage: { in: lostStageKeys } } }),
        prisma.opportunity.count({ where: { assignedToId: user.id, stage: { notIn: [...wonStageKeys, ...lostStageKeys] } } }),
        prisma.opportunity.count({
          where: dates
            ? { assignedToId: user.id, createdAt: { gte: dates.start, lt: dates.end } }
            : { assignedToId: user.id },
        }),
      ])

      const wonCount = wonResult._count.id
      const wonValue = wonResult._sum.value ?? 0
      const closedCount = wonCount + lostCount
      const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0
      const avgDeal = wonCount > 0 ? wonValue / wonCount : 0

      return { user, wonCount, wonValue, lostCount, activeCount, createdCount, winRate, avgDeal }
    }))

    // Only return users with some activity
    const active = performance.filter(p => p.createdCount > 0 || p.wonCount > 0 || p.activeCount > 0)
    active.sort((a, b) => b.wonValue - a.wonValue)

    res.json({ success: true, data: active })
  } catch (err) { handleRouteError(err, res) }
})

// ─── AVAILABLE PERIODS ────────────────────────────────────────────────────────

router.get('/periods', requirePermission('reports:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ success: true, data: lastNQuarters(8) })
})

export default router
