import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { pushAppointmentToAll, pushRemovedParticipants } from '../services/google-calendar'
import { getVisibleOwnerIds, appointmentVisibilityWhere } from '../lib/calendar-visibility'

const router = Router()
router.use(authenticate)

const appointmentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  location: z.string().optional(),
  ticketId: z.string().optional(),
  notes: z.string().optional(),
  userIds: z.array(z.string()).optional(),
  contactIds: z.array(z.string()).optional(),
})

router.get('/', requirePermission('appointments:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { from, to, userId, ownerId } = req.query as Record<string, string>

    // ── Visibilité calendrier ───────────────────────────────────────────────────
    const visible = await getVisibleOwnerIds(req)
    const visibilityWhere = appointmentVisibilityWhere(visible, req.userId!)

    // ── Filtre ownerId (calendrier d'un utilisateur spécifique) ─────────────────
    if (ownerId) {
      // Vérifier que l'appelant peut voir ce calendrier
      const canSee =
        visible === 'all' ||
        visible.includes(ownerId)

      if (!canSee) {
        res.status(403).json({
          success: false,
          error: { code: 'CALENDAR_FORBIDDEN', message: 'Vous n\'avez pas accès au calendrier de cet utilisateur' },
        })
        return
      }
    }

    // ── Construction du where final ─────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseWhere: Record<string, any> = { ...visibilityWhere }

    if (from || to) {
      baseWhere.startAt = {}
      if (from) baseWhere.startAt.gte = new Date(from)
      if (to) baseWhere.startAt.lte = new Date(to)
    }

    // Filtre userId existant (legacy — filtre par participant)
    if (userId) baseWhere.users = { some: { userId } }

    // Filtre ownerId — ne s'applique que si fourni et vérifié ci-dessus
    // ownerId filtre les RDV où CET utilisateur est participant
    let where = baseWhere
    if (ownerId) {
      // Combine la visibilité ET le filtre ownerId par AND
      const ownerFilter = { users: { some: { userId: ownerId } } }
      if (Object.keys(visibilityWhere).length > 0) {
        where = { AND: [visibilityWhere, ownerFilter] }
        if (from || to) {
          where = { AND: [visibilityWhere, ownerFilter, { startAt: baseWhere.startAt }] }
        }
      } else {
        where = ownerFilter
        if (from || to) where = { ...ownerFilter, startAt: baseWhere.startAt }
      }
    }

    const appointments = await prisma.appointment.findMany({
      where, orderBy: { startAt: 'asc' },
      include: {
        users: { include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } } },
        contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true } } } },
      },
    })
    res.json({ success: true, data: appointments })
  } catch (err) { handleRouteError(err, res) }
})

router.post('/', requirePermission('appointments:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = appointmentSchema.parse(req.body)
    const { userIds = [], contactIds = [], ...rest } = body
    const appointment = await prisma.appointment.create({
      data: {
        ...rest,
        startAt: new Date(rest.startAt),
        endAt: new Date(rest.endAt),
        createdById: req.userId,
        users: { create: userIds.map(uid => ({ userId: uid })) },
        contacts: { create: contactIds.map(cid => ({ contactId: cid })) },
      },
      include: {
        users: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true } } } },
      },
    })

    // Notifier les utilisateurs assignés (sauf le créateur)
    const targets = userIds.filter(uid => uid !== req.userId)
    if (targets.length > 0) {
      const startDate = new Date(rest.startAt)
      const dateStr = startDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
      const timeStr = startDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      await prisma.notification.createMany({
        data: targets.map(uid => ({
          userId: uid,
          type: 'APPOINTMENT_CREATED',
          title: 'Nouveau rendez-vous',
          message: `${appointment.title} — ${dateStr} à ${timeStr}`,
          link: '/appointments',
          appointmentId: appointment.id,
        })),
      })
    }

    // Push Google Calendar — fire-and-forget (après envoi de la réponse)
    pushAppointmentToAll(appointment.id, 'upsert')

    res.status(201).json({ success: true, data: appointment })
  } catch (err) { handleRouteError(err, res) }
})

// ── Vérification de visibilité pour GET/:id, PUT, DELETE ────────────────────────

async function isVisibleByUser(appointmentId: string, userId: string, visible: string[] | 'all'): Promise<boolean> {
  if (visible === 'all') return true

  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { users: { select: { userId: true } } },
  })
  if (!appt) return false

  // Créé par l'utilisateur
  if (appt.createdById === userId) return true

  // Aucun participant (RDV orphelin)
  if (appt.users.length === 0) return true

  // Au moins un participant dont le calendrier est visible
  return appt.users.some(u => visible.includes(u.userId))
}

router.get('/:id', requirePermission('appointments:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const visible = await getVisibleOwnerIds(req)
    const canSee = await isVisibleByUser(req.params.id, req.userId!, visible)
    if (!canSee) {
      // 404 plutôt que 403 pour ne pas révéler l'existence
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ressource introuvable' } })
      return
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: {
        users: { include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } } },
        contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true } } } },
      },
    })
    if (!appointment) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ressource introuvable' } })
      return
    }

    res.json({ success: true, data: appointment })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/:id', requirePermission('appointments:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const visible = await getVisibleOwnerIds(req)
    const canSee = await isVisibleByUser(req.params.id, req.userId!, visible)
    if (!canSee) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ressource introuvable' } })
      return
    }

    const { userIds, contactIds, ...rest } = req.body
    const appointmentId = req.params.id

    // Récupère les participants actuels AVANT la mise à jour (pour détecter les retraits)
    const currentUsers = await prisma.appointmentUser.findMany({
      where: { appointmentId },
      select: { userId: true },
    })
    const currentUserIds = currentUsers.map(u => u.userId)

    const data: Record<string, unknown> = { ...rest }
    if (rest.startAt) data.startAt = new Date(rest.startAt)
    if (rest.endAt) data.endAt = new Date(rest.endAt)

    // Mise à jour des participants si fournis
    if (Array.isArray(userIds)) {
      data.users = {
        deleteMany: {},
        create: (userIds as string[]).map((uid: string) => ({ userId: uid })),
      }
    }

    // Mise à jour des contacts si fournis
    if (Array.isArray(contactIds)) {
      data.contacts = {
        deleteMany: {},
        create: (contactIds as string[]).map((cid: string) => ({ contactId: cid })),
      }
    }

    const appointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data:  data as Parameters<typeof prisma.appointment.update>[0]['data'],
    })

    // Participants retirés → supprimer leurs copies Google
    if (Array.isArray(userIds)) {
      const newUserIds = userIds as string[]
      const removedUserIds = currentUserIds.filter(uid => !newUserIds.includes(uid))
      pushRemovedParticipants(appointmentId, removedUserIds)
    }

    // Push l'update à tous les participants courants — fire-and-forget
    pushAppointmentToAll(appointmentId, 'upsert')

    res.json({ success: true, data: appointment })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/:id', requirePermission('appointments:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const visible = await getVisibleOwnerIds(req)
    const canSee = await isVisibleByUser(req.params.id, req.userId!, visible)
    if (!canSee) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ressource introuvable' } })
      return
    }

    const appointmentId = req.params.id

    // Récupère les participants AVANT suppression pour pouvoir effacer leurs copies Google
    const participants = await prisma.appointmentUser.findMany({
      where:  { appointmentId },
      select: { userId: true },
    })

    // Push delete vers Google AVANT la suppression DB (on a encore les données)
    // Exécuté de manière synchrone intentionnellement ici (best effort, ordre important)
    for (const { userId } of participants) {
      // On importe et appelle directement pour garantir l'ordre avant la suppression DB
      const { pushAppointmentForUser } = await import('../services/google-calendar')
      pushAppointmentForUser(appointmentId, userId, 'delete').catch(() => {})
    }

    await prisma.appointment.delete({ where: { id: appointmentId } })
    res.json({ success: true, data: { message: 'RDV supprimé' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
