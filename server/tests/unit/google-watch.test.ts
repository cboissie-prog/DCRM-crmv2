/**
 * google-watch.test.ts
 * Tests unitaires des fonctions watch Google Calendar :
 *   - registerWatchForUser   : ouvre un canal, stocke channelId/resourceId/token/expiresAt
 *   - stopWatchForUser       : ferme le canal, remet les champs à null
 *   - renewExpiringChannels  : renouvelle les canaux expirant sous 24 h, rattrape ceux sans canal
 *   - runCalendarSync(force) : saute les credentials à canal actif ; les inclut avec force:true
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

// ── vi.hoisted : mocks déclarés AVANT le hissage de vi.mock ──────────────────

const {
  mockEventsList,
  mockEventsWatch,
  mockChannelsStop,
} = vi.hoisted(() => ({
  mockEventsList:   vi.fn(),
  mockEventsWatch:  vi.fn(),
  mockChannelsStop: vi.fn(),
}))

// ── Mock googleapis ───────────────────────────────────────────────────────────

vi.mock('googleapis', () => {
  const calendarFactory = () => ({
    events: {
      list:   mockEventsList,
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      watch:  mockEventsWatch,
    },
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
import {
  registerWatchForUser,
  stopWatchForUser,
  renewExpiringChannels,
  runCalendarSync,
  getWebhookUrl,
} from '../../src/services/google-calendar'

const prisma = new PrismaClient()

// IDs réutilisés dans les tests
let adminUserId = ''

// Helper : crée ou remplace la credential de l'admin avec des champs personnalisés
async function upsertCred(overrides: Record<string, unknown> = {}) {
  return prisma.googleCredential.upsert({
    where:  { userId: adminUserId },
    create: {
      userId:              adminUserId,
      googleEmail:         'admin@watch-test.local',
      refreshTokenEnc:     'enc:fake-refresh',
      calendarSyncEnabled: true,
      channelId:           null,
      channelResourceId:   null,
      channelToken:        null,
      channelExpiresAt:    null,
      ...overrides,
    },
    update: {
      googleEmail:         'admin@watch-test.local',
      refreshTokenEnc:     'enc:fake-refresh',
      calendarSyncEnabled: true,
      channelId:           null,
      channelResourceId:   null,
      channelToken:        null,
      channelExpiresAt:    null,
      ...overrides,
    },
  })
}

describe('google-watch — tests unitaires', () => {

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID     = 'watch-test-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'watch-test-client-secret'
    process.env.TOKEN_ENC_KEY        = 'd'.repeat(64)

    const admin = await prisma.user.findUnique({ where: { email: 'admin@crm.local' } })
    if (!admin) throw new Error('Admin user not found in test.db')
    adminUserId = admin.id

    await prisma.googleCredential.deleteMany({ where: { userId: adminUserId } }).catch(() => {})
  })

  afterAll(async () => {
    await prisma.googleCredential.deleteMany({ where: { userId: adminUserId } }).catch(() => {})
    await prisma.$disconnect()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Valeur de retour par défaut pour events.list (synchro incrémentale vide)
    mockEventsList.mockResolvedValue({ data: { items: [], nextSyncToken: 'new-sync-token' } })
    // Valeur de retour par défaut pour events.watch
    mockEventsWatch.mockResolvedValue({
      data: {
        resourceId: 'resource-id-from-google',
        expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
    // channels.stop ne fait rien par défaut
    mockChannelsStop.mockResolvedValue({ data: {} })
  })

  // ── a) registerWatchForUser sans GOOGLE_WEBHOOK_URL → no-op ──────────────────

  describe('a) registerWatchForUser sans GOOGLE_WEBHOOK_URL → no-op', () => {
    it('ne crée pas de canal si GOOGLE_WEBHOOK_URL absent', async () => {
      delete process.env.GOOGLE_WEBHOOK_URL
      const cred = await upsertCred()
      await registerWatchForUser(cred as Parameters<typeof registerWatchForUser>[0])
      expect(mockEventsWatch).not.toHaveBeenCalled()
      // La credential doit rester sans canal
      const updated = await prisma.googleCredential.findUnique({ where: { userId: adminUserId } })
      expect(updated?.channelId).toBeNull()
    })
  })

  // ── b) registerWatchForUser avec GOOGLE_WEBHOOK_URL → stocke les champs ──────

  describe('b) registerWatchForUser avec GOOGLE_WEBHOOK_URL → stocke channelId/resourceId/token/expiresAt', () => {
    it('appelle events.watch et met à jour la credential', async () => {
      process.env.GOOGLE_WEBHOOK_URL = 'https://dcrm.dcb-technologies.fr/api/google/notifications'
      const cred = await upsertCred()

      await registerWatchForUser(cred as Parameters<typeof registerWatchForUser>[0])

      expect(mockEventsWatch).toHaveBeenCalledOnce()
      const callArgs = mockEventsWatch.mock.calls[0][0]
      expect(callArgs.calendarId).toBe('primary')
      expect(callArgs.requestBody.type).toBe('web_hook')
      expect(callArgs.requestBody.address).toBe('https://dcrm.dcb-technologies.fr/api/google/notifications')
      expect(typeof callArgs.requestBody.id).toBe('string')
      expect(typeof callArgs.requestBody.token).toBe('string')

      // La credential doit avoir les champs renseignés
      const updated = await prisma.googleCredential.findUnique({ where: { userId: adminUserId } })
      expect(updated?.channelId).toBeTruthy()
      expect(updated?.channelResourceId).toBe('resource-id-from-google')
      expect(updated?.channelToken).toBeTruthy()
      expect(updated?.channelExpiresAt).toBeInstanceOf(Date)
      expect(updated!.channelExpiresAt!.getTime()).toBeGreaterThan(Date.now())
    })
  })

  // ── c) stopWatchForUser → ferme le canal et remet les champs à null ───────────

  describe('c) stopWatchForUser → ferme le canal, champs remis à null', () => {
    it('appelle channels.stop et efface les champs de canal', async () => {
      process.env.GOOGLE_WEBHOOK_URL = 'https://dcrm.dcb-technologies.fr/api/google/notifications'

      // Mettre une credential avec canal
      const cred = await upsertCred({
        channelId:         'channel-to-stop',
        channelResourceId: 'resource-to-stop',
        channelToken:      'token-to-stop',
        channelExpiresAt:  new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      })

      await stopWatchForUser(cred as Parameters<typeof stopWatchForUser>[0])

      expect(mockChannelsStop).toHaveBeenCalledOnce()
      const stopArgs = mockChannelsStop.mock.calls[0][0]
      expect(stopArgs.requestBody.id).toBe('channel-to-stop')
      expect(stopArgs.requestBody.resourceId).toBe('resource-to-stop')

      // Les champs doivent être null en DB
      const updated = await prisma.googleCredential.findUnique({ where: { userId: adminUserId } })
      expect(updated?.channelId).toBeNull()
      expect(updated?.channelResourceId).toBeNull()
      expect(updated?.channelToken).toBeNull()
      expect(updated?.channelExpiresAt).toBeNull()
    })
  })

  // ── d) renewExpiringChannels — canal expirant sous 24 h → renouvelé ───────────

  describe('d) renewExpiringChannels — canal expirant sous 24 h → renouvelé', () => {
    it('renouvelle un canal expirant dans < 24 h', async () => {
      process.env.GOOGLE_WEBHOOK_URL = 'https://dcrm.dcb-technologies.fr/api/google/notifications'

      // Canal expirant dans 12 h (< seuil 24 h)
      const expiresIn12h = new Date(Date.now() + 12 * 60 * 60 * 1000)
      await upsertCred({
        channelId:         'expiring-channel',
        channelResourceId: 'expiring-resource',
        channelToken:      'expiring-token',
        channelExpiresAt:  expiresIn12h,
      })

      const renewed = await renewExpiringChannels()
      expect(renewed).toBeGreaterThanOrEqual(1)

      // Un nouveau canal doit avoir été ouvert (events.watch appelé)
      expect(mockEventsWatch).toHaveBeenCalled()

      // La credential doit avoir un nouveau channelId
      const updated = await prisma.googleCredential.findUnique({ where: { userId: adminUserId } })
      expect(updated?.channelId).toBeTruthy()
      expect(updated?.channelId).not.toBe('expiring-channel') // nouveau canal
    })
  })

  // ── e) renewExpiringChannels — credential sans canal → rattrapée ──────────────

  describe('e) renewExpiringChannels — credential sans canal → rattrapée', () => {
    it('ouvre un canal pour une credential calendarSyncEnabled sans canal', async () => {
      process.env.GOOGLE_WEBHOOK_URL = 'https://dcrm.dcb-technologies.fr/api/google/notifications'
      vi.clearAllMocks()
      mockEventsWatch.mockResolvedValue({
        data: {
          resourceId: 'new-resource-id',
          expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      // Credential sans canal
      await upsertCred({ channelId: null, channelResourceId: null, channelToken: null, channelExpiresAt: null })

      const renewed = await renewExpiringChannels()
      expect(renewed).toBeGreaterThanOrEqual(1)
      expect(mockEventsWatch).toHaveBeenCalled()

      const updated = await prisma.googleCredential.findUnique({ where: { userId: adminUserId } })
      expect(updated?.channelId).toBeTruthy()
    })
  })

  // ── f) runCalendarSync — canal actif → skippé ; force:true → inclus ──────────

  describe('f) runCalendarSync — canal actif → skip ; force:true → synchro', () => {
    it('saute une credential avec canal actif (force=false)', async () => {
      vi.clearAllMocks()
      mockEventsList.mockResolvedValue({ data: { items: [], nextSyncToken: 'tok' } })

      // Credential avec canal actif (expire dans 5 jours)
      await upsertCred({
        channelId:         'active-channel',
        channelResourceId: 'active-resource',
        channelToken:      'active-token',
        channelExpiresAt:  new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        syncToken:         'existing-sync-token',
      })

      const stats = await runCalendarSync(false) // force=false
      // events.list ne doit PAS être appelé (canal actif → skip)
      expect(mockEventsList).not.toHaveBeenCalled()
      expect(stats.pulled).toBe(0)
    })

    it('synchronise une credential avec canal actif quand force=true', async () => {
      vi.clearAllMocks()
      mockEventsList.mockResolvedValue({ data: { items: [], nextSyncToken: 'tok2' } })

      // Même credential avec canal actif
      await upsertCred({
        channelId:         'active-channel-2',
        channelResourceId: 'active-resource-2',
        channelToken:      'active-token-2',
        channelExpiresAt:  new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        syncToken:         'existing-sync-token-2',
      })

      const stats = await runCalendarSync(true) // force=true
      // events.list doit avoir été appelé
      expect(mockEventsList).toHaveBeenCalled()
    })
  })
})
