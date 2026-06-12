import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'

const router = Router()
router.use(authenticate)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
}

function parsePeriod(period: string): { start: Date; end: Date } {
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

const userSelect = { id: true, firstName: true, lastName: true, avatar: true, role: true }

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  userId:  z.string().min(1),
  period:  z.string().regex(/^\d{4}-Q[1-4]$|^\d{4}-\d{2}$/, 'Format: 2026-Q1 ou 2026-01'),
  target:  z.number().positive('Objectif doit être positif'),
  actual:  z.number().min(0).optional(),
})

const updateSchema = z.object({
  target: z.number().positive().optional(),
  actual: z.number().min(0).optional(),
})

// ─── GET /targets?period=2026-Q2 ──────────────────────────────────────────────

router.get('/', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const period = (req.query.period as string) || currentPeriod()

    // COMMERCIAL voit uniquement ses propres objectifs
    const where: Record<string, unknown> = { period }
    const authUser = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } })
    if (authUser?.role === 'COMMERCIAL') where.userId = req.userId

    const targets = await prisma.salesTarget.findMany({
      where,
      include: { user: { select: userSelect } },
      orderBy: { createdAt: 'asc' },
    })

    res.json({ success: true, data: targets, meta: { period } })
  } catch (err) { handleRouteError(err, res) }
})

// ─── GET /targets/forecast ────────────────────────────────────────────────────

router.get('/forecast', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const period = (req.query.period as string) || currentPeriod()
    const { start, end } = parsePeriod(period)

    const [openOpps, wonOpps] = await Promise.all([
      prisma.opportunity.findMany({
        where: { stage: { notIn: ['WON', 'LOST'] } },
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          company:    { select: { id: true, name: true } },
        },
        orderBy: { value: 'desc' },
      }),
      prisma.opportunity.findMany({
        where: { stage: 'WON', closedAt: { gte: start, lte: end } },
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ])

    // Summary
    const weightedTotal = openOpps.reduce((s, o) => s + o.value * o.probability / 100, 0)
    const rawTotal      = openOpps.reduce((s, o) => s + o.value, 0)
    const wonTotal      = wonOpps.reduce((s, o) => s + o.value, 0)

    // By stage
    const stageMap = new Map<string, { stage: string; count: number; rawValue: number; weightedValue: number; probability: number }>()
    for (const o of openOpps) {
      const s = stageMap.get(o.stage) ?? { stage: o.stage, count: 0, rawValue: 0, weightedValue: 0, probability: o.probability }
      s.count++
      s.rawValue      += o.value
      s.weightedValue += o.value * o.probability / 100
      stageMap.set(o.stage, s)
    }
    const byStage = [...stageMap.values()]

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

    // Top opportunities (prob ≥ 50, sorted by weighted desc)
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

// ─── POST /targets ────────────────────────────────────────────────────────────

router.post('/', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body)
    // Upsert par userId + period
    const existing = await prisma.salesTarget.findFirst({ where: { userId: body.userId, period: body.period } })
    let target
    if (existing) {
      target = await prisma.salesTarget.update({
        where: { id: existing.id },
        data: { target: body.target, ...(body.actual !== undefined ? { actual: body.actual } : {}) },
        include: { user: { select: userSelect } },
      })
    } else {
      target = await prisma.salesTarget.create({
        data: { userId: body.userId, period: body.period, target: body.target, actual: body.actual ?? 0 },
        include: { user: { select: userSelect } },
      })
    }
    res.status(201).json({ success: true, data: target })
  } catch (err) { handleRouteError(err, res) }
})

// ─── PUT /targets/:id ─────────────────────────────────────────────────────────

router.put('/:id', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body   = updateSchema.parse(req.body)
    const id     = req.params.id as string
    const target = await prisma.salesTarget.update({
      where: { id },
      data:  body,
      include: { user: { select: userSelect } },
    })
    res.json({ success: true, data: target })
  } catch (err) { handleRouteError(err, res) }
})

// ─── DELETE /targets/:id ──────────────────────────────────────────────────────

router.delete('/:id', requirePermission('reports:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.salesTarget.delete({ where: { id: req.params.id as string } })
    res.json({ success: true })
  } catch (err) { handleRouteError(err, res) }
})

export default router
