/**
 * account-lockout.test.ts — verrouillage de compte après échecs répétés
 * et invalidation immédiate des access tokens via tokenVersion.
 *
 * Chacun de ces tests échoue si le garde-fou correspondant est retiré.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

const LOCK_EMAIL = 'lockout-target@test.local'
const LOCK_PASSWORD = 'Lockout-pwd-12345'

const TEST_EMAILS = [LOCK_EMAIL]

async function purgeTestUsers() {
  const users = await prisma.user.findMany({ where: { email: { in: TEST_EMAILS } }, select: { id: true } })
  if (users.length === 0) return
  const ids = users.map(u => u.id)
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

let lockUserId: string

async function failLogin(times: number) {
  let last: request.Response | undefined
  for (let i = 0; i < times; i++) {
    last = await request(app).post('/api/auth/login').send({ email: LOCK_EMAIL, password: 'Wrong-pwd-99999' })
  }
  return last!
}

// Hooks au niveau fichier : le compte de test sert aux deux suites
beforeAll(async () => {
  await purgeTestUsers()
  const user = await prisma.user.create({
    data: {
      email: LOCK_EMAIL,
      password: await bcrypt.hash(LOCK_PASSWORD, 10),
      firstName: 'Lock',
      lastName: 'Target',
      role: 'COMMERCIAL',
    },
  })
  lockUserId = user.id
})

afterAll(async () => {
  await purgeTestUsers()
  await prisma.$disconnect()
})

describe('Verrouillage de compte', () => {
  beforeEach(async () => {
    // Chaque test part d'un compte déverrouillé, compteur à zéro
    await prisma.user.update({ where: { id: lockUserId }, data: { failedLoginAttempts: 0, lockedUntil: null } })
  })

  it('verrouille le compte après 5 échecs, même avec le bon mot de passe ensuite', async () => {
    const fifth = await failLogin(5)
    expect(fifth.status).toBe(423)
    expect(fifth.body.error.code).toBe('ACCOUNT_LOCKED')

    // Le bon mot de passe ne suffit plus tant que le verrou est actif
    const res = await request(app).post('/api/auth/login').send({ email: LOCK_EMAIL, password: LOCK_PASSWORD })
    expect(res.status).toBe(423)
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED')
  })

  it('reste 401 INVALID_CREDENTIALS sous le seuil', async () => {
    const fourth = await failLogin(4)
    expect(fourth.status).toBe(401)
    expect(fourth.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('un login réussi remet le compteur à zéro', async () => {
    await failLogin(4)
    const ok = await request(app).post('/api/auth/login').send({ email: LOCK_EMAIL, password: LOCK_PASSWORD })
    expect(ok.status).toBe(200)

    const user = await prisma.user.findUnique({ where: { id: lockUserId } })
    expect(user?.failedLoginAttempts).toBe(0)
    expect(user?.lockedUntil).toBeNull()

    // Le compteur repart bien de zéro : 4 nouveaux échecs ne verrouillent pas
    const fourth = await failLogin(4)
    expect(fourth.status).toBe(401)
  })

  it('le verrou expiré laisse repasser le login', async () => {
    await failLogin(5)
    // Simule l'expiration du verrou
    await prisma.user.update({ where: { id: lockUserId }, data: { lockedUntil: new Date(Date.now() - 1000) } })

    const ok = await request(app).post('/api/auth/login').send({ email: LOCK_EMAIL, password: LOCK_PASSWORD })
    expect(ok.status).toBe(200)
  })

  it('un échec après expiration du verrou repart de 1 (pas de re-verrouillage immédiat)', async () => {
    await failLogin(5)
    await prisma.user.update({ where: { id: lockUserId }, data: { lockedUntil: new Date(Date.now() - 1000) } })

    const res = await failLogin(1)
    expect(res.status).toBe(401)

    const user = await prisma.user.findUnique({ where: { id: lockUserId } })
    expect(user?.failedLoginAttempts).toBe(1)
    expect(user?.lockedUntil).toBeNull()
  })
})

describe('Invalidation immédiate des access tokens (tokenVersion)', () => {
  beforeAll(async () => {
    // Compte remis à neuf pour cette suite (elle réutilise LOCK_EMAIL)
    await prisma.user.update({
      where: { id: lockUserId },
      data: { isActive: true, failedLoginAttempts: 0, lockedUntil: null, password: await bcrypt.hash(LOCK_PASSWORD, 10) },
    })
  })

  it('la désactivation du compte rejette immédiatement un access token encore valide', async () => {
    const { accessToken } = await loginAs(app, LOCK_EMAIL, LOCK_PASSWORD)

    // Le token fonctionne
    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)
    expect(before.status).toBe(200)

    // Un ADMIN désactive le compte
    const admin = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    const del = await request(app).delete(`/api/users/${lockUserId}`).set('Authorization', `Bearer ${admin.accessToken}`)
    expect(del.status).toBe(200)

    // Le token émis avant la désactivation est refusé immédiatement (pas au bout de 15 min)
    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)
    expect(after.status).toBe(401)

    // Réactivation pour les tests suivants
    await prisma.user.update({ where: { id: lockUserId }, data: { isActive: true } })
  })

  it('un changement de rôle invalide les access tokens émis avec les anciennes permissions', async () => {
    const { accessToken } = await loginAs(app, LOCK_EMAIL, LOCK_PASSWORD)
    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)
    expect(before.status).toBe(200)

    const admin = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    const put = await request(app)
      .put(`/api/users/${lockUserId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'TECHNICIEN' })
    expect(put.status).toBe(200)

    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)
    expect(after.status).toBe(401)
  })

  it('un changement de mot de passe par un ADMIN invalide les access tokens existants', async () => {
    const { accessToken } = await loginAs(app, LOCK_EMAIL, LOCK_PASSWORD)

    const admin = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    const patch = await request(app)
      .patch(`/api/users/${lockUserId}/password`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ newPassword: 'New-lockout-pwd-123' })
    expect(patch.status).toBe(200)

    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)
    expect(after.status).toBe(401)
  })
})
