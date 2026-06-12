import { Router, Response } from 'express'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'

const router = Router()
router.use(authenticate)

// GET /dashboard/today — récap journée de l'utilisateur connecté
router.get('/today', requirePermission('dashboard:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
    const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

    const [appointments, urgentTickets, overdueActivities] = await Promise.all([
      // RDV du jour auxquels l'utilisateur participe
      prisma.appointment.findMany({
        where: {
          startAt: { gte: startOfDay, lte: endOfDay },
          users: { some: { userId: req.userId! } },
        },
        include: {
          contacts: { include: { contact: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { startAt: 'asc' },
      }),

      // Tickets urgents/critiques assignés à l'utilisateur et ouverts
      prisma.ticket.findMany({
        where: {
          assignedToId: req.userId!,
          status: { in: ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT'] },
          priority: { in: ['HIGH', 'CRITICAL'] },
        },
        include: { company: { select: { name: true } } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        take: 10,
      }),

      // Activités assignées à l'utilisateur avec dueDate dépassée ou aujourd'hui
      prisma.activity.findMany({
        where: {
          userId: req.userId!,
          completedAt: null,
          dueDate: { lte: endOfDay },
        },
        include: {
          company: { select: { name: true } },
          contact: { select: { firstName: true, lastName: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
    ])

    res.json({
      success: true,
      data: { appointments, urgentTickets, overdueActivities },
    })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.get('/stats', requirePermission('dashboard:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0)
    const in60Days = new Date(); in60Days.setDate(now.getDate() + 60)

    const [
      totalContacts,
      newContactsThisMonth,
      totalCompanies,
      openTickets,
      criticalTickets,
      newTicketsThisMonth,
      activeContracts,
      expiringSoonContracts,
      openOpportunities,
      wonOpportunitiesThisMonth,
      licensesExpiringSoon,
      warrantyExpiringSoon,
      recentActivities,
      pipelineByStage,
      activeContractsList,
      pipelineValue,
      wonValueThisMonth,
      wonValueLastMonth,
    ] = await Promise.all([
      prisma.contact.count({ where: { isActive: true } }),
      prisma.contact.count({ where: { isActive: true, createdAt: { gte: startOfMonth } } }),
      prisma.company.count({ where: { isActive: true } }),
      prisma.ticket.count({ where: { status: { in: ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT'] } } }),
      prisma.ticket.count({ where: { status: { in: ['NEW', 'IN_PROGRESS'] }, priority: 'CRITICAL' } }),
      prisma.ticket.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.contract.count({ where: { status: 'ACTIVE' } }),
      prisma.contract.count({ where: { status: { in: ['ACTIVE', 'EXPIRING_SOON'] }, endDate: { lte: in60Days } } }),
      prisma.opportunity.count({ where: { stage: { notIn: ['WON', 'LOST'] } } }),
      prisma.opportunity.count({ where: { stage: 'WON', closedAt: { gte: startOfMonth } } }),
      prisma.license.count({ where: { expiryDate: { lte: in60Days, gte: now } } }),
      prisma.equipment.count({ where: { warrantyExpiry: { lte: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000), gte: now } } }),
      prisma.activity.findMany({
        orderBy: { createdAt: 'desc' }, take: 10,
        include: {
          user: { select: { firstName: true, lastName: true, avatar: true } },
          contact: { select: { firstName: true, lastName: true } },
          company: { select: { name: true } },
        },
      }),
      prisma.opportunity.groupBy({ by: ['stage'], _count: { id: true }, _sum: { value: true } }),
      prisma.contract.findMany({ where: { status: 'ACTIVE' }, select: { monthlyAmount: true, annualAmount: true } }),
      prisma.opportunity.aggregate({ where: { stage: { notIn: ['WON', 'LOST'] } }, _sum: { value: true } }),
      prisma.opportunity.aggregate({ where: { stage: 'WON', closedAt: { gte: startOfMonth } }, _sum: { value: true } }),
      prisma.opportunity.aggregate({ where: { stage: 'WON', closedAt: { gte: startOfLastMonth, lte: endOfLastMonth } }, _sum: { value: true } }),
    ])

    const mrr = activeContractsList.reduce((sum, c) => sum + (c.monthlyAmount || c.annualAmount / 12), 0)

    res.json({
      success: true,
      data: {
        contacts: { total: totalContacts, newThisMonth: newContactsThisMonth },
        companies: { total: totalCompanies },
        tickets: { open: openTickets, critical: criticalTickets, newThisMonth: newTicketsThisMonth },
        contracts: { active: activeContracts, expiringSoon: expiringSoonContracts },
        opportunities: {
          open: openOpportunities,
          wonThisMonth: wonOpportunitiesThisMonth,
          pipelineValue: pipelineValue._sum.value || 0,
          wonValueThisMonth: wonValueThisMonth._sum.value || 0,
          wonValueLastMonth: wonValueLastMonth._sum.value || 0,
        },
        mrr: Math.round(mrr * 100) / 100,
        arr: Math.round(mrr * 12 * 100) / 100,
        alerts: {
          licensesExpiringSoon,
          warrantyExpiringSoon,
          contractsExpiringSoon: expiringSoonContracts,
          criticalTickets,
        },
        pipeline: pipelineByStage,
        recentActivities,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.get('/revenue', requirePermission('dashboard:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const monthsRaw = parseInt((req.query.months as string) || '12')
    const months = Math.min(24, Math.max(1, isNaN(monthsRaw) ? 12 : monthsRaw))
    const now = new Date()
    const periods = Array.from({ length: months }, (_, i) => {
      const offset = months - 1 - i
      const start = new Date(now.getFullYear(), now.getMonth() - offset, 1)
      const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0)
      return {
        start, end,
        month: start.toISOString().slice(0, 7),
        label: start.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
      }
    })
    const results = await Promise.all(
      periods.map(p => prisma.opportunity.aggregate({
        where: { stage: 'WON', closedAt: { gte: p.start, lte: p.end } },
        _sum: { value: true },
      }))
    )
    const data = periods.map((p, i) => ({ month: p.month, label: p.label, value: results[i]._sum.value || 0 }))
    res.json({ success: true, data })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.get('/churn-risks', requirePermission('dashboard:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    const companies = await prisma.company.findMany({
      where: { isActive: true },
      include: {
        activities: { orderBy: { createdAt: 'desc' }, take: 1 },
        tickets: { where: { status: { in: ['NEW', 'IN_PROGRESS'] } }, orderBy: { createdAt: 'desc' }, take: 3 },
        contracts: { where: { status: 'ACTIVE' } },
      },
    })
    const risks = companies
      .map(company => {
        const lastActivity = company.activities[0]?.createdAt
        const daysSinceContact = lastActivity
          ? Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24))
          : 999
        const openTickets = company.tickets.length
        const hasActiveContract = company.contracts.length > 0
        let score = 0
        if (daysSinceContact > 90) score += 40
        else if (daysSinceContact > 60) score += 20
        else if (daysSinceContact > 30) score += 10
        if (openTickets >= 3) score += 30
        else if (openTickets >= 1) score += 10
        if (!hasActiveContract) score += 20
        return { company: { id: company.id, name: company.name, city: company.city }, score, daysSinceContact, openTickets, hasActiveContract }
      })
      .filter(r => r.score >= 30)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
    res.json({ success: true, data: risks })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.get('/nps', requirePermission('dashboard:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const responses = await prisma.npsResponse.findMany({ orderBy: { createdAt: 'desc' } })
    const total = responses.length
    if (total === 0) { res.json({ success: true, data: { score: 0, promoters: 0, passives: 0, detractors: 0, total: 0, responses: [] } }); return }
    const promoters = responses.filter(r => r.score >= 9).length
    const passives = responses.filter(r => r.score >= 7 && r.score <= 8).length
    const detractors = responses.filter(r => r.score <= 6).length
    const npsScore = Math.round(((promoters - detractors) / total) * 100)
    res.json({ success: true, data: { score: npsScore, promoters, passives, detractors, total, responses: responses.slice(0, 20) } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

export default router
