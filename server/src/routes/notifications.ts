import { Router, Response } from 'express'
import prisma from '../prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()
router.use(authenticate)

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const unreadCount = await prisma.notification.count({ where: { userId: req.userId!, isRead: false } })
    res.json({ success: true, data: notifications, meta: { unreadCount } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.patch('/read-all', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.updateMany({ where: { userId: req.userId!, isRead: false }, data: { isRead: true } })
    res.json({ success: true, data: { message: 'Toutes les notifications marquées comme lues' } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.patch('/:id/read', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } })
    res.json({ success: true, data: { message: 'Notification lue' } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.delete('/all', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.deleteMany({ where: { userId: req.userId! } })
    res.json({ success: true, data: { message: 'Toutes les notifications supprimées' } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.deleteMany({ where: { id: req.params.id, userId: req.userId! } })
    res.json({ success: true, data: { message: 'Notification supprimée' } })
  } catch { res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } }) }
})

export default router
