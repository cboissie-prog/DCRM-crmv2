/**
 * calendar-visibility.test.ts
 * Test des règles de visibilité des calendriers personnels.
 *
 * Scénario :
 *   - Admin (seed existant)
 *   - Utilisateur A (COMMERCIAL, sans accès partagé au départ)
 *   - Utilisateur B (COMMERCIAL, participant d'un RDV)
 *   - RDV créé avec B comme seul participant
 *
 *   Cas testés :
 *     1. A (non admin, sans partage) ne voit PAS le RDV de B dans GET /appointments
 *     2. A demande ownerId=B sans partage → 403 CALENDAR_FORBIDDEN
 *     3. Admin voit TOUS les RDV (permission *)
 *     4. Après ajout CalendarAccess(viewerId=A, ownerId=B), A voit le RDV de B
 *     5. GET /calendar-access/mine → A voit son propre calendrier + B
 *     6. DELETE du partage → A ne voit plus le RDV de B
 *     7. RDV orphelin (aucun participant) visible par tous les utilisateurs authentifiés
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

const USER_A_EMAIL = 'cal-vis-user-a@test.local'
const USER_A_PWD = 'cal-vis-user-a-pwd-123'
const USER_B_EMAIL = 'cal-vis-user-b@test.local'
const USER_B_PWD = 'cal-vis-user-b-pwd-123'

let adminToken: string
let tokenA: string
let tokenB: string
let userAId: string
let userBId: string
let rdvWithBId: string
let rdvOrphanId: string

describe('Calendar Visibility', () => {
  beforeAll(async () => {
    // Login admin
    const adminLogin = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = adminLogin.accessToken

    const commercialRole = await prisma.role.findUnique({ where: { name: 'COMMERCIAL' } })
    if (!commercialRole) throw new Error('Role COMMERCIAL not found')

    // Nettoyer les résidus éventuels
    for (const email of [USER_A_EMAIL, USER_B_EMAIL]) {
      const ex = await prisma.user.findUnique({ where: { email } })
      if (ex) {
        await prisma.refreshToken.deleteMany({ where: { userId: ex.id } })
        await prisma.calendarAccess.deleteMany({
          where: { OR: [{ viewerId: ex.id }, { ownerId: ex.id }] },
        })
        await prisma.appointmentUser.deleteMany({ where: { userId: ex.id } })
        await prisma.user.delete({ where: { id: ex.id } })
      }
    }

    const pwdA = await bcrypt.hash(USER_A_PWD, 10)
    const pwdB = await bcrypt.hash(USER_B_PWD, 10)

    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: {
          email: USER_A_EMAIL, password: pwdA,
          firstName: 'Alice', lastName: 'CalTest',
          role: 'COMMERCIAL', roleId: commercialRole.id,
        },
      }),
      prisma.user.create({
        data: {
          email: USER_B_EMAIL, password: pwdB,
          firstName: 'Bob', lastName: 'CalTest',
          role: 'COMMERCIAL', roleId: commercialRole.id,
        },
      }),
    ])
    userAId = userA.id
    userBId = userB.id

    // Login A et B
    const [loginA, loginB] = await Promise.all([
      loginAs(app, USER_A_EMAIL, USER_A_PWD),
      loginAs(app, USER_B_EMAIL, USER_B_PWD),
    ])
    tokenA = loginA.accessToken
    tokenB = loginB.accessToken

    // Créer un RDV avec B comme participant (via API, avec token B)
    const rdvRes = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        title: 'RDV de B',
        type: 'CLIENT_MEETING',
        startAt: new Date('2030-01-15T10:00:00Z').toISOString(),
        endAt:   new Date('2030-01-15T11:00:00Z').toISOString(),
        userIds: [userBId],
      })
    expect(rdvRes.status).toBe(201)
    rdvWithBId = rdvRes.body.data.id

    // Créer un RDV orphelin (aucun participant) — via admin
    const orphanRes = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'RDV orphelin',
        type: 'OTHER',
        startAt: new Date('2030-01-16T10:00:00Z').toISOString(),
        endAt:   new Date('2030-01-16T11:00:00Z').toISOString(),
        userIds: [],
      })
    expect(orphanRes.status).toBe(201)
    rdvOrphanId = orphanRes.body.data.id
  })

  afterAll(async () => {
    // Nettoyage des RDV créés
    if (rdvWithBId) await prisma.appointment.deleteMany({ where: { id: rdvWithBId } }).catch(() => {})
    if (rdvOrphanId) await prisma.appointment.deleteMany({ where: { id: rdvOrphanId } }).catch(() => {})

    // Nettoyage des partages
    await prisma.calendarAccess.deleteMany({
      where: { OR: [{ viewerId: userAId }, { ownerId: userAId }, { viewerId: userBId }, { ownerId: userBId }] },
    }).catch(() => {})

    // Nettoyage des utilisateurs créés
    for (const id of [userAId, userBId]) {
      if (id) {
        await prisma.refreshToken.deleteMany({ where: { userId: id } }).catch(() => {})
        await prisma.user.delete({ where: { id } }).catch(() => {})
      }
    }

    await prisma.$disconnect()
  })

  // ── 1. A ne voit pas le RDV de B sans partage ────────────────────────────────

  it('A (sans partage) ne voit PAS le RDV de B dans GET /appointments', async () => {
    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as { id: string }[]).map(r => r.id)
    expect(ids).not.toContain(rdvWithBId)
  })

  // ── 2. A demande ownerId=B sans partage → 403 ────────────────────────────────

  it('A demande ownerId=B sans partage → 403 CALENDAR_FORBIDDEN', async () => {
    const res = await request(app)
      .get(`/api/appointments?ownerId=${userBId}`)
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CALENDAR_FORBIDDEN')
  })

  // ── 3. Admin voit tous les RDV ───────────────────────────────────────────────

  it('Admin voit tous les RDV (permission *)', async () => {
    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as { id: string }[]).map(r => r.id)
    expect(ids).toContain(rdvWithBId)
    expect(ids).toContain(rdvOrphanId)
  })

  // ── 4. Après partage CalendarAccess(A→B), A voit le RDV de B ─────────────────

  it('Après ajout CalendarAccess(A→B), A voit le RDV de B', async () => {
    // Créer le partage via l'API admin
    const shareRes = await request(app)
      .post('/api/calendar-access')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ viewerId: userAId, ownerId: userBId })

    expect(shareRes.status).toBe(201)

    // A devrait maintenant voir le RDV de B
    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as { id: string }[]).map(r => r.id)
    expect(ids).toContain(rdvWithBId)
  })

  // ── 5. GET /calendar-access/mine → A voit son propre calendrier + B ──────────

  it('GET /calendar-access/mine renvoie [A, B] pour A après partage', async () => {
    const res = await request(app)
      .get('/api/calendar-access/mine')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as { id: string }[]).map(u => u.id)
    expect(ids).toContain(userAId)
    expect(ids).toContain(userBId)
  })

  // ── 5b. A peut demander ownerId=B après le partage ───────────────────────────

  it('A peut demander ownerId=B après le partage → 200 avec RDV de B', async () => {
    const res = await request(app)
      .get(`/api/appointments?ownerId=${userBId}`)
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as { id: string }[]).map(r => r.id)
    expect(ids).toContain(rdvWithBId)
  })

  // ── 6. Après suppression du partage, A ne voit plus le RDV de B ─────────────

  it('Après suppression du partage, A ne voit plus le RDV de B', async () => {
    // Supprimer le partage
    const delRes = await request(app)
      .delete(`/api/calendar-access/${userAId}/${userBId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(delRes.status).toBe(200)

    // A ne devrait plus voir le RDV de B
    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as { id: string }[]).map(r => r.id)
    expect(ids).not.toContain(rdvWithBId)
  })

  // ── 7. RDV orphelin visible par tous les utilisateurs authentifiés ────────────

  it('RDV orphelin visible par A (utilisateur sans partage)', async () => {
    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as { id: string }[]).map(r => r.id)
    expect(ids).toContain(rdvOrphanId)
  })

  // ── 8. B voit son propre RDV ─────────────────────────────────────────────────

  it('B voit son propre RDV', async () => {
    const res = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${tokenB}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as { id: string }[]).map(r => r.id)
    expect(ids).toContain(rdvWithBId)
  })

  // ── 9. Admin peut lister les partages (GET /calendar-access) ─────────────────

  it('Admin peut lister les partages GET /calendar-access → 200', async () => {
    const res = await request(app)
      .get('/api/calendar-access')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  // ── 10. A (COMMERCIAL) ne peut pas accéder à GET /calendar-access ────────────

  it('A (COMMERCIAL) ne peut pas accéder à GET /calendar-access → 403', async () => {
    const res = await request(app)
      .get('/api/calendar-access')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(403)
  })

  // ── 11. Upsert idempotent (POST deux fois même partage) ──────────────────────

  it('POST /calendar-access deux fois le même partage → idempotent (201)', async () => {
    const payload = { viewerId: userAId, ownerId: userBId }

    const res1 = await request(app)
      .post('/api/calendar-access')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)
    expect(res1.status).toBe(201)

    const res2 = await request(app)
      .post('/api/calendar-access')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)
    expect(res2.status).toBe(201)

    // Nettoyage
    await request(app)
      .delete(`/api/calendar-access/${userAId}/${userBId}`)
      .set('Authorization', `Bearer ${adminToken}`)
  })

  // ── 12. DELETE partage inexistant → 404 ──────────────────────────────────────

  it('DELETE partage inexistant → 404', async () => {
    const res = await request(app)
      .delete(`/api/calendar-access/${userAId}/${userBId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})
