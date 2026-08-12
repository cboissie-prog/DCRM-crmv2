import { Router, Response } from 'express'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'

const router = Router()
// notifications:read couvre lecture ET gestion (marquer lu / supprimer) : les données sont
// strictement celles de l'utilisateur connecté. La permission ferme aussi l'accès aux clés
// API à zéro droit (avant : simple `authenticate` → accessible à toute clé valide).
router.use(authenticate, requirePermission('notifications:read'))

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const unreadCount = await prisma.notification.count({ where: { userId: req.userId!, isRead: false } })
    res.json({ success: true, data: notifications, meta: { unreadCount } })
  } catch (err) { handleRouteError(err, res) }
})

router.patch('/read-all', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.updateMany({ where: { userId: req.userId!, isRead: false }, data: { isRead: true } })
    res.json({ success: true, data: { message: 'Toutes les notifications marquées comme lues' } })
  } catch (err) { handleRouteError(err, res) }
})

router.patch('/:id/read', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { count } = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { isRead: true },
    })
    if (count === 0) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Notification introuvable' } }); return }
    res.json({ success: true, data: { message: 'Notification lue' } })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/all', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.deleteMany({ where: { userId: req.userId! } })
    res.json({ success: true, data: { message: 'Toutes les notifications supprimées' } })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.deleteMany({ where: { id: req.params.id, userId: req.userId! } })
    res.json({ success: true, data: { message: 'Notification supprimée' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
