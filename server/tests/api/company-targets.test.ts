/**
 * company-targets.test.ts — objectifs d'entreprise (/api/targets/company).
 *
 * - CRUD gardé par company_targets:write (COMMERCIAL : lecture seule).
 * - Upsert par (period, pipelineId) : pas de doublon pour une même période.
 * - computedActual = CA des opportunités gagnées de TOUS les commerciaux sur la période.
 * - allocatedTarget = somme des objectifs individuels couvrant la période, sans
 *   double comptage (trimestre prime sur mois, global prime sur pipelines).
 * - Période annuelle ("2098") agrégeant trimestres et mois.
 *
 * Les données utilisent l'année 2098 pour être isolées des autres tests.
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

const USER_A_EMAIL = 'usera-ctargets@test.local'
const USER_B_EMAIL = 'userb-ctargets@test.local'
const USER_PASSWORD = 'ctargets-pwd-123'

let adminToken: string
let userAId: string
let userBId: string
let pipelineId: string
const createdOppIds: string[] = []

describe("Objectifs d'entreprise — /api/targets/company", () => {
  beforeAll(async () => {
    adminToken = (await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)).accessToken

    // ── Deux commerciaux de test ────────────────────────────────────────────
    const commercialRole = await prisma.role.findUnique({ where: { name: 'COMMERCIAL' } })
    if (!commercialRole) throw new Error('Role COMMERCIAL not found in seed')
    const hashedPassword = await bcrypt.hash(USER_PASSWORD, 10)

    for (const email of [USER_A_EMAIL, USER_B_EMAIL]) {
      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) {
        await prisma.refreshToken.deleteMany({ where: { userId: existing.id } })
        await prisma.salesTarget.deleteMany({ where: { userId: existing.id } })
        await prisma.user.delete({ where: { id: existing.id } })
      }
    }
    const userA = await prisma.user.create({
      data: { email: USER_A_EMAIL, password: hashedPassword, firstName: 'Alice', lastName: 'CTargets', role: 'COMMERCIAL', roleId: commercialRole.id },
    })
    const userB = await prisma.user.create({
      data: { email: USER_B_EMAIL, password: hashedPassword, firstName: 'Bob', lastName: 'CTargets', role: 'COMMERCIAL', roleId: commercialRole.id },
    })
    userAId = userA.id
    userBId = userB.id

    // ── Pipeline avec étapes WON/LOST automatiques ──────────────────────────
    const pipRes = await request(app)
      .post('/api/pipelines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'CTargets Pipeline' })
    if (pipRes.status !== 201) throw new Error(`Pipeline creation failed: ${JSON.stringify(pipRes.body)}`)
    pipelineId = pipRes.body.data.id

    // ── Opportunités gagnées (année 2098) ───────────────────────────────────
    // Q3 : 40 000 (Alice) + 20 000 (Bob) = 60 000 ; Q4 : 15 000 (Alice)
    // + une ouverte (jamais comptée)
    const opps = await Promise.all([
      prisma.opportunity.create({ data: { title: 'CT won A Q3', value: 40000, stage: 'WON', pipelineId, assignedToId: userAId, closedAt: new Date(2098, 7, 15) } }),
      prisma.opportunity.create({ data: { title: 'CT won B Q3', value: 20000, stage: 'WON', pipelineId, assignedToId: userBId, closedAt: new Date(2098, 6, 1) } }),
      prisma.opportunity.create({ data: { title: 'CT won A Q4', value: 15000, stage: 'WON', pipelineId, assignedToId: userAId, closedAt: new Date(2098, 10, 1) } }),
      prisma.opportunity.create({ data: { title: 'CT open', value: 99999, stage: 'NEW', pipelineId, assignedToId: userAId } }),
    ])
    createdOppIds.push(...opps.map(o => o.id))

    // ── Objectifs individuels ───────────────────────────────────────────────
    // Alice : trimestre Q3 global 50 000 (prime sur son mois d'août 10 000)
    //         + ventilation pipeline Q3 20 000 (ignorée : le global prime)
    // Bob   : mois de juillet 8 000 (pas d'objectif trimestre → compté)
    await prisma.salesTarget.createMany({
      data: [
        { userId: userAId, period: '2098-Q3', target: 50000, pipelineId: null },
        { userId: userAId, period: '2098-08', target: 10000, pipelineId: null },
        { userId: userAId, period: '2098-Q3', target: 20000, pipelineId },
        { userId: userBId, period: '2098-07', target: 8000,  pipelineId: null },
      ],
    })
  })

  afterAll(async () => {
    if (createdOppIds.length > 0) await prisma.opportunity.deleteMany({ where: { id: { in: createdOppIds } } })
    await prisma.salesTarget.deleteMany({ where: { period: { startsWith: '2098' } } })
    await prisma.companyTarget.deleteMany({ where: { period: { startsWith: '2098' } } })
    if (pipelineId) {
      await prisma.pipelineStage.deleteMany({ where: { pipelineId } })
      await prisma.pipeline.deleteMany({ where: { id: pipelineId } })
    }
    for (const id of [userAId, userBId]) {
      if (!id) continue
      await prisma.refreshToken.deleteMany({ where: { userId: id } })
      await prisma.user.delete({ where: { id } })
    }
    await prisma.$disconnect()
  })

  // ── RBAC ─────────────────────────────────────────────────────────────────

  it('un COMMERCIAL peut lire (company_targets:read) mais pas écrire → 403', async () => {
    const { accessToken } = await loginAs(app, USER_A_EMAIL, USER_PASSWORD)

    const getRes = await request(app)
      .get('/api/targets/company?period=2098-Q3')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(getRes.status).toBe(200)

    const postRes = await request(app)
      .post('/api/targets/company')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ period: '2098-Q3', target: 100000 })
    expect(postRes.status).toBe(403)
  })

  // ── CRUD + upsert ────────────────────────────────────────────────────────

  it('POST crée un objectif global, puis upsert sur la même période (pas de doublon)', async () => {
    const res1 = await request(app)
      .post('/api/targets/company')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ period: '2098-Q3', target: 400000 })
    expect(res1.status).toBe(201)
    expect(res1.body.data.pipelineId).toBeNull()

    const res2 = await request(app)
      .post('/api/targets/company')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ period: '2098-Q3', target: 500000 })
    expect(res2.status).toBe(201)
    expect(res2.body.data.id).toBe(res1.body.data.id)

    const rows = await prisma.companyTarget.findMany({ where: { period: '2098-Q3', pipelineId: null } })
    expect(rows).toHaveLength(1)
    expect(rows[0].target).toBe(500000)
  })

  it('POST refuse une période invalide → 400', async () => {
    const res = await request(app)
      .post('/api/targets/company')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ period: '2098-Q5', target: 1000 })
    expect(res.status).toBe(400)
  })

  it('GET refuse une période mal formée → 400', async () => {
    const res = await request(app)
      .get('/api/targets/company?period=n-importe-quoi')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(400)
  })

  // ── Calculs ──────────────────────────────────────────────────────────────

  it('GET trimestre : réalisé = CA gagné de tous, répartition sans double comptage', async () => {
    const res = await request(app)
      .get('/api/targets/company?period=2098-Q3')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)

    const global = res.body.data.find((t: { pipelineId: string | null }) => t.pipelineId === null)
    expect(global).toBeDefined()
    expect(global.target).toBe(500000)
    // 40 000 (Alice) + 20 000 (Bob), l'opportunité ouverte et celle de Q4 sont exclues
    expect(global.computedActual).toBe(60000)
    // Alice : global Q3 50 000 (le mois d'août et la ventilation pipeline ne comptent pas)
    // Bob   : mois de juillet 8 000
    expect(global.allocatedTarget).toBe(58000)
  })

  it('GET année : agrège les trimestres et les mois de l\'année', async () => {
    await request(app)
      .post('/api/targets/company')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ period: '2098', target: 1000000 })

    const res = await request(app)
      .get('/api/targets/company?period=2098')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)

    const global = res.body.data.find((t: { pipelineId: string | null }) => t.pipelineId === null)
    expect(global.target).toBe(1000000)
    // Toutes les gagnées de l'année : 60 000 (Q3) + 15 000 (Q4)
    expect(global.computedActual).toBe(75000)
    // Identique au trimestre : rien d'autre n'est réparti sur 2098
    expect(global.allocatedTarget).toBe(58000)
  })

  it('GET objectif ventilé par pipeline : réalisé et répartition limités au pipeline', async () => {
    await request(app)
      .post('/api/targets/company')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ period: '2098-Q3', target: 100000, pipelineId })

    const res = await request(app)
      .get('/api/targets/company?period=2098-Q3')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2) // global + pipeline

    const scoped = res.body.data.find((t: { pipelineId: string | null }) => t.pipelineId === pipelineId)
    expect(scoped.computedActual).toBe(60000) // toutes les gagnées Q3 sont sur ce pipeline
    // Seule la ventilation pipeline d'Alice compte (20 000) — son global et le mois de Bob sont hors périmètre
    expect(scoped.allocatedTarget).toBe(20000)
  })

  it('PUT modifie la cible, DELETE la supprime', async () => {
    const created = await request(app)
      .post('/api/targets/company')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ period: '2098-01', target: 30000 })
    const id = created.body.data.id

    const putRes = await request(app)
      .put(`/api/targets/company/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ target: 35000 })
    expect(putRes.status).toBe(200)
    expect(putRes.body.data.target).toBe(35000)

    const delRes = await request(app)
      .delete(`/api/targets/company/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(delRes.status).toBe(200)
    expect(await prisma.companyTarget.findUnique({ where: { id } })).toBeNull()
  })
})
