import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission, hasPermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'

const router = Router()
router.use(authenticate)
// Accès de base au module : voir/gérer sa propre todolist. Les accès à la todolist
// d'un autre utilisateur (lecture/écriture) sont vérifiés au cas par cas ci-dessous.
router.use(requirePermission('todos:read'))

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const
const priorityEnum = z.enum(PRIORITIES)
const priorityWeight: Record<string, number> = { HIGH: 2, NORMAL: 1, LOW: 0 }

type SortableTodo = { isDone: boolean; priority: string; dueDate: Date | null }

/** Tri : non faites d'abord, puis priorité HIGH>NORMAL>LOW, puis échéance croissante (nulles en dernier). */
function compareTodos(a: SortableTodo, b: SortableTodo): number {
  if (a.isDone !== b.isDone) return a.isDone ? 1 : -1
  const pw = (priorityWeight[b.priority] ?? 1) - (priorityWeight[a.priority] ?? 1)
  if (pw !== 0) return pw
  if (a.dueDate === null && b.dueDate === null) return 0
  if (a.dueDate === null) return 1
  if (b.dueDate === null) return -1
  return a.dueDate.getTime() - b.dueDate.getTime()
}

const OWNER_SELECT = { select: { id: true, firstName: true, lastName: true } } as const

// GET /api/todos?userId=&status=&priority= — todolist du propriétaire ciblé (soi par défaut)
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId, status, priority } = req.query as Record<string, string | undefined>
    const targetUserId = userId || req.userId!
    const isOwnList = targetUserId === req.userId

    if (!isOwnList && !hasPermission(req, 'todos:read_all')) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Permission insuffisante pour consulter la todolist d\'un autre utilisateur' } })
      return
    }

    const where: Record<string, unknown> = { ownerId: targetUserId }
    // Règle absolue de confidentialité : une tâche privée d'autrui n'est jamais renvoyée,
    // même à un ADMIN — le filtre est basé sur la propriété, pas sur les permissions.
    if (!isOwnList) where.isPrivate = false
    if (status === 'todo') where.isDone = false
    else if (status === 'done') where.isDone = true
    if (priority && (PRIORITIES as readonly string[]).includes(priority)) where.priority = priority

    const todos = await prisma.todo.findMany({
      where,
      include: { owner: OWNER_SELECT },
    })
    todos.sort(compareTodos)
    res.json({ success: true, data: todos })
  } catch (err) { handleRouteError(err, res) }
})

const createSchema = z.object({
  title: z.string().trim().min(1, 'Titre requis').max(200),
  description: z.string().max(2000).nullable().optional(),
  priority: priorityEnum.default('NORMAL'),
  dueDate: z.string().datetime().nullable().optional(),
  isPrivate: z.boolean().default(false),
  ownerId: z.string().optional(),
})

// POST /api/todos — crée une tâche (pour soi, ou pour autrui avec todos:write_all)
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body)
    const ownerId = body.ownerId || req.userId!
    let isPrivate = body.isPrivate

    if (ownerId !== req.userId) {
      if (!hasPermission(req, 'todos:write_all')) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Permission insuffisante pour créer une tâche pour un autre utilisateur' } })
        return
      }
      const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, isActive: true } })
      if (!owner || !owner.isActive) {
        res.status(400).json({ success: false, error: { code: 'OWNER_NOT_FOUND', message: 'Utilisateur propriétaire introuvable ou inactif' } })
        return
      }
      // On ne crée pas une tâche privée qu'on ne pourrait plus jamais consulter une fois créée pour autrui
      isPrivate = false
    }

    const todo = await prisma.todo.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        priority: body.priority,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        isPrivate,
        ownerId,
      },
      include: { owner: OWNER_SELECT },
    })
    res.status(201).json({ success: true, data: todo })
  } catch (err) { handleRouteError(err, res) }
})

const updateSchema = z.object({
  title: z.string().trim().min(1, 'Titre requis').max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  priority: priorityEnum.optional(),
  dueDate: z.string().datetime().nullable().optional(),
  isPrivate: z.boolean().optional(),
  isDone: z.boolean().optional(),
})

// PATCH /api/todos/:id — modifie une tâche (soi-même, ou autrui avec todos:write_all)
router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const todo = await prisma.todo.findUnique({ where: { id: req.params.id } })
    if (!todo) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tâche introuvable' } }); return }

    const isOwner = todo.ownerId === req.userId
    if (!isOwner) {
      // Une tâche privée d'autrui n'existe pas aux yeux des autres, quelle que soit la permission
      if (todo.isPrivate) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tâche introuvable' } }); return }
      if (!hasPermission(req, 'todos:write_all')) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Permission insuffisante pour modifier la tâche d\'un autre utilisateur' } })
        return
      }
    }

    const body = updateSchema.parse(req.body)

    if (!isOwner && body.isPrivate !== undefined) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Seul le propriétaire de la tâche peut modifier sa confidentialité' } })
      return
    }

    const data: Record<string, unknown> = {}
    if (body.title !== undefined) data.title = body.title
    if (body.description !== undefined) data.description = body.description
    if (body.priority !== undefined) data.priority = body.priority
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null
    if (body.isPrivate !== undefined) data.isPrivate = body.isPrivate
    if (body.isDone !== undefined) {
      data.isDone = body.isDone
      data.completedAt = body.isDone ? new Date() : null
    }

    const updated = await prisma.todo.update({
      where: { id: todo.id },
      data,
      include: { owner: OWNER_SELECT },
    })
    res.json({ success: true, data: updated })
  } catch (err) { handleRouteError(err, res) }
})

// DELETE /api/todos/:id — supprime une tâche (soi-même, ou autrui avec todos:write_all) + ses notifications liées
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const todo = await prisma.todo.findUnique({ where: { id: req.params.id } })
    if (!todo) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tâche introuvable' } }); return }

    const isOwner = todo.ownerId === req.userId
    if (!isOwner) {
      if (todo.isPrivate) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tâche introuvable' } }); return }
      if (!hasPermission(req, 'todos:write_all')) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Permission insuffisante pour supprimer la tâche d\'un autre utilisateur' } })
        return
      }
    }

    await prisma.todo.delete({ where: { id: todo.id } })
    await prisma.notification.deleteMany({ where: { todoId: todo.id } })
    res.json({ success: true, data: { message: 'Tâche supprimée' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
