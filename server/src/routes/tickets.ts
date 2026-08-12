import { Router, Response } from 'express'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { Prisma } from '@prisma/client'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission, hasPermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { ciContains } from '../lib/query'
import { fireAutomations } from '../automation-engine'
import { csvEscape } from '../lib/csv'
import { audit } from '../lib/audit'
import logger from '../lib/logger'
import { sendTicketClosedEmail } from '../services/mailer'
import { signNpsToken } from '../lib/nps-token'
import {
  TICKET_STATUS, TICKET_PRIORITY,
  priorityOrderOf, computeSlaDeadline, generateTicketRef, statusTransitionData,
  logTicketEvent, notifyUsers, activeManagerIds,
} from '../lib/ticket-helpers'
import { ensureExists, fetchOrFail, ensureCompanyMatch } from '../lib/relationChecks'

const router = Router()
router.use(authenticate)

// ─── Upload des pièces jointes ───────────────────────────────────────────────

const uploadsDir = path.join(process.cwd(), 'uploads', 'tickets')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

const ALLOWED_ATTACHMENT_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip', 'application/x-zip-compressed',
])
const ALLOWED_ATTACHMENT_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.pdf', '.txt', '.csv', '.log',
  '.doc', '.docx', '.xls', '.xlsx', '.zip',
])

const attachmentStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  },
})

const attachmentFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()
  if (ALLOWED_ATTACHMENT_MIMES.has(file.mimetype) && ALLOWED_ATTACHMENT_EXTS.has(ext)) {
    cb(null, true)
  } else {
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file')
    ;(err as unknown as Record<string, string>)['customCode'] = 'INVALID_FILE_TYPE'
    cb(err)
  }
}

const attachmentUpload = multer({
  storage: attachmentStorage,
  fileFilter: attachmentFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
})

// ─── Schémas ─────────────────────────────────────────────────────────────────

const ticketSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string(),
  priority: z.enum(TICKET_PRIORITY).optional(),
  contactId: z.string().nullish(),
  companyId: z.string().nullish(),
  contractId: z.string().nullish(),
  equipmentId: z.string().nullish(),
  assignedToId: z.string().nullish(),
  callId: z.string().nullish(),
  notes: z.string().nullish(),
})

/** Colonnes autorisées pour le tri de la liste (priority → priorityOrder, cf. schema). */
const SORTABLE_COLUMNS: Record<string, string> = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  priority: 'priorityOrder',
  status: 'status',
  timeSpent: 'timeSpent',
  reference: 'reference',
  slaDeadline: 'slaDeadline',
}

/** Filtres communs liste + export CSV — status peut être répété (?status=x&status=y). */
function buildTicketWhere(req: AuthRequest): Record<string, unknown> {
  const { search, priority, category, assignedToId, companyId } = req.query as Record<string, string>
  const rawStatus = req.query.status
  const statusValues: string[] = Array.isArray(rawStatus)
    ? (rawStatus as string[]).filter(Boolean)
    : rawStatus ? [rawStatus as string] : []
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
  return where
}

/** Notifie le technicien nouvellement assigné (jamais l'auteur de l'action). */
async function notifyAssignment(ticket: { id: string; reference: string; title: string }, assigneeId: string, actorId?: string): Promise<void> {
  if (assigneeId === actorId) return
  await notifyUsers([assigneeId], {
    type: 'TICKET_ASSIGNED',
    title: 'Ticket assigné',
    message: `${ticket.reference} vous a été assigné : ${ticket.title}`,
    link: `/tickets/${ticket.id}`,
  })
}

// ─── Liste ───────────────────────────────────────────────────────────────────

router.get('/', requirePermission('tickets:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, sortBy, sortOrder } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25))
    const where = buildTicketWhere(req)
    const sortColumn = SORTABLE_COLUMNS[sortBy]
    const direction = sortOrder === 'asc' ? 'asc' as const : 'desc' as const
    const orderBy = sortColumn
      ? [{ [sortColumn]: direction }, { createdAt: 'desc' as const }]
      : [{ priorityOrder: 'desc' as const }, { createdAt: 'desc' as const }]
    const [total, tickets] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where, skip: (pageNum - 1) * limitNum, take: limitNum,
        orderBy,
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
          company: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          equipment: { select: { id: true, type: true, brand: true, model: true } },
          _count: { select: { comments: true, attachments: true } },
        },
      }),
    ])
    res.json({ success: true, data: tickets, meta: { total, page: pageNum, limit: limitNum } })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Création ────────────────────────────────────────────────────────────────

router.post('/', requirePermission('tickets:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = ticketSchema.parse(req.body)
    if (body.assignedToId && body.assignedToId !== req.userId && !hasPermission(req, 'tickets:assign')) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Permission tickets:assign requise pour assigner un ticket à un autre utilisateur' } })
      return
    }

    // ── Cohérence inter-entités ─────────────────────────────────────────────
    const effectiveCompanyId = body.companyId ?? null
    if (body.contactId) {
      const contact = await fetchOrFail(res, body.contactId, 'CONTACT_NOT_FOUND', 'Contact introuvable', id => prisma.contact.findUnique({ where: { id }, select: { id: true, companyId: true } }))
      if (contact === null) return
      // Cohérence souple : ne bloque que si contact ET ticket ont chacun une société, et qu'elles diffèrent
      if (contact && !ensureCompanyMatch(res, contact.companyId, effectiveCompanyId, 'CONTACT_COMPANY_MISMATCH', 'Ce contact appartient à une autre entreprise')) return
    }
    if (body.companyId) {
      if (!await ensureExists(res, body.companyId, 'COMPANY_NOT_FOUND', 'Entreprise introuvable', id => prisma.company.findUnique({ where: { id }, select: { id: true } }))) return
    }
    if (body.contractId) {
      const contract = await fetchOrFail(res, body.contractId, 'CONTRACT_NOT_FOUND', 'Contrat introuvable', id => prisma.contract.findUnique({ where: { id }, select: { id: true, companyId: true } }))
      if (contract === null) return
      if (contract && !ensureCompanyMatch(res, contract.companyId, effectiveCompanyId, 'CONTRACT_COMPANY_MISMATCH', 'Ce contrat appartient à une autre entreprise')) return
    }
    if (body.equipmentId) {
      const equipment = await fetchOrFail(res, body.equipmentId, 'EQUIPMENT_NOT_FOUND', 'Équipement introuvable', id => prisma.equipment.findUnique({ where: { id }, select: { id: true, companyId: true } }))
      if (equipment === null) return
      if (equipment && !ensureCompanyMatch(res, equipment.companyId, effectiveCompanyId, 'EQUIPMENT_COMPANY_MISMATCH', 'Cet équipement appartient à une autre entreprise')) return
    }
    if (body.callId) {
      if (!await ensureExists(res, body.callId, 'CALL_NOT_FOUND', 'Appel introuvable', id => prisma.call.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const slaDeadline = await computeSlaDeadline(body.priority)
    let ticket
    // Retry si la référence générée entre en collision avec une création concurrente
    for (let attempt = 0; ; attempt++) {
      try {
        ticket = await prisma.$transaction(async (tx) => {
          const reference = await generateTicketRef(tx)
          return tx.ticket.create({
            data: {
              ...body,
              reference,
              priorityOrder: priorityOrderOf(body.priority),
              slaDeadline,
              createdById: req.userId,
            },
            include: {
              contact: { select: { id: true, firstName: true, lastName: true } },
              company: { select: { id: true, name: true } },
              assignedTo: { select: { id: true, firstName: true, lastName: true } },
            },
          })
        })
        break
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 2) continue
        throw err
      }
    }
    await logTicketEvent({ ticketId: ticket.id, type: 'CREATED', authorId: req.userId, toValue: ticket.status })
    if (ticket.assignedToId) await notifyAssignment(ticket, ticket.assignedToId, req.userId)
    if (ticket.priority === 'CRITICAL') {
      const managers = (await activeManagerIds()).filter(id => id !== req.userId)
      await notifyUsers(managers, {
        type: 'TICKET_URGENT',
        title: 'Ticket critique',
        message: `${ticket.reference} : ${ticket.title}`,
        link: `/tickets/${ticket.id}`,
      })
    }
    // Fire automations (non-blocking)
    fireAutomations('TICKET_CREATED', {
      triggeredBy: req.userId,
      ticket: { id: ticket.id, title: ticket.title, ref: ticket.reference, priority: ticket.priority, category: ticket.category, status: ticket.status, companyId: ticket.companyId, assignedToId: ticket.assignedToId },
    }).catch(console.error)
    res.status(201).json({ success: true, data: ticket })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Export CSV ──────────────────────────────────────────────────────────────

router.get('/export/csv', requirePermission('tickets:export'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Mêmes filtres que la liste : l'export correspond à ce que l'utilisateur voit
    const where = buildTicketWhere(req)
    const tickets = await prisma.ticket.findMany({
      where,
      orderBy: [{ priorityOrder: 'desc' }, { createdAt: 'desc' }],
      include: {
        contact: { select: { firstName: true, lastName: true } },
        company: { select: { name: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    })
    const header = ['Référence', 'Titre', 'Statut', 'Priorité', 'Catégorie', 'Contact', 'Entreprise', 'Assigné à', 'Temps (min)', 'Créé le']
    const rows = tickets.map(t => [
      csvEscape(t.reference), csvEscape(t.title), csvEscape(t.status), csvEscape(t.priority), csvEscape(t.category),
      t.contact ? csvEscape(`${t.contact.firstName} ${t.contact.lastName}`) : '',
      csvEscape(t.company?.name),
      t.assignedTo ? csvEscape(`${t.assignedTo.firstName} ${t.assignedTo.lastName}`) : '',
      csvEscape(t.timeSpent),
      csvEscape(new Date(t.createdAt).toLocaleDateString('fr-FR')),
    ].join(','))
    const csv = [header.join(','), ...rows].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="tickets-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send('﻿' + csv)
  } catch (err) { handleRouteError(err, res) }
})

// ─── Détail ──────────────────────────────────────────────────────────────────

router.get('/:id', requirePermission('tickets:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [ticket, appointments] = await Promise.all([
      prisma.ticket.findUnique({
        where: { id: req.params.id },
        include: {
          contact: true,
          company: true,
          contract: true,
          equipment: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          comments: { orderBy: { createdAt: 'asc' } },
          events: { orderBy: { createdAt: 'desc' }, include: { author: { select: { id: true, firstName: true, lastName: true } } } },
          timeEntries: { orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, firstName: true, lastName: true } } } },
          attachments: { orderBy: { createdAt: 'desc' }, include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } } },
          npsResponse: true,
        },
      }),
      // Interventions liées (Appointment.ticketId — pas de relation Prisma côté Ticket)
      prisma.appointment.findMany({
        where: { ticketId: req.params.id },
        orderBy: { startAt: 'desc' },
        include: { users: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } },
      }),
    ])
    if (!ticket) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket introuvable' } }); return }
    res.json({ success: true, data: { ...ticket, appointments } })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Mise à jour ─────────────────────────────────────────────────────────────

router.put('/:id', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = ticketSchema.partial().parse(req.body)
    const current = await prisma.ticket.findUnique({ where: { id: req.params.id } })
    if (!current) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket introuvable' } }); return }

    // ── Cohérence inter-entités ─────────────────────────────────────────────
    // companyId « effectif » = celui du body s'il est fourni, sinon celui déjà en base.
    // Les relations non modifiées sont re-résolues depuis `current` : un changement de
    // companyId seul doit rester cohérent avec le contact/contrat/équipement déjà lié.
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
    const effectiveContractId = body.contractId !== undefined ? (body.contractId || null) : current.contractId
    if (effectiveContractId) {
      const contract = await fetchOrFail(res, effectiveContractId, 'CONTRACT_NOT_FOUND', 'Contrat introuvable', id => prisma.contract.findUnique({ where: { id }, select: { id: true, companyId: true } }))
      if (contract === null) return
      if (contract && !ensureCompanyMatch(res, contract.companyId, effectiveCompanyId, 'CONTRACT_COMPANY_MISMATCH', 'Ce contrat appartient à une autre entreprise')) return
    }
    const effectiveEquipmentId = body.equipmentId !== undefined ? (body.equipmentId || null) : current.equipmentId
    if (effectiveEquipmentId) {
      const equipment = await fetchOrFail(res, effectiveEquipmentId, 'EQUIPMENT_NOT_FOUND', 'Équipement introuvable', id => prisma.equipment.findUnique({ where: { id }, select: { id: true, companyId: true } }))
      if (equipment === null) return
      if (equipment && !ensureCompanyMatch(res, equipment.companyId, effectiveCompanyId, 'EQUIPMENT_COMPANY_MISMATCH', 'Cet équipement appartient à une autre entreprise')) return
    }
    if (body.callId !== undefined && body.callId) {
      if (!await ensureExists(res, body.callId, 'CALL_NOT_FOUND', 'Appel introuvable', id => prisma.call.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const newAssignee = body.assignedToId !== undefined ? (body.assignedToId || null) : undefined
    const assignmentChanged = newAssignee !== undefined && newAssignee !== current.assignedToId
    if (assignmentChanged) {
      // Sans tickets:assign, on peut seulement se prendre le ticket ou se désassigner soi-même
      const selfAssign = newAssignee === req.userId
      const selfRelease = newAssignee === null && current.assignedToId === req.userId
      if (!hasPermission(req, 'tickets:assign') && !selfAssign && !selfRelease) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Permission tickets:assign requise pour assigner un ticket à un autre utilisateur' } })
        return
      }
    }

    const data: Record<string, unknown> = { ...body }
    const priorityChanged = body.priority !== undefined && body.priority !== current.priority
    if (priorityChanged) {
      data.priorityOrder = priorityOrderOf(body.priority)
      // L'échéance SLA reste ancrée sur la date de création du ticket
      data.slaDeadline = await computeSlaDeadline(body.priority, current.createdAt)
    }
    if (assignmentChanged && newAssignee && current.status === 'NEW') data.status = 'IN_PROGRESS'

    const ticket = await prisma.ticket.update({
      where: { id: req.params.id },
      data: data as Parameters<typeof prisma.ticket.update>[0]['data'],
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    })

    if (priorityChanged) {
      await logTicketEvent({ ticketId: ticket.id, type: 'PRIORITY_CHANGED', authorId: req.userId, fromValue: current.priority, toValue: ticket.priority })
    }
    if (data.status && data.status !== current.status) {
      await logTicketEvent({ ticketId: ticket.id, type: 'STATUS_CHANGED', authorId: req.userId, fromValue: current.status, toValue: String(data.status) })
    }
    if (assignmentChanged) {
      if (newAssignee) {
        const name = ticket.assignedTo ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}` : newAssignee
        await logTicketEvent({ ticketId: ticket.id, type: 'ASSIGNED', authorId: req.userId, toValue: name })
        await notifyAssignment(ticket, newAssignee, req.userId)
        fireAutomations('TICKET_ASSIGNED', {
          triggeredBy: req.userId,
          ticket: { id: ticket.id, title: ticket.title, priority: ticket.priority, category: ticket.category, status: ticket.status, companyId: ticket.companyId, assignedToId: ticket.assignedToId },
        }).catch(console.error)
      } else {
        await logTicketEvent({ ticketId: ticket.id, type: 'UNASSIGNED', authorId: req.userId })
      }
    }
    res.json({ success: true, data: ticket })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Changement de statut ────────────────────────────────────────────────────

router.patch('/:id/status', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Sans validation, n'importe quelle chaîne était écrite dans `status` : filtres, compteurs
    // et calcul de SLA cassaient sur un statut que l'application ne connaît pas.
    const { status, timeSpent } = z.object({
      status: z.enum(TICKET_STATUS),
      timeSpent: z.number().int().min(0).optional(),
    }).parse(req.body)
    const current = await prisma.ticket.findUnique({ where: { id: req.params.id } })
    if (!current) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket introuvable' } }); return }

    // Idempotent : re-poser le même statut ne renvoie ni email ni automatisation
    if (current.status === status && timeSpent === undefined) {
      res.json({ success: true, data: current })
      return
    }

    const { data, reopened } = statusTransitionData(current.status, status)
    if (timeSpent !== undefined) data.timeSpent = timeSpent
    const ticket = await prisma.ticket.update({
      where: { id: req.params.id },
      data: data as Parameters<typeof prisma.ticket.update>[0]['data'],
      include: {
        contact: { select: { email: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    })

    const statusChanged = current.status !== status
    if (statusChanged) {
      await logTicketEvent({ ticketId: ticket.id, type: reopened ? 'REOPENED' : 'STATUS_CHANGED', authorId: req.userId, fromValue: current.status, toValue: status })
    }
    if (statusChanged && (status === 'RESOLVED' || status === 'CLOSED')) {
      fireAutomations('TICKET_RESOLVED', {
        triggeredBy: req.userId,
        ticket: { id: ticket.id, title: ticket.title, priority: ticket.priority, category: ticket.category, status: ticket.status, companyId: ticket.companyId, assignedToId: ticket.assignedToId },
      }).catch(console.error)
    }
    // Email de clôture automatique + lien d'enquête NPS (best-effort — ne bloque pas la réponse)
    if (statusChanged && status === 'CLOSED' && ticket.contact?.email) {
      const technicien = ticket.assignedTo ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}` : undefined
      const npsResponse = await prisma.npsResponse.findUnique({ where: { ticketId: ticket.id } }).catch(() => null)
      sendTicketClosedEmail({
        to: ticket.contact.email,
        reference: ticket.reference,
        title: ticket.title,
        technicien,
        timeSpent: ticket.timeSpent,
        status: ticket.status,
        npsToken: npsResponse ? undefined : signNpsToken(ticket.id),
      }).catch(console.error)
    }
    res.json({ success: true, data: ticket })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Commentaires ────────────────────────────────────────────────────────────

router.post('/:id/comments', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { content, isInternal } = z.object({
      content: z.string().trim().min(1, 'Le contenu du commentaire est requis'),
      isInternal: z.union([z.boolean(), z.enum(['true', 'false']).transform(v => v === 'true')]).optional().default(false),
    }).parse(req.body)
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      select: { id: true, reference: true, title: true, assignedToId: true },
    })
    if (!ticket) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket introuvable' } }); return }
    // Résoudre le nom de l'auteur depuis l'utilisateur authentifié (pas depuis le body client)
    let authorName = 'Inconnu'
    if (req.userId) {
      const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { firstName: true, lastName: true } })
      if (user) authorName = `${user.firstName} ${user.lastName}`.trim()
    }
    const comment = await prisma.ticketComment.create({
      data: { ticketId: ticket.id, content, isInternal, authorId: req.userId ?? null, authorName },
    })
    if (ticket.assignedToId && ticket.assignedToId !== req.userId) {
      await notifyUsers([ticket.assignedToId], {
        type: 'TICKET_COMMENT',
        title: 'Nouveau commentaire',
        message: `${authorName} a commenté ${ticket.reference} : ${ticket.title}`,
        link: `/tickets/${ticket.id}`,
      })
    }
    res.status(201).json({ success: true, data: comment })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Temps passé ─────────────────────────────────────────────────────────────

router.patch('/:id/time', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Chaque ajout est tracé dans une entrée détaillée (qui, quand, combien, note),
    // le total dénormalisé Ticket.timeSpent reste la source d'affichage rapide.
    const { minutes, note } = z.object({
      minutes: z.number().int().min(1).max(24 * 60),
      note: z.string().trim().max(500).optional(),
    }).parse(req.body)
    const exists = await prisma.ticket.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!exists) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket introuvable' } }); return }
    const [, ticket] = await prisma.$transaction([
      prisma.ticketTimeEntry.create({
        data: { ticketId: req.params.id, userId: req.userId ?? null, minutes, note: note || null },
      }),
      prisma.ticket.update({ where: { id: req.params.id }, data: { timeSpent: { increment: minutes } } }),
    ])
    await logTicketEvent({ ticketId: req.params.id, type: 'TIME_ADDED', authorId: req.userId, toValue: String(minutes) })
    res.json({ success: true, data: ticket })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Pièces jointes ──────────────────────────────────────────────────────────

router.post('/:id/attachments', requirePermission('tickets:update'), (req: AuthRequest, res: Response): void => {
  attachmentUpload.single('file')(req, res, async (err) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError) {
          const code = (err as unknown as Record<string, string>)['customCode'] === 'INVALID_FILE_TYPE' ? 'INVALID_FILE_TYPE' : 'UPLOAD_ERROR'
          const message = code === 'INVALID_FILE_TYPE'
            ? 'Type de fichier non autorisé (images, PDF, documents Office, txt, csv, zip)'
            : err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (10 Mo max)' : 'Erreur lors de l\'upload'
          res.status(400).json({ success: false, error: { code, message } })
          return
        }
        res.status(400).json({ success: false, error: { code: 'UPLOAD_ERROR', message: 'Erreur lors de l\'upload' } })
        return
      }
      if (!req.file) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Aucun fichier reçu (champ "file")' } })
        return
      }
      const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id }, select: { id: true } })
      if (!ticket) {
        fs.promises.unlink(req.file.path).catch(() => {})
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket introuvable' } })
        return
      }
      const attachment = await prisma.ticketAttachment.create({
        data: {
          ticketId: ticket.id,
          filename: req.file.originalname,
          storedName: req.file.filename,
          mimeType: req.file.mimetype,
          size: req.file.size,
          uploadedById: req.userId ?? null,
        },
        include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
      })
      await logTicketEvent({ ticketId: ticket.id, type: 'ATTACHMENT_ADDED', authorId: req.userId, toValue: req.file.originalname })
      audit(req, 'TICKET_ATTACHMENT_UPLOADED', 'Ticket', ticket.id, { filename: req.file.originalname, size: req.file.size })
      res.status(201).json({ success: true, data: attachment })
    } catch (e) { handleRouteError(e, res) }
  })
})

router.get('/attachments/:attachmentId/download', requirePermission('tickets:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const attachment = await prisma.ticketAttachment.findUnique({ where: { id: req.params.attachmentId } })
    if (!attachment) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pièce jointe introuvable' } }); return }
    // storedName est généré côté serveur (pas de traversée de chemin possible)
    const filePath = path.join(uploadsDir, attachment.storedName)
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Fichier absent du stockage' } })
      return
    }
    res.download(filePath, attachment.filename)
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/attachments/:attachmentId', requirePermission('tickets:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const attachment = await prisma.ticketAttachment.findUnique({ where: { id: req.params.attachmentId } })
    if (!attachment) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pièce jointe introuvable' } }); return }
    await prisma.ticketAttachment.delete({ where: { id: attachment.id } })
    fs.promises.unlink(path.join(uploadsDir, attachment.storedName)).catch(() => {})
    audit(req, 'TICKET_ATTACHMENT_DELETED', 'Ticket', attachment.ticketId, { filename: attachment.filename })
    res.json({ success: true, data: { message: 'Pièce jointe supprimée' } })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Suppression ─────────────────────────────────────────────────────────────

router.delete('/:id', requirePermission('tickets:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const attachments = await prisma.ticketAttachment.findMany({ where: { ticketId: req.params.id }, select: { storedName: true } })
    const ticket = await prisma.ticket.delete({ where: { id: req.params.id } })
    // Nettoyage des fichiers sur disque (les lignes sont supprimées par cascade)
    for (const a of attachments) {
      fs.promises.unlink(path.join(uploadsDir, a.storedName)).catch((e: unknown) =>
        logger.warn({ err: e, storedName: a.storedName }, 'Fichier de pièce jointe introuvable lors de la suppression du ticket'))
    }
    audit(req, 'TICKET_DELETED', 'Ticket', req.params.id, { reference: ticket.reference })
    res.json({ success: true, data: { message: 'Ticket supprimé' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
