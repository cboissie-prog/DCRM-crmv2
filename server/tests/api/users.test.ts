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

let adminToken: string
const createdUserIds: string[] = []

// User pour les tests de changement de mot de passe
const SELF_USER_EMAIL = 'self-pwd-test@test.local'
const SELF_USER_PWD = 'self-pwd-initial-123'
let selfUserId: string
let selfUserToken: string

describe('Users API', () => {
  beforeAll(async () => {
    const loginResult = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = loginResult.accessToken

    // Crée un user pour les tests de mot de passe
    const commercialRole = await prisma.role.findUnique({ where: { name: 'COMMERCIAL' } })
    const hashedPassword = await bcrypt.hash(SELF_USER_PWD, 10)

    // Supprime un éventuel résidu de run précédent
    const exSelf = await prisma.user.findUnique({ where: { email: SELF_USER_EMAIL } })
    if (exSelf) {
      await prisma.refreshToken.deleteMany({ where: { userId: exSelf.id } })
      await prisma.user.delete({ where: { id: exSelf.id } })
    }

    const selfUser = await prisma.user.create({
      data: {
        email: SELF_USER_EMAIL,
        password: hashedPassword,
        firstName: 'Self',
        lastName: 'PwdTest',
        role: 'COMMERCIAL',
        roleId: commercialRole?.id,
      },
    })
    selfUserId = selfUser.id
    createdUserIds.push(selfUserId)

    const selfLogin = await loginAs(app, SELF_USER_EMAIL, SELF_USER_PWD)
    selfUserToken = selfLogin.accessToken
  })

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } })
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
    }
    await prisma.$disconnect()
  })

  describe('POST /api/users', () => {
    it('email déjà pris → 409 (mapping P2002)', async () => {
      // L'admin@crm.local existe déjà depuis le seed
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: ADMIN_EMAIL,
          password: 'SomePassword123',
          firstName: 'Duplicate',
          lastName: 'User',
        })

      expect(res.status).toBe(409)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('CONFLICT')
    })

    it('création réussie d\'un nouvel utilisateur → 201', async () => {
      const newEmail = `new-user-${Date.now()}@test.local`
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: newEmail,
          password: 'ValidPassword123',
          firstName: 'New',
          lastName: 'User',
          role: 'COMMERCIAL',
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.email).toBe(newEmail)

      createdUserIds.push(res.body.data.id)
    })
  })

  describe('PATCH /api/users/:id/password', () => {
    it('changement de mot de passe sans currentPassword (non-admin sur soi-même) → 400', async () => {
      const res = await request(app)
        .patch(`/api/users/${selfUserId}/password`)
        .set('Authorization', `Bearer ${selfUserToken}`)
        .send({
          // currentPassword absent intentionnellement
          newPassword: 'NewPassword123',
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('changement de mot de passe avec currentPassword incorrect → 401', async () => {
      const res = await request(app)
        .patch(`/api/users/${selfUserId}/password`)
        .set('Authorization', `Bearer ${selfUserToken}`)
        .send({
          currentPassword: 'wrong-current-password',
          newPassword: 'NewPassword123',
        })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('INVALID_PASSWORD')
    })

    it('changement de mot de passe avec currentPassword correct → 200', async () => {
      const res = await request(app)
        .patch(`/api/users/${selfUserId}/password`)
        .set('Authorization', `Bearer ${selfUserToken}`)
        .send({
          currentPassword: SELF_USER_PWD,
          newPassword: 'NewValidPassword123',
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('ADMIN peut changer le mot de passe d\'un tiers sans currentPassword → 200', async () => {
      // L'admin ne doit pas avoir à fournir le mot de passe actuel du user cible
      const res = await request(app)
        .patch(`/api/users/${selfUserId}/password`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          newPassword: 'AdminSetPassword456',
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})
