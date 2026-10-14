import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission, hasPermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import {
  listAccess, atLeast, isTodoVisible, isTodoEditable, ensurePersonalList,
  type ListAccess, type TodoPerms,
} from '../services/todoAccess'

const router = Router()
router.use(authenticate)
// Accès de base au module. Les accès aux listes des autres (read_all / write_all) et le
// partage par membres sont résolus liste par liste via services/todoAccess.
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

const USER_SELECT = { select: { id: true, firstName: true, lastName: true } } as const

const LIST_INCLUDE = {
  owner: USER_SELECT,
  members: { include: { user: USER_SELECT }, orderBy: { createdAt: 'asc' as const } },
}

type ListWithMembers = NonNullable<Awaited<ReturnType<typeof loadListFull>>>

function loadListFull(id: string) {
  return prisma.todoList.findUnique({ where: { id }, include: LIST_INCLUDE })
}

function permsOf(req: AuthRequest): TodoPerms {
  return {
    canReadAll: hasPermission(req, 'todos:read_all'),
    canWriteAll: hasPermission(req, 'todos:write_all'),
  }
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, error: { code, message } })
}

const notFoundList = (res: Response) => sendError(res, 404, 'NOT_FOUND', 'Liste introuvable')
const notFoundTodo = (res: Response) => sendError(res, 404, 'NOT_FOUND', 'Tâche introuvable')

/** Clause where : tâches visibles (privées d'autrui exclues). */
function visibleTodoWhere(userId: string) {
  return { OR: [{ isPrivate: false }, { ownerId: userId }] }
}

/** Nombre de tâches non faites visibles par l'appelant, par liste. */
async function pendingCounts(listIds: string[], userId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!listIds.length) return map
  const rows = await prisma.todo.groupBy({
    by: ['listId'],
    where: { listId: { in: listIds }, isDone: false, ...visibleTodoWhere(userId) },
    _count: { _all: true },
  })
  for (const r of rows) map.set(r.listId, r._count._all)
  return map
}

function toListDTO(list: ListWithMembers, access: ListAccess, pendingCount: number) {
  return {
    id: list.id,
    name: list.name,
    color: list.color,
    isPersonal: list.isPersonal,
    position: list.position,
    ownerId: list.ownerId,
    owner: list.owner,
    members: list.members.map(m => ({ userId: m.userId, role: m.role, user: m.user })),
    access,
    pendingCount,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  }
}

async function listDTOFor(req: AuthRequest, listId: string) {
  const list = await loadListFull(listId)
  if (!list) return null
  const access = listAccess(list, req.userId!, permsOf(req))
  const counts = await pendingCounts([list.id], req.userId!)
  return toListDTO(list, access, counts.get(list.id) ?? 0)
}

/** Permissions todos d'un utilisateur quelconque (pour valider un assigné). */
async function todoPermsOfUser(userId: string): Promise<{ active: boolean; perms: TodoPerms }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roleRef: { include: { permissions: { include: { permission: true } } } } },
  })
  if (!user || !user.isActive) return { active: false, perms: { canReadAll: false, canWriteAll: false } }
  if (user.role === 'ADMIN') return { active: true, perms: { canReadAll: true, canWriteAll: true } }
  const keys = user.roleRef?.permissions.map(rp => rp.permission.key) ?? []
  return { active: true, perms: { canReadAll: keys.includes('todos:read_all'), canWriteAll: keys.includes('todos:write_all') } }
}

/** L'utilisateur est-il actif et a-t-il au moins un accès en lecture à la liste ? */
async function canBeAssigned(list: ListWithMembers, userId: string): Promise<boolean> {
  const { active, perms } = await todoPermsOfUser(userId)
  if (!active) return false
  return atLeast(listAccess(list, userId, perms), 'view')
}

async function authorNameOf(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } })
  return u ? `${u.firstName} ${u.lastName}`.trim() : 'Utilisateur'
}

// GET /api/todos/users — annuaire minimal des utilisateurs actifs, pour choisir les membres d'une liste.
// `GET /users` exige `users:read` (réservé aux managers) : les commerciaux/techniciens doivent
// pouvoir partager une liste sans cette permission. Déclarée avant `/:id`.
router.get('/users', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    })
    res.json({ success: true, data: users })
  } catch (err) { handleRouteError(err, res) }
})

// ═════════════════════════════ LISTES ═════════════════════════════

const memberInput = z.object({ userId: z.string().min(1), role: z.enum(['VIEWER', 'EDITOR']) })
const colorSchema = z.string().trim().min(1).max(30).nullable()

/** Valide les membres : owner ignoré, doublons fusionnés, utilisateurs actifs exigés. */
async function normalizeMembers(members: z.infer<typeof memberInput>[], ownerId: string) {
  const byUser = new Map<string, 'VIEWER' | 'EDITOR'>()
  for (const m of members) if (m.userId !== ownerId) byUser.set(m.userId, m.role)
  const ids = [...byUser.keys()]
  if (ids.length) {
    const found = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } })
    if (found.length !== ids.length) return null
  }
  return ids.map(userId => ({ userId, role: byUser.get(userId)! }))
}

// GET /api/todos/lists
router.get('/lists', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!
    const perms = permsOf(req)
    await ensurePersonalList(userId)

    const where = perms.canReadAll || perms.canWriteAll
      ? {}
      : { OR: [{ ownerId: userId }, { members: { some: { userId } } }] }
    const lists = await prisma.todoList.findMany({ where, include: LIST_INCLUDE })
    const counts = await pendingCounts(lists.map(l => l.id), userId)

    const mine = (l: { isPersonal: boolean; ownerId: string }) => (l.isPersonal && l.ownerId === userId ? 0 : 1)
    lists.sort((a, b) =>
      mine(a) - mine(b) || a.position - b.position || a.name.localeCompare(b.name, 'fr'))

    res.json({
      success: true,
      data: lists.map(l => toListDTO(l, listAccess(l, userId, perms), counts.get(l.id) ?? 0)),
    })
  } catch (err) { handleRouteError(err, res) }
})

const createListSchema = z.object({
  name: z.string().trim().min(1, 'Nom requis').max(80),
  color: colorSchema.optional(),
  members: z.array(memberInput).max(100).optional(),
})

// POST /api/todos/lists
router.post('/lists', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createListSchema.parse(req.body)
    const userId = req.userId!
    const members = await normalizeMembers(body.members ?? [], userId)
    if (!members) { sendError(res, 400, 'MEMBER_NOT_FOUND', 'Membre introuvable ou inactif'); return }

    const created = await prisma.todoList.create({
      data: {
        name: body.name,
        color: body.color ?? null,
        ownerId: userId,
        members: { create: members },
      },
    })
    res.status(201).json({ success: true, data: await listDTOFor(req, created.id) })
  } catch (err) { handleRouteError(err, res) }
})

/** Charge une liste et exige l'accès `own` (404 si invisible, 403 si accès insuffisant). */
async function requireOwnList(req: AuthRequest, res: Response) {
  const list = await loadListFull(req.params.id)
  if (!list) { notFoundList(res); return null }
  const access = listAccess(list, req.userId!, permsOf(req))
  if (access === 'none') { notFoundList(res); return null }
  if (access !== 'own') { sendError(res, 403, 'FORBIDDEN', 'Seul le propriétaire de la liste peut la gérer'); return null }
  return list
}

const updateListSchema = z.object({
  name: z.string().trim().min(1, 'Nom requis').max(80).optional(),
  color: colorSchema.optional(),
  position: z.number().int().min(0).max(100000).optional(),
})

// PATCH /api/todos/lists/:id
router.patch('/lists/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await requireOwnList(req, res)
    if (!list) return
    const body = updateListSchema.parse(req.body)
    const data: Record<string, unknown> = {}
    if (body.name !== undefined) data.name = body.name
    if (body.color !== undefined) data.color = body.color
    if (body.position !== undefined) data.position = body.position
    await prisma.todoList.update({ where: { id: list.id }, data })
    res.json({ success: true, data: await listDTOFor(req, list.id) })
  } catch (err) { handleRouteError(err, res) }
})

const membersSchema = z.object({ members: z.array(memberInput).max(100) })

// PUT /api/todos/lists/:id/members — remplace l'ensemble des membres
// Accepte `{ members: [...] }` ou directement le tableau `[...]`.
router.put('/lists/:id/members', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await requireOwnList(req, res)
    if (!list) return
    if (list.isPersonal) { sendError(res, 400, 'PERSONAL_LIST', 'Une liste personnelle ne peut pas être partagée'); return }

    const { members: input } = membersSchema.parse(Array.isArray(req.body) ? { members: req.body } : req.body)
    const members = await normalizeMembers(input, list.ownerId)
    if (!members) { sendError(res, 400, 'MEMBER_NOT_FOUND', 'Membre introuvable ou inactif'); return }

    await prisma.$transaction([
      prisma.todoListMember.deleteMany({ where: { listId: list.id } }),
      ...(members.length
        ? [prisma.todoListMember.createMany({ data: members.map(m => ({ ...m, listId: list.id })) })]
        : []),
    ])
    res.json({ success: true, data: await listDTOFor(req, list.id) })
  } catch (err) { handleRouteError(err, res) }
})

// DELETE /api/todos/lists/:id
router.delete('/lists/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await requireOwnList(req, res)
    if (!list) return
    if (list.isPersonal) { sendError(res, 400, 'PERSONAL_LIST', 'La liste personnelle ne peut pas être supprimée'); return }

    const todoIds = (await prisma.todo.findMany({ where: { listId: list.id }, select: { id: true } })).map(t => t.id)
    if (todoIds.length) await prisma.notification.deleteMany({ where: { todoId: { in: todoIds } } })
    await prisma.todoList.delete({ where: { id: list.id } })
    res.json({ success: true, data: { message: 'Liste supprimée' } })
  } catch (err) { handleRouteError(err, res) }
})

// ═════════════════════════════ TÂCHES ═════════════════════════════

type TodoRow = {
  id: string; title: string; description: string | null; priority: string; isDone: boolean; isPrivate: boolean
  dueDate: Date | null; completedAt: Date | null; ownerId: string; listId: string; assigneeId: string | null
  createdAt: Date; updatedAt: Date
  owner: { id: string; firstName: string; lastName: string }
  assignee: { id: string; firstName: string; lastName: string } | null
  _count: { comments: number }
}

const TODO_INCLUDE = {
  owner: USER_SELECT,
  assignee: USER_SELECT,
  _count: { select: { comments: true } },
}

function toTodoDTO(t: TodoRow, access: ListAccess, userId: string) {
  const { _count, ...rest } = t
  return { ...rest, commentCount: _count.comments, canEdit: isTodoEditable(t, access, userId) }
}

// GET /api/todos?listId=&status=&priority=&assigneeId=
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { listId, status, priority, assigneeId } = req.query as Record<string, string | undefined>
    const userId = req.userId!
    const perms = permsOf(req)

    const accessWhere = perms.canReadAll || perms.canWriteAll
      ? {}
      : { OR: [{ ownerId: userId }, { members: { some: { userId } } }] }
    const lists = await prisma.todoList.findMany({
      where: listId ? { id: listId, ...accessWhere } : accessWhere,
      include: { members: true },
    })
    if (listId && lists.length === 0) { notFoundList(res); return }

    const accessByList = new Map(lists.map(l => [l.id, listAccess(l, userId, perms)]))

    const where: Record<string, unknown> = {
      listId: { in: lists.map(l => l.id) },
      ...visibleTodoWhere(userId),
    }
    if (status === 'todo') where.isDone = false
    else if (status === 'done') where.isDone = true
    if (priority && (PRIORITIES as readonly string[]).includes(priority)) where.priority = priority
    if (assigneeId) where.assigneeId = assigneeId === 'me' ? userId : assigneeId

    const todos = await prisma.todo.findMany({ where, include: TODO_INCLUDE })
    todos.sort(compareTodos)
    res.json({
      success: true,
      data: todos.map(t => toTodoDTO(t, accessByList.get(t.listId) ?? 'none', userId)),
    })
  } catch (err) { handleRouteError(err, res) }
})

/** Charge une tâche + sa liste ; répond 404 si inexistante ou invisible. */
async function loadVisibleTodo(req: AuthRequest, res: Response) {
  const todo = await prisma.todo.findUnique({
    where: { id: req.params.id },
    include: { list: { include: LIST_INCLUDE } },
  })
  if (!todo) { notFoundTodo(res); return null }
  const access = listAccess(todo.list, req.userId!, permsOf(req))
  if (!isTodoVisible(todo, access, req.userId!)) { notFoundTodo(res); return null }
  return { todo, list: todo.list, access }
}

// GET /api/todos/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadVisibleTodo(req, res)
    if (!loaded) return
    const userId = req.userId!
    const full = await prisma.todo.findUnique({
      where: { id: loaded.todo.id },
      include: {
        ...TODO_INCLUDE,
        comments: { orderBy: { createdAt: 'asc' }, include: { author: USER_SELECT } },
        events: { orderBy: { createdAt: 'asc' }, include: { author: USER_SELECT } },
      },
    })
    if (!full) { notFoundTodo(res); return }
    const { comments, events, ...base } = full
    const { list } = loaded
    res.json({
      success: true,
      data: {
        ...toTodoDTO(base, loaded.access, userId),
        list: { id: list.id, name: list.name, color: list.color, isPersonal: list.isPersonal },
        comments: comments.map(c => ({
          id: c.id, content: c.content, authorId: c.authorId, authorName: c.authorName, author: c.author, createdAt: c.createdAt,
        })),
        events: events.map(e => ({
          id: e.id, type: e.type, authorId: e.authorId, author: e.author, fromValue: e.fromValue, toValue: e.toValue, createdAt: e.createdAt,
        })),
      },
    })
  } catch (err) { handleRouteError(err, res) }
})

const createSchema = z.object({
  listId: z.string().min(1, 'Liste requise'),
  title: z.string().trim().min(1, 'Titre requis').max(200),
  description: z.string().max(2000).nullable().optional(),
  priority: priorityEnum.default('NORMAL'),
  dueDate: z.string().datetime().nullable().optional(),
  isPrivate: z.boolean().default(false),
  assigneeId: z.string().nullable().optional(),
})

// POST /api/todos
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body)
    const userId = req.userId!

    const list = await loadListFull(body.listId)
    const access = list ? listAccess(list, userId, permsOf(req)) : 'none'
    if (!list || access === 'none') { notFoundList(res); return }
    if (!atLeast(access, 'edit')) { sendError(res, 403, 'FORBIDDEN', 'Droits insuffisants pour ajouter une tâche à cette liste'); return }

    const canBePrivate = list.isPersonal && list.ownerId === userId
    if (body.isPrivate && !canBePrivate) {
      sendError(res, 400, 'VALIDATION_ERROR', "Une tâche privée n'est possible que dans sa liste personnelle")
      return
    }
    const assigneeId = body.assigneeId ?? null
    if (assigneeId) {
      const ok = await canBeAssigned(list, assigneeId)
      if (!ok || (body.isPrivate && assigneeId !== userId)) {
        sendError(res, 400, 'ASSIGNEE_NOT_ALLOWED', 'Cet utilisateur ne peut pas être assigné à une tâche de cette liste')
        return
      }
    }

    const todo = await prisma.todo.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        priority: body.priority,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        isPrivate: body.isPrivate,
        ownerId: userId,
        listId: list.id,
        assigneeId,
        events: {
          create: [
            { type: 'CREATED', authorId: userId },
            ...(assigneeId ? [{ type: 'ASSIGNED', authorId: userId, toValue: assigneeId }] : []),
          ],
        },
      },
      include: TODO_INCLUDE,
    })
    res.status(201).json({ success: true, data: toTodoDTO(todo, access, userId) })
  } catch (err) { handleRouteError(err, res) }
})

const updateSchema = z.object({
  title: z.string().trim().min(1, 'Titre requis').max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  priority: priorityEnum.optional(),
  dueDate: z.string().datetime().nullable().optional(),
  isPrivate: z.boolean().optional(),
  isDone: z.boolean().optional(),
  listId: z.string().min(1).optional(),
  assigneeId: z.string().nullable().optional(),
})

// PATCH /api/todos/:id
router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadVisibleTodo(req, res)
    if (!loaded) return
    const { todo, list } = loaded
    const userId = req.userId!
    const perms = permsOf(req)
    if (!isTodoEditable(todo, loaded.access, userId)) {
      sendError(res, 403, 'FORBIDDEN', 'Droits insuffisants pour modifier cette tâche')
      return
    }

    const body = updateSchema.parse(req.body)

    // Liste cible (déplacement) : edit exigé sur la source (déjà vérifié) et sur la cible
    let targetList: ListWithMembers = list
    let targetAccess: ListAccess = loaded.access
    const moving = body.listId !== undefined && body.listId !== todo.listId
    if (moving) {
      const t = await loadListFull(body.listId!)
      const a: ListAccess = t ? listAccess(t, userId, perms) : 'none'
      if (!t || a === 'none') { notFoundList(res); return }
      if (!atLeast(a, 'edit')) { sendError(res, 403, 'FORBIDDEN', 'Droits insuffisants sur la liste de destination'); return }
      targetList = t
      targetAccess = a
    }

    // Confidentialité : uniquement dans sa liste personnelle ; perdue en quittant cette liste
    const personalOwnerHere = targetList.isPersonal && targetList.ownerId === userId
    if (body.isPrivate === true && !personalOwnerHere) {
      sendError(res, 400, 'VALIDATION_ERROR', "Une tâche privée n'est possible que dans sa liste personnelle")
      return
    }
    let isPrivate = body.isPrivate ?? todo.isPrivate
    if (!personalOwnerHere) isPrivate = false

    // Assigné : doit avoir accès à la liste cible. Au déplacement, une assignation devenue
    // invalide est retirée automatiquement (événement UNASSIGNED).
    let assigneeId: string | null = body.assigneeId !== undefined ? body.assigneeId : todo.assigneeId
    if (assigneeId && (body.assigneeId !== undefined || moving)) {
      const ok = await canBeAssigned(targetList, assigneeId)
      if (!ok) {
        if (body.assigneeId !== undefined) {
          sendError(res, 400, 'ASSIGNEE_NOT_ALLOWED', 'Cet utilisateur ne peut pas être assigné à une tâche de cette liste')
          return
        }
        assigneeId = null
      }
    }
    if (isPrivate && assigneeId && assigneeId !== userId) {
      if (body.assigneeId !== undefined) {
        sendError(res, 400, 'ASSIGNEE_NOT_ALLOWED', "Une tâche privée ne peut être assignée qu'à son créateur")
        return
      }
      assigneeId = null
    }

    const data: Record<string, unknown> = {}
    const events: { type: string; fromValue?: string | null; toValue?: string | null }[] = []

    if (body.title !== undefined) data.title = body.title
    if (body.description !== undefined) data.description = body.description
    if (body.priority !== undefined && body.priority !== todo.priority) {
      data.priority = body.priority
      events.push({ type: 'PRIORITY_CHANGED', fromValue: todo.priority, toValue: body.priority })
    }
    if (body.dueDate !== undefined) {
      const newDue = body.dueDate ? new Date(body.dueDate) : null
      data.dueDate = newDue
      if ((newDue?.getTime() ?? null) !== (todo.dueDate?.getTime() ?? null)) {
        events.push({ type: 'DUE_CHANGED', fromValue: todo.dueDate?.toISOString() ?? null, toValue: newDue?.toISOString() ?? null })
      }
    }
    if (isPrivate !== todo.isPrivate) data.isPrivate = isPrivate
    if (body.isDone !== undefined) {
      data.isDone = body.isDone
      data.completedAt = body.isDone ? new Date() : null
      if (body.isDone !== todo.isDone) events.push({ type: body.isDone ? 'DONE' : 'REOPENED' })
    }
    if (moving) {
      data.listId = targetList.id
      events.push({ type: 'MOVED', fromValue: list.name, toValue: targetList.name })
    }
    if (assigneeId !== todo.assigneeId) {
      data.assigneeId = assigneeId
      if (assigneeId) events.push({ type: 'ASSIGNED', fromValue: todo.assigneeId, toValue: assigneeId })
      else events.push({ type: 'UNASSIGNED', fromValue: todo.assigneeId })
    }

    const updated = await prisma.todo.update({
      where: { id: todo.id },
      data: {
        ...data,
        ...(events.length
          ? { events: { create: events.map(e => ({ type: e.type, fromValue: e.fromValue ?? null, toValue: e.toValue ?? null, authorId: userId })) } }
          : {}),
      },
      include: TODO_INCLUDE,
    })
    res.json({ success: true, data: toTodoDTO(updated, targetAccess, userId) })
  } catch (err) { handleRouteError(err, res) }
})

// DELETE /api/todos/:id — supprime la tâche + ses notifications liées
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadVisibleTodo(req, res)
    if (!loaded) return
    if (!isTodoEditable(loaded.todo, loaded.access, req.userId!)) {
      sendError(res, 403, 'FORBIDDEN', 'Droits insuffisants pour supprimer cette tâche')
      return
    }
    await prisma.todo.delete({ where: { id: loaded.todo.id } })
    await prisma.notification.deleteMany({ where: { todoId: loaded.todo.id } })
    res.json({ success: true, data: { message: 'Tâche supprimée' } })
  } catch (err) { handleRouteError(err, res) }
})

const commentSchema = z.object({ content: z.string().trim().min(1, 'Contenu requis').max(2000) })

// POST /api/todos/:id/comments
router.post('/:id/comments', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadVisibleTodo(req, res)
    if (!loaded) return
    const userId = req.userId!
    if (!isTodoEditable(loaded.todo, loaded.access, userId)) {
      sendError(res, 403, 'FORBIDDEN', 'Droits insuffisants pour commenter cette tâche')
      return
    }
    const body = commentSchema.parse(req.body)
    const comment = await prisma.todoComment.create({
      data: { todoId: loaded.todo.id, content: body.content, authorId: userId, authorName: await authorNameOf(userId) },
      include: { author: USER_SELECT },
    })
    res.status(201).json({
      success: true,
      data: {
        id: comment.id, content: comment.content, authorId: comment.authorId,
        authorName: comment.authorName, author: comment.author, createdAt: comment.createdAt,
      },
    })
  } catch (err) { handleRouteError(err, res) }
})

export default router
