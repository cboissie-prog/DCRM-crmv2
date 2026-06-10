import { Router, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { fireAutomations } from '../automation-engine'

const router = Router()
router.use(authenticate)

async function generateTicketRef(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.ticket.count()
  const year = new Date().getFullYear()
  return `TKT-${year}-${String(count + 1).padStart(4, '0')}`
}

const ticketSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string(),
  priority: z.string().optional(),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  contractId: z.string().optional(),
  equipmentId: z.string().optional(),
  assignedToId: z.string().optional(),
  callId: z.string().optional(),
  notes: z.string().optional(),
})

router.get('/', requirePermission('tickets:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, status, priority, category, assignedToId, companyId, page, limit } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25))
    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (priority) where.priority = priority
    if (category) where.category = category
    if (assignedToId) where.assignedToId = assignedToId
    if (companyId) where.companyId = companyId
    if (search) where.OR = [
      { title: { contains: search } },
      { reference: { contains: search } },
      { description: { contains: search } },
    ]
    const [total, tickets] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where, skip: (pageNum - 1) * limitNum, take: limitNum,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
          company: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          equipment: { select: { id: true, type: true, brand: true, model: true } },
          _count: { select: { comments: true } },
        },
      }),
    ])
    res.json({ success: true, data: tickets, meta: { total, page: pageNum, limit: limitNum } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.post('/', requirePermission('tickets:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = ticketSchema.parse(req.body)
    const ticket = await prisma.$transaction(async (tx) => {
      const reference = await generateTicketRef(tx)
      return tx.ticket.create({
        data: { ...body, reference, createdById: req.userId },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
          company: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    })
    // Fire automations (non-blocking)
    fireAutomations('TICKET_CREATED', {
      triggeredBy: req.userId,
      ticket: { id: ticket.id, title: ticket.title, ref: ticket.reference, priority: ticket.priority, category: ticket.category, status: ticket.status, companyId: ticket.companyId, assignedToId: ticket.assignedToId },
    }).catch(console.error)
    res.status(201).json({ success: true, data: ticket })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// GET /tickets/export/csv
router.get('/export/csv', requirePermission('tickets:export'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, priority, category } = req.query as Record<string, string>
    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (priority) where.priority = priority
    if (category) where.category = category
    const tickets = await prisma.ticket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        contact: { select: { firstName: true, lastName: true } },
        company: { select: { name: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    })
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = ['Référence', 'Titre', 'Statut', 'Priorité', 'Catégorie', 'Contact', 'Entreprise', 'Assigné à', 'Créé le']
    const rows = tickets.map(t => [
      escape(t.reference), escape(t.title), escape(t.status), escape(t.priority), escape(t.category),
      t.contact ? escape(`${t.contact.firstName} ${t.contact.lastName}`) : '',
      escape(t.company?.name),
      t.assignedTo ? escape(`${t.assignedTo.firstName} ${t.assignedTo.lastName}`) : '',
      escape(new Date(t.createdAt).toLocaleDateString('fr-FR')),
    ].join(','))
    const csv = [header.join(','), ...rows].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="tickets-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send('\uFEFF' + csv)
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.get('/:id', requirePermission('tickets:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: {
        contact: true,
        company: true,
        contract: true,
        equipment: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        comments: { orderBy: { createdAt: 'asc' } },
        npsResponse: true,
      },
    })
    if (!ticket) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket introuvable' } }); return }
    res.json({ success: true, data: ticket })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.put('/:id', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = ticketSchema.partial().parse(req.body)
    const data: Record<string, unknown> = { ...body }
    let previousAssignedToId: string | null = null
    if (body.assignedToId !== undefined) {
      const current = await prisma.ticket.findUnique({ where: { id: req.params.id } })
      previousAssignedToId = current?.assignedToId ?? null
      if (current?.status === 'NEW' && body.assignedToId) data.status = 'IN_PROGRESS'
    }
    const ticket = await prisma.ticket.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.ticket.update>[0]['data'] })
    if (body.assignedToId && body.assignedToId !== previousAssignedToId) {
      fireAutomations('TICKET_ASSIGNED', {
        triggeredBy: req.userId,
        ticket: { id: ticket.id, title: ticket.title, priority: ticket.priority, category: ticket.category, status: ticket.status, companyId: ticket.companyId, assignedToId: ticket.assignedToId },
      }).catch(console.error)
    }
    res.json({ success: true, data: ticket })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }); return }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

router.patch('/:id/status', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, timeSpent } = req.body
    const data: Record<string, unknown> = { status }
    if (timeSpent !== undefined) data.timeSpent = timeSpent
    if (status === 'RESOLVED') data.resolvedAt = new Date()
    if (status === 'CLOSED') data.closedAt = new Date()
    const ticket = await prisma.ticket.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.ticket.update>[0]['data'] })
    if (status === 'RESOLVED' || status === 'CLOSED') {
      fireAutomations('TICKET_RESOLVED', {
        triggeredBy: req.userId,
        ticket: { id: ticket.id, title: ticket.title, priority: ticket.priority, category: ticket.category, status: ticket.status, companyId: ticket.companyId, assignedToId: ticket.assignedToId },
      }).catch(console.error)
    }
    res.json({ success: true, data: ticket })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.post('/:id/comments', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { content, isInternal, authorName } = req.body
    const comment = await prisma.ticketComment.create({ data: { ticketId: req.params.id, content, isInternal: isInternal || false, authorName } })
    res.status(201).json({ success: true, data: comment })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.patch('/:id/time', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { minutes } = req.body
    const ticket = await prisma.ticket.update({ where: { id: req.params.id }, data: { timeSpent: { increment: minutes } } })
    res.json({ success: true, data: ticket })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.delete('/:id', requirePermission('tickets:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.ticket.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: { message: 'Ticket supprimé' } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

export default router
