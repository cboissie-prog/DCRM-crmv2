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

const TECH_EMAIL = 'technicien-docs-test@test.local'
const TECH_PASSWORD = 'technicien-pwd-123'

let techUserId: string

describe('Documentation API (/api/docs)', () => {
  beforeAll(async () => {
    // Crée un user TECHNICIEN de test (rôle sans apidocs:read)
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
  })

  afterAll(async () => {
    if (techUserId) {
      await prisma.refreshToken.deleteMany({ where: { userId: techUserId } })
      await prisma.user.delete({ where: { id: techUserId } })
    }
    await prisma.$disconnect()
  })

  it('GET /api/docs/markdown → 401 sans token', async () => {
    const res = await request(app).get('/api/docs/markdown')
    expect(res.status).toBe(401)
  })

  it('GET /api/docs/markdown → 403 pour un TECHNICIEN (pas de apidocs:read)', async () => {
    const { accessToken } = await loginAs(app, TECH_EMAIL, TECH_PASSWORD)

    const res = await request(app)
      .get('/api/docs/markdown')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
  })

  it('GET /api/docs/markdown → 200 pour un ADMIN, contenu markdown', async () => {
    const { accessToken } = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)

    const res = await request(app)
      .get('/api/docs/markdown')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/markdown')
    expect(res.text).toContain('# Documentation API')
  })

  it('GET /api/docs/openapi → 200 pour un ADMIN, JSON OpenAPI valide', async () => {
    const { accessToken } = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)

    const res = await request(app)
      .get('/api/docs/openapi')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    const spec = JSON.parse(res.text)
    expect(spec.openapi).toMatch(/^3\./)
    expect(spec.paths).toBeTypeOf('object')
    expect(Object.keys(spec.paths).length).toBeGreaterThan(50)
  })
})
