import { Router, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { ciContains } from '../lib/query'
import { fireAutomations } from '../automation-engine'
import { csvEscape } from '../lib/csv'
import { sendTicketClosedEmail } from '../services/mailer'

const router = Router()
router.use(authenticate)

async function generateTicketRef(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.ticket.count()
  const year = new Date().getFullYear()
  return `TKT-${year}-${String(count + 1).padStart(4, '0')}`
}

/** Statuts et priorités reconnus — miroir de TICKET_STATUSES / TICKET_PRIORITIES côté client. */
const TICKET_STATUS = ['NEW', 'IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED'] as const
const TICKET_PRIORITY = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const

const ticketSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string(),
  priority: z.enum(TICKET_PRIORITY).optional(),
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
    const { search, priority, category, assignedToId, companyId, page, limit } = req.query as Record<string, string>
    // status peut être une valeur simple ou un tableau (multi-sélection) : ?status=x&status=y
    const rawStatus = req.query.status
    const statusValues: string[] = Array.isArray(rawStatus)
      ? (rawStatus as string[]).filter(Boolean)
      : rawStatus ? [rawStatus as string] : []
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25))
    const where: Record<string, unknown> = {}
    if (statusValues.length > 1) where.status = { in: statusValues }
    else if (statusValues.length === 1) where.status = statusValues[0]
    if (priority) where.priority = priority
    if (category) where.category = category
    if (assignedToId) where.assignedToId = assignedToId
    if (companyId) where.companyId = companyId
    if (search) where.OR = [
      { title: ciContains(search) },
      { reference: ciContains(search) },
      { description: ciContains(search) },
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
  } catch (err) { handleRouteError(err, res) }
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
  } catch (err) { handleRouteError(err, res) }
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
    const header = ['Référence', 'Titre', 'Statut', 'Priorité', 'Catégorie', 'Contact', 'Entreprise', 'Assigné à', 'Créé le']
    const rows = tickets.map(t => [
      csvEscape(t.reference), csvEscape(t.title), csvEscape(t.status), csvEscape(t.priority), csvEscape(t.category),
      t.contact ? csvEscape(`${t.contact.firstName} ${t.contact.lastName}`) : '',
      csvEscape(t.company?.name),
      t.assignedTo ? csvEscape(`${t.assignedTo.firstName} ${t.assignedTo.lastName}`) : '',
      csvEscape(new Date(t.createdAt).toLocaleDateString('fr-FR')),
    ].join(','))
    const csv = [header.join(','), ...rows].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="tickets-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send('﻿' + csv)
  } catch (err) { handleRouteError(err, res) }
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
  } catch (err) { handleRouteError(err, res) }
})

router.put('/:id', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = ticketSchema.partial().parse(req.body)
    const data: Record<string, unknown> = { ...body }
    const current = await prisma.ticket.findUnique({ where: { id: req.params.id } })
    const previousAssignedToId = current?.assignedToId ?? null
    const previousStatus = current?.status ?? null
    if (body.assignedToId !== undefined && current?.status === 'NEW' && body.assignedToId) data.status = 'IN_PROGRESS'
    // resolvedAt / closedAt cohérents lors des transitions de statut
    if (data.status === 'RESOLVED' && previousStatus !== 'RESOLVED') data.resolvedAt = new Date()
    if (data.status === 'CLOSED' && previousStatus !== 'CLOSED') data.closedAt = new Date()
    const ticket = await prisma.ticket.update({
      where: { id: req.params.id },
      data: data as Parameters<typeof prisma.ticket.update>[0]['data'],
      include: {
        contact: { select: { email: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    })
    if (body.assignedToId && body.assignedToId !== previousAssignedToId) {
      fireAutomations('TICKET_ASSIGNED', {
        triggeredBy: req.userId,
        ticket: { id: ticket.id, title: ticket.title, priority: ticket.priority, category: ticket.category, status: ticket.status, companyId: ticket.companyId, assignedToId: ticket.assignedToId },
      }).catch(console.error)
    }
    // Email de clôture automatique (best-effort — ne bloque pas la réponse)
    if (ticket.status === 'CLOSED' && previousStatus !== 'CLOSED' && ticket.contact?.email) {
      const technicien = ticket.assignedTo ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}` : undefined
      sendTicketClosedEmail({
        to: ticket.contact.email,
        reference: ticket.reference,
        title: ticket.title,
        technicien,
        timeSpent: ticket.timeSpent,
        status: ticket.status,
      }).catch(console.error)
    }
    res.json({ success: true, data: ticket })
  } catch (err) { handleRouteError(err, res) }
})

router.patch('/:id/status', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Sans validation, n'importe quelle chaîne était écrite dans `status` : filtres, compteurs
    // et calcul de SLA cassaient sur un statut que l'application ne connaît pas.
    const { status, timeSpent } = z.object({
      status: z.enum(TICKET_STATUS),
      timeSpent: z.number().int().min(0).optional(),
    }).parse(req.body)
    const data: Record<string, unknown> = { status }
    if (timeSpent !== undefined) data.timeSpent = timeSpent
    if (status === 'RESOLVED') data.resolvedAt = new Date()
    if (status === 'CLOSED') data.closedAt = new Date()
    const ticket = await prisma.ticket.update({
      where: { id: req.params.id },
      data: data as Parameters<typeof prisma.ticket.update>[0]['data'],
      include: {
        contact: { select: { email: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    })
    if (status === 'RESOLVED' || status === 'CLOSED') {
      fireAutomations('TICKET_RESOLVED', {
        triggeredBy: req.userId,
        ticket: { id: ticket.id, title: ticket.title, priority: ticket.priority, category: ticket.category, status: ticket.status, companyId: ticket.companyId, assignedToId: ticket.assignedToId },
      }).catch(console.error)
    }
    // Email de clôture automatique (best-effort — ne bloque pas la réponse)
    if (status === 'CLOSED' && ticket.contact?.email) {
      const technicien = ticket.assignedTo ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}` : undefined
      sendTicketClosedEmail({
        to: ticket.contact.email,
        reference: ticket.reference,
        title: ticket.title,
        technicien,
        timeSpent: ticket.timeSpent,
        status: ticket.status,
      }).catch(console.error)
    }
    res.json({ success: true, data: ticket })
  } catch (err) { handleRouteError(err, res) }
})

router.post('/:id/comments', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { content, isInternal } = req.body
    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Le contenu du commentaire est requis' } })
      return
    }
    // Résoudre le nom de l'auteur depuis l'utilisateur authentifié (pas depuis le body client)
    let authorName = 'Inconnu'
    if (req.userId) {
      const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { firstName: true, lastName: true } })
      if (user) authorName = `${user.firstName} ${user.lastName}`.trim()
    }
    const comment = await prisma.ticketComment.create({
      data: { ticketId: req.params.id, content: content.trim(), isInternal: isInternal === true || isInternal === 'true', authorName },
    })
    res.status(201).json({ success: true, data: comment })
  } catch (err) { handleRouteError(err, res) }
})

router.patch('/:id/time', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // `increment` sans validation acceptait une valeur négative (qui décrémente le temps passé)
    // ou une chaîne (erreur Prisma en 500).
    const { minutes } = z.object({ minutes: z.number().int().min(0) }).parse(req.body)
    const ticket = await prisma.ticket.update({ where: { id: req.params.id }, data: { timeSpent: { increment: minutes } } })
    res.json({ success: true, data: ticket })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/:id', requirePermission('tickets:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.ticket.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: { message: 'Ticket supprimé' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
