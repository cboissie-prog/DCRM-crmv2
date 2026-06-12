import prisma from './prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AutomationTrigger =
  | 'TICKET_CREATED'
  | 'TICKET_RESOLVED'
  | 'TICKET_ASSIGNED'
  | 'TICKET_OVERDUE'
  | 'OPPORTUNITY_CREATED'
  | 'OPPORTUNITY_STAGE_CHANGED'
  | 'OPPORTUNITY_INACTIVE'
  | 'CONTRACT_EXPIRING'
  | 'LEAD_SCORE_THRESHOLD'

interface TicketCtx {
  id: string
  title: string
  ref?: string
  priority: string
  category: string
  status: string
  companyId?: string | null
  assignedToId?: string | null
  previousStage?: string
}

interface OpportunityCtx {
  id: string
  title: string
  stage: string
  previousStage?: string
  value: number
  companyId?: string | null
  assignedToId?: string | null
}

interface ContractCtx {
  id: string
  title?: string
  endDate: Date
  companyId?: string | null
}

interface LeadCtx {
  id: string
  contactId?: string | null
  score: number
}

export interface AutomationContext {
  triggeredBy?: string
  ticket?: TicketCtx
  opportunity?: OpportunityCtx
  contract?: ContractCtx
  lead?: LeadCtx
}

interface Condition {
  priority?:         string | string[]
  category?:         string | string[]
  toStage?:          string
  fromStage?:        string
  hoursOpen?:        number
  inactiveDays?:     number
  daysBeforeExpiry?: number
  minScore?:         number
  renotifyHours?:    number
}

interface Action {
  type:   'NOTIFY_USER' | 'NOTIFY_ROLE' | 'CREATE_ACTIVITY' | 'CHANGE_TICKET_STATUS' | 'CHANGE_TICKET_PRIORITY'
  params: Record<string, unknown>
}

// ─── Condition checker ────────────────────────────────────────────────────────

function matchesConditions(conditions: Condition, ctx: AutomationContext): boolean {
  const t = ctx.ticket
  const o = ctx.opportunity

  if (conditions.priority && t) {
    const allowed = Array.isArray(conditions.priority) ? conditions.priority : [conditions.priority]
    if (!allowed.includes(t.priority)) return false
  }

  if (conditions.category && t) {
    const allowed = Array.isArray(conditions.category) ? conditions.category : [conditions.category]
    if (!allowed.includes(t.category)) return false
  }

  if (conditions.toStage && o) {
    if (o.stage !== conditions.toStage) return false
  }

  if (conditions.fromStage && o) {
    if (o.previousStage !== conditions.fromStage) return false
  }

  if (conditions.minScore !== undefined && ctx.lead) {
    if (ctx.lead.score < conditions.minScore) return false
  }

  return true
}

// ─── Action executors ─────────────────────────────────────────────────────────

async function execAction(action: Action, ctx: AutomationContext): Promise<void> {
  switch (action.type) {

    case 'NOTIFY_USER': {
      const target = action.params.target as string | undefined
      const message = (action.params.message as string | undefined) || buildDefaultMessage(ctx)
      const title   = buildNotifTitle(ctx)
      const link    = buildLink(ctx)
      const userIds: string[] = []

      if (target === 'assignee') {
        const id = ctx.ticket?.assignedToId ?? ctx.opportunity?.assignedToId
        if (id) userIds.push(id)
      } else if (target === 'creator' && ctx.triggeredBy) {
        userIds.push(ctx.triggeredBy)
      } else if (target === 'role') {
        const role = action.params.role as string
        if (role) {
          const users = await prisma.user.findMany({ where: { role, isActive: true }, select: { id: true } })
          userIds.push(...users.map(u => u.id))
        }
      } else if (target === 'specific' && action.params.userId) {
        userIds.push(action.params.userId as string)
      }

      if (userIds.length > 0) {
        await prisma.notification.createMany({
          data: userIds.map(userId => ({
            userId,
            type: 'AUTOMATION_TRIGGERED',
            title,
            message,
            link,
          })),
        })
      }
      break
    }

    case 'NOTIFY_ROLE': {
      const role = action.params.role as string
      if (!role) break
      const message = (action.params.message as string | undefined) || buildDefaultMessage(ctx)
      const title   = buildNotifTitle(ctx)
      const link    = buildLink(ctx)
      const users   = await prisma.user.findMany({ where: { role, isActive: true }, select: { id: true } })
      if (users.length > 0) {
        await prisma.notification.createMany({
          data: users.map(u => ({ userId: u.id, type: 'AUTOMATION_TRIGGERED', title, message, link })),
        })
      }
      break
    }

    case 'CREATE_ACTIVITY': {
      const companyId = ctx.ticket?.companyId ?? ctx.opportunity?.companyId
      if (!companyId) break
      const title = (action.params.title as string | undefined) || buildDefaultMessage(ctx)
      const type  = (action.params.type as string | undefined) || 'NOTE'
      await prisma.activity.create({
        data: {
          title,
          type,
          companyId,
          userId: ctx.triggeredBy ?? undefined,
        },
      })
      break
    }

    case 'CHANGE_TICKET_STATUS': {
      if (!ctx.ticket) break
      const status = action.params.status as string
      if (!status) break
      const data: Record<string, unknown> = { status }
      if (status === 'RESOLVED') data.resolvedAt = new Date()
      if (status === 'CLOSED')   data.closedAt   = new Date()
      await prisma.ticket.update({
        where: { id: ctx.ticket.id },
        data: data as Parameters<typeof prisma.ticket.update>[0]['data'],
      })
      break
    }

    case 'CHANGE_TICKET_PRIORITY': {
      if (!ctx.ticket) break
      const priority = action.params.priority as string
      if (!priority) break
      await prisma.ticket.update({ where: { id: ctx.ticket.id }, data: { priority } })
      break
    }
  }
}

// ─── Message helpers ──────────────────────────────────────────────────────────

function buildNotifTitle(ctx: AutomationContext): string {
  if (ctx.ticket)      return `Ticket : ${ctx.ticket.title}`
  if (ctx.opportunity) return `Opportunité : ${ctx.opportunity.title}`
  if (ctx.contract)    return 'Contrat expirant bientôt'
  if (ctx.lead)        return `Lead : score ${ctx.lead.score}`
  return 'Automatisation déclenchée'
}

function buildDefaultMessage(ctx: AutomationContext): string {
  if (ctx.ticket)      return `Le ticket "${ctx.ticket.title}" a déclenché une automatisation.`
  if (ctx.opportunity) return `L'opportunité "${ctx.opportunity.title}" a déclenché une automatisation.`
  if (ctx.contract)    return 'Un contrat expire bientôt et a déclenché une automatisation.'
  if (ctx.lead)        return `Un lead a atteint un score de ${ctx.lead.score}.`
  return 'Une automatisation a été déclenchée.'
}

function buildLink(ctx: AutomationContext): string {
  if (ctx.ticket)      return `/tickets/${ctx.ticket.id}`
  if (ctx.opportunity) return `/pipeline`
  if (ctx.lead)        return `/leads`
  return '/'
}

// ─── Main fire function ───────────────────────────────────────────────────────

export async function fireAutomations(trigger: AutomationTrigger, ctx: AutomationContext): Promise<void> {
  try {
    const automations = await prisma.automation.findMany({
      where: { trigger, isActive: true },
    })

    for (const automation of automations) {
      let success = true
      let result  = 'OK'

      try {
        const conditions: Condition = automation.conditions ? JSON.parse(automation.conditions) : {}
        if (!matchesConditions(conditions, ctx)) continue

        const actions: Action[] = automation.actions ? JSON.parse(automation.actions) : []
        for (const action of actions) {
          await execAction(action, ctx)
        }
      } catch (err) {
        success = false
        result  = err instanceof Error ? err.message : 'Erreur inconnue'
        console.error(`[Automation] ${automation.name} failed:`, err)
      }

      // Log the run
      await prisma.automationLog.create({
        data: {
          automationId: automation.id,
          triggeredBy:  trigger,
          userId:       ctx.triggeredBy ?? null,
          result,
          success,
        },
      }).catch(console.error)
    }
  } catch (err) {
    console.error('[AutomationEngine] Error fetching automations:', err)
  }
}

// ─── Scheduled checks ────────────────────────────────────────────────────────

/** Tickets open for more than N hours without update → TICKET_OVERDUE */
export async function runOverdueTickets(): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { trigger: 'TICKET_OVERDUE', isActive: true },
  })
  if (automations.length === 0) return 0

  let fired = 0
  for (const automation of automations) {
    const conditions: Condition = automation.conditions ? JSON.parse(automation.conditions) : {}
    const hoursOpen = conditions.hoursOpen ?? 24
    const threshold = new Date(Date.now() - hoursOpen * 60 * 60 * 1000)

    const tickets = await prisma.ticket.findMany({
      where: {
        status: { in: ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT'] },
        updatedAt: { lt: threshold },
      },
      take: 50,
    })

    const renotifyHours = conditions.renotifyHours ?? 24
    for (const ticket of tickets) {
      // Avoid duplicate logs within renotifyHours (default 24 h)
      const recent = await prisma.automationLog.findFirst({
        where: {
          automationId: automation.id,
          triggeredBy:  'TICKET_OVERDUE',
          createdAt:    { gt: new Date(Date.now() - renotifyHours * 60 * 60 * 1000) },
          result:       { contains: ticket.id },
        },
      })
      if (recent) continue

      let success = true
      let result  = ticket.id
      try {
        const actions: Action[] = automation.actions ? JSON.parse(automation.actions) : []
        for (const action of actions) {
          await execAction(action, {
            ticket: {
              id: ticket.id, title: ticket.title,
              priority: ticket.priority, category: ticket.category,
              status: ticket.status, companyId: ticket.companyId,
              assignedToId: ticket.assignedToId,
            },
          })
        }
        fired++
      } catch (err) {
        success = false
        result  = err instanceof Error ? err.message : 'Erreur'
      }

      await prisma.automationLog.create({
        data: { automationId: automation.id, triggeredBy: 'TICKET_OVERDUE', result, success },
      }).catch(console.error)
    }
  }
  return fired
}

/** Opportunities without activity for N days → OPPORTUNITY_INACTIVE */
export async function runOpportunityInactive(): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { trigger: 'OPPORTUNITY_INACTIVE', isActive: true },
  })
  if (automations.length === 0) return 0

  let fired = 0
  for (const automation of automations) {
    const conditions: Condition = automation.conditions ? JSON.parse(automation.conditions) : {}
    const inactiveDays = conditions.inactiveDays ?? 15
    const threshold = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000)

    // Récupère les stages terminaux dynamiquement (isWon ou isLost)
    const terminalStages = await prisma.pipelineStage.findMany({
      where: { OR: [{ isWon: true }, { isLost: true }] },
      select: { key: true },
    })
    // Déduplique et ajoute les valeurs statiques par sécurité (anciens enregistrements)
    const terminalKeys = [...new Set([
      ...terminalStages.map(s => s.key),
      'WON',
      'LOST',
    ])]

    const opps = await prisma.opportunity.findMany({
      where: {
        stage: { notIn: terminalKeys },
        updatedAt: { lt: threshold },
      },
      take: 50,
    })

    for (const opp of opps) {
      const recent = await prisma.automationLog.findFirst({
        where: {
          automationId: automation.id,
          triggeredBy:  'OPPORTUNITY_INACTIVE',
          createdAt:    { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          result:       { contains: opp.id },
        },
      })
      if (recent) continue

      let success = true
      let result  = opp.id
      try {
        const actions: Action[] = automation.actions ? JSON.parse(automation.actions) : []
        for (const action of actions) {
          await execAction(action, {
            opportunity: {
              id: opp.id, title: opp.title, stage: opp.stage,
              value: opp.value, companyId: opp.companyId, assignedToId: opp.assignedToId,
            },
          })
        }
        fired++
      } catch (err) {
        success = false
        result  = err instanceof Error ? err.message : 'Erreur'
      }

      await prisma.automationLog.create({
        data: { automationId: automation.id, triggeredBy: 'OPPORTUNITY_INACTIVE', result, success },
      }).catch(console.error)
    }
  }
  return fired
}

/** Contracts expiring in N days → CONTRACT_EXPIRING */
export async function runContractExpiring(): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { trigger: 'CONTRACT_EXPIRING', isActive: true },
  })
  if (automations.length === 0) return 0

  let fired = 0
  for (const automation of automations) {
    const conditions: Condition = automation.conditions ? JSON.parse(automation.conditions) : {}
    const daysBeforeExpiry = conditions.daysBeforeExpiry ?? 30
    const now       = new Date()
    const threshold = new Date(now.getTime() + daysBeforeExpiry * 24 * 60 * 60 * 1000)

    const contracts = await prisma.contract.findMany({
      where: {
        status: { in: ['ACTIVE', 'EXPIRING_SOON'] },
        endDate: { gte: now, lte: threshold },
      },
      take: 50,
    })

    for (const contract of contracts) {
      const recent = await prisma.automationLog.findFirst({
        where: {
          automationId: automation.id,
          triggeredBy:  'CONTRACT_EXPIRING',
          createdAt:    { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          result:       { contains: contract.id },
        },
      })
      if (recent) continue

      let success = true
      let result  = contract.id
      try {
        const actions: Action[] = automation.actions ? JSON.parse(automation.actions) : []
        for (const action of actions) {
          await execAction(action, {
            contract: { id: contract.id, endDate: contract.endDate, companyId: contract.companyId },
          })
        }
        fired++
      } catch (err) {
        success = false
        result  = err instanceof Error ? err.message : 'Erreur'
      }

      await prisma.automationLog.create({
        data: { automationId: automation.id, triggeredBy: 'CONTRACT_EXPIRING', result, success },
      }).catch(console.error)
    }
  }
  return fired
}
