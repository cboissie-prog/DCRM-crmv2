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

const TECH_EMAIL = 'technicien-apikey-test@test.local'
const TECH_PASSWORD = 'technicien-pwd-123'

let techUserId: string
let adminToken: string
let techToken: string
const createdKeyIds: string[] = []

async function createKey(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/apikeys')
    .set('Authorization', `Bearer ${token}`)
    .send(body)
}

describe('Clés API à portée restreinte (scopes)', () => {
  beforeAll(async () => {
    // User TECHNICIEN de test — son rôle n'a ni users:read ni apikeys:manage par défaut :
    // on lui ajoute apikeys:manage pour tester la création par un non-admin.
    const techRole = await prisma.role.findUnique({ where: { name: 'TECHNICIEN' } })
    if (!techRole) throw new Error('Role TECHNICIEN not found in seed')
    const manage = await prisma.permission.findUnique({ where: { key: 'apikeys:manage' } })
    if (!manage) throw new Error('Permission apikeys:manage not found in seed')
    const alreadyLinked = await prisma.rolePermission.findFirst({
      where: { roleId: techRole.id, permissionId: manage.id },
    })
    if (!alreadyLinked) {
      await prisma.rolePermission.create({ data: { roleId: techRole.id, permissionId: manage.id } })
    }

    const hashedPassword = await bcrypt.hash(TECH_PASSWORD, 10)
    const existing = await prisma.user.findUnique({ where: { email: TECH_EMAIL } })
    if (existing) {
      await prisma.refreshToken.deleteMany({ where: { userId: existing.id } })
      await prisma.apiKey.deleteMany({ where: { userId: existing.id } })
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

    adminToken = (await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)).accessToken
    techToken = (await loginAs(app, TECH_EMAIL, TECH_PASSWORD)).accessToken
  })

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { id: { in: createdKeyIds } } })
    if (techUserId) {
      await prisma.refreshToken.deleteMany({ where: { userId: techUserId } })
      await prisma.apiKey.deleteMany({ where: { userId: techUserId } })
      await prisma.user.delete({ where: { id: techUserId } })
    }
    // Retire apikeys:manage du rôle TECHNICIEN (remis pour ce test)
    const techRole = await prisma.role.findUnique({ where: { name: 'TECHNICIEN' } })
    const manage = await prisma.permission.findUnique({ where: { key: 'apikeys:manage' } })
    if (techRole && manage) {
      await prisma.rolePermission.deleteMany({ where: { roleId: techRole.id, permissionId: manage.id } })
    }
    await prisma.$disconnect()
  })

  it('clé scopée : 200 sur une route couverte, 403 ailleurs', async () => {
    const res = await createKey(adminToken, { name: 'scoped-contacts', permissions: ['contacts:read'] })
    expect(res.status).toBe(201)
    expect(res.body.data.permissions).toEqual(['contacts:read'])
    createdKeyIds.push(res.body.data.id)
    const key: string = res.body.data.key

    const ok = await request(app).get('/api/contacts').set('X-API-Key', key)
    expect(ok.status).toBe(200)

    const forbidden = await request(app).get('/api/users').set('X-API-Key', key)
    expect(forbidden.status).toBe(403)
  })

  it("clé d'ADMIN scopée : pas de bypass '*' (403 hors scope malgré le rôle)", async () => {
    const res = await createKey(adminToken, { name: 'admin-narrow', permissions: ['tickets:read'] })
    expect(res.status).toBe(201)
    createdKeyIds.push(res.body.data.id)
    const key: string = res.body.data.key

    // users:read serait couvert par le bypass '*' historique — plus maintenant
    const forbidden = await request(app).get('/api/users').set('X-API-Key', key)
    expect(forbidden.status).toBe(403)

    // Route gardée par rôle : inaccessible par clé API même pour un ADMIN
    const roleGated = await request(app).get('/api/calls/sync-ovh/debug').set('X-API-Key', key)
    expect(roleGated.status).toBe(403)
  })

  it('clé sans scopes ([] par défaut) : 403 partout', async () => {
    const res = await createKey(adminToken, { name: 'zero-rights' })
    expect(res.status).toBe(201)
    expect(res.body.data.permissions).toEqual([])
    createdKeyIds.push(res.body.data.id)
    const key: string = res.body.data.key

    for (const route of ['/api/contacts', '/api/tickets', '/api/companies']) {
      const r = await request(app).get(route).set('X-API-Key', key)
      expect(r.status, route).toBe(403)
    }
  })

  it('PUT /apikeys/:id/permissions : l\'édition des droits prend effet immédiatement', async () => {
    const res = await createKey(adminToken, { name: 'editable', permissions: [] })
    createdKeyIds.push(res.body.data.id)
    const key: string = res.body.data.key
    const id: string = res.body.data.id

    expect((await request(app).get('/api/contacts').set('X-API-Key', key)).status).toBe(403)

    const upd = await request(app)
      .put(`/api/apikeys/${id}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissions: ['contacts:read'] })
    expect(upd.status).toBe(200)
    expect(upd.body.data.permissions).toEqual(['contacts:read'])

    expect((await request(app).get('/api/contacts').set('X-API-Key', key)).status).toBe(200)
  })

  it('non-admin : refus des permissions au-delà de ses droits (400 INVALID_PERMISSIONS)', async () => {
    // TECHNICIEN n'a pas users:read
    const res = await createKey(techToken, { name: 'tech-overreach', permissions: ['users:read'] })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_PERMISSIONS')
  })

  it('permissions inconnues refusées (400)', async () => {
    const res = await createKey(adminToken, { name: 'bad-perm', permissions: ['foo:bar'] })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_PERMISSIONS')
  })

  it('non-admin : peut créer une clé dans la limite de ses droits, effective sur l\'API', async () => {
    const res = await createKey(techToken, { name: 'tech-tickets', permissions: ['tickets:read'] })
    expect(res.status).toBe(201)
    createdKeyIds.push(res.body.data.id)
    const key: string = res.body.data.key

    expect((await request(app).get('/api/tickets').set('X-API-Key', key)).status).toBe(200)
    expect((await request(app).get('/api/contacts').set('X-API-Key', key)).status).toBe(403)
  })

  it('GET /apikeys/permissions : groupé par catégorie, filtré pour un non-admin', async () => {
    const adminRes = await request(app).get('/api/apikeys/permissions').set('Authorization', `Bearer ${adminToken}`)
    expect(adminRes.status).toBe(200)
    const adminKeys = Object.values(adminRes.body.data as Record<string, { key: string }[]>).flat().map(p => p.key)
    expect(adminKeys).toContain('users:read')

    const techRes = await request(app).get('/api/apikeys/permissions').set('Authorization', `Bearer ${techToken}`)
    expect(techRes.status).toBe(200)
    const techKeys = Object.values(techRes.body.data as Record<string, { key: string }[]>).flat().map(p => p.key)
    expect(techKeys).toContain('tickets:read')
    expect(techKeys).not.toContain('users:read')
  })

  it('GET /apikeys : renvoie les permissions de chaque clé', async () => {
    const list = await request(app).get('/api/apikeys').set('Authorization', `Bearer ${adminToken}`)
    expect(list.status).toBe(200)
    const scoped = (list.body.data as { name: string; permissions: string[] }[]).find(k => k.name === 'scoped-contacts')
    expect(scoped?.permissions).toEqual(['contacts:read'])
  })
})
