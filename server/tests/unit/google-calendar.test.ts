/**
 * google-calendar.test.ts
 * Tests unitaires du service google-calendar.ts — la couche googleapis est entièrement mockée.
 *
 * Fonctions testées :
 *   - appointmentToEvent   (mapping CRM → Google Event)
 *   - processIncomingEvent (traitement d'un événement entrant)
 *   - runCalendarSync      (boucle principale — sans credential → {pulled:0, pushed:0, errors:0})
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

// ── Mock googleapis AVANT tout import du service ─────────────────────────────

const mockEventsList   = vi.fn()
const mockEventsInsert = vi.fn()
const mockEventsUpdate = vi.fn()
const mockEventsDelete = vi.fn()

vi.mock('googleapis', () => {
  const calendarFactory = () => ({
    events: {
      list:   mockEventsList,
      insert: mockEventsInsert,
      update: mockEventsUpdate,
      delete: mockEventsDelete,
    },
  })

  // IMPORTANT : doit utiliser function (pas arrow) pour pouvoir être appelé avec `new`
  const OAuth2 = vi.fn().mockImplementation(function() {
    this.setCredentials = vi.fn()
  })

  return {
    google: {
      calendar: calendarFactory,
      auth:     { OAuth2 },
    },
    calendar_v3: {},
  }
})

// Import du service APRÈS le mock
import {
  appointmentToEvent,
  processIncomingEvent,
  runCalendarSync,
} from '../../src/services/google-calendar'

// ── Mock crypto (encrypt/decrypt) pour éviter la dépendance sur TOKEN_ENC_KEY ─

vi.mock('../../src/lib/crypto', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
}))

const prisma = new PrismaClient()

// ── Données de test ───────────────────────────────────────────────────────────

const TZ = 'Europe/Paris'
const START = new Date('2025-06-15T09:00:00.000Z')
const END   = new Date('2025-06-15T10:00:00.000Z')

const SAMPLE_APPT = {
  id:          'appt-unit-test-1',
  title:       'Réunion équipe',
  description: 'Discussion hebdo',
  location:    'Salle B',
  startAt:     START,
  endAt:       END,
}

// userId de l'admin (créé par seedBase, toujours présent dans test.db)
let adminUserId = ''

describe('google-calendar service — tests unitaires', () => {

  beforeAll(async () => {
    // Pose TOKEN_ENC_KEY (nécessaire pour getOAuthClientForUser via crypto)
    process.env.GOOGLE_CLIENT_ID     = 'unit-test-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'unit-test-client-secret'
    process.env.TOKEN_ENC_KEY        = 'b'.repeat(64)

    const admin = await prisma.user.findUnique({ where: { email: 'admin@crm.local' } })
    if (!admin) throw new Error('Admin user not found in test.db')
    adminUserId = admin.id

    // Nettoyer les résidus de tests précédents
    await prisma.appointmentGoogleEvent.deleteMany({ where: { appointmentId: { startsWith: 'appt-unit-test' } } }).catch(() => {})
    await prisma.appointment.deleteMany({ where: { id: { startsWith: 'appt-unit-test' } } }).catch(() => {})
    await prisma.googleCredential.deleteMany({ where: { userId: adminUserId } }).catch(() => {})
  })

  afterAll(async () => {
    await prisma.appointmentGoogleEvent.deleteMany({ where: { appointmentId: { startsWith: 'appt-unit-test' } } }).catch(() => {})
    await prisma.appointment.deleteMany({ where: { id: { startsWith: 'appt-unit-test' } } }).catch(() => {})
    await prisma.googleCredential.deleteMany({ where: { userId: adminUserId } }).catch(() => {})
    await prisma.$disconnect()
  })

  // ─── a) runCalendarSync sans credentials ─────────────────────────────────────

  describe('a) runCalendarSync sans credentials → stats vides', () => {
    it('retourne {pulled:0, pushed:0, errors:0} quand aucune credential calendarSyncEnabled', async () => {
      // S'assurer qu'il n'y a pas de credential sync activée pour l'admin
      await prisma.googleCredential.deleteMany({ where: { userId: adminUserId } })

      const stats = await runCalendarSync()

      expect(stats).toEqual({ pulled: 0, pushed: 0, errors: 0 })
    })
  })

  // ─── b) appointmentToEvent — mapping CRM → Event ─────────────────────────────

  describe('b) appointmentToEvent — mapping RDV vers Google Event', () => {
    it('summary = title du RDV', () => {
      const event = appointmentToEvent(SAMPLE_APPT)
      expect(event.summary).toBe('Réunion équipe')
    })

    it('description et location sont mappés', () => {
      const event = appointmentToEvent(SAMPLE_APPT)
      expect(event.description).toBe('Discussion hebdo')
      expect(event.location).toBe('Salle B')
    })

    it('start.dateTime est un ISO string valide', () => {
      const event = appointmentToEvent(SAMPLE_APPT)
      expect(event.start?.dateTime).toBe(START.toISOString())
      expect(event.end?.dateTime).toBe(END.toISOString())
    })

    it('timezone = Europe/Paris', () => {
      const event = appointmentToEvent(SAMPLE_APPT)
      expect(event.start?.timeZone).toBe(TZ)
      expect(event.end?.timeZone).toBe(TZ)
    })

    it('extendedProperties.private.dcrmAppointmentId = id du RDV', () => {
      const event = appointmentToEvent(SAMPLE_APPT)
      expect(event.extendedProperties?.private?.['dcrmAppointmentId']).toBe('appt-unit-test-1')
    })

    it('description null → champ absent (undefined)', () => {
      const event = appointmentToEvent({ ...SAMPLE_APPT, description: null, location: null })
      expect(event.description).toBeUndefined()
      expect(event.location).toBeUndefined()
    })
  })

  // ─── c) processIncomingEvent ──────────────────────────────────────────────────

  describe('c) processIncomingEvent', () => {

    // c1) Événement CRM connu + updated plus récent → RDV mis à jour

    it('c1) événement connu avec updated plus récent → RDV CRM mis à jour', async () => {
      // Créer un RDV en base
      const appt = await prisma.appointment.create({
        data: {
          id:          'appt-unit-test-2',
          title:       'Old Title',
          type:        'CLIENT_MEETING',
          startAt:     START,
          endAt:       END,
          createdById: adminUserId,
        },
      })

      // Créer le lien GoogleEvent
      const googleEventId = 'g-event-known-1'
      const storedEtag = 'etag-old'
      await prisma.appointmentGoogleEvent.create({
        data: {
          appointmentId: appt.id,
          userId:        adminUserId,
          googleEventId,
          etag:          storedEtag,
        },
      })

      // L'événement entrant a un etag différent et une date updated plus récente
      const laterDate = new Date(appt.updatedAt.getTime() + 10000).toISOString()
      const incomingEvent = {
        id:      googleEventId,
        etag:    'etag-new',
        status:  'confirmed',
        summary: 'New Title from Google',
        updated: laterDate,
        start:   { dateTime: new Date('2025-07-01T09:00:00Z').toISOString() },
        end:     { dateTime: new Date('2025-07-01T10:00:00Z').toISOString() },
        extendedProperties: { private: {} },
      }

      await processIncomingEvent(incomingEvent as any, adminUserId)

      // Le RDV doit être mis à jour
      const updated = await prisma.appointment.findUnique({ where: { id: appt.id } })
      expect(updated?.title).toBe('New Title from Google')
    })

    // c2) status cancelled → RDV supprimé

    it('c2) status cancelled → RDV CRM supprimé', async () => {
      const appt = await prisma.appointment.create({
        data: {
          id:          'appt-unit-test-3',
          title:       'To Delete',
          type:        'OTHER',
          startAt:     START,
          endAt:       END,
          createdById: adminUserId,
        },
      })

      const googleEventId = 'g-event-to-cancel'
      await prisma.appointmentGoogleEvent.create({
        data: {
          appointmentId: appt.id,
          userId:        adminUserId,
          googleEventId,
          etag:          'etag-cancel',
        },
      })

      const cancelledEvent = {
        id:     googleEventId,
        status: 'cancelled',
        extendedProperties: { private: {} },
      }

      await processIncomingEvent(cancelledEvent as any, adminUserId)

      const deleted = await prisma.appointment.findUnique({ where: { id: appt.id } })
      expect(deleted).toBeNull()
    })

    // c3) Événement inconnu → RDV créé avec sourceGoogle=true

    it('c3) événement inconnu → RDV CRM créé avec sourceGoogle=true et user participant', async () => {
      const newGoogleEventId = 'g-event-brand-new'
      const newEvent = {
        id:      newGoogleEventId,
        etag:    'etag-new-import',
        status:  'confirmed',
        summary: 'Réunion importée depuis Google',
        updated: new Date().toISOString(),
        start:   { dateTime: new Date('2025-08-01T14:00:00Z').toISOString() },
        end:     { dateTime: new Date('2025-08-01T15:00:00Z').toISOString() },
        extendedProperties: { private: {} },
      }

      await processIncomingEvent(newEvent as any, adminUserId)

      // Un RDV doit avoir été créé avec sourceGoogle=true
      const link = await prisma.appointmentGoogleEvent.findFirst({
        where: { googleEventId: newGoogleEventId, userId: adminUserId },
        include: { appointment: { include: { users: true } } },
      })
      expect(link).not.toBeNull()
      expect(link?.appointment.sourceGoogle).toBe(true)
      expect(link?.appointment.title).toBe('Réunion importée depuis Google')
      // L'admin doit être participant
      expect(link?.appointment.users.some((u: { userId: string }) => u.userId === adminUserId)).toBe(true)

      // Nettoyage
      await prisma.appointmentGoogleEvent.delete({
        where: { appointmentId_userId: { appointmentId: link!.appointmentId, userId: adminUserId } },
      }).catch(() => {})
      await prisma.appointment.delete({ where: { id: link!.appointmentId } }).catch(() => {})
    })

    // c4) etag identique → ignoré (anti-boucle)

    it('c4) etag identique au stocké → RDV non modifié (anti-boucle)', async () => {
      const appt = await prisma.appointment.create({
        data: {
          id:          'appt-unit-test-4',
          title:       'Stable Title',
          type:        'OTHER',
          startAt:     START,
          endAt:       END,
          createdById: adminUserId,
        },
      })

      const googleEventId = 'g-event-same-etag'
      const sameEtag = 'etag-same'
      await prisma.appointmentGoogleEvent.create({
        data: {
          appointmentId: appt.id,
          userId:        adminUserId,
          googleEventId,
          etag:          sameEtag,
        },
      })

      const sameEtagEvent = {
        id:      googleEventId,
        etag:    sameEtag, // même etag → l'anti-boucle doit ignorer
        status:  'confirmed',
        summary: 'Modified Title That Should Be Ignored',
        updated: new Date().toISOString(),
        start:   { dateTime: new Date('2025-09-01T09:00:00Z').toISOString() },
        end:     { dateTime: new Date('2025-09-01T10:00:00Z').toISOString() },
        extendedProperties: { private: {} },
      }

      await processIncomingEvent(sameEtagEvent as any, adminUserId)

      // Le titre ne doit PAS avoir changé
      const unchanged = await prisma.appointment.findUnique({ where: { id: appt.id } })
      expect(unchanged?.title).toBe('Stable Title')
    })
  })

  // ─── d) Erreur invalid_grant → calendarSyncEnabled=false + notification ───────

  describe('d) Erreur invalid_grant → désactivation sync + notification', () => {
    it('error invalid_grant pendant pull → calendarSyncEnabled=false + notification créée', async () => {
      // Créer une credential avec calendarSyncEnabled=true
      await prisma.googleCredential.upsert({
        where:  { userId: adminUserId },
        create: {
          userId:              adminUserId,
          googleEmail:         'admin@test.local',
          refreshTokenEnc:     'enc:fake-refresh-token',
          calendarSyncEnabled: true,
          syncToken:           'fake-sync-token',
        },
        update: {
          calendarSyncEnabled: true,
          syncToken:           'fake-sync-token',
        },
      })

      // Supprimer les notifications existantes pour cet utilisateur pour avoir un décompte propre
      const notifCountBefore = await prisma.notification.count({ where: { userId: adminUserId } })

      // Faire en sorte que la synchro incrémentale lève une erreur invalid_grant
      mockEventsList.mockRejectedValueOnce(new Error('invalid_grant'))

      const stats = await runCalendarSync()

      // Une erreur comptée
      expect(stats.errors).toBeGreaterThanOrEqual(1)

      // calendarSyncEnabled doit être passé à false
      const cred = await prisma.googleCredential.findUnique({ where: { userId: adminUserId } })
      expect(cred?.calendarSyncEnabled).toBe(false)

      // Une notification doit avoir été créée
      const notifCountAfter = await prisma.notification.count({ where: { userId: adminUserId } })
      expect(notifCountAfter).toBeGreaterThan(notifCountBefore)

      // Nettoyage
      await prisma.googleCredential.delete({ where: { userId: adminUserId } }).catch(() => {})
    })
  })
})
