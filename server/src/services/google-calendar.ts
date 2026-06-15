/**
 * Service de synchronisation bidirectionnelle Google Calendar ↔ CRM
 *
 * Architecture :
 * - CRM → Google : pushAppointmentForUser / pushAppointmentToAll
 * - Google → CRM : pullUserCalendar (polling incrémental avec syncToken)
 * - Anti-boucle : extendedProperties.private.dcrmAppointmentId + etag
 * - Conflits : last-write-wins (event.updated vs appointment.updatedAt)
 * - Tolérance pannes : erreur d'un user → log + calendarSyncEnabled=false + notif, sans bloquer les autres
 *
 * Push notifications (Google Calendar watch) :
 * - registerWatchForUser : ouvre un canal watch Google (7 j) si GOOGLE_WEBHOOK_URL configurée
 * - stopWatchForUser     : ferme le canal + efface les champs
 * - renewExpiringChannels: renouvelle les canaux expirant dans < 24 h (à appeler chaque heure)
 * - Garde-fou anti-rafale : Set<credentialId> inFlight — une seule synchro simultanée par user
 */

import crypto from 'crypto'
import { google, calendar_v3 } from 'googleapis'
import prisma from '../prisma/client'
import logger from '../lib/logger'
import { decrypt } from '../lib/crypto'

// Utilise le OAuth2Client bundlé par googleapis pour éviter le conflit de types
// entre google-auth-library et googleapis-common
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const CALENDAR_REDIRECT_URI = process.env.GOOGLE_CALENDAR_REDIRECT_URI
  ?? (process.env.GOOGLE_REDIRECT_URI
      ? new URL(process.env.GOOGLE_REDIRECT_URI).origin + '/api/google/calendar/callback'
      : 'http://localhost:3001/api/google/calendar/callback')

const TZ = 'Europe/Paris'
const DCRM_PROP_KEY = 'dcrmAppointmentId'
// Ignorer les événements plus vieux que 365 jours
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000
// Pour la re-sync complète après 410 GONE : 30 jours en arrière
const RESYNC_DAYS = 30

// ─── Types internes ──────────────────────────────────────────────────────────

interface SyncStats {
  pulled: number
  pushed: number
  errors: number
}

// Type complet de GoogleCredential avec les champs de canal
type GoogleCredentialWithUser = {
  id: string
  userId: string
  googleEmail: string
  refreshTokenEnc: string
  calendarSyncEnabled: boolean
  syncToken: string | null
  lastSyncAt: Date | null
  channelId: string | null
  channelResourceId: string | null
  channelToken: string | null
  channelExpiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// ─── Garde-fou anti-rafale ────────────────────────────────────────────────────

/** Set des credentialId en cours de synchro — évite les rafales parallèles */
export const inFlight: Set<string> = new Set()

// ─── Configuration webhook ────────────────────────────────────────────────────

/**
 * Retourne l'URL webhook publique configurée, ou null si absente/vide.
 * Quand null → mode polling pur (comportement inchangé).
 */
export function getWebhookUrl(): string | null {
  const url = process.env.GOOGLE_WEBHOOK_URL
  return url && url.trim().length > 0 ? url.trim() : null
}

// ─── OAuth client ─────────────────────────────────────────────────────────────

/**
 * Retourne un OAuth2Client configuré avec le refresh token déchiffré d'un utilisateur.
 * Lance une erreur si Google n'est pas configuré ou si la credential est absente.
 */
export async function getOAuthClientForUser(userId: string): Promise<OAuth2Client> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth non configuré (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants)')
  }
  const cred = await prisma.googleCredential.findUnique({ where: { userId } })
  if (!cred) throw new Error(`Aucune credential Google pour l'utilisateur ${userId}`)

  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALENDAR_REDIRECT_URI)
  const refreshToken = decrypt(cred.refreshTokenEnc)
  client.setCredentials({ refresh_token: refreshToken })
  return client
}

// ─── Mapping RDV ↔ event ─────────────────────────────────────────────────────

interface AppointmentData {
  id: string
  title: string
  description: string | null
  location: string | null
  startAt: Date
  endAt: Date
}

/** @internal Exporté pour les tests unitaires */
export function appointmentToEvent(appt: AppointmentData): calendar_v3.Schema$Event {
  return {
    summary: appt.title,
    description: appt.description ?? undefined,
    location: appt.location ?? undefined,
    start: { dateTime: appt.startAt.toISOString(), timeZone: TZ },
    end:   { dateTime: appt.endAt.toISOString(),   timeZone: TZ },
    extendedProperties: {
      private: { [DCRM_PROP_KEY]: appt.id },
    },
  }
}

function parseEventDateTime(dt: calendar_v3.Schema$EventDateTime | undefined): Date | null {
  if (!dt) return null
  if (dt.dateTime) return new Date(dt.dateTime)
  // All-day event : date seule (ex: "2025-01-15")
  if (dt.date) {
    const [y, m, d] = dt.date.split('-').map(Number)
    return new Date(y, m - 1, d, 0, 0, 0, 0)
  }
  return null
}

function parseEventEndDateTime(dt: calendar_v3.Schema$EventDateTime | undefined): Date | null {
  if (!dt) return null
  if (dt.dateTime) return new Date(dt.dateTime)
  // All-day event : endAt = 23:59
  if (dt.date) {
    const [y, m, d] = dt.date.split('-').map(Number)
    return new Date(y, m - 1, d, 23, 59, 0, 0)
  }
  return null
}

// ─── Push CRM → Google ────────────────────────────────────────────────────────

/**
 * Crée ou met à jour (upsert) / supprime l'événement Google Calendar pour un
 * rendez-vous CRM donné, pour un utilisateur donné.
 * Fire-and-forget : les erreurs sont loguées mais non propagées.
 */
export async function pushAppointmentForUser(
  appointmentId: string,
  userId: string,
  action: 'upsert' | 'delete',
): Promise<void> {
  try {
    const cred = await prisma.googleCredential.findUnique({ where: { userId } })
    if (!cred || !cred.calendarSyncEnabled) return

    const auth = await getOAuthClientForUser(userId)
    const cal  = google.calendar({ version: 'v3', auth })

    if (action === 'delete') {
      const existing = await prisma.appointmentGoogleEvent.findUnique({
        where: { appointmentId_userId: { appointmentId, userId } },
      })
      if (!existing) return
      try {
        await cal.events.delete({ calendarId: 'primary', eventId: existing.googleEventId })
      } catch (err: unknown) {
        // 404 = déjà supprimé côté Google — ok
        const status = (err as { code?: number })?.code
        if (status !== 404 && status !== 410) throw err
      }
      await prisma.appointmentGoogleEvent.delete({
        where: { appointmentId_userId: { appointmentId, userId } },
      })
      return
    }

    // action === 'upsert'
    const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } })
    if (!appt) return

    const eventBody = appointmentToEvent(appt)
    const existing  = await prisma.appointmentGoogleEvent.findUnique({
      where: { appointmentId_userId: { appointmentId, userId } },
    })

    let googleEventId: string
    let etag: string | undefined

    if (existing) {
      // Update
      const res = await cal.events.update({
        calendarId: 'primary',
        eventId:    existing.googleEventId,
        requestBody: eventBody,
      })
      googleEventId = res.data.id!
      etag          = res.data.etag ?? undefined
    } else {
      // Create
      const res = await cal.events.insert({
        calendarId: 'primary',
        requestBody: eventBody,
      })
      googleEventId = res.data.id!
      etag          = res.data.etag ?? undefined
    }

    await prisma.appointmentGoogleEvent.upsert({
      where:  { appointmentId_userId: { appointmentId, userId } },
      create: { appointmentId, userId, googleEventId, etag },
      update: { googleEventId, etag },
    })
  } catch (err) {
    await handleUserError(userId, err, `pushAppointmentForUser(${appointmentId})`)
  }
}

/**
 * Pousse un RDV vers tous les participants connectés (calendarSyncEnabled).
 * Fire-and-forget par design — ne lève jamais d'exception.
 */
export function pushAppointmentToAll(appointmentId: string, action: 'upsert' | 'delete'): void {
  setImmediate(async () => {
    try {
      const apptUsers = await prisma.appointmentUser.findMany({
        where: { appointmentId },
        select: { userId: true },
      })
      for (const { userId } of apptUsers) {
        await pushAppointmentForUser(appointmentId, userId, action)
      }
    } catch (err) {
      logger.error({ err }, `[GCAL] pushAppointmentToAll(${appointmentId}) erreur inattendue`)
    }
  })
}

/**
 * Supprime les copies Google uniquement pour les participants retirés d'un RDV.
 */
export function pushRemovedParticipants(appointmentId: string, removedUserIds: string[]): void {
  if (removedUserIds.length === 0) return
  setImmediate(async () => {
    for (const userId of removedUserIds) {
      await pushAppointmentForUser(appointmentId, userId, 'delete')
    }
  })
}

// ─── Pull Google → CRM ────────────────────────────────────────────────────────

/**
 * Synchronisation incrémentale pour un utilisateur.
 * Retourne le nombre d'événements traités.
 */
export async function pullUserCalendar(credential: GoogleCredentialWithUser): Promise<number> {
  const { userId } = credential
  let processed = 0

  const auth = await getOAuthClientForUser(userId)
  const cal  = google.calendar({ version: 'v3', auth })

  let events: calendar_v3.Schema$Event[] = []
  let newSyncToken: string | undefined

  // Tente la synchro incrémentale avec le syncToken existant
  const tryIncremental = async (): Promise<boolean> => {
    if (!credential.syncToken) return false
    try {
      const res = await cal.events.list({
        calendarId: 'primary',
        syncToken:  credential.syncToken,
        singleEvents: true,
      })
      events       = res.data.items ?? []
      newSyncToken = res.data.nextSyncToken ?? undefined
      return true
    } catch (err: unknown) {
      const status = (err as { code?: number })?.code
      if (status === 410) return false // syncToken expiré → re-sync complète
      throw err
    }
  }

  const doFullSync = async () => {
    const timeMin = new Date(Date.now() - RESYNC_DAYS * 24 * 60 * 60 * 1000).toISOString()
    let pageToken: string | undefined
    events = []

    do {
      const res = await cal.events.list({
        calendarId: 'primary',
        timeMin,
        singleEvents: true,
        maxResults: 250,
        pageToken,
      })
      events.push(...(res.data.items ?? []))
      pageToken    = res.data.nextPageToken ?? undefined
      newSyncToken = res.data.nextSyncToken ?? undefined
    } while (pageToken)
  }

  const incremental = await tryIncremental()
  if (!incremental) {
    logger.info({ userId }, '[GCAL] syncToken expiré (410) — re-sync complète')
    await doFullSync()
  }

  // Traitement de chaque événement
  for (const event of events) {
    await processIncomingEvent(event, userId)
    processed++
  }

  // Mise à jour du syncToken et lastSyncAt
  if (newSyncToken) {
    await prisma.googleCredential.update({
      where: { userId },
      data:  { syncToken: newSyncToken, lastSyncAt: new Date() },
    })
  }

  return processed
}

/**
 * Traite un événement Google entrant pour un utilisateur.
 */
/** @internal Exporté pour les tests unitaires */
export async function processIncomingEvent(
  event: calendar_v3.Schema$Event,
  userId: string,
): Promise<void> {
  const eventId     = event.id
  const isCancelled = event.status === 'cancelled'

  if (!eventId) return

  // Cherche si on a un AppointmentGoogleEvent pour cet eventId + userId
  const existingLink = await prisma.appointmentGoogleEvent.findFirst({
    where: { googleEventId: eventId, userId },
  })

  // Ou si l'event porte dcrmAppointmentId
  const dcrmId = event.extendedProperties?.private?.[DCRM_PROP_KEY]

  const isKnownCrmEvent = !!existingLink || !!dcrmId

  if (isKnownCrmEvent) {
    // ── Événement CRM connu ─────────────────────────────────────────────────
    const appointmentId = existingLink?.appointmentId ?? dcrmId!

    if (isCancelled) {
      // Suppression côté Google → supprimer le RDV CRM + toutes ses copies Google
      const appt = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { users: { select: { userId: true } } },
      })
      if (!appt) return

      // Supprimer les copies Google des autres participants (fire-and-forget)
      for (const { userId: uid } of appt.users) {
        if (uid !== userId) {
          pushAppointmentForUser(appointmentId, uid, 'delete').catch(() => {})
        }
      }
      await prisma.appointment.delete({ where: { id: appointmentId } }).catch(() => {})
      return
    }

    // Anti-boucle : si l'etag stocké correspond → c'est le CRM qui a fait la modif, ignorer
    if (existingLink?.etag && existingLink.etag === event.etag) return

    // Conflit last-write-wins : compare event.updated vs appointment.updatedAt
    const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } })
    if (!appt) return
    const eventUpdated = event.updated ? new Date(event.updated) : new Date(0)
    if (eventUpdated <= appt.updatedAt) return // CRM plus récent → ignorer

    // Appliquer les modifications Google → CRM
    const startAt = parseEventDateTime(event.start)
    const endAt   = parseEventEndDateTime(event.end)
    if (!startAt || !endAt) return

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        title:       event.summary ?? appt.title,
        description: event.description ?? null,
        location:    event.location    ?? null,
        startAt,
        endAt,
      },
    })

    // Mettre à jour l'etag stocké
    if (existingLink && event.etag) {
      await prisma.appointmentGoogleEvent.update({
        where: { appointmentId_userId: { appointmentId, userId } },
        data:  { etag: event.etag },
      })
    }
  } else {
    // ── Import d'un nouvel événement Google ──────────────────────────────────
    if (isCancelled) return // événement inconnu annulé → rien à faire

    const startAt = parseEventDateTime(event.start)
    const endAt   = parseEventEndDateTime(event.end)
    if (!startAt || !endAt) return

    // Ignorer les événements trop anciens
    if (Date.now() - startAt.getTime() > MAX_AGE_MS) return

    // Créer un RDV CRM
    const newAppt = await prisma.appointment.create({
      data: {
        title:       event.summary ?? '(Sans titre)',
        description: event.description ?? null,
        location:    event.location    ?? null,
        type:        'OTHER',
        startAt,
        endAt,
        sourceGoogle: true,
        createdById:  userId,
        users: { create: [{ userId }] },
      },
    })

    // Enregistrer le lien
    await prisma.appointmentGoogleEvent.create({
      data: {
        appointmentId: newAppt.id,
        userId,
        googleEventId: eventId,
        etag:          event.etag ?? null,
      },
    })
  }
}

// ─── Watch channels (push notifications) ─────────────────────────────────────

/**
 * Ouvre un canal watch Google Calendar pour un utilisateur.
 * No-op si GOOGLE_WEBHOOK_URL n'est pas configurée.
 * Ferme l'éventuel canal existant avant (best-effort).
 */
export async function registerWatchForUser(credential: GoogleCredentialWithUser): Promise<void> {
  const webhookUrl = getWebhookUrl()
  if (!webhookUrl) {
    logger.debug({ userId: credential.userId }, '[GCAL] registerWatchForUser : GOOGLE_WEBHOOK_URL absent, mode polling pur')
    return
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    logger.debug({ userId: credential.userId }, '[GCAL] registerWatchForUser : Google non configuré')
    return
  }

  // Fermeture best-effort de l'éventuel canal existant
  if (credential.channelId && credential.channelResourceId) {
    await stopWatchForUser(credential).catch((err) => {
      logger.warn({ err, userId: credential.userId }, '[GCAL] registerWatchForUser : fermeture ancien canal échouée (best-effort)')
    })
    // Recharger la credential après arrêt (channelId mis à null)
    const fresh = await prisma.googleCredential.findUnique({ where: { userId: credential.userId } })
    if (fresh) credential = fresh as GoogleCredentialWithUser
  }

  const auth = await getOAuthClientForUser(credential.userId)
  const cal  = google.calendar({ version: 'v3', auth })

  const channelId    = crypto.randomUUID()
  const channelToken = crypto.randomBytes(32).toString('hex')
  const ttlSeconds   = 604800 // 7 jours

  try {
    const res = await cal.events.watch({
      calendarId: 'primary',
      requestBody: {
        id:      channelId,
        type:    'web_hook',
        address: webhookUrl,
        token:   channelToken,
        params:  { ttl: String(ttlSeconds) },
      },
    })

    const resourceId  = res.data.resourceId ?? null
    const expiration  = res.data.expiration  ? new Date(Number(res.data.expiration)) : new Date(Date.now() + ttlSeconds * 1000)

    await prisma.googleCredential.update({
      where: { userId: credential.userId },
      data: {
        channelId,
        channelResourceId: resourceId,
        channelToken,
        channelExpiresAt: expiration,
      },
    })

    logger.info({ userId: credential.userId, channelId, expiresAt: expiration.toISOString() }, '[GCAL] Canal watch ouvert')
  } catch (err) {
    logger.error({ err, userId: credential.userId }, "[GCAL] Impossible d'ouvrir un canal watch Google")
    throw err
  }
}

/**
 * Ferme le canal watch Google Calendar d'un utilisateur (best-effort).
 * Remet les 4 champs de canal à null.
 */
export async function stopWatchForUser(credential: GoogleCredentialWithUser): Promise<void> {
  if (!credential.channelId || !credential.channelResourceId) return

  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    try {
      const auth = await getOAuthClientForUser(credential.userId)
      const cal  = google.calendar({ version: 'v3', auth })
      await cal.channels.stop({
        requestBody: {
          id:         credential.channelId,
          resourceId: credential.channelResourceId,
        },
      })
      logger.info({ userId: credential.userId, channelId: credential.channelId }, '[GCAL] Canal watch fermé')
    } catch (err) {
      logger.warn({ err, userId: credential.userId, channelId: credential.channelId }, '[GCAL] Fermeture canal watch échouée (best-effort)')
    }
  }

  // Effacer les champs de canal même si l'appel channels.stop a échoué
  await prisma.googleCredential.update({
    where: { userId: credential.userId },
    data: {
      channelId:         null,
      channelResourceId: null,
      channelToken:      null,
      channelExpiresAt:  null,
    },
  })
}

/**
 * Renouvelle les canaux watch qui expirent dans moins de 24 h.
 * Rattrape aussi les credentials calendarSyncEnabled sans canal actif (si webhook configurée).
 * Retourne le nombre de canaux renouvelés/ouverts.
 */
export async function renewExpiringChannels(): Promise<number> {
  const webhookUrl = getWebhookUrl()
  if (!webhookUrl) return 0

  const now       = new Date()
  const threshold = new Date(now.getTime() + 24 * 60 * 60 * 1000) // now + 24 h

  // Credentials calendarSyncEnabled avec canal expirant sous 24 h OU sans canal
  const credentials = await prisma.googleCredential.findMany({
    where: {
      calendarSyncEnabled: true,
      OR: [
        // Canal expirant bientôt
        { channelExpiresAt: { lt: threshold } },
        // Pas de canal du tout
        { channelId: null },
      ],
    },
  })

  let renewed = 0
  for (const cred of credentials) {
    try {
      await registerWatchForUser(cred as GoogleCredentialWithUser)
      renewed++
    } catch (err) {
      logger.error({ err, userId: cred.userId }, '[GCAL] renewExpiringChannels : échec pour un utilisateur')
    }
  }

  return renewed
}

// ─── Job de synchronisation principal ────────────────────────────────────────

/**
 * Boucle sur toutes les credentials calendarSyncEnabled, synchro séquentielle.
 * Si force=false (défaut) : saute les credentials ayant un canal actif (géré par push).
 * Si force=true : synchronise tous les users (synchro manuelle).
 * Retourne les stats { pulled, pushed, errors }.
 */
export async function runCalendarSync(force = false): Promise<SyncStats> {
  const stats: SyncStats = { pulled: 0, pushed: 0, errors: 0 }

  const now = new Date()

  const credentials = await prisma.googleCredential.findMany({
    where: { calendarSyncEnabled: true },
  })

  for (const cred of credentials) {
    // Si force=false et que le canal est actif (channelExpiresAt > now) → skip
    if (!force && cred.channelExpiresAt && cred.channelExpiresAt > now) {
      logger.debug({ userId: cred.userId }, '[GCAL] runCalendarSync : canal actif, skip (push couvre)')
      continue
    }

    // Garde-fou anti-rafale
    if (inFlight.has(cred.id)) {
      logger.debug({ userId: cred.userId, credId: cred.id }, '[GCAL] runCalendarSync : synchro déjà en cours, skip')
      continue
    }

    inFlight.add(cred.id)
    try {
      const pulled = await pullUserCalendar(cred as GoogleCredentialWithUser)
      stats.pulled += pulled
    } catch (err) {
      stats.errors++
      await handleUserError(cred.userId, err, 'runCalendarSync')
    } finally {
      inFlight.delete(cred.id)
    }
  }

  return stats
}

// ─── Gestion des erreurs utilisateur ─────────────────────────────────────────

/**
 * Sur erreur Google d'un utilisateur :
 * - Log
 * - Si 401/token révoqué → désactive calendarSyncEnabled + notif in-app
 */
async function handleUserError(userId: string, err: unknown, context: string): Promise<void> {
  const code = (err as { code?: number; response?: { status?: number } })?.code
    ?? (err as { response?: { status?: number } })?.response?.status

  logger.error({ err, userId, context }, `[GCAL] Erreur pour l'utilisateur ${userId}`)

  // Désactiver si token révoqué (401) ou invalid_grant
  const message = (err as { message?: string })?.message ?? ''
  const isAuthError = code === 401 || message.includes('invalid_grant') || message.includes('Token has been expired')

  if (isAuthError) {
    try {
      await prisma.googleCredential.update({
        where: { userId },
        data:  { calendarSyncEnabled: false },
      })
      // Notification in-app
      await prisma.notification.create({
        data: {
          userId,
          type:    'SYSTEM',
          title:   'Synchronisation Google déconnectée',
          message: 'Votre synchronisation Google Calendar a été interrompue. Reconnectez votre agenda depuis la page Agenda.',
          link:    '/appointments',
        },
      })
      logger.warn({ userId }, '[GCAL] Credential désactivée — token révoqué ou invalide')
    } catch (innerErr) {
      logger.error({ innerErr, userId }, '[GCAL] Impossible de désactiver la credential')
    }
  }
}
