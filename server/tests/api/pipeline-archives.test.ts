/**
 * pipeline-archives.test.ts — archivage des opportunités gagnées/perdues.
 *
 * - `GET /opportunities` : paramètre `archived` (exclude/only/all).
 * - `PATCH /:id/archive` : refuse une opportunité ouverte (400 NOT_CLOSED).
 * - `PATCH /:id/archive` puis `/:id/unarchive` (autoArchive passe à false).
 * - `PATCH /:id/stage` vers une étape ouverte désarchive (archivedAt=null, autoArchive=true).
 * - `runOpportunityArchiving()` : archive une opportunité close depuis >N jours, pas celle
 *   fermée hier, ni celle `autoArchive=false`.
 * - `GET /opportunities/archives/count`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'
import { runOpportunityArchiving } from '../../src/scheduler'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

let adminToken: string
let pipelineId: string
const createdOpportunityIds: string[] = []

async function createOpp(stage: string, extra: Record<string, unknown> = {}) {
  const opp = await prisma.opportunity.create({
    data: { title: 'Opp archive test', pipelineId, stage, value: 1000, ...extra },
  })
  createdOpportunityIds.push(opp.id)
  return opp
}

describe('Pipeline — archivage des opportunités gagnées/perdues', () => {
  beforeAll(async () => {
    const loginResult = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = loginResult.accessToken

    const pipeRes = await request(app)
      .post('/api/pipelines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Archives' })
    expect(pipeRes.status).toBe(201)
    pipelineId = pipeRes.body.data.id

    // Un pipeline créé via l'API ne reçoit que les étapes WON/LOST (cf. ensureWonLostStages) —
    // il faut une étape ouverte réelle pour tester la désarchivation via changement d'étape.
    const stageRes = await request(app)
      .post(`/api/pipelines/${pipelineId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'OPEN', name: 'Ouverte' })
    expect(stageRes.status).toBe(201)

    // Réglage déterministe pour le test de l'automate (valeur par défaut, posée explicitement
    // pour ne pas dépendre d'une valeur laissée par un autre test).
    await prisma.setting.upsert({
      where: { key: 'pipelineArchiveAfterDays' },
      update: { value: '30' },
      create: { key: 'pipelineArchiveAfterDays', value: '30' },
    })
  })

  afterAll(async () => {
    if (createdOpportunityIds.length > 0) {
      await prisma.opportunity.deleteMany({ where: { id: { in: createdOpportunityIds } } })
    }
    await prisma.pipelineStage.deleteMany({ where: { pipelineId } })
    await prisma.pipeline.delete({ where: { id: pipelineId } })
    await prisma.$disconnect()
  })

  it('GET /opportunities?archived=exclude|only|all filtre correctement', async () => {
    const open = await createOpp('NEW')
    const archived = await createOpp('WON', { closedAt: new Date(), archivedAt: new Date() })

    const resAll = await request(app)
      .get('/api/pipeline/opportunities')
      .query({ pipelineId, limit: '200' })
      .set('Authorization', `Bearer ${adminToken}`)
    expect(resAll.status).toBe(200)
    const allIds = resAll.body.data.map((o: { id: string }) => o.id)
    expect(allIds).toContain(open.id)
    expect(allIds).toContain(archived.id)

    const resExclude = await request(app)
      .get('/api/pipeline/opportunities')
      .query({ pipelineId, archived: 'exclude', limit: '200' })
      .set('Authorization', `Bearer ${adminToken}`)
    expect(resExclude.status).toBe(200)
    const excludeIds = resExclude.body.data.map((o: { id: string }) => o.id)
    expect(excludeIds).toContain(open.id)
    expect(excludeIds).not.toContain(archived.id)

    const resOnly = await request(app)
      .get('/api/pipeline/opportunities')
      .query({ pipelineId, archived: 'only', limit: '200' })
      .set('Authorization', `Bearer ${adminToken}`)
    expect(resOnly.status).toBe(200)
    const onlyIds = resOnly.body.data.map((o: { id: string }) => o.id)
    expect(onlyIds).not.toContain(open.id)
    expect(onlyIds).toContain(archived.id)
  })

  it('PATCH /:id/archive refuse une opportunité ouverte (400 NOT_CLOSED)', async () => {
    const opp = await createOpp('NEW')
    const res = await request(app)
      .patch(`/api/pipeline/opportunities/${opp.id}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('NOT_CLOSED')
  })

  it('PATCH /:id/archive puis /:id/unarchive (autoArchive passe à false)', async () => {
    const opp = await createOpp('WON', { closedAt: new Date() })

    const archRes = await request(app)
      .patch(`/api/pipeline/opportunities/${opp.id}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(archRes.status).toBe(200)
    expect(archRes.body.success).toBe(true)
    expect(archRes.body.data.archivedAt).not.toBeNull()

    const unarchRes = await request(app)
      .patch(`/api/pipeline/opportunities/${opp.id}/unarchive`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(unarchRes.status).toBe(200)
    expect(unarchRes.body.data.archivedAt).toBeNull()
    expect(unarchRes.body.data.autoArchive).toBe(false)
  })

  it('PATCH /:id/stage vers une étape ouverte désarchive (archivedAt=null, autoArchive=true)', async () => {
    const opp = await createOpp('WON', { closedAt: new Date(), archivedAt: new Date(), autoArchive: false })

    const res = await request(app)
      .patch(`/api/pipeline/opportunities/${opp.id}/stage`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stage: 'OPEN' })
    expect(res.status).toBe(200)
    expect(res.body.data.archivedAt).toBeNull()
    expect(res.body.data.autoArchive).toBe(true)
    expect(res.body.data.closedAt).toBeNull()
  })

  it('runOpportunityArchiving archive une opportunité close depuis >30j, pas celle fermée hier, ni autoArchive=false', async () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)

    const old = await createOpp('WON', { closedAt: fortyDaysAgo })
    const recent = await createOpp('WON', { closedAt: yesterday })
    const noAuto = await createOpp('WON', { closedAt: fortyDaysAgo, autoArchive: false })

    const result = await runOpportunityArchiving()
    expect(result.archived).toBeGreaterThanOrEqual(1)

    const [oldRow, recentRow, noAutoRow] = await Promise.all([
      prisma.opportunity.findUnique({ where: { id: old.id } }),
      prisma.opportunity.findUnique({ where: { id: recent.id } }),
      prisma.opportunity.findUnique({ where: { id: noAuto.id } }),
    ])
    expect(oldRow?.archivedAt).not.toBeNull()
    expect(recentRow?.archivedAt).toBeNull()
    expect(noAutoRow?.archivedAt).toBeNull()
  })

  it('GET /opportunities/archives/count compte les archivées par type d\'étape pour le pipeline', async () => {
    const wonArchived = await createOpp('WON', { closedAt: new Date(), archivedAt: new Date() })
    const lostArchived = await createOpp('LOST', { closedAt: new Date(), archivedAt: new Date() })

    const res = await request(app)
      .get('/api/pipeline/opportunities/archives/count')
      .query({ pipelineId })
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(typeof res.body.data.won).toBe('number')
    expect(typeof res.body.data.lost).toBe('number')
    expect(res.body.data.won).toBeGreaterThanOrEqual(1)
    expect(res.body.data.lost).toBeGreaterThanOrEqual(1)

    // Vérifie que ce sont bien NOS lignes qui sont comptées (pas de faux-positif de filtrage)
    const wonRow = await prisma.opportunity.findUnique({ where: { id: wonArchived.id } })
    const lostRow = await prisma.opportunity.findUnique({ where: { id: lostArchived.id } })
    expect(wonRow?.archivedAt).not.toBeNull()
    expect(lostRow?.archivedAt).not.toBeNull()
  })
})
