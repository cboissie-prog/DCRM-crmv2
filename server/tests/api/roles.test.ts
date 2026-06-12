import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

let adminToken: string
let testRoleId: string

describe('PUT /api/roles/:id/permissions', () => {
  beforeAll(async () => {
    const loginResult = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = loginResult.accessToken

    // Crée un rôle de test non-système pour les tests de permissions
    // Supprime un éventuel résidu de run précédent
    const existing = await prisma.role.findUnique({ where: { name: 'TEST_ROLE_PERM' } })
    if (existing) {
      await prisma.rolePermission.deleteMany({ where: { roleId: existing.id } })
      await prisma.role.delete({ where: { id: existing.id } })
    }
    const role = await prisma.role.create({
      data: { name: 'TEST_ROLE_PERM', label: 'Test Role Permissions', isSystem: false },
    })
    testRoleId = role.id
  })

  afterAll(async () => {
    // Nettoyage du rôle de test
    if (testRoleId) {
      await prisma.rolePermission.deleteMany({ where: { roleId: testRoleId } })
      await prisma.role.delete({ where: { id: testRoleId } })
    }
    await prisma.$disconnect()
  })

  it('avec un id de permission bidon → 400 et permissions inchangées', async () => {
    // D'abord, donne une permission réelle au rôle
    const realPerm = await prisma.permission.findFirst({ where: { key: 'dashboard:read' } })
    if (realPerm) {
      await prisma.rolePermission.create({
        data: { roleId: testRoleId, permissionId: realPerm.id },
      })
    }

    // Vérifie l'état initial
    const permsBefore = await prisma.rolePermission.findMany({ where: { roleId: testRoleId } })

    // Tente de setter des permissions avec un ID bidon
    const res = await request(app)
      .put(`/api/roles/${testRoleId}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionIds: ['fake-id-that-does-not-exist', 'another-fake-id'] })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('INVALID_PERMISSION_IDS')

    // Vérifie que les permissions sont inchangées
    const permsAfter = await prisma.rolePermission.findMany({ where: { roleId: testRoleId } })
    expect(permsAfter.length).toBe(permsBefore.length)
  })

  it('avec des ids de permissions valides → 200 et permissions mises à jour', async () => {
    // Récupère des permissions réelles
    const perms = await prisma.permission.findMany({
      where: { key: { in: ['contacts:read', 'companies:read'] } },
    })
    expect(perms.length).toBeGreaterThan(0)

    const res = await request(app)
      .put(`/api/roles/${testRoleId}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionIds: perms.map(p => p.id) })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // Vérifie que les permissions retournées correspondent
    const returnedKeys = res.body.data.permissions.map((p: { key: string }) => p.key)
    expect(returnedKeys).toContain('contacts:read')
  })

  it('PUT /api/roles/nonexistent-id/permissions → 404', async () => {
    const res = await request(app)
      .put('/api/roles/nonexistent-id-xyz/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionIds: [] })

    expect(res.status).toBe(404)
  })
})
