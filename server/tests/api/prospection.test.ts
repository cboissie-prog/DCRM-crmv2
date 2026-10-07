/**
 * prospection.test.ts — leads fusionnés dans les opportunités (spec
 * docs/superpowers/specs/2026-10-05-prospection-design.md, §6 serveur).
 *
 * - `PATCH /opportunities/:id/prospect` : compteurs, activité, CALLBACK sans remindAt → 400.
 * - `GET /opportunities` : filtres `remindToday`, `neverContacted`, `staleDays`, tri.
 * - `POST /opportunities/bulk` : assign, stage, archive (étape ouverte ignorée), prospectStatus.
 * - `POST /opportunities/import/csv` : création entreprise+contact+opportunité, réutilisation
 *   d'une entreprise existante, doublon d'opportunité ignoré, ligne sans entreprise → erreurs,
 *   > 500 lignes → 400.
 * - Routes `/leads*` → 404.
 */
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
let pipelineId: string
let openStageKey: string
const createdOpportunityIds: string[] = []
const createdCompanyIds: string[] = []
const createdContactIds: string[] = []

async function createOpp(extra: Record<string, unknown> = {}) {
  const opp = await prisma.opportunity.create({
    data: { title: 'Opp prospection test', pipelineId, stage: openStageKey, value: 1000, ...extra },
  })
  createdOpportunityIds.push(opp.id)
  return opp
}

describe('Prospection — leads fusionnés dans les opportunités', () => {
  beforeAll(async () => {
    const loginResult = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = loginResult.accessToken

    const pipeRes = await request(app)
      .post('/api/pipelines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Prospection' })
    expect(pipeRes.status).toBe(201)
    pipelineId = pipeRes.body.data.id

    const stageRes = await request(app)
      .post(`/api/pipelines/${pipelineId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'OPEN', name: 'Ouverte' })
    expect(stageRes.status).toBe(201)
    openStageKey = 'OPEN'
  })

  afterAll(async () => {
    if (createdOpportunityIds.length > 0) {
      await prisma.opportunity.deleteMany({ where: { id: { in: createdOpportunityIds } } })
    }
    if (createdContactIds.length > 0) {
      await prisma.contact.deleteMany({ where: { id: { in: createdContactIds } } })
    }
    if (createdCompanyIds.length > 0) {
      await prisma.opportunity.deleteMany({ where: { companyId: { in: createdCompanyIds } } })
      await prisma.contact.deleteMany({ where: { companyId: { in: createdCompanyIds } } })
      await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } })
    }
    await prisma.pipelineStage.deleteMany({ where: { pipelineId } })
    await prisma.pipeline.delete({ where: { id: pipelineId } })
    await prisma.$disconnect()
  })

  // ─── PATCH /opportunities/:id/prospect ──────────────────────────────────

  describe('PATCH /opportunities/:id/prospect', () => {
    it('NO_ANSWER pose lastContactedAt, incrémente callAttempts et journalise un appel', async () => {
      const contact = await prisma.contact.create({ data: { firstName: 'Call', lastName: 'Test' } })
      createdContactIds.push(contact.id)
      const opp = await createOpp({ contactId: contact.id })

      const res = await request(app)
        .patch(`/api/pipeline/opportunities/${opp.id}/prospect`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ prospectStatus: 'NO_ANSWER' })
      expect(res.status).toBe(200)
      expect(res.body.data.prospectStatus).toBe('NO_ANSWER')
      expect(res.body.data.callAttempts).toBe(1)
      expect(res.body.data.lastContactedAt).not.toBeNull()

      const activity = await prisma.activity.findFirst({ where: { opportunityId: opp.id, type: 'CALL' } })
      expect(activity).not.toBeNull()
      expect(activity?.title).toBe('Appel sans réponse')
      expect(activity?.contactId).toBe(contact.id)
    })

    it('REACHED pose lastContactedAt, incrémente callAttempts et journalise "Joint par téléphone"', async () => {
      const opp = await createOpp()

      const res = await request(app)
        .patch(`/api/pipeline/opportunities/${opp.id}/prospect`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ prospectStatus: 'REACHED' })
      expect(res.status).toBe(200)
      expect(res.body.data.callAttempts).toBe(1)

      const activity = await prisma.activity.findFirst({ where: { opportunityId: opp.id, type: 'CALL' } })
      expect(activity?.title).toBe('Joint par téléphone')
    })

    it('deux appels successifs incrémentent callAttempts à 2', async () => {
      const opp = await createOpp()
      await request(app)
        .patch(`/api/pipeline/opportunities/${opp.id}/prospect`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ prospectStatus: 'NO_ANSWER' })
      const res = await request(app)
        .patch(`/api/pipeline/opportunities/${opp.id}/prospect`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ prospectStatus: 'REACHED' })
      expect(res.body.data.callAttempts).toBe(2)
    })

    it('CALLBACK sans remindAt → 400 REMIND_AT_REQUIRED', async () => {
      const opp = await createOpp()
      const res = await request(app)
        .patch(`/api/pipeline/opportunities/${opp.id}/prospect`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ prospectStatus: 'CALLBACK' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('REMIND_AT_REQUIRED')
    })

    it('CALLBACK avec remindAt → 200, remindAt posé, callAttempts inchangé', async () => {
      const opp = await createOpp()
      const remindAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const res = await request(app)
        .patch(`/api/pipeline/opportunities/${opp.id}/prospect`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ prospectStatus: 'CALLBACK', remindAt })
      expect(res.status).toBe(200)
      expect(res.body.data.prospectStatus).toBe('CALLBACK')
      expect(res.body.data.remindAt).not.toBeNull()
      expect(res.body.data.callAttempts).toBe(0)
    })

    it('TODO ne touche pas aux compteurs', async () => {
      const opp = await createOpp({ prospectStatus: 'REACHED', callAttempts: 3, lastContactedAt: new Date() })
      const res = await request(app)
        .patch(`/api/pipeline/opportunities/${opp.id}/prospect`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ prospectStatus: 'TODO' })
      expect(res.status).toBe(200)
      expect(res.body.data.prospectStatus).toBe('TODO')
      expect(res.body.data.callAttempts).toBe(3)
    })

    it('404 si l\'opportunité n\'existe pas', async () => {
      const res = await request(app)
        .patch('/api/pipeline/opportunities/does-not-exist/prospect')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ prospectStatus: 'TODO' })
      expect(res.status).toBe(404)
    })
  })

  // ─── GET /opportunities — filtres & tri ─────────────────────────────────

  describe('GET /opportunities — filtres de prospection', () => {
    it('remindToday=true ne renvoie que les rappels du jour', async () => {
      const today = await createOpp({ remindAt: new Date() })
      const future = await createOpp({ remindAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) })

      const res = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, remindToday: 'true', limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      const ids = res.body.data.map((o: { id: string }) => o.id)
      expect(ids).toContain(today.id)
      expect(ids).not.toContain(future.id)
    })

    it('neverContacted=true ne renvoie que lastContactedAt=null', async () => {
      const never = await createOpp({ lastContactedAt: null })
      const contacted = await createOpp({ lastContactedAt: new Date() })

      const res = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, neverContacted: 'true', limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      const ids = res.body.data.map((o: { id: string }) => o.id)
      expect(ids).toContain(never.id)
      expect(ids).not.toContain(contacted.id)
    })

    it('staleDays=N renvoie lastContactedAt null ou plus vieux que N jours', async () => {
      const stale = await createOpp({ lastContactedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) })
      const recent = await createOpp({ lastContactedAt: new Date() })
      const never = await createOpp({ lastContactedAt: null })

      const res = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, staleDays: '7', limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      const ids = res.body.data.map((o: { id: string }) => o.id)
      expect(ids).toContain(stale.id)
      expect(ids).toContain(never.id)
      expect(ids).not.toContain(recent.id)
    })

    it('sortBy=value&sortOrder=asc trie par montant croissant', async () => {
      await createOpp({ value: 500 })
      await createOpp({ value: 9000 })

      const res = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, sortBy: 'value', sortOrder: 'asc', limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      const values = res.body.data.map((o: { value: number }) => o.value)
      const sorted = [...values].sort((a, b) => a - b)
      expect(values).toEqual(sorted)
    })

    it('search trouve une opportunité par titre insensible à la casse', async () => {
      await createOpp({ title: 'Boulangerie Durand — maintenance caisse' })

      const res = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, search: 'durand', limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data.length).toBeGreaterThanOrEqual(1)
      expect(res.body.data.some((o: { title: string }) => o.title.includes('Durand'))).toBe(true)
    })

    it('sans nouveau paramètre, comportement inchangé (tri createdAt desc)', async () => {
      const res = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
    })
  })

  // ─── POST /opportunities/bulk ────────────────────────────────────────────

  describe('POST /opportunities/bulk', () => {
    it('action assign met à jour assignedToId sur toutes les opportunités', async () => {
      const opp1 = await createOpp()
      const opp2 = await createOpp()
      const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } })

      const res = await request(app)
        .post('/api/pipeline/opportunities/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [opp1.id, opp2.id], action: 'assign', value: admin.id })
      expect(res.status).toBe(200)
      expect(res.body.data.updated).toBe(2)

      const rows = await prisma.opportunity.findMany({ where: { id: { in: [opp1.id, opp2.id] } } })
      expect(rows.every(r => r.assignedToId === admin.id)).toBe(true)
    })

    it('action stage déplace toutes les opportunités vers l\'étape demandée', async () => {
      const opp1 = await createOpp()
      const opp2 = await createOpp()

      const res = await request(app)
        .post('/api/pipeline/opportunities/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [opp1.id, opp2.id], action: 'stage', value: openStageKey })
      expect(res.status).toBe(200)
      expect(res.body.data.updated).toBe(2)
    })

    it('action stage avec une clé inexistante → 400 INVALID_STAGE', async () => {
      const opp1 = await createOpp()
      const res = await request(app)
        .post('/api/pipeline/opportunities/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [opp1.id], action: 'stage', value: 'NOPE_STAGE' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_STAGE')
    })

    it('action archive ignore les opportunités sur une étape ouverte (skipped)', async () => {
      const open = await createOpp({ stage: openStageKey })
      const won = await createOpp({ stage: 'WON', closedAt: new Date() })

      const res = await request(app)
        .post('/api/pipeline/opportunities/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [open.id, won.id], action: 'archive' })
      expect(res.status).toBe(200)
      expect(res.body.data.updated).toBe(1)
      expect(res.body.data.skipped).toBe(1)

      const openRow = await prisma.opportunity.findUnique({ where: { id: open.id } })
      const wonRow = await prisma.opportunity.findUnique({ where: { id: won.id } })
      expect(openRow?.archivedAt).toBeNull()
      expect(wonRow?.archivedAt).not.toBeNull()
    })

    it('action prospectStatus met à jour le statut de prospection en masse', async () => {
      const opp1 = await createOpp()
      const opp2 = await createOpp()
      const res = await request(app)
        .post('/api/pipeline/opportunities/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [opp1.id, opp2.id], action: 'prospectStatus', value: 'REACHED' })
      expect(res.status).toBe(200)
      expect(res.body.data.updated).toBe(2)
      const rows = await prisma.opportunity.findMany({ where: { id: { in: [opp1.id, opp2.id] } } })
      expect(rows.every(r => r.prospectStatus === 'REACHED')).toBe(true)
    })

    it('plus de 200 ids → 400 VALIDATION_ERROR', async () => {
      const ids = Array.from({ length: 201 }, (_, i) => `fake-id-${i}`)
      const res = await request(app)
        .post('/api/pipeline/opportunities/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids, action: 'archive' })
      expect(res.status).toBe(400)
    })
  })

  // ─── POST /opportunities/import/csv ─────────────────────────────────────

  describe('POST /opportunities/import/csv', () => {
    it('crée entreprise + contact + opportunité pour une ligne complète', async () => {
      const res = await request(app)
        .post('/api/pipeline/opportunities/import/csv')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          pipelineId,
          stage: openStageKey,
          source: 'COLD_CALL',
          rows: [{ companyName: 'Import Test SARL', firstName: 'Alice', lastName: 'Martin', email: 'alice.martin@importtest.fr', value: '1500' }],
        })
      expect(res.status).toBe(200)
      expect(res.body.data.created.companies).toBe(1)
      expect(res.body.data.created.contacts).toBe(1)
      expect(res.body.data.created.opportunities).toBe(1)
      expect(res.body.data.errors).toEqual([])

      const company = await prisma.company.findFirst({ where: { name: 'Import Test SARL' } })
      expect(company).not.toBeNull()
      if (company) createdCompanyIds.push(company.id)

      const opp = await prisma.opportunity.findFirst({ where: { companyId: company?.id } })
      expect(opp?.source).toBe('COLD_CALL')
      expect(opp?.prospectStatus).toBe('TODO')
      expect(opp?.value).toBe(1500)
    })

    it('réutilise une entreprise existante (nom insensible à la casse)', async () => {
      const existing = await prisma.company.create({ data: { name: 'Réutilisée Corp' } })
      createdCompanyIds.push(existing.id)

      const res = await request(app)
        .post('/api/pipeline/opportunities/import/csv')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          pipelineId,
          stage: openStageKey,
          rows: [{ companyName: 'réutilisée corp', firstName: 'Bob', lastName: 'Durand' }],
        })
      expect(res.status).toBe(200)
      expect(res.body.data.created.companies).toBe(0)
      expect(res.body.data.created.opportunities).toBe(1)

      const companies = await prisma.company.findMany({ where: { name: { contains: 'Corp' } } })
      expect(companies.length).toBe(1)
    })

    it('ignore (skipped) une ligne qui dupliquerait une opportunité ouverte existante', async () => {
      const company = await prisma.company.create({ data: { name: 'Doublon Opportunité SAS' } })
      createdCompanyIds.push(company.id)
      await createOpp({ companyId: company.id, stage: openStageKey })

      const res = await request(app)
        .post('/api/pipeline/opportunities/import/csv')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          pipelineId,
          stage: openStageKey,
          rows: [{ companyName: 'Doublon Opportunité SAS' }],
        })
      expect(res.status).toBe(200)
      expect(res.body.data.skipped).toBe(1)
      expect(res.body.data.created.opportunities).toBe(0)
    })

    it('ligne sans entreprise ni contact → errors, pas de création', async () => {
      const res = await request(app)
        .post('/api/pipeline/opportunities/import/csv')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pipelineId, stage: openStageKey, rows: [{ phone: '0600000000', notes: 'ni société ni personne' }] })
      expect(res.status).toBe(200)
      expect(res.body.data.errors.length).toBe(1)
      expect(res.body.data.errors[0].row).toBe(0)
      expect(res.body.data.created.opportunities).toBe(0)
    })

    it('plus de 500 lignes → 400', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => ({ companyName: `Entreprise ${i}` }))
      const res = await request(app)
        .post('/api/pipeline/opportunities/import/csv')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pipelineId, rows })
      expect(res.status).toBe(400)
    })
  })

  // ─── Routes /leads supprimées ─────────────────────────────────────────────

  describe('Routes /leads supprimées', () => {
    it('GET /pipeline/leads → 404', async () => {
      const res = await request(app)
        .get('/api/pipeline/leads')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(404)
    })

    it('POST /pipeline/leads → 404', async () => {
      const res = await request(app)
        .post('/api/pipeline/leads')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ contactId: 'x', title: 'y' })
      expect(res.status).toBe(404)
    })

    it('POST /pipeline/leads/:id/convert → 404', async () => {
      const res = await request(app)
        .post('/api/pipeline/leads/does-not-exist/convert')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(404)
    })
  })
})
