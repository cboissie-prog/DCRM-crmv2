/**
 * privilege-escalation.test.ts — régressions sur les chemins d'escalade de privilège
 * identifiés lors de l'audit du 31/07/2026.
 *
 * Chacun de ces tests échoue si le garde-fou correspondant est retiré.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

const MANAGER_EMAIL = 'manager-escalation-test@test.local'
const MANAGER_PASSWORD = 'manager-pwd-123'

/** Comptes créés par ce fichier — purgés avant ET après, pour rester rejouable. */
const TEST_EMAILS = [
  MANAGER_EMAIL,
  'escalation-attempt@test.local',
  'legit-commercial@test.local',
  'legit-admin@test.local',
]

async function purgeTestUsers() {
  const users = await prisma.user.findMany({ where: { email: { in: TEST_EMAILS } }, select: { id: true } })
  if (users.length === 0) return
  const ids = users.map(u => u.id)
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

let managerUserId: string

describe('Escalade de privilège', () => {
  beforeAll(async () => {
    const managerRole = await prisma.role.findUnique({ where: { name: 'MANAGER' } })
    if (!managerRole) throw new Error('Role MANAGER absent du seed')

    // Un run précédent interrompu peut avoir laissé ces comptes : sans purge, la contrainte
    // d'unicité sur l'email ferait échouer tout le fichier.
    await purgeTestUsers()

    const user = await prisma.user.create({
      data: {
        email: MANAGER_EMAIL,
        password: await bcrypt.hash(MANAGER_PASSWORD, 10),
        firstName: 'Test',
        lastName: 'Manager',
        role: 'MANAGER',
        roleId: managerRole.id,
      },
    })
    managerUserId = user.id
  })

  afterAll(async () => {
    await purgeTestUsers()
    await prisma.$disconnect()
  })

  // ── POST /api/users — le trou principal : users:create suffisait à créer un ADMIN ──

  it('un MANAGER ne peut pas créer un compte ADMIN', async () => {
    const { accessToken } = await loginAs(app, MANAGER_EMAIL, MANAGER_PASSWORD)

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        email: 'escalation-attempt@test.local',
        password: 'Attacker-chosen-pwd-123',
        firstName: 'Esc',
        lastName: 'Alation',
        role: 'ADMIN',
      })

    expect(res.status).toBe(403)

    // Le compte ne doit pas exister, même désactivé
    const created = await prisma.user.findUnique({ where: { email: 'escalation-attempt@test.local' } })
    expect(created).toBeNull()
  })

  it('un MANAGER peut toujours créer un compte COMMERCIAL', async () => {
    const { accessToken } = await loginAs(app, MANAGER_EMAIL, MANAGER_PASSWORD)

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        email: 'legit-commercial@test.local',
        password: 'Legit-pwd-12345',
        firstName: 'Legit',
        lastName: 'Commercial',
        role: 'COMMERCIAL',
      })

    expect(res.status).toBe(201)

    expect(res.body.data.role).toBe('COMMERCIAL')
  })

  it('un ADMIN peut créer un compte ADMIN', async () => {
    const { accessToken } = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        email: 'legit-admin@test.local',
        password: 'Legit-admin-pwd-123',
        firstName: 'Legit',
        lastName: 'Admin',
        role: 'ADMIN',
      })

    expect(res.status).toBe(201)

    expect(res.body.data.role).toBe('ADMIN')
  })

  // ── Jetons à usage spécifique : le state OAuth ne doit pas authentifier ──

  it('un jeton portant un claim `typ` est refusé par authenticate', async () => {
    // Reproduit un state OAuth qui aurait fuité par les logs d'accès : même s'il était signé
    // avec JWT_SECRET, il ne doit jamais valoir jeton d'accès.
    const stateLikeToken = jwt.sign(
      { userId: managerUserId, typ: 'gcal_state' },
      process.env.JWT_SECRET!,
      { expiresIn: '5m' },
    )

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${stateLikeToken}`)

    expect(res.status).toBe(401)
  })

  // ── Réglages qui gouvernent l'authentification ──

  it('un MANAGER ne peut pas modifier le domaine autorisé pour l\'inscription Google', async () => {
    const { accessToken } = await loginAs(app, MANAGER_EMAIL, MANAGER_PASSWORD)

    const res = await request(app)
      .put('/api/settings/googleAllowedDomain')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ value: 'gmail.com' })

    expect(res.status).toBe(403)
  })

  it('un ADMIN ne peut pas enregistrer un domaine malformé', async () => {
    const { accessToken } = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)

    const res = await request(app)
      .put('/api/settings/googleAllowedDomain')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ value: 'pas un domaine' })

    expect(res.status).toBe(400)
  })
})
