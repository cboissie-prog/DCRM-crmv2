import crypto from 'crypto'

/**
 * Jetons NPS signés (HMAC-SHA256) pour l'enquête de satisfaction publique.
 * Format : base64url("<ticketId>.<expirationMs>") + "." + signature base64url.
 * Aucun stockage : la signature suffit à garantir l'origine, l'unicité de la
 * réponse est assurée par la contrainte @unique sur NpsResponse.ticketId.
 */

function secret(): string {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('[nps-token] JWT_SECRET absent')
  return s
}

function hmac(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function signNpsToken(ticketId: string, expiresInDays = 30): string {
  const exp = Date.now() + expiresInDays * 24 * 60 * 60 * 1000
  const payload = `${ticketId}.${exp}`
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${hmac(payload)}`
}

/** Retourne le ticketId si le jeton est valide et non expiré, sinon null. */
export function verifyNpsToken(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [encoded, sig] = parts
  let payload: string
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8')
  } catch { return null }
  const expected = hmac(payload)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const dot = payload.lastIndexOf('.')
  if (dot === -1) return null
  const ticketId = payload.slice(0, dot)
  const exp = parseInt(payload.slice(dot + 1), 10)
  if (isNaN(exp) || Date.now() > exp) return null
  return ticketId
}
