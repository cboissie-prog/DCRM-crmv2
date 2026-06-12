/**
 * helpers.ts — utilitaires partagés pour les tests API.
 */
import type { Express } from 'express'
import request from 'supertest'

/**
 * Login et retourne { accessToken, cookies } pour un utilisateur donné.
 */
export async function loginAs(app: Express, email: string, password: string) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password })

  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`)
  }

  const accessToken: string = res.body.data.accessToken
  // supertest expose les Set-Cookie headers
  const rawCookies = res.headers['set-cookie']
  const cookies: string[] = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : []
  return { accessToken, cookies, user: res.body.data.user }
}

/**
 * Extrait la valeur brute du cookie refreshToken depuis les headers Set-Cookie.
 */
export function extractRefreshCookie(cookies: string[]): string | undefined {
  const cookieStr = cookies.find(c => c.startsWith('refreshToken='))
  if (!cookieStr) return undefined
  return cookieStr.split(';')[0] // "refreshToken=<value>"
}
