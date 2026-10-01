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
const TECH_EMAIL = 'technicien-mail-test@test.local'
const TECH_PASSWORD = 'technicien-pwd-123'

let techUserId: string
let adminToken: string

describe('Diagnostic SMTP (/api/settings/mail)', () => {
  beforeAll(async () => {
    // L'environnement de test n'a pas de SMTP : les routes doivent le dire proprement
    delete process.env.SMTP_HOST
    delete process.env.SMTP_USER

    const techRole = await prisma.role.findUnique({ where: { name: 'TECHNICIEN' } })
    if (!techRole) throw new Error('Role TECHNICIEN not found in seed')
    const existing = await prisma.user.findUnique({ where: { email: TECH_EMAIL } })
    if (existing) {
      await prisma.refreshToken.deleteMany({ where: { userId: existing.id } })
      await prisma.user.delete({ where: { id: existing.id } })
    }
    const user = await prisma.user.create({
      data: {
        email: TECH_EMAIL,
        password: await bcrypt.hash(TECH_PASSWORD, 10),
        firstName: 'Test',
        lastName: 'Technicien',
        role: 'TECHNICIEN',
        roleId: techRole.id,
      },
    })
    techUserId = user.id
    adminToken = (await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)).accessToken
  })

  afterAll(async () => {
    if (techUserId) {
      await prisma.refreshToken.deleteMany({ where: { userId: techUserId } })
      await prisma.user.delete({ where: { id: techUserId } })
    }
    await prisma.$disconnect()
  })

  it('GET /settings/mail/status → 401 sans token', async () => {
    const res = await request(app).get('/api/settings/mail/status')
    expect(res.status).toBe(401)
  })

  it('GET /settings/mail/status → 403 pour un TECHNICIEN (pas de settings:write)', async () => {
    const { accessToken } = await loginAs(app, TECH_EMAIL, TECH_PASSWORD)
    const res = await request(app).get('/api/settings/mail/status').set('Authorization', `Bearer ${accessToken}`)
    expect(res.status).toBe(403)
  })

  it('GET /settings/mail/status → état "non configuré" sans SMTP, variables manquantes listées', async () => {
    const res = await request(app).get('/api/settings/mail/status?probe=false').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.configured).toBe(false)
    expect(res.body.data.host).toBeNull()
    expect(['SSL', 'STARTTLS']).toContain(res.body.data.mode)
    expect(res.body.data.missing).toContain('SMTP_HOST')
    expect(res.body.data.connection).toBeUndefined()
    // Jamais de secret dans la réponse
    expect(JSON.stringify(res.body)).not.toMatch(/SMTP_PASS=|pass"/)
  })

  it('POST /settings/mail/test → 400 si adresse invalide', async () => {
    const res = await request(app).post('/api/settings/mail/test').set('Authorization', `Bearer ${adminToken}`).send({ to: 'pas-un-email' })
    expect(res.status).toBe(400)
  })

  it('POST /settings/mail/test → 503 MAILER_NOT_CONFIGURED sans SMTP', async () => {
    const res = await request(app).post('/api/settings/mail/test').set('Authorization', `Bearer ${adminToken}`).send({ to: 'dest@test.local' })
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('MAILER_NOT_CONFIGURED')
  })

  it('POST /settings/mail/test → 403 pour un TECHNICIEN', async () => {
    const { accessToken } = await loginAs(app, TECH_EMAIL, TECH_PASSWORD)
    const res = await request(app).post('/api/settings/mail/test').set('Authorization', `Bearer ${accessToken}`).send({ to: 'dest@test.local' })
    expect(res.status).toBe(403)
  })
})
