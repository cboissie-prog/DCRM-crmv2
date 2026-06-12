/**
 * google-notifications.test.ts
 * Tests de l'endpoint POST /api/google/notifications (public).
 *
 * Couverture :
 *   - state 'sync' → 200 immédiat, pas de synchro déclenchée
 *   - channelId inconnu → 200 (silencieux), pas de synchro
 *   - token invalide → 403
 *   - notification valide ('exists') → 200 et pullUserCalendar déclenché
 *   - pas d'authentification requise
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { createApp } from '../../src/app'

// ── Mock googleapis AVANT tout import du service ──────────────────────────────

const mockEventsList   = vi.fn()
const mockChannelsStop = vi.fn()

vi.mock('googleapis', () => {
  const calendarFactory = () => ({
    events:   { list: mockEventsList, insert: vi.fn(), update: vi.fn(), delete: vi.fn(), watch: vi.fn() },
    channels: { stop: mockChannelsStop },
  })

  const OAuth2 = vi.fn().mockImplementation(function() {
    this.setCredentials = vi.fn()
  })

  return {
    google: { calendar: calendarFactory, auth: { OAuth2 } },
    calendar_v3: {},
  }
})

vi.mock('../../src/lib/crypto', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
}))

// Import APRÈS les mocks
import { inFlight } from '../../src/services/google-calendar'

const app    = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const TEST_CHANNEL_ID    = 'test-channel-id-notif-abc123'
const TEST_CHANNEL_TOKEN = 'test-channel-token-secret-xyz'
const TEST_RESOURCE_ID   = 'test-resource-id-xyz'

let adminUserId  = ''
let credentialId = ''

describe('POST /api/google/notifications', () => {

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || 'test-client-id'
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-client-secret'
    process.env.TOKEN_ENC_KEY        = process.env.TOKEN_ENC_KEY        || 'a'.repeat(64)

    const admin = await prisma.user.findUnique({ where: { email: 'admin@crm.local' } })
    if (!admin) throw new Error('Admin user not found in test.db')
    adminUserId = admin.id

    // Nettoyer
    await prisma.googleCredential.deleteMany({ where: { userId: adminUserId } }).catch(() => {})

    // Créer une credential avec un canal watch enregistré
    const cred = await prisma.googleCredential.create({
      data: {
        userId:              adminUserId,
        googleEmail:         'admin@test-notif.local',
        refreshTokenEnc:     'enc:fake-refresh-token',
        calendarSyncEnabled: true,
        syncToken:           'fake-sync-token',
        channelId:           TEST_CHANNEL_ID,
        channelResourceId:   TEST_RESOURCE_ID,
        channelToken:        TEST_CHANNEL_TOKEN,
        channelExpiresAt:    new Date(Date.now() + 6 * 24 * 60 * 60 * 1000), // 6 jours
      },
    })
    credentialId = cred.id
  })

  afterAll(async () => {
    await prisma.googleCredential.deleteMany({ where: { userId: adminUserId } }).catch(() => {})
    await prisma.$disconnect()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    inFlight.clear()
    // Par défaut : events.list simule une réponse vide (pas d'events)
    mockEventsList.mockResolvedValue({ data: { items: [], nextSyncToken: 'new-sync-token' } })
  })

  // ── a) State 'sync' → 200 immédiat, pas de synchro ───────────────────────────

  it('a) state=sync → 200 immédiat, pas de synchro déclenchée', async () => {
    const res = await request(app)
      .post('/api/google/notifications')
      .set('X-Goog-Channel-ID',    TEST_CHANNEL_ID)
      .set('X-Goog-Resource-ID',   TEST_RESOURCE_ID)
      .set('X-Goog-Resource-State','sync')
      .set('X-Goog-Channel-Token', TEST_CHANNEL_TOKEN)

    expect(res.status).toBe(200)
    // Aucune synchro ne doit avoir été déclenchée (events.list non appelé)
    // On attend un tick pour que setImmediate ait pu s'exécuter si mal codé
    await new Promise(r => setTimeout(r, 50))
    expect(mockEventsList).not.toHaveBeenCalled()
  })

  // ── b) channelId inconnu → 200, pas de synchro ───────────────────────────────

  it('b) channelId inconnu → 200 silencieux, pas de synchro', async () => {
    const res = await request(app)
      .post('/api/google/notifications')
      .set('X-Goog-Channel-ID',    'UNKNOWN-CHANNEL-ID-XXXXX')
      .set('X-Goog-Resource-ID',   'some-resource-id')
      .set('X-Goog-Resource-State','exists')
      .set('X-Goog-Channel-Token', 'some-token')

    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 50))
    expect(mockEventsList).not.toHaveBeenCalled()
  })

  // ── c) Token invalide → 403 ───────────────────────────────────────────────────

  it('c) token invalide → 403', async () => {
    const res = await request(app)
      .post('/api/google/notifications')
      .set('X-Goog-Channel-ID',    TEST_CHANNEL_ID)
      .set('X-Goog-Resource-ID',   TEST_RESOURCE_ID)
      .set('X-Goog-Resource-State','exists')
      .set('X-Goog-Channel-Token', 'WRONG-TOKEN-SHOULD-FAIL')

    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('INVALID_CHANNEL_TOKEN')
  })

  // ── d) Notification valide 'exists' → 200 + pullUserCalendar déclenché ────────

  it('d) notification valide exists → 200 et synchro déclenchée', async () => {
    const res = await request(app)
      .post('/api/google/notifications')
      .set('X-Goog-Channel-ID',    TEST_CHANNEL_ID)
      .set('X-Goog-Resource-ID',   TEST_RESOURCE_ID)
      .set('X-Goog-Resource-State','exists')
      .set('X-Goog-Channel-Token', TEST_CHANNEL_TOKEN)

    expect(res.status).toBe(200)

    // Attendre que setImmediate s'exécute
    await new Promise(r => setTimeout(r, 200))

    // pullUserCalendar appelle events.list → au moins un appel
    expect(mockEventsList).toHaveBeenCalled()
  })

  // ── e) Pas d'authentification requise ────────────────────────────────────────

  it('e) pas de header Authorization requis → fonctionne', async () => {
    // On envoie la requête sans aucun token d'auth
    const res = await request(app)
      .post('/api/google/notifications')
      .set('X-Goog-Channel-ID',    TEST_CHANNEL_ID)
      .set('X-Goog-Resource-ID',   TEST_RESOURCE_ID)
      .set('X-Goog-Resource-State','sync')
      .set('X-Goog-Channel-Token', TEST_CHANNEL_TOKEN)
    // Doit répondre 200 (pas 401)
    expect(res.status).toBe(200)
  })

  // ── f) Garde-fou inFlight : si déjà en cours → synchro ignorée ───────────────

  it('f) inFlight actif → notification ignorée silencieusement', async () => {
    // Simuler une synchro en cours pour ce credential
    inFlight.add(credentialId)

    const res = await request(app)
      .post('/api/google/notifications')
      .set('X-Goog-Channel-ID',    TEST_CHANNEL_ID)
      .set('X-Goog-Resource-ID',   TEST_RESOURCE_ID)
      .set('X-Goog-Resource-State','exists')
      .set('X-Goog-Channel-Token', TEST_CHANNEL_TOKEN)

    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 200))

    // events.list ne doit PAS avoir été appelé (synchro bloquée par inFlight)
    expect(mockEventsList).not.toHaveBeenCalled()

    inFlight.delete(credentialId)
  })
})
