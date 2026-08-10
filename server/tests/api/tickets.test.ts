/**
 * tickets.test.ts — module Tickets : CRUD, références, tri, transitions de statut,
 * temps détaillé, commentaires, historique, permissions (tickets:assign), NPS public.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { signNpsToken } from '../../src/lib/nps-token'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

const TECH_EMAIL = 'technicien-tickets-test@test.local'
const TECH_PASSWORD = 'technicien-pwd-123'

let adminToken: string
let techToken: string
let techUserId: string
let adminUserId: string

async function createTicket(token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Ticket de test',
      description: 'Description de test',
      category: 'OTHER',
      ...overrides,
    })
  return res
}

describe('Tickets', () => {
  beforeAll(async () => {
    // Base propre pour les assertions de tri et de référence
    await prisma.ticket.deleteMany()
    await prisma.notification.deleteMany()

    const techRole = await prisma.role.findUnique({ where: { name: 'TECHNICIEN' } })
    if (!techRole) throw new Error('Role TECHNICIEN not found in seed')

    const existing = await prisma.user.findUnique({ where: { email: TECH_EMAIL } })
    if (existing) {
      await prisma.refreshToken.deleteMany({ where: { userId: existing.id } })
      await prisma.user.delete({ where: { id: existing.id } })
    }
    const tech = await prisma.user.create({
      data: {
        email: TECH_EMAIL,
        password: await bcrypt.hash(TECH_PASSWORD, 10),
        firstName: 'Test',
        lastName: 'Technicien',
        role: 'TECHNICIEN',
        roleId: techRole.id,
      },
    })
    techUserId = tech.id

    const adminLogin = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = adminLogin.accessToken
    adminUserId = adminLogin.user.id
    const techLogin = await loginAs(app, TECH_EMAIL, TECH_PASSWORD)
    techToken = techLogin.accessToken
  })

  afterAll(async () => {
    await prisma.ticket.deleteMany()
    if (techUserId) {
      await prisma.refreshToken.deleteMany({ where: { userId: techUserId } })
      await prisma.notification.deleteMany({ where: { userId: techUserId } })
      await prisma.user.delete({ where: { id: techUserId } })
    }
    await prisma.$disconnect()
  })

  // ─── Création & référence ──────────────────────────────────────────────────

  it('POST /api/tickets → 201, référence TKT-<année>-NNNN, SLA et priorityOrder posés', async () => {
    const res = await createTicket(adminToken, { priority: 'HIGH' })
    expect(res.status).toBe(201)
    const year = new Date().getFullYear()
    expect(res.body.data.reference).toMatch(new RegExp(`^TKT-${year}-\\d{4}$`))
    expect(res.body.data.priorityOrder).toBe(2)
    expect(res.body.data.slaDeadline).toBeTruthy()
    // SLA HIGH par défaut : 8h après création (tolérance 5 min)
    const sla = new Date(res.body.data.slaDeadline).getTime()
    const expected = Date.now() + 8 * 60 * 60 * 1000
    expect(Math.abs(sla - expected)).toBeLessThan(5 * 60 * 1000)
  })

  it('les références restent uniques après une suppression', async () => {
    const a = await createTicket(adminToken)
    const b = await createTicket(adminToken)
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    // Supprime le premier : un compteur count() redescendrait et provoquerait un doublon
    await request(app).delete(`/api/tickets/${a.body.data.id}`).set('Authorization', `Bearer ${adminToken}`)
    const c = await createTicket(adminToken)
    expect(c.status).toBe(201)
    expect(c.body.data.reference).not.toBe(b.body.data.reference)
    const numB = parseInt(b.body.data.reference.slice(-4), 10)
    const numC = parseInt(c.body.data.reference.slice(-4), 10)
    expect(numC).toBe(numB + 1)
  })

  it('un évènement CREATED est tracé dans l\'historique', async () => {
    const res = await createTicket(adminToken)
    const detail = await request(app)
      .get(`/api/tickets/${res.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(detail.status).toBe(200)
    const events = detail.body.data.events as { type: string }[]
    expect(events.some(e => e.type === 'CREATED')).toBe(true)
  })

  // ─── Tri ───────────────────────────────────────────────────────────────────

  it('la liste trie les CRITICAL avant les NORMAL (priorityOrder, pas alphabétique)', async () => {
    await prisma.ticket.deleteMany()
    await createTicket(adminToken, { priority: 'NORMAL', title: 'normal' })
    await createTicket(adminToken, { priority: 'CRITICAL', title: 'critique' })
    await createTicket(adminToken, { priority: 'LOW', title: 'faible' })
    const res = await request(app).get('/api/tickets').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    const priorities = (res.body.data as { priority: string }[]).map(t => t.priority)
    expect(priorities[0]).toBe('CRITICAL')
    expect(priorities[priorities.length - 1]).toBe('LOW')
  })

  it('sortBy=createdAt&sortOrder=asc trie du plus ancien au plus récent', async () => {
    const res = await request(app)
      .get('/api/tickets?sortBy=createdAt&sortOrder=asc')
      .set('Authorization', `Bearer ${adminToken}`)
    const dates = (res.body.data as { createdAt: string }[]).map(t => new Date(t.createdAt).getTime())
    expect([...dates].sort((x, y) => x - y)).toEqual(dates)
  })

  it('filtre multi-statut : ?status=NEW&status=CLOSED', async () => {
    const t = await createTicket(adminToken)
    await request(app)
      .patch(`/api/tickets/${t.body.data.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CLOSED' })
    const res = await request(app)
      .get('/api/tickets?status=NEW&status=CLOSED')
      .set('Authorization', `Bearer ${adminToken}`)
    const statuses = new Set((res.body.data as { status: string }[]).map(x => x.status))
    expect([...statuses].every(s => s === 'NEW' || s === 'CLOSED')).toBe(true)
    expect(statuses.has('CLOSED')).toBe(true)
  })

  // ─── Transitions de statut ─────────────────────────────────────────────────

  it('PATCH status invalide → 400', async () => {
    const t = await createTicket(adminToken)
    const res = await request(app)
      .patch(`/api/tickets/${t.body.data.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'N_IMPORTE_QUOI' })
    expect(res.status).toBe(400)
  })

  it('RESOLVED pose resolvedAt ; re-poser le même statut ne l\'écrase pas', async () => {
    const t = await createTicket(adminToken)
    const first = await request(app)
      .patch(`/api/tickets/${t.body.data.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RESOLVED' })
    expect(first.status).toBe(200)
    const resolvedAt1 = first.body.data.resolvedAt
    expect(resolvedAt1).toBeTruthy()
    // Idempotence : un second PATCH RESOLVED ne change pas la date
    await new Promise(r => setTimeout(r, 20))
    const second = await request(app)
      .patch(`/api/tickets/${t.body.data.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RESOLVED' })
    expect(second.status).toBe(200)
    expect(second.body.data.resolvedAt).toBe(resolvedAt1)
  })

  it('réouverture : CLOSED → IN_PROGRESS remet resolvedAt/closedAt à null et trace REOPENED', async () => {
    const t = await createTicket(adminToken)
    const id = t.body.data.id
    await request(app).patch(`/api/tickets/${id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'RESOLVED' })
    await request(app).patch(`/api/tickets/${id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CLOSED' })
    const reopened = await request(app)
      .patch(`/api/tickets/${id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'IN_PROGRESS' })
    expect(reopened.status).toBe(200)
    expect(reopened.body.data.resolvedAt).toBeNull()
    expect(reopened.body.data.closedAt).toBeNull()
    const detail = await request(app).get(`/api/tickets/${id}`).set('Authorization', `Bearer ${adminToken}`)
    const events = detail.body.data.events as { type: string }[]
    expect(events.some(e => e.type === 'REOPENED')).toBe(true)
  })

  // ─── Temps détaillé ────────────────────────────────────────────────────────

  it('PATCH /time crée une entrée détaillée et incrémente le total', async () => {
    const t = await createTicket(adminToken)
    const res = await request(app)
      .patch(`/api/tickets/${t.body.data.id}/time`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ minutes: 45, note: 'Diagnostic sur site' })
    expect(res.status).toBe(200)
    expect(res.body.data.timeSpent).toBe(45)
    const detail = await request(app).get(`/api/tickets/${t.body.data.id}`).set('Authorization', `Bearer ${adminToken}`)
    const entries = detail.body.data.timeEntries as { minutes: number; note?: string; user?: { id: string } }[]
    expect(entries).toHaveLength(1)
    expect(entries[0].minutes).toBe(45)
    expect(entries[0].note).toBe('Diagnostic sur site')
    expect(entries[0].user?.id).toBe(adminUserId)
  })

  it('PATCH /time refuse les minutes négatives ou nulles', async () => {
    const t = await createTicket(adminToken)
    for (const minutes of [0, -30, 'abc']) {
      const res = await request(app)
        .patch(`/api/tickets/${t.body.data.id}/time`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ minutes })
      expect(res.status).toBe(400)
    }
  })

  // ─── Commentaires ──────────────────────────────────────────────────────────

  it('POST /comments résout l\'auteur côté serveur et lie authorId', async () => {
    const t = await createTicket(adminToken)
    const res = await request(app)
      .post(`/api/tickets/${t.body.data.id}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: 'Un commentaire', isInternal: true, authorName: 'Usurpateur' })
    expect(res.status).toBe(201)
    expect(res.body.data.authorName).not.toBe('Usurpateur')
    expect(res.body.data.authorId).toBe(adminUserId)
    expect(res.body.data.isInternal).toBe(true)
  })

  it('POST /comments sur un ticket inexistant → 404', async () => {
    const res = await request(app)
      .post('/api/tickets/00000000-0000-0000-0000-000000000000/comments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: 'test' })
    expect(res.status).toBe(404)
  })

  // ─── Permissions ───────────────────────────────────────────────────────────

  it('TECHNICIEN : delete → 403, export → 403', async () => {
    const t = await createTicket(adminToken)
    const del = await request(app).delete(`/api/tickets/${t.body.data.id}`).set('Authorization', `Bearer ${techToken}`)
    expect(del.status).toBe(403)
    const exp = await request(app).get('/api/tickets/export/csv').set('Authorization', `Bearer ${techToken}`)
    expect(exp.status).toBe(403)
  })

  it('TECHNICIEN : assigner un ticket à un autre utilisateur → 403 (pas de tickets:assign)', async () => {
    const t = await createTicket(adminToken)
    const res = await request(app)
      .put(`/api/tickets/${t.body.data.id}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ assignedToId: adminUserId })
    expect(res.status).toBe(403)
  })

  it('TECHNICIEN : s\'auto-assigner un ticket NEW → 200, statut passe IN_PROGRESS, notification absente', async () => {
    const t = await createTicket(adminToken)
    const res = await request(app)
      .put(`/api/tickets/${t.body.data.id}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ assignedToId: techUserId })
    expect(res.status).toBe(200)
    expect(res.body.data.assignedToId).toBe(techUserId)
    expect(res.body.data.status).toBe('IN_PROGRESS')
    // Pas de notification quand on s'assigne soi-même
    const notifs = await prisma.notification.findMany({ where: { userId: techUserId, type: 'TICKET_ASSIGNED' } })
    expect(notifs).toHaveLength(0)
  })

  it('ADMIN assigne au technicien → notification TICKET_ASSIGNED + évènement ASSIGNED', async () => {
    const t = await createTicket(adminToken)
    const res = await request(app)
      .put(`/api/tickets/${t.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assignedToId: techUserId })
    expect(res.status).toBe(200)
    const notifs = await prisma.notification.findMany({ where: { userId: techUserId, type: 'TICKET_ASSIGNED' } })
    expect(notifs.length).toBeGreaterThan(0)
    const detail = await request(app).get(`/api/tickets/${t.body.data.id}`).set('Authorization', `Bearer ${adminToken}`)
    const events = detail.body.data.events as { type: string }[]
    expect(events.some(e => e.type === 'ASSIGNED')).toBe(true)
  })

  it('ticket CRITICAL créé par le technicien → notification TICKET_URGENT aux managers', async () => {
    await prisma.notification.deleteMany({ where: { type: 'TICKET_URGENT' } })
    const res = await createTicket(techToken, { priority: 'CRITICAL' })
    expect(res.status).toBe(201)
    const notifs = await prisma.notification.findMany({ where: { type: 'TICKET_URGENT', userId: adminUserId } })
    expect(notifs.length).toBeGreaterThan(0)
  })

  // ─── NPS public ────────────────────────────────────────────────────────────

  it('NPS : GET avec jeton signé → infos minimales ; POST → 201 puis 409 ; jeton falsifié → 404', async () => {
    const t = await createTicket(adminToken, { title: 'Ticket NPS' })
    const token = signNpsToken(t.body.data.id)

    const info = await request(app).get(`/api/nps/${token}`)
    expect(info.status).toBe(200)
    expect(info.body.data.reference).toBe(t.body.data.reference)
    expect(info.body.data.alreadyAnswered).toBe(false)
    // Ne doit exposer aucune donnée sensible
    expect(info.body.data.contactId).toBeUndefined()

    const post = await request(app).post(`/api/nps/${token}`).send({ score: 9, comment: 'Très satisfait' })
    expect(post.status).toBe(201)

    const again = await request(app).post(`/api/nps/${token}`).send({ score: 2 })
    expect(again.status).toBe(409)

    const forged = await request(app).get(`/api/nps/${Buffer.from(`${t.body.data.id}.${Date.now() + 10000}`).toString('base64url')}.fausse-signature`)
    expect(forged.status).toBe(404)

    const badScore = await request(app).post(`/api/nps/${token}`).send({ score: 11 })
    expect(badScore.status).toBe(400)
  })

  it('NPS : l\'avis apparaît sur le ticket (npsResponse + évènement NPS_RECEIVED)', async () => {
    const t = await createTicket(adminToken)
    const token = signNpsToken(t.body.data.id)
    await request(app).post(`/api/nps/${token}`).send({ score: 10 })
    const detail = await request(app).get(`/api/tickets/${t.body.data.id}`).set('Authorization', `Bearer ${adminToken}`)
    expect(detail.body.data.npsResponse?.score).toBe(10)
    const events = detail.body.data.events as { type: string }[]
    expect(events.some(e => e.type === 'NPS_RECEIVED')).toBe(true)
  })

  // ─── Export CSV ────────────────────────────────────────────────────────────

  it('export CSV : respecte les filtres multi-statut et search', async () => {
    await createTicket(adminToken, { title: 'ExportCible', priority: 'LOW' })
    const res = await request(app)
      .get('/api/tickets/export/csv?search=ExportCible')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    const lines = res.text.trim().split('\n')
    expect(lines.length).toBe(2) // entête + 1 ligne
    expect(lines[1]).toContain('ExportCible')
  })
})
