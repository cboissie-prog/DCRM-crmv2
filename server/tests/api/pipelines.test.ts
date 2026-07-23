/**
 * pipelines.test.ts — étapes Gagné/Perdu obligatoires et liées aux stats.
 *
 * - Tout pipeline créé via l'API reçoit automatiquement ses étapes WON/LOST.
 * - Ces étapes sont protégées (ni modifiables, ni supprimables).
 * - Le rattrapage ensureWonLostStagesForAllPipelines complète les pipelines
 *   existants qui en sont dépourvus (cas des pipelines antérieurs à la feature).
 * - getWonLostStageKeys dérive les clés des flags isWon/isLost (base des stats).
 * - Le passage d'une opportunité sur une étape gagnée/perdue pose closedAt.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'
import { ensureWonLostStagesForAllPipelines, getWonLostStageKeys } from '../../src/services/pipelineService'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

let adminToken: string
const createdPipelineIds: string[] = []
const createdOpportunityIds: string[] = []

describe('Pipelines — étapes Gagné/Perdu obligatoires', () => {
  beforeAll(async () => {
    const loginResult = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = loginResult.accessToken
  })

  afterAll(async () => {
    if (createdOpportunityIds.length > 0) {
      await prisma.opportunity.deleteMany({ where: { id: { in: createdOpportunityIds } } })
    }
    if (createdPipelineIds.length > 0) {
      await prisma.pipelineStage.deleteMany({ where: { pipelineId: { in: createdPipelineIds } } })
      await prisma.pipeline.deleteMany({ where: { id: { in: createdPipelineIds } } })
    }
    await prisma.$disconnect()
  })

  it('un pipeline créé via POST /api/pipelines contient les étapes WON et LOST', async () => {
    const res = await request(app)
      .post('/api/pipelines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test WonLost Auto' })

    expect(res.status).toBe(201)
    createdPipelineIds.push(res.body.data.id)

    const stages = res.body.data.stages
    const won = stages.find((s: { isWon: boolean }) => s.isWon)
    const lost = stages.find((s: { isLost: boolean }) => s.isLost)
    expect(won).toBeDefined()
    expect(won.key).toBe('WON')
    expect(lost).toBeDefined()
    expect(lost.key).toBe('LOST')
  })

  it('les étapes WON/LOST ne sont ni modifiables ni supprimables', async () => {
    const pipelineId = createdPipelineIds[0]
    const stages = await prisma.pipelineStage.findMany({ where: { pipelineId } })
    const won = stages.find(s => s.isWon)!

    const putRes = await request(app)
      .put(`/api/pipelines/${pipelineId}/stages/${won.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Renommé' })
    expect(putRes.status).toBe(400)

    const delRes = await request(app)
      .delete(`/api/pipelines/${pipelineId}/stages/${won.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(delRes.status).toBe(400)
  })

  it('le rattrapage complète un pipeline existant sans étapes Gagné/Perdu', async () => {
    // Pipeline "legacy" créé directement en base, sans étapes WON/LOST
    const legacy = await prisma.pipeline.create({
      data: {
        name: 'Legacy sans WonLost',
        stages: {
          create: [
            { key: 'NEW', name: 'Nouveau', order: 0 },
            { key: 'NEGOTIATION', name: 'Négociation', order: 1 },
          ],
        },
      },
    })
    createdPipelineIds.push(legacy.id)

    const fixed = await ensureWonLostStagesForAllPipelines()
    expect(fixed).toBeGreaterThanOrEqual(1)

    const stages = await prisma.pipelineStage.findMany({ where: { pipelineId: legacy.id } })
    expect(stages.some(s => s.isWon)).toBe(true)
    expect(stages.some(s => s.isLost)).toBe(true)

    // Idempotent : un second passage ne complète plus rien pour ce pipeline
    const fixedAgain = await ensureWonLostStagesForAllPipelines()
    expect(fixedAgain).toBe(0)
  })

  it('getWonLostStageKeys dérive les clés des flags isWon/isLost', async () => {
    const pipelineId = createdPipelineIds[0]
    // Étape gagnée supplémentaire avec une clé personnalisée
    const res = await request(app)
      .post(`/api/pipelines/${pipelineId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'SIGNED', name: 'Signé', isWon: true })
    expect(res.status).toBe(201)

    const { wonKeys, lostKeys } = await getWonLostStageKeys()
    expect(wonKeys).toContain('WON')
    expect(wonKeys).toContain('SIGNED')
    expect(lostKeys).toContain('LOST')
  })

  it('déplacer une opportunité sur une étape gagnée pose closedAt, la retirer le remet à null', async () => {
    const pipelineId = createdPipelineIds[0]
    const opp = await prisma.opportunity.create({
      data: { title: 'Opp test closedAt', pipelineId, stage: 'NEW', value: 1000 },
    })
    createdOpportunityIds.push(opp.id)

    const toWon = await request(app)
      .patch(`/api/pipeline/opportunities/${opp.id}/stage`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stage: 'WON' })
    expect(toWon.status).toBe(200)
    expect(toWon.body.data.closedAt).not.toBeNull()

    const backToNew = await request(app)
      .patch(`/api/pipeline/opportunities/${opp.id}/stage`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stage: 'NEW' })
    expect(backToNew.status).toBe(200)
    expect(backToNew.body.data.closedAt).toBeNull()
  })
})
