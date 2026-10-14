/**
 * todos.test.ts — module Todo : listes partageables, tâches assignables, fil de tâche.
 *
 * Voir docs/superpowers/specs/2026-10-14-todo-listes-partagees-design.md.
 * Règles centrales testées :
 *  - accès liste : own / edit (membre EDITOR) / view (membre VIEWER) / none ;
 *  - une tâche isPrivate (liste personnelle uniquement) n'est JAMAIS visible ni modifiable
 *    par un autre que son créateur, même ADMIN ;
 *  - événements système, commentaires, assignation, déplacement, rappels.
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
const PWD = 'todos-test-pwd-123'

const EMAILS = {
  owner: 'todos-owner@test.local',
  editor: 'todos-editor@test.local',
  viewer: 'todos-viewer@test.local',
  outsider: 'todos-outsider@test.local',
} as const

type Who = keyof typeof EMAILS | 'admin'
const tokens = {} as Record<Who, string>
const ids = {} as Record<Who, string>

const auth = (who: Who) => ({ Authorization: `Bearer ${tokens[who]}` })
const get = (who: Who, url: string) => request(app).get(url).set(auth(who))
const post = (who: Who, url: string, body: object = {}) => request(app).post(url).set(auth(who)).send(body)
const patch = (who: Who, url: string, body: object = {}) => request(app).patch(url).set(auth(who)).send(body)
const put = (who: Who, url: string, body: unknown = {}) => request(app).put(url).set(auth(who)).send(body as object)
const del = (who: Who, url: string) => request(app).delete(url).set(auth(who))

let personalListId: string // liste personnelle du owner
let sharedListId: string   // liste partagée : owner, editor (EDITOR), viewer (VIEWER)
let otherListId: string    // autre liste du owner partagée uniquement en lecture avec editor

async function newShared(name = 'Partagée', members?: { userId: string; role: string }[]) {
  const res = await post('owner', '/api/todos/lists', {
    name,
    members: members ?? [
      { userId: ids.editor, role: 'EDITOR' },
      { userId: ids.viewer, role: 'VIEWER' },
    ],
  })
  expect(res.status).toBe(201)
  return res.body.data.id as string
}

async function newTodo(who: Who, listId: string, extra: object = {}) {
  const res = await post(who, '/api/todos', { listId, title: 'Tâche test', ...extra })
  expect(res.status).toBe(201)
  return res.body.data as { id: string; [k: string]: unknown }
}

describe('Todo', () => {
  beforeAll(async () => {
    const role = await prisma.role.findUnique({ where: { name: 'COMMERCIAL' } })
    if (!role) throw new Error('Role COMMERCIAL not found in seed')
    const hash = await bcrypt.hash(PWD, 10)

    for (const [key, email] of Object.entries(EMAILS)) {
      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) {
        await prisma.refreshToken.deleteMany({ where: { userId: existing.id } })
        await prisma.user.delete({ where: { id: existing.id } })
      }
      const user = await prisma.user.create({
        data: { email, password: hash, firstName: key, lastName: 'Todos', role: 'COMMERCIAL', roleId: role.id },
      })
      ids[key as keyof typeof EMAILS] = user.id
      tokens[key as keyof typeof EMAILS] = (await loginAs(app, email, PWD)).accessToken
    }
    const admin = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    tokens.admin = admin.accessToken
    ids.admin = admin.user.id

    // Liste personnelle du owner (créée à la volée) + liste partagée
    const lists = await get('owner', '/api/todos/lists')
    personalListId = lists.body.data.find((l: { isPersonal: boolean }) => l.isPersonal).id
    sharedListId = await newShared('Équipe test')
    otherListId = await newShared('Lecture seule pour editor', [{ userId: ids.editor, role: 'VIEWER' }])
  })

  afterAll(async () => {
    const userIds = Object.values(EMAILS).map(e => e)
    const users = await prisma.user.findMany({ where: { email: { in: userIds } }, select: { id: true } })
    const uids = users.map(u => u.id)
    await prisma.notification.deleteMany({ where: { userId: { in: uids } } })
    await prisma.todo.deleteMany({ where: { ownerId: { in: uids } } })
    await prisma.refreshToken.deleteMany({ where: { userId: { in: uids } } })
    await prisma.user.deleteMany({ where: { id: { in: uids } } })
    await prisma.$disconnect()
  })

  // ─── Listes ────────────────────────────────────────────────────────────

  describe('listes', () => {
    it('GET /todos/users liste les utilisateurs actifs sans exiger users:read', async () => {
      const res = await get('outsider', '/api/todos/users')
      expect(res.status).toBe(200)
      const found = res.body.data.find((u: { id: string }) => u.id === ids.owner)
      expect(found).toEqual({ id: ids.owner, firstName: 'owner', lastName: 'Todos' })
      expect(Object.keys(res.body.data[0]).sort()).toEqual(['firstName', 'id', 'lastName'])
    })

    it('GET /todos/lists crée « Mes tâches » à la volée et la place en premier', async () => {
      const res = await get('outsider', '/api/todos/lists')
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      const l = res.body.data[0]
      expect(l.name).toBe('Mes tâches')
      expect(l.isPersonal).toBe(true)
      expect(l.access).toBe('own')
      expect(l.ownerId).toBe(ids.outsider)
      expect(l.members).toEqual([])
      expect(l.pendingCount).toBe(0)
      // idempotent
      const again = await get('outsider', '/api/todos/lists')
      expect(again.body.data).toHaveLength(1)
    })

    it('POST /todos/lists crée une liste avec membres (DTO complet)', async () => {
      const res = await post('owner', '/api/todos/lists', {
        name: 'Projet X', color: 'blue',
        members: [{ userId: ids.editor, role: 'EDITOR' }, { userId: ids.owner, role: 'VIEWER' }],
      })
      expect(res.status).toBe(201)
      const l = res.body.data
      expect(l).toMatchObject({ name: 'Projet X', color: 'blue', isPersonal: false, ownerId: ids.owner, access: 'own', pendingCount: 0 })
      expect(l.owner.id).toBe(ids.owner)
      // le owner présent dans les membres est ignoré
      expect(l.members).toHaveLength(1)
      expect(l.members[0]).toMatchObject({ userId: ids.editor, role: 'EDITOR' })
      expect(l.members[0].user.id).toBe(ids.editor)
    })

    it('POST /todos/lists : nom vide → 400 VALIDATION_ERROR ; membre inconnu → 400 MEMBER_NOT_FOUND', async () => {
      const a = await post('owner', '/api/todos/lists', { name: '  ' })
      expect(a.status).toBe(400)
      expect(a.body.error.code).toBe('VALIDATION_ERROR')
      const b = await post('owner', '/api/todos/lists', { name: 'X', members: [{ userId: 'inconnu', role: 'EDITOR' }] })
      expect(b.status).toBe(400)
      expect(b.body.error.code).toBe('MEMBER_NOT_FOUND')
    })

    it('GET /todos/lists : un membre voit la liste partagée avec son niveau d\'accès, un tiers non', async () => {
      const editor = (await get('editor', '/api/todos/lists')).body.data.find((l: { id: string }) => l.id === sharedListId)
      expect(editor.access).toBe('edit')
      const viewer = (await get('viewer', '/api/todos/lists')).body.data.find((l: { id: string }) => l.id === sharedListId)
      expect(viewer.access).toBe('view')
      const outsider = (await get('outsider', '/api/todos/lists')).body.data
      expect(outsider.find((l: { id: string }) => l.id === sharedListId)).toBeUndefined()
    })

    it('un ADMIN (todos:read_all/write_all) voit toutes les listes', async () => {
      const res = await get('admin', '/api/todos/lists')
      const found = res.body.data.find((l: { id: string }) => l.id === sharedListId)
      expect(found).toBeDefined()
      expect(['view', 'edit']).toContain(found.access)
      // sa propre liste personnelle est en premier
      expect(res.body.data[0].isPersonal).toBe(true)
      expect(res.body.data[0].ownerId).toBe(ids.admin)
    })

    it('PATCH /todos/lists/:id : le owner renomme ; editor → 403 ; tiers → 404', async () => {
      const id = await newShared('À renommer')
      const ok = await patch('owner', `/api/todos/lists/${id}`, { name: 'Renommée', color: 'emerald', position: 3 })
      expect(ok.status).toBe(200)
      expect(ok.body.data).toMatchObject({ name: 'Renommée', color: 'emerald', position: 3 })

      const forbidden = await patch('editor', `/api/todos/lists/${id}`, { name: 'Pirate' })
      expect(forbidden.status).toBe(403)
      expect(forbidden.body.error.code).toBe('FORBIDDEN')

      const hidden = await patch('outsider', `/api/todos/lists/${id}`, { name: 'Pirate' })
      expect(hidden.status).toBe(404)
      expect(hidden.body.error.code).toBe('NOT_FOUND')
    })

    it('la liste personnelle peut être renommée mais pas partagée ni supprimée (PERSONAL_LIST)', async () => {
      const rename = await patch('owner', `/api/todos/lists/${personalListId}`, { name: 'Mon espace', color: 'violet' })
      expect(rename.status).toBe(200)
      expect(rename.body.data.name).toBe('Mon espace')
      await patch('owner', `/api/todos/lists/${personalListId}`, { name: 'Mes tâches', color: null })

      const members = await put('owner', `/api/todos/lists/${personalListId}/members`, { members: [{ userId: ids.editor, role: 'EDITOR' }] })
      expect(members.status).toBe(400)
      expect(members.body.error.code).toBe('PERSONAL_LIST')

      const remove = await del('owner', `/api/todos/lists/${personalListId}`)
      expect(remove.status).toBe(400)
      expect(remove.body.error.code).toBe('PERSONAL_LIST')
    })

    it('PUT /todos/lists/:id/members remplace l\'ensemble des membres (objet ou tableau nu)', async () => {
      const id = await newShared('Membres')
      const res = await put('owner', `/api/todos/lists/${id}/members`, { members: [{ userId: ids.outsider, role: 'VIEWER' }] })
      expect(res.status).toBe(200)
      expect(res.body.data.members.map((m: { userId: string }) => m.userId)).toEqual([ids.outsider])

      const bare = await put('owner', `/api/todos/lists/${id}/members`, [{ userId: ids.viewer, role: 'EDITOR' }])
      expect(bare.status).toBe(200)
      expect(bare.body.data.members).toHaveLength(1)
      expect(bare.body.data.members[0]).toMatchObject({ userId: ids.viewer, role: 'EDITOR' })

      const empty = await put('owner', `/api/todos/lists/${id}/members`, { members: [] })
      expect(empty.body.data.members).toEqual([])

      const unknown = await put('owner', `/api/todos/lists/${id}/members`, { members: [{ userId: 'nope', role: 'EDITOR' }] })
      expect(unknown.status).toBe(400)
      expect(unknown.body.error.code).toBe('MEMBER_NOT_FOUND')

      const notOwner = await put('editor', `/api/todos/lists/${sharedListId}/members`, { members: [] })
      expect(notOwner.status).toBe(403)
    })

    it('DELETE /todos/lists/:id supprime la liste, ses tâches et leurs notifications', async () => {
      const id = await newShared('À supprimer')
      const todo = await newTodo('owner', id, { dueDate: new Date(Date.now() - 86400000).toISOString() })
      await runTodoReminders()
      expect((await prisma.notification.findMany({ where: { todoId: todo.id } })).length).toBeGreaterThan(0)

      const forbidden = await del('editor', `/api/todos/lists/${id}`)
      expect(forbidden.status).toBe(403)

      const res = await del('owner', `/api/todos/lists/${id}`)
      expect(res.status).toBe(200)
      expect(await prisma.todoList.findUnique({ where: { id } })).toBeNull()
      expect(await prisma.todo.findUnique({ where: { id: todo.id } })).toBeNull()
      expect(await prisma.notification.findMany({ where: { todoId: todo.id } })).toHaveLength(0)

      const gone = await del('owner', `/api/todos/lists/${id}`)
      expect(gone.status).toBe(404)
    })

    it('pendingCount compte les tâches non faites visibles (privées d\'autrui exclues)', async () => {
      const id = await newShared('Compteur')
      await newTodo('owner', id)
      const done = await newTodo('owner', id)
      await patch('owner', `/api/todos/${done.id}`, { isDone: true })
      const forOwner = (await get('owner', '/api/todos/lists')).body.data.find((l: { id: string }) => l.id === id)
      expect(forOwner.pendingCount).toBe(1)

      const before = (await get('owner', '/api/todos/lists')).body.data.find((l: { id: string }) => l.id === personalListId).pendingCount
      await newTodo('owner', personalListId, { isPrivate: true })
      const adminView = (await get('admin', '/api/todos/lists')).body.data.find((l: { id: string }) => l.id === personalListId)
      const ownerView = (await get('owner', '/api/todos/lists')).body.data.find((l: { id: string }) => l.id === personalListId)
      expect(ownerView.pendingCount).toBe(before + 1)
      expect(adminView.pendingCount).toBe(before) // la privée du owner n'est pas comptée pour l'admin
    })
  })

  // ─── CRUD tâches & valeurs par défaut ──────────────────────────────────

  describe('tâches', () => {
    it('POST /todos crée une tâche dans sa liste personnelle (défauts, DTO, événement CREATED)', async () => {
      const res = await post('owner', '/api/todos', { listId: personalListId, title: 'Rappeler Dupont' })
      expect(res.status).toBe(201)
      const t = res.body.data
      expect(t).toMatchObject({
        title: 'Rappeler Dupont', priority: 'NORMAL', isPrivate: false, isDone: false,
        ownerId: ids.owner, listId: personalListId, assigneeId: null, assignee: null, commentCount: 0, canEdit: true,
      })
      expect(t.owner.id).toBe(ids.owner)

      const detail = await get('owner', `/api/todos/${t.id}`)
      expect(detail.body.data.events.map((e: { type: string }) => e.type)).toEqual(['CREATED'])
    })

    it('POST /todos valide : listId requis, titre requis, priorité valide', async () => {
      const a = await post('owner', '/api/todos', { title: 'Sans liste' })
      expect(a.status).toBe(400)
      expect(a.body.error.code).toBe('VALIDATION_ERROR')
      const b = await post('owner', '/api/todos', { listId: personalListId })
      expect(b.status).toBe(400)
      expect(b.body.error.code).toBe('VALIDATION_ERROR')
      const c = await post('owner', '/api/todos', { listId: personalListId, title: 'X', priority: 'URGENTISSIME' })
      expect(c.status).toBe(400)
      expect(c.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('POST /todos : liste inexistante ou invisible → 404 ; accès lecture seule → 403', async () => {
      const unknown = await post('owner', '/api/todos', { listId: 'inconnue', title: 'X' })
      expect(unknown.status).toBe(404)
      const hidden = await post('outsider', '/api/todos', { listId: sharedListId, title: 'X' })
      expect(hidden.status).toBe(404)
      expect(hidden.body.error.code).toBe('NOT_FOUND')
      const viewer = await post('viewer', '/api/todos', { listId: sharedListId, title: 'X' })
      expect(viewer.status).toBe(403)
      expect(viewer.body.error.code).toBe('FORBIDDEN')
    })

    it('les anciens paramètres ownerId (POST) et userId (GET) sont ignorés', async () => {
      const res = await post('owner', '/api/todos', { listId: personalListId, title: 'Pas pour autrui', ownerId: ids.admin })
      expect(res.status).toBe(201)
      expect(res.body.data.ownerId).toBe(ids.owner)
      const list = await get('outsider', `/api/todos?userId=${ids.owner}`)
      expect(list.status).toBe(200)
      expect(list.body.data.every((t: { ownerId: string }) => t.ownerId !== ids.owner)).toBe(true)
    })

    it('GET /todos?listId= filtre par liste ; sans listId renvoie toutes les listes accessibles', async () => {
      const t = await newTodo('owner', sharedListId, { title: 'Dans la partagée' })
      const byList = await get('editor', `/api/todos?listId=${sharedListId}`)
      expect(byList.status).toBe(200)
      expect(byList.body.data.map((x: { id: string }) => x.id)).toContain(t.id)
      expect(byList.body.data.every((x: { listId: string }) => x.listId === sharedListId)).toBe(true)

      const all = await get('editor', '/api/todos')
      expect(all.body.data.map((x: { id: string }) => x.id)).toContain(t.id)

      const outsiderAll = await get('outsider', '/api/todos')
      expect(outsiderAll.body.data.map((x: { id: string }) => x.id)).not.toContain(t.id)
    })

    it('GET /todos?listId= sur une liste invisible → 404 NOT_FOUND', async () => {
      const res = await get('outsider', `/api/todos?listId=${sharedListId}`)
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('GET /todos : filtres status, priority, assigneeId=me et tri', async () => {
      const id = await newShared('Filtres')
      const low = await newTodo('owner', id, { title: 'low', priority: 'LOW' })
      const high = await newTodo('owner', id, { title: 'high', priority: 'HIGH', assigneeId: ids.editor })
      const done = await newTodo('owner', id, { title: 'done' })
      await patch('owner', `/api/todos/${done.id}`, { isDone: true })

      const all = await get('owner', `/api/todos?listId=${id}`)
      expect(all.body.data.map((t: { title: string }) => t.title)).toEqual(['high', 'low', 'done'])

      const onlyDone = await get('owner', `/api/todos?listId=${id}&status=done`)
      expect(onlyDone.body.data.map((t: { id: string }) => t.id)).toEqual([done.id])
      const onlyTodo = await get('owner', `/api/todos?listId=${id}&status=todo&priority=LOW`)
      expect(onlyTodo.body.data.map((t: { id: string }) => t.id)).toEqual([low.id])

      const mine = await get('editor', `/api/todos?listId=${id}&assigneeId=me`)
      expect(mine.body.data.map((t: { id: string }) => t.id)).toEqual([high.id])
    })

    it('PATCH /todos/:id modifie titre, description et priorité', async () => {
      const t = await newTodo('owner', personalListId, { title: 'Titre initial' })
      const res = await patch('owner', `/api/todos/${t.id}`, { title: 'Titre modifié', priority: 'HIGH', description: 'Détail' })
      expect(res.status).toBe(200)
      expect(res.body.data).toMatchObject({ title: 'Titre modifié', priority: 'HIGH', description: 'Détail' })
    })

    it('DELETE /todos/:id supprime la tâche ; viewer → 403', async () => {
      const t = await newTodo('owner', sharedListId)
      const forbidden = await del('viewer', `/api/todos/${t.id}`)
      expect(forbidden.status).toBe(403)
      const res = await del('editor', `/api/todos/${t.id}`)
      expect(res.status).toBe(200)
      expect(await prisma.todo.findUnique({ where: { id: t.id } })).toBeNull()
    })

    it('DELETE d\'une tâche supprime ses notifications liées (todoId)', async () => {
      const t = await newTodo('owner', personalListId, { dueDate: new Date(Date.now() - 86400000).toISOString() })
      await runTodoReminders()
      expect((await prisma.notification.findMany({ where: { todoId: t.id } })).length).toBeGreaterThan(0)
      const res = await del('owner', `/api/todos/${t.id}`)
      expect(res.status).toBe(200)
      expect(await prisma.notification.findMany({ where: { todoId: t.id } })).toHaveLength(0)
    })

    it('requête sans token → 401', async () => {
      expect((await request(app).get('/api/todos')).status).toBe(401)
      expect((await request(app).get('/api/todos/lists')).status).toBe(401)
    })
  })

  // ─── Accès view vs edit ────────────────────────────────────────────────

  describe('accès view / edit', () => {
    it('viewer : lit la tâche (canEdit=false) mais ne peut ni modifier, ni cocher, ni commenter', async () => {
      const t = await newTodo('owner', sharedListId, { title: 'Lecture seule' })

      const list = await get('viewer', `/api/todos?listId=${sharedListId}`)
      const dto = list.body.data.find((x: { id: string }) => x.id === t.id)
      expect(dto.canEdit).toBe(false)

      const detail = await get('viewer', `/api/todos/${t.id}`)
      expect(detail.status).toBe(200)
      expect(detail.body.data.canEdit).toBe(false)

      for (const res of [
        await patch('viewer', `/api/todos/${t.id}`, { title: 'Pirate' }),
        await patch('viewer', `/api/todos/${t.id}`, { isDone: true }),
        await post('viewer', `/api/todos/${t.id}/comments`, { content: 'hello' }),
      ]) {
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
      }
    })

    it('editor : modifie, coche et commente (canEdit=true)', async () => {
      const t = await newTodo('owner', sharedListId, { title: 'Éditable' })
      const dto = (await get('editor', `/api/todos?listId=${sharedListId}`)).body.data.find((x: { id: string }) => x.id === t.id)
      expect(dto.canEdit).toBe(true)
      expect((await patch('editor', `/api/todos/${t.id}`, { title: 'Éditée' })).status).toBe(200)
      expect((await patch('editor', `/api/todos/${t.id}`, { isDone: true })).status).toBe(200)
      expect((await post('editor', `/api/todos/${t.id}/comments`, { content: 'ok' })).status).toBe(201)
    })

    it('tiers sans accès : GET/PATCH/DELETE/commentaire → 404 NOT_FOUND', async () => {
      const t = await newTodo('owner', sharedListId)
      for (const res of [
        await get('outsider', `/api/todos/${t.id}`),
        await patch('outsider', `/api/todos/${t.id}`, { title: 'x' }),
        await del('outsider', `/api/todos/${t.id}`),
        await post('outsider', `/api/todos/${t.id}/comments`, { content: 'x' }),
      ]) {
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('NOT_FOUND')
      }
    })

    it('tâche inexistante → 404', async () => {
      expect((await get('owner', '/api/todos/inconnue')).status).toBe(404)
    })
  })

  // ─── Confidentialité absolue ───────────────────────────────────────────

  describe('tâches privées', () => {
    it('privée possible dans sa liste personnelle, absente des listes des autres', async () => {
      const priv = await newTodo('owner', personalListId, { title: 'Secret absolu', isPrivate: true })
      expect(priv.isPrivate).toBe(true)

      const own = await get('owner', `/api/todos?listId=${personalListId}`)
      expect(own.body.data.map((t: { id: string }) => t.id)).toContain(priv.id)

      // ADMIN (read_all + write_all) : liste visible mais tâche privée jamais renvoyée
      const adminList = await get('admin', `/api/todos?listId=${personalListId}`)
      expect(adminList.status).toBe(200)
      expect(adminList.body.data.map((t: { id: string }) => t.id)).not.toContain(priv.id)
      const adminAll = await get('admin', '/api/todos')
      expect(adminAll.body.data.map((t: { id: string }) => t.id)).not.toContain(priv.id)
    })

    it('ADMIN : GET/PATCH/DELETE/commentaire sur une privée d\'autrui → 404 NOT_FOUND', async () => {
      const priv = await newTodo('owner', personalListId, { title: 'Secret 2', isPrivate: true })
      for (const res of [
        await get('admin', `/api/todos/${priv.id}`),
        await patch('admin', `/api/todos/${priv.id}`, { title: 'Tentative' }),
        await del('admin', `/api/todos/${priv.id}`),
        await post('admin', `/api/todos/${priv.id}/comments`, { content: 'espion' }),
      ]) {
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('NOT_FOUND')
      }
      expect(await prisma.todo.findUnique({ where: { id: priv.id } })).not.toBeNull()
    })

    it('une tâche non privée de la liste personnelle du owner est modifiable par un ADMIN (write_all)', async () => {
      const t = await newTodo('owner', personalListId, { title: 'Publique perso' })
      const res = await patch('admin', `/api/todos/${t.id}`, { priority: 'HIGH' })
      expect(res.status).toBe(200)
    })

    it('isPrivate hors liste personnelle → 400 VALIDATION_ERROR (POST et PATCH)', async () => {
      const post1 = await post('owner', '/api/todos', { listId: sharedListId, title: 'Privée partagée', isPrivate: true })
      expect(post1.status).toBe(400)
      expect(post1.body.error.code).toBe('VALIDATION_ERROR')

      const t = await newTodo('owner', sharedListId)
      const patch1 = await patch('owner', `/api/todos/${t.id}`, { isPrivate: true })
      expect(patch1.status).toBe(400)
      expect(patch1.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('la privée déplacée hors de la liste personnelle perd isPrivate', async () => {
      const priv = await newTodo('owner', personalListId, { title: 'Sera partagée', isPrivate: true })
      const res = await patch('owner', `/api/todos/${priv.id}`, { listId: sharedListId })
      expect(res.status).toBe(200)
      expect(res.body.data.isPrivate).toBe(false)
      expect(res.body.data.listId).toBe(sharedListId)
      // désormais visible par le viewer
      expect((await get('viewer', `/api/todos/${priv.id}`)).status).toBe(200)
    })

    it('un membre ne peut pas voir une privée d\'un autre membre dans la liste personnelle d\'un autre', async () => {
      // le créateur d'une tâche dans une liste partagée peut être différent du owner de la liste :
      // la règle de visibilité est portée par la tâche (isPrivate + ownerId), jamais par la liste.
      const t = await prisma.todo.create({
        data: { title: 'Privée legacy', ownerId: ids.editor, listId: sharedListId, isPrivate: true },
      })
      expect((await get('owner', `/api/todos/${t.id}`)).status).toBe(404)
      expect((await get('editor', `/api/todos/${t.id}`)).status).toBe(200)
    })
  })

  // ─── Déplacement ───────────────────────────────────────────────────────

  describe('déplacement', () => {
    it('editor déplace entre deux listes où il peut éditer → événement MOVED (noms des listes)', async () => {
      const target = await newShared('Cible', [{ userId: ids.editor, role: 'EDITOR' }])
      const t = await newTodo('owner', sharedListId, { title: 'À déplacer' })
      const res = await patch('editor', `/api/todos/${t.id}`, { listId: target })
      expect(res.status).toBe(200)
      expect(res.body.data.listId).toBe(target)

      const detail = (await get('editor', `/api/todos/${t.id}`)).body.data
      expect(detail.list.id).toBe(target)
      const moved = detail.events.find((e: { type: string }) => e.type === 'MOVED')
      expect(moved).toMatchObject({ fromValue: 'Équipe test', toValue: 'Cible', authorId: ids.editor })
    })

    it('déplacement vers une liste en lecture seule → 403 ; vers une liste invisible → 404', async () => {
      const t = await newTodo('owner', sharedListId, { title: 'Reste ici' })
      const readOnly = await patch('editor', `/api/todos/${t.id}`, { listId: otherListId })
      expect(readOnly.status).toBe(403)
      const hidden = await patch('viewer', `/api/todos/${t.id}`, { listId: personalListId })
      // viewer n'a pas edit sur la source : 403 avant toute lecture de la cible
      expect(hidden.status).toBe(403)
      const invisible = await patch('editor', `/api/todos/${t.id}`, { listId: personalListId })
      expect(invisible.status).toBe(404)
      expect((await prisma.todo.findUnique({ where: { id: t.id } }))!.listId).toBe(sharedListId)
    })

    it('déplacement d\'une tâche assignée vers une liste où l\'assigné n\'a pas accès → assignation retirée (UNASSIGNED)', async () => {
      const t = await newTodo('owner', sharedListId, { title: 'Assignée', assigneeId: ids.viewer })
      const res = await patch('owner', `/api/todos/${t.id}`, { listId: personalListId })
      expect(res.status).toBe(200)
      expect(res.body.data.assigneeId).toBeNull()
      const events = (await get('owner', `/api/todos/${t.id}`)).body.data.events.map((e: { type: string }) => e.type)
      expect(events).toEqual(expect.arrayContaining(['ASSIGNED', 'MOVED', 'UNASSIGNED']))
    })
  })

  // ─── Assignation ───────────────────────────────────────────────────────

  describe('assignation', () => {
    it('assigner à un membre → 201/200, assignee dans le DTO, événement ASSIGNED', async () => {
      const t = await newTodo('owner', sharedListId, { title: 'À assigner', assigneeId: ids.editor })
      expect(t.assigneeId).toBe(ids.editor)
      expect((t.assignee as { id: string }).id).toBe(ids.editor)

      const res = await patch('owner', `/api/todos/${t.id}`, { assigneeId: ids.viewer })
      expect(res.status).toBe(200)
      expect(res.body.data.assigneeId).toBe(ids.viewer)

      const events = (await get('owner', `/api/todos/${t.id}`)).body.data.events
      const assigned = events.filter((e: { type: string }) => e.type === 'ASSIGNED')
      expect(assigned.map((e: { toValue: string }) => e.toValue)).toEqual([ids.editor, ids.viewer])
    })

    it('assigner à quelqu\'un sans accès à la liste → 400 ASSIGNEE_NOT_ALLOWED (POST et PATCH)', async () => {
      const a = await post('owner', '/api/todos', { listId: sharedListId, title: 'X', assigneeId: ids.outsider })
      expect(a.status).toBe(400)
      expect(a.body.error.code).toBe('ASSIGNEE_NOT_ALLOWED')

      const t = await newTodo('owner', sharedListId)
      const b = await patch('owner', `/api/todos/${t.id}`, { assigneeId: ids.outsider })
      expect(b.status).toBe(400)
      expect(b.body.error.code).toBe('ASSIGNEE_NOT_ALLOWED')

      const c = await post('owner', '/api/todos', { listId: sharedListId, title: 'X', assigneeId: 'inconnu' })
      expect(c.status).toBe(400)
      expect(c.body.error.code).toBe('ASSIGNEE_NOT_ALLOWED')
    })

    it('un utilisateur inactif ne peut pas être assigné', async () => {
      await prisma.user.update({ where: { id: ids.viewer }, data: { isActive: false } })
      try {
        const res = await post('owner', '/api/todos', { listId: sharedListId, title: 'X', assigneeId: ids.viewer })
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('ASSIGNEE_NOT_ALLOWED')
      } finally {
        await prisma.user.update({ where: { id: ids.viewer }, data: { isActive: true } })
      }
    })

    it('un utilisateur avec todos:read_all (ADMIN) peut être assigné sans être membre', async () => {
      const res = await post('owner', '/api/todos', { listId: sharedListId, title: 'Pour l\'admin', assigneeId: ids.admin })
      expect(res.status).toBe(201)
      expect(res.body.data.assigneeId).toBe(ids.admin)
    })

    it('assigneeId: null retire l\'assignation (UNASSIGNED)', async () => {
      const t = await newTodo('owner', sharedListId, { assigneeId: ids.editor })
      const res = await patch('owner', `/api/todos/${t.id}`, { assigneeId: null })
      expect(res.status).toBe(200)
      expect(res.body.data.assigneeId).toBeNull()
      expect(res.body.data.assignee).toBeNull()
      const last = (await get('owner', `/api/todos/${t.id}`)).body.data.events.pop()
      expect(last).toMatchObject({ type: 'UNASSIGNED', fromValue: ids.editor })
    })
  })

  // ─── Commentaires & événements ─────────────────────────────────────────

  describe('fil de tâche', () => {
    it('POST /todos/:id/comments → 201 ; validation du contenu', async () => {
      const t = await newTodo('owner', sharedListId, { title: 'Avec fil' })
      const res = await post('editor', `/api/todos/${t.id}/comments`, { content: 'Premier point fait' })
      expect(res.status).toBe(201)
      expect(res.body.data).toMatchObject({ content: 'Premier point fait', authorId: ids.editor, authorName: 'editor Todos' })
      expect(res.body.data.author.id).toBe(ids.editor)

      const empty = await post('editor', `/api/todos/${t.id}/comments`, { content: '   ' })
      expect(empty.status).toBe(400)
      expect(empty.body.error.code).toBe('VALIDATION_ERROR')
      const long = await post('editor', `/api/todos/${t.id}/comments`, { content: 'x'.repeat(2001) })
      expect(long.status).toBe(400)
    })

    it('GET /todos/:id → TodoDetailDTO : liste, commentaires et événements triés, commentCount', async () => {
      const t = await newTodo('owner', sharedListId, { title: 'Détail', priority: 'LOW' })
      await post('owner', `/api/todos/${t.id}/comments`, { content: 'un' })
      await post('editor', `/api/todos/${t.id}/comments`, { content: 'deux' })
      await patch('owner', `/api/todos/${t.id}`, { priority: 'HIGH' })

      const res = await get('viewer', `/api/todos/${t.id}`)
      expect(res.status).toBe(200)
      const d = res.body.data
      expect(d.list).toEqual({ id: sharedListId, name: 'Équipe test', color: null, isPersonal: false })
      expect(d.commentCount).toBe(2)
      expect(d.comments.map((c: { content: string }) => c.content)).toEqual(['un', 'deux'])
      expect(d.comments[0]).toHaveProperty('authorName')
      const times = d.events.map((e: { createdAt: string }) => new Date(e.createdAt).getTime())
      expect(times).toEqual([...times].sort((a, b) => a - b))
      expect(d.events.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'PRIORITY_CHANGED'])
    })

    it('événements DONE/REOPENED, PRIORITY_CHANGED, DUE_CHANGED ; completedAt géré', async () => {
      const t = await newTodo('owner', personalListId, { title: 'Événements' })

      const done = await patch('owner', `/api/todos/${t.id}`, { isDone: true })
      expect(done.body.data.isDone).toBe(true)
      expect(done.body.data.completedAt).not.toBeNull()
      // idempotent : re-cocher ne crée pas de nouvel événement
      await patch('owner', `/api/todos/${t.id}`, { isDone: true })

      const reopened = await patch('owner', `/api/todos/${t.id}`, { isDone: false })
      expect(reopened.body.data.completedAt).toBeNull()

      await patch('owner', `/api/todos/${t.id}`, { priority: 'HIGH' })
      const due = new Date(Date.now() + 5 * 86400000).toISOString()
      await patch('owner', `/api/todos/${t.id}`, { dueDate: due })
      await patch('owner', `/api/todos/${t.id}`, { dueDate: null })
      // titre seul : aucun événement
      await patch('owner', `/api/todos/${t.id}`, { title: 'Nouveau titre' })

      const events = (await get('owner', `/api/todos/${t.id}`)).body.data.events
      expect(events.map((e: { type: string }) => e.type)).toEqual([
        'CREATED', 'DONE', 'REOPENED', 'PRIORITY_CHANGED', 'DUE_CHANGED', 'DUE_CHANGED',
      ])
      expect(events[3]).toMatchObject({ fromValue: 'NORMAL', toValue: 'HIGH', authorId: ids.owner })
      expect(events[4]).toMatchObject({ fromValue: null, toValue: due })
      expect(events[5]).toMatchObject({ fromValue: due, toValue: null })
    })

    it('la suppression d\'une tâche supprime commentaires et événements (cascade)', async () => {
      const t = await newTodo('owner', sharedListId)
      await post('owner', `/api/todos/${t.id}/comments`, { content: 'bye' })
      await del('owner', `/api/todos/${t.id}`)
      expect(await prisma.todoComment.count({ where: { todoId: t.id } })).toBe(0)
      expect(await prisma.todoEvent.count({ where: { todoId: t.id } })).toBe(0)
    })
  })

  // ─── Rappels (scheduler) ───────────────────────────────────────────────

  describe('runTodoReminders', () => {
    it('J-1 : TODO_REMINDER au créateur, lien /todos?task=<id>, dédoublonné au 2e run', async () => {
      const dueDate = new Date(Date.now() + 12 * 60 * 60 * 1000)
      const todo = await prisma.todo.create({ data: { title: 'Échéance demain', ownerId: ids.owner, listId: personalListId, dueDate } })

      await runTodoReminders()
      const reminders = await prisma.notification.findMany({ where: { todoId: todo.id, type: 'TODO_REMINDER' } })
      expect(reminders).toHaveLength(1)
      expect(reminders[0].userId).toBe(ids.owner)
      expect(reminders[0].link).toBe(`/todos?task=${todo.id}`)
      expect(await prisma.notification.count({ where: { todoId: todo.id, type: 'TODO_DUE' } })).toBe(0)

      await runTodoReminders()
      expect(await prisma.notification.count({ where: { todoId: todo.id, type: 'TODO_REMINDER' } })).toBe(1)
    })

    it('jour J : TODO_DUE envoyée à l\'assigné (et non au créateur)', async () => {
      const dueDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const todo = await prisma.todo.create({
        data: { title: 'Assignée en retard', ownerId: ids.owner, listId: sharedListId, assigneeId: ids.editor, dueDate },
      })
      await runTodoReminders()
      const notifs = await prisma.notification.findMany({ where: { todoId: todo.id, type: 'TODO_DUE' } })
      expect(notifs).toHaveLength(1)
      expect(notifs[0].userId).toBe(ids.editor)
      expect(notifs[0].link).toBe(`/todos?task=${todo.id}`)
    })

    it('tâche terminée → aucune notification même en retard', async () => {
      const todo = await prisma.todo.create({
        data: { title: 'Faite', ownerId: ids.owner, listId: personalListId, dueDate: new Date(Date.now() - 86400000), isDone: true, completedAt: new Date() },
      })
      await runTodoReminders()
      expect(await prisma.notification.count({ where: { todoId: todo.id } })).toBe(0)
    })
  })
})
