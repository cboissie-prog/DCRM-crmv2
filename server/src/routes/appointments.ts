import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'

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
    const { from, to, userId } = req.query as Record<string, string>
    const where: Record<string, unknown> = {}
    if (from || to) {
      where.startAt = {}
      if (from) (where.startAt as Record<string, unknown>).gte = new Date(from)
      if (to) (where.startAt as Record<string, unknown>).lte = new Date(to)
    }
    if (userId) where.users = { some: { userId } }
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

    res.status(201).json({ success: true, data: appointment })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/:id', requirePermission('appointments:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userIds, contactIds, ...rest } = req.body
    const data: Record<string, unknown> = { ...rest }
    if (rest.startAt) data.startAt = new Date(rest.startAt)
    if (rest.endAt) data.endAt = new Date(rest.endAt)
    const appointment = await prisma.appointment.update({ where: { id: req.params.id }, data: data as Parameters<typeof prisma.appointment.update>[0]['data'] })
    res.json({ success: true, data: appointment })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/:id', requirePermission('appointments:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.appointment.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: { message: 'RDV supprimé' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
