/**
 * calendar-access.ts — Routes pour la gestion des partages de calendriers.
 * Monté sur /api/calendar-access.
 */
import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { audit } from '../lib/audit'
import { getVisibleOwnerIds } from '../lib/calendar-visibility'

const router = Router()
router.use(authenticate)

// ── GET /api/calendar-access — liste tous les partages (ADMIN/MANAGER) ──────────

router.get('/', requirePermission('calendars:manage_access'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const accesses = await prisma.calendarAccess.findMany({
      orderBy: { createdAt: 'desc' },
    })

    if (accesses.length === 0) {
      res.json({ success: true, data: [] })
      return
    }

    // Récupérer les infos user pour viewer et owner (CalendarAccess n'a pas de relations Prisma)
    const allUserIds = [...new Set([
      ...accesses.map(a => a.viewerId),
      ...accesses.map(a => a.ownerId),
    ])]

    const users = await prisma.user.findMany({
      where: { id: { in: allUserIds } },
      select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
    })

    const userMap = new Map(users.map(u => [u.id, u]))

    const enriched = accesses.map(a => ({
      viewerId: a.viewerId,
      ownerId: a.ownerId,
      createdAt: a.createdAt,
      viewer: userMap.get(a.viewerId) ?? null,
      owner: userMap.get(a.ownerId) ?? null,
    }))

    res.json({ success: true, data: enriched })
  } catch (err) { handleRouteError(err, res) }
})

// ── GET /api/calendar-access/mine — les ownerIds visibles par l'appelant ────────

router.get('/mine', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const visible = await getVisibleOwnerIds(req)

    let ownerIds: string[]
    if (visible === 'all') {
      // ADMIN : tous les utilisateurs actifs
      const allUsers = await prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, firstName: true, lastName: true, avatar: true },
      })
      res.json({ success: true, data: allUsers, isAll: true })
      return
    } else {
      ownerIds = visible
    }

    const users = await prisma.user.findMany({
      where: { id: { in: ownerIds }, isActive: true },
      select: { id: true, firstName: true, lastName: true, avatar: true },
    })

    // Préserver l'ordre : l'utilisateur lui-même en premier
    const selfFirst = [
      ...users.filter(u => u.id === req.userId),
      ...users.filter(u => u.id !== req.userId),
    ]

    res.json({ success: true, data: selfFirst, isAll: false })
  } catch (err) { handleRouteError(err, res) }
})

// ── POST /api/calendar-access — créer un partage (ADMIN/MANAGER) ─────────────────

const createSchema = z.object({
  viewerId: z.string().uuid(),
  ownerId:  z.string().uuid(),
})

router.post('/', requirePermission('calendars:manage_access'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body)
    const { viewerId, ownerId } = body

    if (viewerId === ownerId) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'viewerId et ownerId ne peuvent pas être identiques' },
      })
      return
    }

    // Vérifier que les deux utilisateurs existent
    const [viewer, owner] = await Promise.all([
      prisma.user.findUnique({ where: { id: viewerId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } }),
    ])

    if (!viewer) {
      res.status(400).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Utilisateur viewer introuvable' },
      })
      return
    }
    if (!owner) {
      res.status(400).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Utilisateur owner introuvable' },
      })
      return
    }

    // Upsert — pas d'erreur si déjà présent (@@id unique)
    const access = await prisma.calendarAccess.upsert({
      where: { viewerId_ownerId: { viewerId, ownerId } },
      update: {},
      create: { viewerId, ownerId },
    })

    audit(req, 'CALENDAR_ACCESS_GRANTED', 'CalendarAccess', `${viewerId}:${ownerId}`, { viewerId, ownerId })

    res.status(201).json({ success: true, data: access })
  } catch (err) { handleRouteError(err, res) }
})

// ── DELETE /api/calendar-access/:viewerId/:ownerId ───────────────────────────────

router.delete('/:viewerId/:ownerId', requirePermission('calendars:manage_access'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { viewerId, ownerId } = req.params

    const existing = await prisma.calendarAccess.findUnique({
      where: { viewerId_ownerId: { viewerId, ownerId } },
    })

    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Partage introuvable' },
      })
      return
    }

    await prisma.calendarAccess.delete({
      where: { viewerId_ownerId: { viewerId, ownerId } },
    })

    audit(req, 'CALENDAR_ACCESS_REVOKED', 'CalendarAccess', `${viewerId}:${ownerId}`, { viewerId, ownerId })

    res.json({ success: true, data: { message: 'Partage supprimé' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
