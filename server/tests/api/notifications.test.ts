import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

let userAId: string
let userBId: string
let userAToken: string
let notifBId: string

const USER_A_EMAIL = 'notif-user-a@test.local'
const USER_B_EMAIL = 'notif-user-b@test.local'
const USER_PWD = 'notif-test-pwd-123'

describe('Notifications — IDOR protection', () => {
  beforeAll(async () => {
    const commercialRole = await prisma.role.findUnique({ where: { name: 'COMMERCIAL' } })
    const hashedPassword = await bcrypt.hash(USER_PWD, 10)

    // Supprime les résidus éventuels de runs précédents
    for (const email of [USER_A_EMAIL, USER_B_EMAIL]) {
      const ex = await prisma.user.findUnique({ where: { email } })
      if (ex) {
        await prisma.notification.deleteMany({ where: { userId: ex.id } })
        await prisma.refreshToken.deleteMany({ where: { userId: ex.id } })
        await prisma.user.delete({ where: { id: ex.id } })
      }
    }

    // Crée user A
    const userA = await prisma.user.create({
      data: {
        email: USER_A_EMAIL,
        password: hashedPassword,
        firstName: 'Notif',
        lastName: 'UserA',
        role: 'COMMERCIAL',
        roleId: commercialRole?.id,
      },
    })
    userAId = userA.id

    // Crée user B
    const userB = await prisma.user.create({
      data: {
        email: USER_B_EMAIL,
        password: hashedPassword,
        firstName: 'Notif',
        lastName: 'UserB',
        role: 'COMMERCIAL',
        roleId: commercialRole?.id,
      },
    })
    userBId = userB.id

    // Crée une notification pour user B
    const notifB = await prisma.notification.create({
      data: {
        userId: userBId,
        type: 'INFO',
        title: 'Test notification for B',
        message: 'This belongs to user B',
      },
    })
    notifBId = notifB.id

    // Login user A
    const loginResult = await loginAs(app, USER_A_EMAIL, USER_PWD)
    userAToken = loginResult.accessToken
  })

  afterAll(async () => {
    // Nettoyage
    await prisma.notification.deleteMany({
      where: { userId: { in: [userAId, userBId] } },
    })
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: [userAId, userBId] } },
    })
    await prisma.user.deleteMany({
      where: { id: { in: [userAId, userBId] } },
    })
    await prisma.$disconnect()
  })

  it('user A ne peut pas marquer lue la notification de user B → 404 (IDOR)', async () => {
    const res = await request(app)
      .patch(`/api/notifications/${notifBId}/read`)
      .set('Authorization', `Bearer ${userAToken}`)

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('user A peut marquer lue sa propre notification → 200', async () => {
    // Crée une notification pour user A
    const notifA = await prisma.notification.create({
      data: {
        userId: userAId,
        type: 'INFO',
        title: 'Test notification for A',
        message: 'This belongs to user A',
      },
    })

    const res = await request(app)
      .patch(`/api/notifications/${notifA.id}/read`)
      .set('Authorization', `Bearer ${userAToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
