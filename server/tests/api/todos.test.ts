/**
 * todos.test.ts — todolist par utilisateur (module Todo).
 *
 * Voir docs/superpowers/specs/2026-08-19-todos-design.md.
 * Règle centrale testée : une tâche isPrivate n'est JAMAIS visible/modifiable
 * par quelqu'un d'autre que son propriétaire, même ADMIN (todos:read_all /
 * todos:write_all n'ont aucun effet sur ce filtre).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { runTodoReminders } from '../../src/scheduler'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

const COMMERCIAL_EMAIL = 'commercial-todos-test@test.local'
const COMMERCIAL_PASSWORD = 'commercial-todos-pwd-123'

let adminToken: string
let adminUserId: string
let commercialToken: string
let commercialUserId: string

const createdTodoIds: string[] = []

function trackTodo(id: string | undefined | null) {
  if (id) createdTodoIds.push(id)
}

describe('Todo', () => {
  beforeAll(async () => {
    const commercialRole = await prisma.role.findUnique({ where: { name: 'COMMERCIAL' } })
    if (!commercialRole) throw new Error('Role COMMERCIAL not found in seed')

    const hashedPassword = await bcrypt.hash(COMMERCIAL_PASSWORD, 10)
    const existing = await prisma.user.findUnique({ where: { email: COMMERCIAL_EMAIL } })
    if (existing) {
      await prisma.todo.deleteMany({ where: { ownerId: existing.id } })
      await prisma.refreshToken.deleteMany({ where: { userId: existing.id } })
      await prisma.user.delete({ where: { id: existing.id } })
    }

    const user = await prisma.user.create({
      data: {
        email: COMMERCIAL_EMAIL,
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Commercial',
        role: 'COMMERCIAL',
        roleId: commercialRole.id,
      },
    })
    commercialUserId = user.id

    const adminLogin = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = adminLogin.accessToken
    adminUserId = adminLogin.user.id

    const commercialLogin = await loginAs(app, COMMERCIAL_EMAIL, COMMERCIAL_PASSWORD)
    commercialToken = commercialLogin.accessToken
  })

  afterAll(async () => {
    if (createdTodoIds.length) {
      await prisma.notification.deleteMany({ where: { todoId: { in: createdTodoIds } } })
      await prisma.todo.deleteMany({ where: { id: { in: createdTodoIds } } })
    }
    if (commercialUserId) {
      await prisma.todo.deleteMany({ where: { ownerId: commercialUserId } })
      await prisma.refreshToken.deleteMany({ where: { userId: commercialUserId } })
      await prisma.user.delete({ where: { id: commercialUserId } })
    }
    await prisma.$disconnect()
  })

  // ─── CRUD sur sa propre liste ────────────────────────────────────────────

  it('POST /api/todos crée une tâche pour soi avec les valeurs par défaut', async () => {
    const res = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Rappeler le client Dupont' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.title).toBe('Rappeler le client Dupont')
    expect(res.body.data.priority).toBe('NORMAL')
    expect(res.body.data.isPrivate).toBe(false)
    expect(res.body.data.isDone).toBe(false)
    expect(res.body.data.ownerId).toBe(commercialUserId)
    trackTodo(res.body.data.id)
  })

  it('GET /api/todos sans userId renvoie ses propres tâches, privées comprises', async () => {
    const priv = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Tâche privée perso', isPrivate: true })
    expect(priv.status).toBe(201)
    expect(priv.body.data.isPrivate).toBe(true)
    trackTodo(priv.body.data.id)

    const res = await request(app)
      .get('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((t: { id: string }) => t.id)
    expect(ids).toContain(priv.body.data.id)
  })

  it('PATCH /api/todos/:id modifie titre et priorité', async () => {
    const created = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Titre initial' })
    trackTodo(created.body.data.id)

    const res = await request(app)
      .patch(`/api/todos/${created.body.data.id}`)
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Titre modifié', priority: 'HIGH' })

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Titre modifié')
    expect(res.body.data.priority).toBe('HIGH')
  })

  it('DELETE /api/todos/:id supprime la tâche', async () => {
    const created = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'À supprimer' })
    const id = created.body.data.id

    const res = await request(app)
      .delete(`/api/todos/${id}`)
      .set('Authorization', `Bearer ${commercialToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const row = await prisma.todo.findUnique({ where: { id } })
    expect(row).toBeNull()
  })

  // ─── Confidentialité absolue ──────────────────────────────────────────────

  it('une tâche privée n\'apparaît jamais pour un ADMIN via GET ?userId=', async () => {
    const priv = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Secret absolu', isPrivate: true })
    expect(priv.status).toBe(201)
    trackTodo(priv.body.data.id)

    const res = await request(app)
      .get(`/api/todos?userId=${commercialUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((t: { id: string }) => t.id)
    expect(ids).not.toContain(priv.body.data.id)
  })

  it('PATCH par un ADMIN sur une tâche privée d\'autrui → 404 NOT_FOUND', async () => {
    const priv = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Secret patch', isPrivate: true })
    trackTodo(priv.body.data.id)

    const res = await request(app)
      .patch(`/api/todos/${priv.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Tentative de modification' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('DELETE par un ADMIN sur une tâche privée d\'autrui → 404 NOT_FOUND', async () => {
    const priv = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Secret delete', isPrivate: true })
    trackTodo(priv.body.data.id)

    const res = await request(app)
      .delete(`/api/todos/${priv.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')

    // toujours là
    const row = await prisma.todo.findUnique({ where: { id: priv.body.data.id } })
    expect(row).not.toBeNull()
  })

  // ─── GET ?userId=autre selon permission todos:read_all ───────────────────

  it('GET ?userId=autre sans todos:read_all (COMMERCIAL) → 403 FORBIDDEN', async () => {
    const res = await request(app)
      .get(`/api/todos?userId=${adminUserId}`)
      .set('Authorization', `Bearer ${commercialToken}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('GET ?userId=autre avec todos:read_all (ADMIN) → 200, tâches non privées uniquement', async () => {
    const pub = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Publique visible par admin' })
    trackTodo(pub.body.data.id)

    const priv = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Privée invisible par admin', isPrivate: true })
    trackTodo(priv.body.data.id)

    const res = await request(app)
      .get(`/api/todos?userId=${commercialUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((t: { id: string }) => t.id)
    expect(ids).toContain(pub.body.data.id)
    expect(ids).not.toContain(priv.body.data.id)
    expect(res.body.data.every((t: { isPrivate: boolean }) => t.isPrivate === false)).toBe(true)
  })

  // ─── POST ownerId=autre selon permission todos:write_all ─────────────────

  it('POST avec ownerId=autre sans todos:write_all (COMMERCIAL) → 403 FORBIDDEN', async () => {
    const res = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Pour l\'admin', ownerId: adminUserId })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('POST avec ownerId=autre avec todos:write_all (ADMIN) → 201, isPrivate forcé à false', async () => {
    const res = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Assignée par admin', ownerId: commercialUserId, isPrivate: true })

    expect(res.status).toBe(201)
    expect(res.body.data.ownerId).toBe(commercialUserId)
    expect(res.body.data.isPrivate).toBe(false)
    trackTodo(res.body.data.id)
  })

  // ─── isDone → completedAt ──────────────────────────────────────────────

  it('PATCH isDone: true renseigne completedAt, isDone: false le vide', async () => {
    const created = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'À cocher' })
    const id = created.body.data.id
    trackTodo(id)

    const done = await request(app)
      .patch(`/api/todos/${id}`)
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ isDone: true })

    expect(done.status).toBe(200)
    expect(done.body.data.isDone).toBe(true)
    expect(done.body.data.completedAt).not.toBeNull()

    const undone = await request(app)
      .patch(`/api/todos/${id}`)
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ isDone: false })

    expect(undone.status).toBe(200)
    expect(undone.body.data.isDone).toBe(false)
    expect(undone.body.data.completedAt).toBeNull()
  })

  // ─── Non-propriétaire + isPrivate dans un PATCH ───────────────────────────

  it('non-propriétaire (même avec todos:write_all) qui envoie isPrivate dans un PATCH → 403', async () => {
    const created = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Publique pour test isPrivate' })
    trackTodo(created.body.data.id)

    const res = await request(app)
      .patch(`/api/todos/${created.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isPrivate: true })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  // ─── Validation ────────────────────────────────────────────────────────

  it('POST sans titre → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('POST avec priority invalide → 400', async () => {
    const res = await request(app)
      .post('/api/todos')
      .set('Authorization', `Bearer ${commercialToken}`)
      .send({ title: 'Priorité invalide', priority: 'URGENTISSIME' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  // ─── Rappels (scheduler) ──────────────────────────────────────────────

  describe('runTodoReminders', () => {
    const reminderTodoIds: string[] = []

    afterAll(async () => {
      if (reminderTodoIds.length) {
        await prisma.notification.deleteMany({ where: { todoId: { in: reminderTodoIds } } })
        await prisma.todo.deleteMany({ where: { id: { in: reminderTodoIds } } })
      }
    })

    it('J-1 : tâche à échéance dans 12h → TODO_REMINDER, pas de TODO_DUE, dédoublonnée au 2e run', async () => {
      const dueDate = new Date(Date.now() + 12 * 60 * 60 * 1000)
      const todo = await prisma.todo.create({
        data: { title: 'Échéance demain', ownerId: commercialUserId, dueDate },
      })
      reminderTodoIds.push(todo.id)

      await runTodoReminders()

      const reminders = await prisma.notification.findMany({ where: { todoId: todo.id, type: 'TODO_REMINDER' } })
      expect(reminders.length).toBe(1)
      expect(reminders[0].userId).toBe(commercialUserId)

      const dueNotifs = await prisma.notification.findMany({ where: { todoId: todo.id, type: 'TODO_DUE' } })
      expect(dueNotifs.length).toBe(0)

      // Re-run : toujours une seule notification (dédup)
      await runTodoReminders()
      const remindersAfter = await prisma.notification.findMany({ where: { todoId: todo.id, type: 'TODO_REMINDER' } })
      expect(remindersAfter.length).toBe(1)
    })

    it('jour J : tâche en retard (hier) → TODO_DUE créée', async () => {
      const dueDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const todo = await prisma.todo.create({
        data: { title: 'Échéance dépassée', ownerId: commercialUserId, dueDate },
      })
      reminderTodoIds.push(todo.id)

      await runTodoReminders()

      const dueNotifs = await prisma.notification.findMany({ where: { todoId: todo.id, type: 'TODO_DUE' } })
      expect(dueNotifs.length).toBe(1)
      expect(dueNotifs[0].userId).toBe(commercialUserId)
    })

    it('tâche isDone: true → aucune notification même en retard', async () => {
      const dueDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const todo = await prisma.todo.create({
        data: { title: 'Faite mais en retard', ownerId: commercialUserId, dueDate, isDone: true, completedAt: new Date() },
      })
      reminderTodoIds.push(todo.id)

      await runTodoReminders()

      const notifs = await prisma.notification.findMany({ where: { todoId: todo.id } })
      expect(notifs.length).toBe(0)
    })
  })

  // ─── DELETE nettoie les notifications liées ──────────────────────────────

  it('DELETE d\'une tâche supprime ses notifications liées (todoId)', async () => {
    const dueDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const todo = await prisma.todo.create({
      data: { title: 'À supprimer avec ses notifs', ownerId: commercialUserId, dueDate },
    })

    await runTodoReminders()
    const before = await prisma.notification.findMany({ where: { todoId: todo.id } })
    expect(before.length).toBeGreaterThan(0)

    const res = await request(app)
      .delete(`/api/todos/${todo.id}`)
      .set('Authorization', `Bearer ${commercialToken}`)

    expect(res.status).toBe(200)

    const after = await prisma.notification.findMany({ where: { todoId: todo.id } })
    expect(after.length).toBe(0)
  })

  // ─── Auth ──────────────────────────────────────────────────────────────

  it('requête sans token → 401', async () => {
    const res = await request(app).get('/api/todos')
    expect(res.status).toBe(401)
  })
})
