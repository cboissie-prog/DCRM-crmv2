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

const COMMERCIAL_EMAIL = 'commercial-rbac-test@test.local'
const COMMERCIAL_PASSWORD = 'commercial-pwd-123'

let commercialUserId: string

describe('RBAC', () => {
  beforeAll(async () => {
    // Crée un user COMMERCIAL de test lié au rôle COMMERCIAL
    const commercialRole = await prisma.role.findUnique({ where: { name: 'COMMERCIAL' } })
    if (!commercialRole) throw new Error('Role COMMERCIAL not found in seed')

    const hashedPassword = await bcrypt.hash(COMMERCIAL_PASSWORD, 10)

    // Supprime un éventuel résidu de run précédent avant de créer
    const existing = await prisma.user.findUnique({ where: { email: COMMERCIAL_EMAIL } })
    if (existing) {
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
  })

  afterAll(async () => {
    // Nettoyage : supprime le user commercial créé pour ce test
    if (commercialUserId) {
      await prisma.refreshToken.deleteMany({ where: { userId: commercialUserId } })
      await prisma.user.delete({ where: { id: commercialUserId } })
    }
    await prisma.$disconnect()
  })

  it('GET /api/users → 403 pour un COMMERCIAL (pas de users:read)', async () => {
    const { accessToken } = await loginAs(app, COMMERCIAL_EMAIL, COMMERCIAL_PASSWORD)

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
  })

  it('GET /api/contacts → 200 pour un COMMERCIAL (contacts:read inclus)', async () => {
    const { accessToken } = await loginAs(app, COMMERCIAL_EMAIL, COMMERCIAL_PASSWORD)

    const res = await request(app)
      .get('/api/contacts')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('GET /api/users → 200 pour un ADMIN (bypass *)', async () => {
    const { accessToken } = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('requête sans token → 401', async () => {
    const res = await request(app).get('/api/users')
    expect(res.status).toBe(401)
  })
})
