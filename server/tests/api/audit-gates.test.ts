/**
 * Tests de non-régression de l'audit permissions du 2026-08-12 :
 * fermeture des routes « authentifié seulement » (notifications, Google Calendar)
 * et passage des gardes par rôle aux gardes par permission (users/:id, NPS).
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

const TECH_EMAIL = 'technicien-audit-test@test.local'
const TECH_PASSWORD = 'technicien-pwd-123'

let techUserId = ''
let adminUserId = ''
let adminToken = ''
let techToken = ''
let zeroScopeKey = ''
let zeroScopeKeyId = ''

describe('Audit permissions — fermeture des trous', () => {
  beforeAll(async () => {
    const techRole = await prisma.role.findUnique({ where: { name: 'TECHNICIEN' } })
    if (!techRole) throw new Error('Role TECHNICIEN not found in seed')

    const hashedPassword = await bcrypt.hash(TECH_PASSWORD, 10)
    const existing = await prisma.user.findUnique({ where: { email: TECH_EMAIL } })
    if (existing) {
      await prisma.refreshToken.deleteMany({ where: { userId: existing.id } })
      await prisma.user.delete({ where: { id: existing.id } })
    }
    const user = await prisma.user.create({
      data: {
        email: TECH_EMAIL,
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Technicien',
        role: 'TECHNICIEN',
        roleId: techRole.id,
      },
    })
    techUserId = user.id

    const adminLogin = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = adminLogin.accessToken
    adminUserId = adminLogin.user.id
    techToken = (await loginAs(app, TECH_EMAIL, TECH_PASSWORD)).accessToken

    // Clé API sans aucun droit (permissions par défaut = [])
    const keyRes = await request(app)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'audit-zero-scope' })
    zeroScopeKey = keyRes.body.data.key
    zeroScopeKeyId = keyRes.body.data.id
  })

  afterAll(async () => {
    if (zeroScopeKeyId) await prisma.apiKey.deleteMany({ where: { id: zeroScopeKeyId } })
    if (techUserId) {
      await prisma.refreshToken.deleteMany({ where: { userId: techUserId } })
      await prisma.user.delete({ where: { id: techUserId } })
    }
    await prisma.$disconnect()
  })

  // ─── T1 : notifications gardées par notifications:read ────────────────────
  it('notifications : 200 pour un TECHNICIEN (notifications:read seedée par défaut)', async () => {
    const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${techToken}`)
    expect(res.status).toBe(200)
  })

  it('notifications : 403 pour une clé API à zéro droit (trou T1 fermé)', async () => {
    const res = await request(app).get('/api/notifications').set('X-API-Key', zeroScopeKey)
    expect(res.status).toBe(403)
  })

  // ─── T2 : Google Calendar gardé par google:calendar ────────────────────────
  it('google/status : 200 pour un TECHNICIEN (google:calendar seedée par défaut)', async () => {
    const res = await request(app).get('/api/google/status').set('Authorization', `Bearer ${techToken}`)
    expect(res.status).toBe(200)
  })

  it('google/status : 403 pour une clé API à zéro droit (trou T2 fermé)', async () => {
    const res = await request(app).get('/api/google/status').set('X-API-Key', zeroScopeKey)
    expect(res.status).toBe(403)
  })

  // ─── NPS : nps:read remplace dashboard:read ────────────────────────────────
  it('dashboard/nps : 403 pour un TECHNICIEN (pas de nps:read), 200 pour un ADMIN', async () => {
    const tech = await request(app).get('/api/dashboard/nps').set('Authorization', `Bearer ${techToken}`)
    expect(tech.status).toBe(403)
    const admin = await request(app).get('/api/dashboard/nps').set('Authorization', `Bearer ${adminToken}`)
    expect(admin.status).toBe(200)
  })

  // ─── users/:id : permissions au lieu des rôles en dur ─────────────────────
  it('GET /users/:id : soi-même 200, un tiers 403 sans users:read', async () => {
    const self = await request(app).get(`/api/users/${techUserId}`).set('Authorization', `Bearer ${techToken}`)
    expect(self.status).toBe(200)
    const other = await request(app).get(`/api/users/${adminUserId}`).set('Authorization', `Bearer ${techToken}`)
    expect(other.status).toBe(403)
  })

  it('PATCH /users/:id/password : un tiers sans users:update → 403', async () => {
    const res = await request(app)
      .patch(`/api/users/${adminUserId}/password`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ newPassword: 'NouveauPass123' })
    expect(res.status).toBe(403)
  })

  it('PUT /users/:id : un tiers sans users:update → 403, soi-même → 200', async () => {
    const other = await request(app)
      .put(`/api/users/${adminUserId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ firstName: 'Hack' })
    expect(other.status).toBe(403)

    const self = await request(app)
      .put(`/api/users/${techUserId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ firstName: 'Testeur' })
    expect(self.status).toBe(200)
    expect(self.body.data.firstName).toBe('Testeur')
  })

  it('PUT /users/:id : un porteur de users:update ne peut pas toucher un compte ADMIN', async () => {
    // Donne temporairement users:update au rôle TECHNICIEN
    const techRole = await prisma.role.findUnique({ where: { name: 'TECHNICIEN' } })
    const perm = await prisma.permission.findUnique({ where: { key: 'users:update' } })
    if (!techRole || !perm) throw new Error('seed incomplet')
    await prisma.rolePermission.create({ data: { roleId: techRole.id, permissionId: perm.id } })
    try {
      // Re-login pour obtenir un token avec la nouvelle permission
      const freshToken = (await loginAs(app, TECH_EMAIL, TECH_PASSWORD)).accessToken

      // Peut éditer les champs de base d'un ADMIN ? Non : cible ADMIN protégée pour rôle/isActive,
      // et le mot de passe d'un ADMIN est intouchable par un non-'*'
      const roleChange = await request(app)
        .put(`/api/users/${adminUserId}`)
        .set('Authorization', `Bearer ${freshToken}`)
        .send({ isActive: false })
      expect(roleChange.status).toBe(403)

      const pwd = await request(app)
        .patch(`/api/users/${adminUserId}/password`)
        .set('Authorization', `Bearer ${freshToken}`)
        .send({ newPassword: 'NouveauPass123' })
      expect(pwd.status).toBe(403)
    } finally {
      await prisma.rolePermission.deleteMany({ where: { roleId: techRole.id, permissionId: perm.id } })
    }
  })
})
