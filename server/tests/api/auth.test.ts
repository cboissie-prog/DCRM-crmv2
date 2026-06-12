import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { extractRefreshCookie } from '../helpers'

const app = createApp({ rateLimit: false })

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

function extractCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie']
  return Array.isArray(raw) ? raw : raw ? [raw] : []
}

/** Attendre N millisecondes */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('POST /api/auth/login', () => {
  it('login admin OK → token + permissions ["*"]', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.accessToken).toBeTruthy()
    expect(res.body.data.user.permissions).toContain('*')
    // Un cookie refreshToken doit être posé
    const cookies = extractCookies(res)
    expect(cookies.some((c: string) => c.startsWith('refreshToken='))).toBe(true)
  })

  it('login mauvais mot de passe → 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong-password' })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('login user inconnu → 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })
})

describe('POST /api/auth/refresh — rotation', () => {
  let originalRefreshCookie: string
  let rotatedRefreshCookie: string

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    const cookies = extractCookies(res)
    originalRefreshCookie = extractRefreshCookie(cookies) ?? ''
    expect(originalRefreshCookie).toBeTruthy()
  })

  it('refresh avec cookie valide → nouveau accessToken + nouveau cookie (rotation)', async () => {
    // Attendre 1100ms pour que l'iat JWT soit différent (iat = secondes)
    await sleep(1100)

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', originalRefreshCookie)

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeTruthy()
    // Un nouveau cookie refreshToken doit être posé (rotation)
    const newCookies = extractCookies(res)
    expect(newCookies.some((c: string) => c.startsWith('refreshToken='))).toBe(true)
    // Sauvegarde le nouveau cookie pour le test suivant
    rotatedRefreshCookie = extractRefreshCookie(newCookies) ?? ''
    expect(rotatedRefreshCookie).toBeTruthy()
    // Le nouveau token doit être différent (iat +1s → hash différent)
    expect(rotatedRefreshCookie).not.toBe(originalRefreshCookie)
  })

  it("l'ancien token (avant rotation) ne fonctionne plus → 401 (réutilisation détectée)", async () => {
    // L'ancien token a été consommé lors du test précédent (rotation)
    // Le réutiliser doit déclencher la détection de réutilisation → 401 + révocation
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', originalRefreshCookie)

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })

  it("après révocation, le token rotaté est aussi invalidé (deleteMany tous les tokens du user)", async () => {
    // La révocation de tous les tokens de l'utilisateur a été déclenchée
    // par la réutilisation du token dans le test précédent.
    // Le token rotaté (rotatedRefreshCookie) doit aussi être invalidé.
    if (!rotatedRefreshCookie) return
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', rotatedRefreshCookie)

    expect(res.status).toBe(401)
  })
})
