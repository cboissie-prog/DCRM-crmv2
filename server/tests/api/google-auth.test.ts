/**
 * google-auth.test.ts
 * Tests des routes Google OAuth : GET /api/auth/google et GET /api/auth/google/callback
 *
 * Les dépendances Google (google-auth-library) sont entièrement mockées.
 * La base test.db est utilisée (setup via global-setup.ts).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

// ── vi.hoisted : déclare les fonctions mock AVANT le hissage de vi.mock ───────
const {
  mockGetToken,
  mockVerifyIdToken,
  mockGenerateAuthUrl,
  mockSetCredentials,
} = vi.hoisted(() => ({
  mockGetToken:       vi.fn(),
  mockVerifyIdToken:  vi.fn(),
  mockGenerateAuthUrl: vi.fn(),
  mockSetCredentials: vi.fn(),
}))

// ── Mock google-auth-library ──────────────────────────────────────────────────
// IMPORTANT : mockImplementation doit utiliser une function (pas une arrow function)
// pour pouvoir être appelée avec `new`.
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(function() {
    this.generateAuthUrl = mockGenerateAuthUrl
    this.getToken        = mockGetToken
    this.setCredentials  = mockSetCredentials
    this.verifyIdToken   = mockVerifyIdToken
  }),
}))

// Import APRÈS le mock
import { createApp } from '../../src/app'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

// Emails de test
const EXISTING_EMAIL   = 'google-existing@dcb-technologies.fr'
const UNKNOWN_ALLOWED  = 'google-newuser@dcb-technologies.fr'
const UNKNOWN_DENIED   = 'hacker@evil.corp'
const DISABLED_EMAIL   = 'google-disabled@dcb-technologies.fr'

// IDs créés dans beforeAll, nettoyés dans afterAll
let existingUserId  = ''
let disabledUserId  = ''
let newAutoUserId   = ''

/** Construit un cookie d'état CSRF valide pour le callback */
function buildStateCookie(state: string): string {
  return `gauth_state=${state}`
}

describe('Google OAuth — /api/auth/google*', () => {

  beforeAll(async () => {
    const commercialRole = await prisma.role.findUnique({ where: { name: 'COMMERCIAL' } })

    // Nettoyer d'éventuels résidus
    for (const email of [EXISTING_EMAIL, UNKNOWN_ALLOWED, DISABLED_EMAIL]) {
      const u = await prisma.user.findUnique({ where: { email } })
      if (u) {
        await prisma.googleCredential.deleteMany({ where: { userId: u.id } }).catch(() => {})
        await prisma.refreshToken.deleteMany({ where: { userId: u.id } }).catch(() => {})
        await prisma.user.delete({ where: { id: u.id } })
      }
    }

    // User existant actif (sera lié via email)
    const existing = await prisma.user.create({
      data: {
        email:     EXISTING_EMAIL,
        password:  await bcrypt.hash('irrelevant', 10),
        firstName: 'Existing',
        lastName:  'User',
        role:      'COMMERCIAL',
        roleId:    commercialRole?.id ?? null,
      },
    })
    existingUserId = existing.id

    // User désactivé
    const disabled = await prisma.user.create({
      data: {
        email:     DISABLED_EMAIL,
        password:  await bcrypt.hash('irrelevant', 10),
        firstName: 'Disabled',
        lastName:  'User',
        role:      'COMMERCIAL',
        roleId:    commercialRole?.id ?? null,
        isActive:  false,
      },
    })
    disabledUserId = disabled.id

    // Poser le setting googleAllowedDomain = dcb-technologies.fr
    await prisma.setting.upsert({
      where:  { key: 'googleAllowedDomain' },
      create: { key: 'googleAllowedDomain', value: 'dcb-technologies.fr', label: 'Domaine Google autorisé' },
      update: { value: 'dcb-technologies.fr' },
    })
    await prisma.setting.upsert({
      where:  { key: 'googleAutoCreateRole' },
      create: { key: 'googleAutoCreateRole', value: 'COMMERCIAL', label: 'Rôle auto Google' },
      update: { value: 'COMMERCIAL' },
    })
  })

  afterAll(async () => {
    // Cleanup users
    for (const id of [existingUserId, disabledUserId, newAutoUserId]) {
      if (!id) continue
      await prisma.googleCredential.deleteMany({ where: { userId: id } }).catch(() => {})
      await prisma.refreshToken.deleteMany({ where: { userId: id } }).catch(() => {})
      await prisma.user.delete({ where: { id } }).catch(() => {})
    }

    await prisma.$disconnect()
  })

  // ── a) GOOGLE_CLIENT_ID absent → 503 GOOGLE_DISABLED ────────────────────────
  // Note : les modules Express lisent GOOGLE_CLIENT_ID au chargement comme const.
  // On peut tester le comportement 503 seulement si la variable était absente
  // AU MOMENT du chargement du module. Ici on vérifie seulement que la route
  // répond normalement quand la variable est présente (setup-env.ts la pose).

  describe('a) GOOGLE_CLIENT_ID présent → route OK', () => {
    it('GET /api/auth/google avec GOOGLE_CLIENT_ID → redirige (pas 503)', async () => {
      mockGenerateAuthUrl.mockReturnValueOnce('https://accounts.google.com/o/oauth2/auth?fake=1')
      const res = await request(app).get('/api/auth/google')
      // Doit être une redirection vers Google — pas un 503
      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('accounts.google.com')
    })
  })

  // ── b) Callback sans state ou state ≠ cookie → 400 ──────────────────────────

  describe('b) Callback sans state valide → 400 INVALID_STATE', () => {
    it('callback sans state du tout → 400', async () => {
      const res = await request(app)
        .get('/api/auth/google/callback?code=someCode')
        .set('Cookie', 'gauth_state=some-state')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_STATE')
    })

    it('callback sans cookie gauth_state → 400', async () => {
      const res = await request(app)
        .get('/api/auth/google/callback?code=someCode&state=some-state')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_STATE')
    })

    it('callback avec state ≠ cookie → 400', async () => {
      const res = await request(app)
        .get('/api/auth/google/callback?code=someCode&state=state-a')
        .set('Cookie', 'gauth_state=state-b')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_STATE')
    })
  })

  // ── c) Email correspondant à un user existant → liaison + redirect success ───

  describe('c) Email user existant → liaison du googleId + redirect success', () => {
    it('lie le googleId au user existant et redirige vers /auth/google/success', async () => {
      const state = 'valid-state-existing'
      const googleSub = 'google-sub-existing-user'

      mockGetToken.mockResolvedValueOnce({ tokens: { id_token: 'fake-id-token-existing' } })
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({
          sub:            googleSub,
          email:          EXISTING_EMAIL,
          email_verified: true,
          given_name:     'Existing',
          family_name:    'User',
        }),
      })

      const res = await request(app)
        .get(`/api/auth/google/callback?code=valid-code&state=${state}`)
        .set('Cookie', buildStateCookie(state))

      // Doit rediriger vers /auth/google/success
      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('/auth/google/success')

      // Vérifier le refreshToken cookie
      const cookies: string[] = Array.isArray(res.headers['set-cookie'])
        ? res.headers['set-cookie']
        : res.headers['set-cookie'] ? [res.headers['set-cookie']] : []
      expect(cookies.some((c: string) => c.startsWith('refreshToken='))).toBe(true)

      // Vérifier que le googleId a été posé en DB
      const updated = await prisma.user.findUnique({ where: { id: existingUserId } })
      expect(updated?.googleId).toBe(googleSub)
    })
  })

  // ── d) Email domaine non autorisé → redirect /login?error=google_unauthorized

  describe('d) Email domaine non autorisé → redirect unauthorized', () => {
    it('email @evil.corp → redirect /login?error=google_unauthorized, aucun user créé', async () => {
      const state = 'valid-state-denied'

      mockGetToken.mockResolvedValueOnce({ tokens: { id_token: 'fake-id-token-denied' } })
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({
          sub:            'google-sub-evil',
          email:          UNKNOWN_DENIED,
          email_verified: true,
        }),
      })

      const countBefore = await prisma.user.count()

      const res = await request(app)
        .get(`/api/auth/google/callback?code=code-denied&state=${state}`)
        .set('Cookie', buildStateCookie(state))

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('error=google_unauthorized')

      // Aucun user créé
      const countAfter = await prisma.user.count()
      expect(countAfter).toBe(countBefore)
    })
  })

  // ── e) Email domaine autorisé inconnu → auto-création user ──────────────────

  describe('e) Email domaine autorisé + user inconnu → auto-création', () => {
    it('crée un user COMMERCIAL et redirige vers success', async () => {
      const state = 'valid-state-autocreate'
      const newSub = 'google-sub-new-allowed'

      mockGetToken.mockResolvedValueOnce({ tokens: { id_token: 'fake-id-token-new' } })
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({
          sub:            newSub,
          email:          UNKNOWN_ALLOWED,
          email_verified: true,
          given_name:     'Nouveau',
          family_name:    'Membre',
        }),
      })

      const res = await request(app)
        .get(`/api/auth/google/callback?code=code-allowed&state=${state}`)
        .set('Cookie', buildStateCookie(state))

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('/auth/google/success')

      // Le user doit exister en DB avec le bon rôle
      const created = await prisma.user.findUnique({ where: { email: UNKNOWN_ALLOWED } })
      expect(created).not.toBeNull()
      expect(created?.role).toBe('COMMERCIAL')
      expect(created?.googleId).toBe(newSub)
      newAutoUserId = created?.id ?? ''
    })
  })

  // ── f) User désactivé → redirect error=account_disabled ─────────────────────

  describe('f) User désactivé → redirect account_disabled', () => {
    it('user isActive=false → redirect /login?error=account_disabled', async () => {
      const state = 'valid-state-disabled'
      const disabledSub = 'google-sub-disabled'

      mockGetToken.mockResolvedValueOnce({ tokens: { id_token: 'fake-id-token-disabled' } })
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({
          sub:            disabledSub,
          email:          DISABLED_EMAIL,
          email_verified: true,
        }),
      })

      const res = await request(app)
        .get(`/api/auth/google/callback?code=code-disabled&state=${state}`)
        .set('Cookie', buildStateCookie(state))

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('error=account_disabled')
    })
  })
})
