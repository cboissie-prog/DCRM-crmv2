/**
 * prospection-module.test.ts — module Prospection (spec
 * docs/superpowers/specs/2026-10-08-prospection-module-design.md, §6 serveur) :
 * listes (CRUD, compteurs, archivage), import dans une liste, actions rapides
 * (cadence, auto-attribution, Appointment), qualification vers le pipeline,
 * stats par commercial, alertes du pipeline, permissions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

const TECH_EMAIL = 'technicien-prospection-test@test.local'
const TECH_PASSWORD = 'technicien-pwd-123'
const COMMERCIAL_EMAIL = 'commercial-prospection-test@test.local'
const COMMERCIAL_PASSWORD = 'commercial-pwd-123'

let adminToken: string
let adminId: string
let techToken: string
let techId: string
let commercialToken: string
let commercialId: string

let pipelineId: string
let openStageKey: string
let wonStageKey: string

const createdOpportunityIds: string[] = []
const createdCompanyIds: string[] = []
const createdContactIds: string[] = []
const createdListIds: string[] = []
const createdAppointmentIds: string[] = []

async function createProspect(extra: Record<string, unknown> = {}) {
  const opp = await prisma.opportunity.create({
    data: { title: 'Prospect test', pipelineId: null, stage: 'NEW', value: 0, ...extra },
  })
  createdOpportunityIds.push(opp.id)
  return opp
}

describe('Module Prospection (serveur)', () => {
  beforeAll(async () => {
    const loginResult = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = loginResult.accessToken
    adminId = loginResult.user.id

    const pipeRes = await request(app)
      .post('/api/pipelines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Prospection Module' })
    expect(pipeRes.status).toBe(201)
    pipelineId = pipeRes.body.data.id

    const stageRes = await request(app)
      .post(`/api/pipelines/${pipelineId}/stages`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'OPEN', name: 'Ouverte' })
    expect(stageRes.status).toBe(201)
    openStageKey = 'OPEN'
    wonStageKey = 'WON' // injecté automatiquement par ensureWonLostStages à la création du pipeline

    // ── Utilisateurs de test (rôles TECHNICIEN et COMMERCIAL) ──────────────────
    const techRole = await prisma.role.findUnique({ where: { name: 'TECHNICIEN' } })
    const commercialRole = await prisma.role.findUnique({ where: { name: 'COMMERCIAL' } })
    if (!techRole || !commercialRole) throw new Error('Rôles TECHNICIEN/COMMERCIAL introuvables dans le seed')

    for (const email of [TECH_EMAIL, COMMERCIAL_EMAIL]) {
      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) {
        await prisma.refreshToken.deleteMany({ where: { userId: existing.id } })
        await prisma.user.delete({ where: { id: existing.id } })
      }
    }

    const techUser = await prisma.user.create({
      data: {
        email: TECH_EMAIL, password: await bcrypt.hash(TECH_PASSWORD, 10),
        firstName: 'Test', lastName: 'Technicien', role: 'TECHNICIEN', roleId: techRole.id,
      },
    })
    techId = techUser.id
    const techLogin = await loginAs(app, TECH_EMAIL, TECH_PASSWORD)
    techToken = techLogin.accessToken

    const commercialUser = await prisma.user.create({
      data: {
        email: COMMERCIAL_EMAIL, password: await bcrypt.hash(COMMERCIAL_PASSWORD, 10),
        firstName: 'Test', lastName: 'Commercial', role: 'COMMERCIAL', roleId: commercialRole.id,
      },
    })
    commercialId = commercialUser.id
    const commercialLogin = await loginAs(app, COMMERCIAL_EMAIL, COMMERCIAL_PASSWORD)
    commercialToken = commercialLogin.accessToken
  })

  afterAll(async () => {
    if (createdAppointmentIds.length > 0) {
      await prisma.appointmentUser.deleteMany({ where: { appointmentId: { in: createdAppointmentIds } } })
      await prisma.appointmentContact.deleteMany({ where: { appointmentId: { in: createdAppointmentIds } } })
      await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } })
    }
    await prisma.appointment.deleteMany({ where: { opportunityId: { in: createdOpportunityIds } } })
    if (createdOpportunityIds.length > 0) {
      await prisma.activity.deleteMany({ where: { opportunityId: { in: createdOpportunityIds } } })
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
    if (createdListIds.length > 0) {
      await prisma.opportunity.updateMany({ where: { listId: { in: createdListIds } }, data: { listId: null } })
      await prisma.prospectList.deleteMany({ where: { id: { in: createdListIds } } })
    }
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [techId, commercialId] } } })
    await prisma.user.deleteMany({ where: { id: { in: [techId, commercialId] } } })
    await prisma.pipelineStage.deleteMany({ where: { pipelineId } })
    await prisma.pipeline.delete({ where: { id: pipelineId } })
    await prisma.$disconnect()
  })

  // ─── Permissions ─────────────────────────────────────────────────────────

  describe('Permissions', () => {
    it('TECHNICIEN → 403 sur GET /prospection/lists', async () => {
      const res = await request(app).get('/api/prospection/lists').set('Authorization', `Bearer ${techToken}`)
      expect(res.status).toBe(403)
    })

    it('TECHNICIEN → 403 sur GET /prospection/prospects', async () => {
      const res = await request(app).get('/api/prospection/prospects').set('Authorization', `Bearer ${techToken}`)
      expect(res.status).toBe(403)
    })

    it('COMMERCIAL (prospection:write, pas manage) → 403 sur POST /prospection/lists', async () => {
      const res = await request(app)
        .post('/api/prospection/lists')
        .set('Authorization', `Bearer ${commercialToken}`)
        .send({ name: 'Liste interdite' })
      expect(res.status).toBe(403)
    })

    it('COMMERCIAL → 200 sur GET /prospection/lists (lecture autorisée)', async () => {
      const res = await request(app).get('/api/prospection/lists').set('Authorization', `Bearer ${commercialToken}`)
      expect(res.status).toBe(200)
    })
  })

  // ─── Listes : CRUD, compteurs, archivage ────────────────────────────────

  describe('Listes de prospection', () => {
    let listId: string

    it('POST /prospection/lists crée une liste', async () => {
      const res = await request(app)
        .post('/api/prospection/lists')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'IT Roanne octobre 2026', source: 'COLD_CALL', pipelineId, assignedToId: adminId })
      expect(res.status).toBe(201)
      expect(res.body.data.status).toBe('ACTIVE')
      listId = res.body.data.id
      createdListIds.push(listId)
    })

    it('GET /prospection/lists renvoie la liste avec des compteurs à 0', async () => {
      const res = await request(app).get('/api/prospection/lists').set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      const found = res.body.data.find((l: { id: string }) => l.id === listId)
      expect(found).toBeDefined()
      expect(found.counts).toEqual({ total: 0, todo: 0, contacted: 0, callback: 0, qualified: 0, rejected: 0, unreachable: 0 })
    })

    it('les compteurs reflètent les statuts des prospects de la liste', async () => {
      await createProspect({ listId, prospectStatus: 'TODO' })
      await createProspect({ listId, prospectStatus: 'REACHED' })
      await createProspect({ listId, prospectStatus: 'CALLBACK' })
      await createProspect({ listId, prospectStatus: 'NOT_INTERESTED' })
      await createProspect({ listId, prospectStatus: 'UNREACHABLE' })

      const res = await request(app).get('/api/prospection/lists').set('Authorization', `Bearer ${adminToken}`)
      const found = res.body.data.find((l: { id: string }) => l.id === listId)
      expect(found.counts).toEqual({ total: 5, todo: 1, contacted: 1, callback: 1, qualified: 0, rejected: 1, unreachable: 1 })
    })

    it('PUT /prospection/lists/:id met à jour le nom', async () => {
      const res = await request(app)
        .put(`/api/prospection/lists/${listId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'IT Roanne — renommée' })
      expect(res.status).toBe(200)
      expect(res.body.data.name).toBe('IT Roanne — renommée')
    })

    it('PATCH /:id/archive puis GET /lists par défaut ne la montre plus', async () => {
      const archiveRes = await request(app)
        .patch(`/api/prospection/lists/${listId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(archiveRes.status).toBe(200)
      expect(archiveRes.body.data.status).toBe('ARCHIVED')

      const activeRes = await request(app).get('/api/prospection/lists').set('Authorization', `Bearer ${adminToken}`)
      expect(activeRes.body.data.some((l: { id: string }) => l.id === listId)).toBe(false)

      const archivedRes = await request(app)
        .get('/api/prospection/lists')
        .query({ status: 'ARCHIVED' })
        .set('Authorization', `Bearer ${adminToken}`)
      expect(archivedRes.body.data.some((l: { id: string }) => l.id === listId)).toBe(true)
    })

    it('PATCH /:id/unarchive la réactive', async () => {
      const res = await request(app)
        .patch(`/api/prospection/lists/${listId}/unarchive`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('ACTIVE')
    })
  })

  // ─── Import dans une liste ────────────────────────────────────────────────

  describe('POST /prospection/lists/:id/import', () => {
    let listId: string

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/prospection/lists')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Import Test', source: 'COLD_CALL' })
      listId = res.body.data.id
      createdListIds.push(listId)
    })

    it('crée un prospect avec listId posé et pipelineId null', async () => {
      const res = await request(app)
        .post(`/api/prospection/lists/${listId}/import`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rows: [{ companyName: 'Import Liste SARL', firstName: 'Alice', lastName: 'Martin' }] })
      expect(res.status).toBe(200)
      expect(res.body.data.created.opportunities).toBe(1)

      const company = await prisma.company.findFirst({ where: { name: 'Import Liste SARL' } })
      expect(company).not.toBeNull()
      if (company) createdCompanyIds.push(company.id)

      const prospect = await prisma.opportunity.findFirst({ where: { companyId: company?.id } })
      expect(prospect?.listId).toBe(listId)
      expect(prospect?.pipelineId).toBeNull()
      expect(prospect?.prospectStatus).toBe('TODO')
      expect(prospect?.source).toBe('COLD_CALL')
    })

    it('ignore (skipped) un doublon dans la même liste pour la même entreprise', async () => {
      const res = await request(app)
        .post(`/api/prospection/lists/${listId}/import`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rows: [{ companyName: 'Import Liste SARL' }] })
      expect(res.status).toBe(200)
      expect(res.body.data.skipped).toBe(1)
      expect(res.body.data.created.opportunities).toBe(0)
    })

    it('404 LIST non trouvée', async () => {
      const res = await request(app)
        .post('/api/prospection/lists/does-not-exist/import')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rows: [{ companyName: 'X' }] })
      expect(res.status).toBe(404)
    })
  })

  // ─── Actions rapides ───────────────────────────────────────────────────────

  describe('POST /prospection/prospects/:id/actions', () => {
    it('auto-attribution : la première action assigne la fiche à son auteur', async () => {
      const prospect = await createProspect()
      expect(prospect.assignedToId).toBeNull()

      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NOTE', note: 'Première prise de contact' })
      expect(res.status).toBe(200)
      expect(res.body.data.assignedToId).toBe(adminId)

      const activity = await prisma.activity.findFirst({ where: { opportunityId: prospect.id, type: 'NOTE' } })
      expect(activity?.userId).toBe(adminId)
      expect(activity?.description).toBe('Première prise de contact')
      expect(res.body.data.lastActivityAt).not.toBeNull()
    })

    it('cadence NO_ANSWER : rappel à J+2, puis UNREACHABLE à la 3e tentative', async () => {
      const prospect = await createProspect()

      const first = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NO_ANSWER' })
      expect(first.status).toBe(200)
      expect(first.body.data.prospectStatus).toBe('NO_ANSWER')
      expect(first.body.data.callAttempts).toBe(1)
      const remindAt1 = new Date(first.body.data.remindAt)
      const daysUntilRemind = Math.round((remindAt1.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      expect(daysUntilRemind).toBe(2) // prospectCallbackDays par défaut

      const second = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NO_ANSWER' })
      expect(second.body.data.prospectStatus).toBe('NO_ANSWER')
      expect(second.body.data.callAttempts).toBe(2)

      const third = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NO_ANSWER' })
      expect(third.body.data.prospectStatus).toBe('UNREACHABLE')
      expect(third.body.data.callAttempts).toBe(3)
      const remindAt3 = new Date(third.body.data.remindAt)
      const daysUntilRetry = Math.round((remindAt3.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      expect(daysUntilRetry).toBe(30) // prospectUnreachableRetryDays par défaut

      const activity = await prisma.activity.findFirst({ where: { opportunityId: prospect.id, type: 'UNREACHABLE' } })
      expect(activity).not.toBeNull()
    })

    it('REACHED sans remindAt/nextAction → 400 REMIND_AT_REQUIRED puis NEXT_ACTION_REQUIRED', async () => {
      const prospect = await createProspect()
      const noRemind = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'REACHED' })
      expect(noRemind.status).toBe(400)
      expect(noRemind.body.error.code).toBe('REMIND_AT_REQUIRED')

      const noNextAction = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'REACHED', remindAt: new Date(Date.now() + 86400000).toISOString() })
      expect(noNextAction.status).toBe(400)
      expect(noNextAction.body.error.code).toBe('NEXT_ACTION_REQUIRED')
    })

    it('REACHED avec remindAt + nextAction → 200, statut REACHED', async () => {
      const prospect = await createProspect()
      const remindAt = new Date(Date.now() + 3 * 86400000).toISOString()
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'REACHED', remindAt, nextAction: 'Envoyer la plaquette' })
      expect(res.status).toBe(200)
      expect(res.body.data.prospectStatus).toBe('REACHED')
      expect(res.body.data.callAttempts).toBe(1)
      expect(res.body.data.nextAction).toBe('Envoyer la plaquette')

      const activity = await prisma.activity.findFirst({ where: { opportunityId: prospect.id, type: 'CALL_REACHED' } })
      expect(activity).not.toBeNull()
    })

    it('CALLBACK sans remindAt → 400 REMIND_AT_REQUIRED', async () => {
      const prospect = await createProspect()
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'CALLBACK' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('REMIND_AT_REQUIRED')
    })

    it('CALLBACK avec remindAt → 200, statut CALLBACK', async () => {
      const prospect = await createProspect()
      const remindAt = new Date(Date.now() + 86400000).toISOString()
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'CALLBACK', remindAt })
      expect(res.status).toBe(200)
      expect(res.body.data.prospectStatus).toBe('CALLBACK')
      expect(res.body.data.remindAt).not.toBeNull()
    })

    it('DOC_SENT ajoute le document à documentsSent', async () => {
      const prospect = await createProspect()
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'DOC_SENT', document: 'PLAQUETTE' })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body.data.documentsSent)).toEqual(['PLAQUETTE'])

      const activity = await prisma.activity.findFirst({ where: { opportunityId: prospect.id, type: 'DOC_SENT' } })
      expect(activity).not.toBeNull()
    })

    it('DOC_SENT avec un document inconnu → 400 INVALID_REFERENCE', async () => {
      const prospect = await createProspect()
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'DOC_SENT', document: 'NE_EXISTE_PAS' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_REFERENCE')
    })

    it('EMAIL_SENT journalise une Activity', async () => {
      const prospect = await createProspect()
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'EMAIL_SENT', note: 'Envoi de la présentation' })
      expect(res.status).toBe(200)
      const activity = await prisma.activity.findFirst({ where: { opportunityId: prospect.id, type: 'EMAIL_SENT' } })
      expect(activity?.description).toBe('Envoi de la présentation')
    })

    it('MEETING_SET crée un Appointment lié et pose remindAt', async () => {
      const contact = await prisma.contact.create({ data: { firstName: 'RDV', lastName: 'Test' } })
      createdContactIds.push(contact.id)
      const prospect = await createProspect({ contactId: contact.id })
      const startAt = new Date(Date.now() + 5 * 86400000).toISOString()

      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'MEETING_SET', startAt, title: 'Démo caisse' })
      expect(res.status).toBe(200)
      expect(new Date(res.body.data.remindAt).toISOString()).toBe(new Date(startAt).toISOString())

      const appointment = await prisma.appointment.findFirst({ where: { opportunityId: prospect.id } })
      expect(appointment).not.toBeNull()
      expect(appointment?.type).toBe('CLIENT_MEETING')
      expect(appointment?.title).toBe('Démo caisse')
      if (appointment) createdAppointmentIds.push(appointment.id)

      const linkedContact = await prisma.appointmentContact.findFirst({ where: { appointmentId: appointment!.id } })
      expect(linkedContact?.contactId).toBe(contact.id)

      const activity = await prisma.activity.findFirst({ where: { opportunityId: prospect.id, type: 'MEETING_SET' } })
      expect(activity).not.toBeNull()
    })

    it('NOTE sans note → 400 NOTE_REQUIRED', async () => {
      const prospect = await createProspect()
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NOTE' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('NOTE_REQUIRED')
    })

    it('NEXT_ACTION met à jour remindAt et nextAction', async () => {
      const prospect = await createProspect()
      const remindAt = new Date(Date.now() + 86400000).toISOString()
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NEXT_ACTION', remindAt, nextAction: 'Relancer par email' })
      expect(res.status).toBe(200)
      expect(res.body.data.nextAction).toBe('Relancer par email')
    })

    it('QUALIFICATION met à jour la grille de qualification (JSON)', async () => {
      const prospect = await createProspect()
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'QUALIFICATION', criteria: { NEED: true, BUDGET: null } })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body.data.qualification)).toEqual({ NEED: true, BUDGET: null })
    })

    it('QUALIFICATION avec un critère inconnu → 400 INVALID_REFERENCE', async () => {
      const prospect = await createProspect()
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'QUALIFICATION', criteria: { NE_EXISTE_PAS: true } })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_REFERENCE')
    })

    it('NOT_INTERESTED pose lostReason et efface remindAt', async () => {
      const prospect = await createProspect({ remindAt: new Date() })
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NOT_INTERESTED', reason: 'NO_NEED' })
      expect(res.status).toBe(200)
      expect(res.body.data.prospectStatus).toBe('NOT_INTERESTED')
      expect(res.body.data.lostReason).toBe('NO_NEED')
      expect(res.body.data.remindAt).toBeNull()
    })

    it('REOPEN repasse le prospect à TODO', async () => {
      const prospect = await createProspect({ prospectStatus: 'NOT_INTERESTED', lostReason: 'NO_NEED' })
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'REOPEN' })
      expect(res.status).toBe(200)
      expect(res.body.data.prospectStatus).toBe('TODO')
    })

    it('action inconnue → 400 INVALID_ACTION', async () => {
      const prospect = await createProspect()
      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NIMPORTE_QUOI' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_ACTION')
    })

    it('404 si le prospect n\'existe pas', async () => {
      const res = await request(app)
        .post('/api/prospection/prospects/does-not-exist/actions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NOTE', note: 'x' })
      expect(res.status).toBe(404)
    })
  })

  // ─── Actions exclues depuis le pipeline ──────────────────────────────────

  describe('POST /pipeline/opportunities/:id/actions', () => {
    it('NOT_INTERESTED est refusé depuis le pipeline (perte via l\'étape Perdu)', async () => {
      const opp = await prisma.opportunity.create({ data: { title: 'Deal test', pipelineId, stage: openStageKey, value: 500 } })
      createdOpportunityIds.push(opp.id)
      const res = await request(app)
        .post(`/api/pipeline/opportunities/${opp.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NOT_INTERESTED', reason: 'NO_NEED' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_ACTION')
    })

    it('REOPEN est refusé depuis le pipeline', async () => {
      const opp = await prisma.opportunity.create({ data: { title: 'Deal test 2', pipelineId, stage: openStageKey, value: 500 } })
      createdOpportunityIds.push(opp.id)
      const res = await request(app)
        .post(`/api/pipeline/opportunities/${opp.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'REOPEN' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_ACTION')
    })

    it('NOTE reste disponible depuis le pipeline', async () => {
      const opp = await prisma.opportunity.create({ data: { title: 'Deal test 3', pipelineId, stage: openStageKey, value: 500 } })
      createdOpportunityIds.push(opp.id)
      const res = await request(app)
        .post(`/api/pipeline/opportunities/${opp.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'NOTE', note: 'Relance faite' })
      expect(res.status).toBe(200)
    })
  })

  // ─── GET /pipeline/opportunities/:id enrichi ──────────────────────────────

  describe('GET /pipeline/opportunities/:id', () => {
    it('renvoie activities (avec user), list, qualification, documentsSent, lastActivityAt', async () => {
      const list = await prisma.prospectList.create({ data: { name: 'Liste pour détail', createdById: adminId } })
      createdListIds.push(list.id)
      const opp = await prisma.opportunity.create({
        data: { title: 'Deal détail', pipelineId, stage: openStageKey, value: 100, listId: list.id },
      })
      createdOpportunityIds.push(opp.id)
      await prisma.activity.create({ data: { type: 'NOTE', title: 'Note test', userId: adminId, opportunityId: opp.id } })

      const res = await request(app)
        .get(`/api/pipeline/opportunities/${opp.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data.activities.length).toBeGreaterThanOrEqual(1)
      expect(res.body.data.activities[0].user.id).toBe(adminId)
      expect(res.body.data.list.id).toBe(list.id)
      expect('qualification' in res.body.data).toBe(true)
      expect('documentsSent' in res.body.data).toBe(true)
      expect('lastActivityAt' in res.body.data).toBe(true)
    })
  })

  // ─── PATCH /pipeline/opportunities/:id/stage journalise STAGE_CHANGED ─────

  describe('PATCH /pipeline/opportunities/:id/stage', () => {
    it('journalise une Activity STAGE_CHANGED et pose lastActivityAt', async () => {
      const opp = await prisma.opportunity.create({ data: { title: 'Deal stage', pipelineId, stage: 'NEW', value: 100 } })
      createdOpportunityIds.push(opp.id)

      const res = await request(app)
        .patch(`/api/pipeline/opportunities/${opp.id}/stage`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: openStageKey })
      expect(res.status).toBe(200)
      expect(res.body.data.lastActivityAt).not.toBeNull()

      const activity = await prisma.activity.findFirst({ where: { opportunityId: opp.id, type: 'STAGE_CHANGED' } })
      expect(activity).not.toBeNull()
    })
  })

  // ─── Qualification vers le pipeline ────────────────────────────────────────

  describe('POST /prospection/prospects/:id/qualify', () => {
    let listId: string

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/prospection/lists')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Liste à qualifier', pipelineId })
      listId = res.body.data.id
      createdListIds.push(listId)
    })

    it('qualifie un prospect vers le pipeline par défaut de la liste', async () => {
      const prospect = await createProspect({ listId })

      const res = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/qualify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
      expect(res.status).toBe(200)
      expect(res.body.data.pipelineId).toBe(pipelineId)
      expect(res.body.data.stage).toBe(openStageKey)
      expect(res.body.data.prospectStatus).toBe('QUALIFIED')
      expect(res.body.data.qualifiedAt).not.toBeNull()

      const activity = await prisma.activity.findFirst({ where: { opportunityId: prospect.id, type: 'QUALIFIED' } })
      expect(activity).not.toBeNull()
    })

    it('400 ALREADY_QUALIFIED si la fiche est déjà dans un pipeline', async () => {
      const prospect = await createProspect({ listId })
      const first = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/qualify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
      expect(first.status).toBe(200)

      const second = await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/qualify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
      expect(second.status).toBe(400)
      expect(second.body.error.code).toBe('ALREADY_QUALIFIED')
    })

    it('la fiche sort de GET /prospects et entre dans GET /pipeline/opportunities', async () => {
      const prospect = await createProspect({ listId })
      await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/qualify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: openStageKey })

      const prospectsRes = await request(app)
        .get('/api/prospection/prospects')
        .query({ listId, limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      expect(prospectsRes.body.data.some((p: { id: string }) => p.id === prospect.id)).toBe(false)

      const pipelineRes = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      expect(pipelineRes.body.data.some((o: { id: string }) => o.id === prospect.id)).toBe(true)
    })

    it('404 si le prospect n\'existe pas', async () => {
      const res = await request(app)
        .post('/api/prospection/prospects/does-not-exist/qualify')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
      expect(res.status).toBe(404)
    })
  })

  // ─── Stats par commercial ───────────────────────────────────────────────

  describe('GET /prospection/stats', () => {
    it('ADMIN (prospection:manage) voit les stats de plusieurs commerciaux', async () => {
      const prospect = await createProspect()
      await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${commercialToken}`)
        .send({ action: 'NOTE', note: 'Appel du commercial' })

      const res = await request(app).get('/api/prospection/stats').set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it('COMMERCIAL (sans manage) ne voit que sa propre ligne', async () => {
      const prospect = await createProspect()
      await request(app)
        .post(`/api/prospection/prospects/${prospect.id}/actions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'DOC_SENT', document: 'TARIFS' })

      const res = await request(app).get('/api/prospection/stats').set('Authorization', `Bearer ${commercialToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data.every((row: { userId: string }) => row.userId === commercialId)).toBe(true)
      expect(res.body.data.some((row: { userId: string }) => row.userId === adminId)).toBe(false)
    })
  })

  // ─── Alertes du pipeline ────────────────────────────────────────────────

  describe('GET /pipeline/opportunities — alert', () => {
    it('NO_NEXT_ACTION pour une étape ouverte sans remindAt futur', async () => {
      const opp = await prisma.opportunity.create({ data: { title: 'Alerte sans action', pipelineId, stage: openStageKey, value: 0 } })
      createdOpportunityIds.push(opp.id)

      const res = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      const found = res.body.data.find((o: { id: string }) => o.id === opp.id)
      expect(found.alert).toBe('NO_NEXT_ACTION')
    })

    it('STALE pour une étape ouverte avec remindAt futur mais lastActivityAt ancien', async () => {
      const opp = await prisma.opportunity.create({
        data: {
          title: 'Alerte stale', pipelineId, stage: openStageKey, value: 0,
          remindAt: new Date(Date.now() + 10 * 86400000),
          lastActivityAt: new Date(Date.now() - 10 * 86400000),
        },
      })
      createdOpportunityIds.push(opp.id)

      const res = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      const found = res.body.data.find((o: { id: string }) => o.id === opp.id)
      expect(found.alert).toBe('STALE')
    })

    it('null quand remindAt est futur et lastActivityAt récent', async () => {
      const opp = await prisma.opportunity.create({
        data: {
          title: 'Pas d\'alerte', pipelineId, stage: openStageKey, value: 0,
          remindAt: new Date(Date.now() + 10 * 86400000),
          lastActivityAt: new Date(),
        },
      })
      createdOpportunityIds.push(opp.id)

      const res = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      const found = res.body.data.find((o: { id: string }) => o.id === opp.id)
      expect(found.alert).toBeNull()
    })

    it('alert=true ne renvoie que les opportunités alertées', async () => {
      const res = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, alert: 'true', limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data.every((o: { alert: string | null }) => o.alert !== null)).toBe(true)
    })

    it('une étape gagnée/perdue n\'est jamais alertée', async () => {
      const opp = await prisma.opportunity.create({ data: { title: 'Gagnée sans action', pipelineId, stage: wonStageKey, value: 0, closedAt: new Date() } })
      createdOpportunityIds.push(opp.id)

      const res = await request(app)
        .get('/api/pipeline/opportunities')
        .query({ pipelineId, limit: '200' })
        .set('Authorization', `Bearer ${adminToken}`)
      const found = res.body.data.find((o: { id: string }) => o.id === opp.id)
      expect(found.alert).toBeNull()
    })
  })
})
