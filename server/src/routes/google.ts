/**
 * Routes Google Calendar — montées sur /api/google
 *
 * POST /api/google/notifications          → PUBLIC — réception des push notifications Google Calendar
 * GET  /api/google/status                 → statut de connexion Calendar de l'utilisateur
 * GET  /api/google/calendar/connect       → URL de consentement (scopes Calendar)
 * GET  /api/google/calendar/callback      → PUBLIC — échange le code, stocke le refresh token
 * POST /api/google/calendar/disconnect    → révoque + supprime la credential
 * POST /api/google/calendar/sync          → synchro manuelle (pull forcé)
 * POST /api/google/calendar/sync/all      → synchro globale (admin)
 */

import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { google } from 'googleapis'
import prisma from '../prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { encrypt } from '../lib/crypto'
import { audit } from '../lib/audit'
import logger from '../lib/logger'
import {
  pullUserCalendar,
  runCalendarSync,
  registerWatchForUser,
  stopWatchForUser,
  inFlight,
} from '../services/google-calendar'

const router = Router()

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
// URL de retour du flux calendrier. Déduite de GOOGLE_REDIRECT_URI (même origine)
// si GOOGLE_CALENDAR_REDIRECT_URI n'est pas explicitement défini.
const CALENDAR_REDIRECT_URI = process.env.GOOGLE_CALENDAR_REDIRECT_URI
  ?? (process.env.GOOGLE_REDIRECT_URI
      ? new URL(process.env.GOOGLE_REDIRECT_URI).origin + '/api/google/calendar/callback'
      : 'http://localhost:3001/api/google/calendar/callback')
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173'

const CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
]

/** Helper : renvoie 503 si Google OAuth n'est pas configuré */
function requireGoogleConfig(res: Response): boolean {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(503).json({
      success: false,
      error: { code: 'GOOGLE_DISABLED', message: 'Connexion Google non configurée' },
    })
    return false
  }
  return true
}

function getOAuth2Client() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID!, GOOGLE_CLIENT_SECRET!, CALENDAR_REDIRECT_URI)
}

// ─── State JWT anti-CSRF ──────────────────────────────────────────────────────
// Le state est un JWT signé contenant l'userId (valable 5 min).
// Stocké en cookie httpOnly pour vérification au retour.

const STATE_COOKIE = 'gcal_state'
const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge:   5 * 60 * 1000, // 5 minutes
  path:     '/',
}

// ─── POST /api/google/notifications — PUBLIC — push notifications Google ──────
// Monté EN PREMIER, avant authenticate, car il n'y a pas de session utilisateur.
// Google POST cette URL sans corps d'événement — seuls les headers portent l'info.
// Réponse 200 immédiate requise ; la synchro est déclenchée en arrière-plan.

router.post('/notifications', async (req: Request, res: Response): Promise<void> => {
  const channelId   = req.headers['x-goog-channel-id']   as string | undefined
  const resourceId  = req.headers['x-goog-resource-id']  as string | undefined
  const resourceState = req.headers['x-goog-resource-state'] as string | undefined
  const channelToken  = req.headers['x-goog-channel-token'] as string | undefined

  // Notification initiale 'sync' à l'ouverture du canal — répondre 200 de suite
  if (resourceState === 'sync') {
    logger.debug({ channelId }, '[GCAL] Notification push : state=sync (canal ouvert)')
    res.status(200).end()
    return
  }

  // Notification de changement 'exists' (ou 'not_exists' — traiter pareil)
  // 1. Trouver la credential par channelId
  if (!channelId) {
    logger.warn({ resourceId, resourceState }, '[GCAL] Notification push sans X-Goog-Channel-ID')
    res.status(200).end()
    return
  }

  const cred = await prisma.googleCredential.findUnique({
    where: { channelId },
  }).catch(() => null)

  if (!cred) {
    logger.warn({ channelId }, '[GCAL] Notification push : channelId inconnu')
    res.status(200).end() // 200 pour ne pas faire retenter Google
    return
  }

  // 2. Vérifier le token de sécurité par canal
  if (!channelToken || channelToken !== cred.channelToken) {
    logger.warn({ channelId, userId: cred.userId }, '[GCAL] Notification push : token invalide — possible usurpation')
    res.status(403).json({ success: false, error: { code: 'INVALID_CHANNEL_TOKEN', message: 'Token de canal invalide' } })
    return
  }

  // 3. Répondre 200 IMMÉDIATEMENT — Google n'attend pas la synchro
  res.status(200).end()

  // 4. Déclencher la synchro en arrière-plan (garde-fou anti-rafale)
  setImmediate(async () => {
    if (inFlight.has(cred.id)) {
      logger.debug({ userId: cred.userId, credId: cred.id }, '[GCAL] Notification push : synchro déjà en cours, ignorée')
      return
    }
    inFlight.add(cred.id)
    try {
      // Cast : les champs channelId etc. sont présents car on vient de les lire
      const fullCred = await prisma.googleCredential.findUnique({ where: { userId: cred.userId } })
      if (fullCred && fullCred.calendarSyncEnabled) {
        const count = await pullUserCalendar(fullCred as Parameters<typeof pullUserCalendar>[0])
        logger.debug({ userId: cred.userId, count }, '[GCAL] Notification push : synchro déclenchée')
      }
    } catch (err) {
      logger.error({ err, userId: cred.userId }, '[GCAL] Notification push : erreur lors de la synchro')
    } finally {
      inFlight.delete(cred.id)
    }
  })
})

// ─── Routes authentifiées ─────────────────────────────────────────────────────

// GET /api/google/status
router.get('/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cred = await prisma.googleCredential.findUnique({ where: { userId: req.userId! } })
    res.json({
      success: true,
      data: {
        connected:           !!cred,
        googleEmail:         cred?.googleEmail ?? null,
        calendarSyncEnabled: cred?.calendarSyncEnabled ?? false,
        lastSyncAt:          cred?.lastSyncAt ?? null,
        // Statut du canal watch
        watchChannel: cred?.channelId ? {
          channelId:       cred.channelId,
          expiresAt:       cred.channelExpiresAt ?? null,
          active:          cred.channelExpiresAt ? cred.channelExpiresAt > new Date() : false,
        } : null,
      },
    })
  } catch (err) { handleRouteError(err, res) }
})

// GET /api/google/calendar/connect
router.get('/calendar/connect', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireGoogleConfig(res)) return
  try {
    // Génère un state JWT signé contenant l'userId (5 min)
    const state = jwt.sign({ userId: req.userId }, process.env.JWT_SECRET!, { expiresIn: '5m' })
    res.cookie(STATE_COOKIE, state, STATE_COOKIE_OPTIONS)

    const oauth2Client = getOAuth2Client()
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt:      'consent',
      scope:       CALENDAR_SCOPES,
      state,
    })

    res.json({ success: true, data: { url } })
  } catch (err) { handleRouteError(err, res) }
})

// GET /api/google/calendar/callback  — PUBLIC (pas d'authenticate)
router.get('/calendar/callback', async (req: Request, res: Response): Promise<void> => {
  if (!requireGoogleConfig(res)) return

  const { code, state, error: oauthError } = req.query as Record<string, string>

  if (oauthError) {
    logger.warn({ oauthError }, '[GCAL] Erreur renvoyée par Google lors du consentement Calendar')
    res.redirect(`${FRONTEND_URL}/appointments?google=error`)
    return
  }

  // Vérification CSRF : state dans la query == state dans le cookie
  const storedState = req.cookies?.[STATE_COOKIE]
  if (!state || !storedState || state !== storedState) {
    res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: 'State CSRF invalide' } })
    return
  }
  res.clearCookie(STATE_COOKIE, { path: '/' })

  // Décode le JWT state pour obtenir l'userId
  let userId: string
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string }
    userId = payload.userId
  } catch {
    res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: 'State expiré ou invalide' } })
    return
  }

  try {
    const oauth2Client = getOAuth2Client()
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    if (!tokens.refresh_token) {
      // Pas de refresh token (consentement déjà accordé sans prompt=consent) → erreur
      logger.warn({ userId }, '[GCAL] Pas de refresh token reçu — consentement déjà accordé ?')
      res.redirect(`${FRONTEND_URL}/appointments?google=no_refresh_token`)
      return
    }

    // Récupère l'email Google depuis le id_token ou le userinfo
    let googleEmail: string | null = null
    if (tokens.id_token) {
      try {
        const ticket = await oauth2Client.verifyIdToken({
          idToken: tokens.id_token,
          audience: GOOGLE_CLIENT_ID!,
        })
        googleEmail = ticket.getPayload()?.email ?? null
      } catch { /* ignore */ }
    }
    if (!googleEmail) {
      // Fallback : cherche l'email dans la credential existante
      const existingCred = await prisma.googleCredential.findUnique({ where: { userId } })
      googleEmail = existingCred?.googleEmail ?? `user_${userId}@google`
    }

    const encryptedToken = encrypt(tokens.refresh_token)

    const savedCred = await prisma.googleCredential.upsert({
      where:  { userId },
      create: {
        userId,
        googleEmail,
        refreshTokenEnc:     encryptedToken,
        calendarSyncEnabled: true,
      },
      update: {
        googleEmail,
        refreshTokenEnc:     encryptedToken,
        calendarSyncEnabled: true,
      },
    })

    // Première synchro + ouverture du canal watch en arrière-plan
    setImmediate(async () => {
      try {
        const cred = await prisma.googleCredential.findUnique({ where: { userId } })
        if (cred) {
          // syncToken null → force la re-sync complète
          const credNoSync = { ...cred, syncToken: null }
          await pullUserCalendar(credNoSync as Parameters<typeof pullUserCalendar>[0])
          logger.info({ userId }, '[GCAL] Première synchro Calendar effectuée après connexion')
        }
      } catch (err) {
        logger.error({ err, userId }, '[GCAL] Échec de la première synchro Calendar')
      }
      // Ouverture du canal watch (best-effort — ne casse pas la redirection)
      try {
        const cred = await prisma.googleCredential.findUnique({ where: { userId } })
        if (cred) {
          await registerWatchForUser(cred as Parameters<typeof registerWatchForUser>[0])
        }
      } catch (err) {
        logger.warn({ err, userId }, "[GCAL] Impossible d'ouvrir le canal watch apres connexion (best-effort)")
      }
    })

    const fakeReq = { userId } as AuthRequest
    audit(fakeReq, 'GOOGLE_CALENDAR_CONNECTED', 'GoogleCredential', savedCred.id, { googleEmail })

    res.redirect(`${FRONTEND_URL}/appointments?google=connected`)
  } catch (err) {
    logger.error({ err, userId }, '[GCAL] Erreur dans le callback Calendar')
    res.redirect(`${FRONTEND_URL}/appointments?google=error`)
  }
})

// POST /api/google/calendar/disconnect
router.post('/calendar/disconnect', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cred = await prisma.googleCredential.findUnique({ where: { userId: req.userId! } })
    if (!cred) {
      res.json({ success: true, data: { message: 'Aucune connexion Google Calendar active' } })
      return
    }

    // Fermeture du canal watch (best-effort)
    try {
      await stopWatchForUser(cred as Parameters<typeof stopWatchForUser>[0])
    } catch (err) {
      logger.warn({ err, userId: req.userId }, '[GCAL] stopWatchForUser échoué lors du disconnect (best-effort)')
    }

    // Révocation du token chez Google (best effort)
    if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
      try {
        const { decrypt: dec } = await import('../lib/crypto')
        const refreshToken = dec(cred.refreshTokenEnc)
        const oauth2Client = getOAuth2Client()
        await oauth2Client.revokeToken(refreshToken)
      } catch (err) {
        logger.warn({ err, userId: req.userId }, '[GCAL] Révocation token Google échouée (best effort)')
      }
    }

    // Suppression des AppointmentGoogleEvent du user
    await prisma.appointmentGoogleEvent.deleteMany({ where: { userId: req.userId! } })

    // Suppression de la credential
    await prisma.googleCredential.delete({ where: { userId: req.userId! } })

    audit(req, 'GOOGLE_CALENDAR_DISCONNECTED', 'GoogleCredential', req.userId)

    res.json({ success: true, data: { message: 'Google Calendar déconnecté avec succès' } })
  } catch (err) { handleRouteError(err, res) }
})

// POST /api/google/calendar/sync  — synchro manuelle (force=true)
router.post('/calendar/sync', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cred = await prisma.googleCredential.findUnique({ where: { userId: req.userId! } })
    if (!cred || !cred.calendarSyncEnabled) {
      res.status(400).json({
        success: false,
        error: { code: 'NOT_CONNECTED', message: 'Google Calendar non connecté ou désactivé' },
      })
      return
    }

    // force=true : ignore le canal actif — synchro manuelle toujours possible
    const pulled = await pullUserCalendar(cred as Parameters<typeof pullUserCalendar>[0])
    res.json({ success: true, data: { pulled, pushed: 0, errors: 0 } })
  } catch (err) { handleRouteError(err, res) }
})

// POST /api/google/calendar/sync/all  — synchro globale (admin)
router.post('/calendar/sync/all', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userRole !== 'ADMIN') {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Réservé aux administrateurs' } })
    return
  }
  try {
    // force=true pour synchroniser tous les users même ceux avec canal actif
    const stats = await runCalendarSync(true)
    res.json({ success: true, data: stats })
  } catch (err) { handleRouteError(err, res) }
})

export default router
