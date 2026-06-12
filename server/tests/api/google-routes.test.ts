/**
 * google-routes.test.ts
 * Tests des routes /api/google/* :
 *   - GET  /api/google/status
 *   - GET  /api/google/calendar/connect
 *   - POST /api/google/calendar/disconnect
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { loginAs } from '../helpers'
import { createApp } from '../../src/app'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL    = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

let adminToken = ''
let adminUserId = ''

describe('/api/google routes', () => {

  beforeAll(async () => {
    // Poser GOOGLE_CLIENT_ID pour que les routes "connect" fonctionnent
    process.env.GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || 'routes-test-client-id'
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'routes-test-client-secret'
    process.env.TOKEN_ENC_KEY        = process.env.TOKEN_ENC_KEY        || 'c'.repeat(64)

    const login = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken  = login.accessToken
    adminUserId = login.user.id

    // S'assurer qu'il n'y a pas de GoogleCredential pour l'admin
    await prisma.googleCredential.deleteMany({ where: { userId: adminUserId } }).catch(() => {})
  })

  afterAll(async () => {
    await prisma.googleCredential.deleteMany({ where: { userId: adminUserId } }).catch(() => {})
    await prisma.$disconnect()
  })

  // ── GET /api/google/status sans credential ────────────────────────────────

  it('GET /api/google/status sans credential → connected:false', async () => {
    const res = await request(app)
      .get('/api/google/status')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.connected).toBe(false)
    expect(res.body.data.calendarSyncEnabled).toBe(false)
    expect(res.body.data.googleEmail).toBeNull()
  })

  // ── GET /api/google/status sans auth → 401 ───────────────────────────────

  it('GET /api/google/status sans authentification → 401', async () => {
    const res = await request(app).get('/api/google/status')
    expect(res.status).toBe(401)
  })

  // ── GET /api/google/calendar/connect → URL avec scope calendar.events ─────

  it('GET /api/google/calendar/connect → renvoie URL contenant calendar.events', async () => {
    const res = await request(app)
      .get('/api/google/calendar/connect')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(typeof res.body.data.url).toBe('string')
    // L'URL doit contenir le scope calendar.events
    expect(res.body.data.url).toContain('calendar.events')
    // Et pointer vers Google OAuth
    expect(res.body.data.url).toMatch(/accounts\.google\.com|oauth2/)
  })

  // ── GET /api/google/calendar/connect sans auth → 401 ─────────────────────

  it('GET /api/google/calendar/connect sans auth → 401', async () => {
    const res = await request(app).get('/api/google/calendar/connect')
    expect(res.status).toBe(401)
  })

  // ── POST /api/google/calendar/disconnect sans credential → 200 (aucune connexion active) ─

  it('POST /api/google/calendar/disconnect sans credential → 200 (message "Aucune connexion")', async () => {
    // Vérifier d'abord qu'il n'y a pas de credential
    await prisma.googleCredential.deleteMany({ where: { userId: adminUserId } })

    const res = await request(app)
      .post('/api/google/calendar/disconnect')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // Le message doit indiquer qu'aucune connexion n'est active
    expect(res.body.data.message).toMatch(/Aucune|aucune/i)
  })

  // ── POST /api/google/calendar/disconnect sans auth → 401 ─────────────────

  it('POST /api/google/calendar/disconnect sans auth → 401', async () => {
    const res = await request(app).post('/api/google/calendar/disconnect')
    expect(res.status).toBe(401)
  })

  // ── GET /api/google/status avec credential active ─────────────────────────

  it('GET /api/google/status avec credential → connected:true', async () => {
    // Créer une credential factice
    await prisma.googleCredential.upsert({
      where:  { userId: adminUserId },
      create: {
        userId:              adminUserId,
        googleEmail:         'admin@google-test.local',
        refreshTokenEnc:     'enc:fake-token',
        calendarSyncEnabled: false,
      },
      update: {
        googleEmail:         'admin@google-test.local',
        refreshTokenEnc:     'enc:fake-token',
        calendarSyncEnabled: false,
      },
    })

    const res = await request(app)
      .get('/api/google/status')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.connected).toBe(true)
    expect(res.body.data.googleEmail).toBe('admin@google-test.local')

    // Nettoyage
    await prisma.googleCredential.delete({ where: { userId: adminUserId } }).catch(() => {})
  })
})
