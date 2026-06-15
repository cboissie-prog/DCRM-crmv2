import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomBytes, createHash } from 'crypto'
import { z } from 'zod'
import { OAuth2Client } from 'google-auth-library'
import prisma from '../prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { sendPasswordResetEmail } from '../services/mailer'
import logger from '../lib/logger'
import { audit } from '../lib/audit'
import { encrypt } from '../lib/crypto'

/** Retourne le SHA-256 hex d'un token — le token en clair ne touche jamais la DB */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const router = Router()

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
  path: '/api/auth',
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

function generateTokens(userId: string, role: string, permissions: string[]) {
  const accessToken = jwt.sign({ userId, role, permissions }, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  } as jwt.SignOptions)
  const refreshToken = jwt.sign({ userId, role }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  } as jwt.SignOptions)
  return { accessToken, refreshToken }
}

// POST /auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = loginSchema.parse(req.body)
    // Un seul findUnique avec include pour éviter la double requête
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: {
        roleRef: {
          include: {
            permissions: {
              include: { permission: true }
            }
          }
        }
      }
    })
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' } })
      return
    }
    const valid = await bcrypt.compare(body.password, user.password)
    if (!valid) {
      res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect' } })
      return
    }
    // Bypass ADMIN : accès total symbolisé par ['*']
    const permissions: string[] = user.role === 'ADMIN'
      ? ['*']
      : (user.roleRef?.permissions.map(rp => rp.permission.key) ?? [])
    const { accessToken, refreshToken } = generateTokens(user.id, user.role, permissions)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    // Stocke le hash SHA-256 — le token en clair reste uniquement dans le cookie httpOnly.
    // Upsert : évite le P2002 si deux logins consécutifs génèrent le même token JWT
    // (iat étant basé sur la seconde, deux logins dans la même seconde donnent le même hash).
    await prisma.refreshToken.upsert({
      where: { token: hashToken(refreshToken) },
      create: { token: hashToken(refreshToken), userId: user.id, expiresAt },
      update: { expiresAt },
    })
    const { password: _, roleRef: __, ...userWithoutPassword } = user
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS)
    // Audit fire-and-forget (après envoi de la réponse)
    const fakeReq = { userId: user.id } as AuthRequest
    audit(fakeReq, 'LOGIN_SUCCESS', 'User', user.id, { email: user.email, role: user.role })
    res.json({ success: true, data: { user: { ...userWithoutPassword, permissions }, accessToken } })
  } catch (err) {
    // login : ZodError → 400, autres → log + 500
    handleRouteError(err, res)
  }
})

// POST /auth/refresh
// LOGIQUE SPÉCIFIQUE CONSERVÉE : clearCookie + 401 sur token invalide/expiré/réutilisé
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken
    if (!refreshToken) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Refresh token manquant' } })
      return
    }

    // 1. Vérifie la signature JWT en premier pour pouvoir extraire userId en cas de réutilisation
    let payload: { userId: string; role: string }
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { userId: string; role: string }
    } catch {
      res.clearCookie('refreshToken', { path: '/api/auth' })
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token invalide' } })
      return
    }

    // 2. Cherche le hash en base
    const tokenHash = hashToken(refreshToken)
    const stored = await prisma.refreshToken.findUnique({ where: { token: tokenHash } })

    if (!stored) {
      // Token JWT authentique mais absent de la DB → réutilisation probable (vol détecté)
      logger.warn({ userId: payload.userId }, '[SECURITY] Refresh token réutilisé, révocation des sessions user')
      await prisma.refreshToken.deleteMany({ where: { userId: payload.userId } })
      res.clearCookie('refreshToken', { path: '/api/auth' })
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Session révoquée pour raison de sécurité' } })
      return
    }

    if (stored.expiresAt < new Date()) {
      await prisma.refreshToken.deleteMany({ where: { token: tokenHash } })
      res.clearCookie('refreshToken', { path: '/api/auth' })
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Refresh token expiré' } })
      return
    }

    // 3. Charge l'utilisateur avec ses permissions
    const userWithPermissions = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        roleRef: {
          include: {
            permissions: { include: { permission: true } }
          }
        }
      }
    })
    if (!userWithPermissions || !userWithPermissions.isActive) {
      res.clearCookie('refreshToken', { path: '/api/auth' })
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Utilisateur introuvable' } })
      return
    }

    // Bypass ADMIN : accès total symbolisé par ['*']
    const permissions: string[] = userWithPermissions.role === 'ADMIN'
      ? ['*']
      : (userWithPermissions.roleRef?.permissions.map(rp => rp.permission.key) ?? [])

    // 4. Rotation : supprime l'ancien token, crée le nouveau (stocke le hash)
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(userWithPermissions.id, userWithPermissions.role, permissions)
    await prisma.refreshToken.deleteMany({ where: { token: tokenHash } })
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.refreshToken.create({ data: { token: hashToken(newRefreshToken), userId: userWithPermissions.id, expiresAt } })
    res.cookie('refreshToken', newRefreshToken, REFRESH_COOKIE_OPTIONS)
    res.json({ success: true, data: { accessToken } })
  } catch {
    // Erreur inattendue (DB down, etc.) : clear cookie par sécurité + 401
    res.clearCookie('refreshToken', { path: '/api/auth' })
    res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token invalide' } })
  }
})

// POST /auth/logout
router.post('/logout', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken
    if (refreshToken) await prisma.refreshToken.deleteMany({ where: { token: hashToken(refreshToken) } })
    audit(req, 'LOGOUT', 'User', req.userId)
    res.clearCookie('refreshToken', { path: '/api/auth' })
    res.json({ success: true, data: { message: 'Déconnecté avec succès' } })
  } catch (err) { handleRouteError(err, res) }
})

// POST /auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  // Délai constant pour éviter l'énumération d'emails par timing (user existant vs non existant)
  const minDelay = new Promise(r => setTimeout(r, 300))
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body)
    const user = await prisma.user.findUnique({ where: { email } })
    if (user && user.isActive) {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })
      // Le token en clair part uniquement dans l'email ; seul son hash SHA-256 est stocké en base
      // (même principe que les refresh tokens — une fuite de la base ne donne aucun token réutilisable).
      const rawToken = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1h
      await prisma.passwordResetToken.create({ data: { token: hashToken(rawToken), userId: user.id, expiresAt } })
      // Envoi détaché : sort du cycle requête pour éviter la fuite de timing (énumération d'emails)
      const emailTo = user.email
      setImmediate(() => {
        sendPasswordResetEmail(emailTo, rawToken).catch(err => logger.error({ err }, '[MAILER] Échec d\'envoi de l\'email de réinitialisation'))
      })
    }
    await minDelay
    res.json({ success: true, data: { message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' } })
  } catch (err) {
    await minDelay
    handleRouteError(err, res)
  }
})

// POST /auth/reset-password
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = z.object({
      token: z.string().min(1),
      password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères'),
    }).parse(req.body)
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: hashToken(token) },
      include: { user: true },
    })
    if (!resetToken || resetToken.expiresAt < new Date()) {
      res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Lien invalide ou expiré' } })
      return
    }
    const hashedPassword = await bcrypt.hash(password, 12)
    await prisma.user.update({ where: { id: resetToken.userId }, data: { password: hashedPassword } })
    await prisma.passwordResetToken.delete({ where: { id: resetToken.id } })
    await prisma.refreshToken.deleteMany({ where: { userId: resetToken.userId } })
    const fakeReq = { userId: resetToken.userId } as AuthRequest
    audit(fakeReq, 'PASSWORD_RESET', 'User', resetToken.userId)
    res.clearCookie('refreshToken', { path: '/api/auth' })
    res.json({ success: true, data: { message: 'Mot de passe réinitialisé avec succès' } })
  } catch (err) { handleRouteError(err, res) }
})

// GET /auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: {
      id: true, email: true, firstName: true, lastName: true, phone: true, avatar: true, role: true, isActive: true, createdAt: true
    }})
    if (!user) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Utilisateur introuvable' } }); return }
    res.json({ success: true, data: user })
  } catch (err) { handleRouteError(err, res) }
})

// ─── GOOGLE OAUTH 2.0 ────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3001/api/auth/google/callback'
const FRONTEND_URL         = process.env.FRONTEND_URL ?? 'http://localhost:5173'

/** Retourne un OAuth2Client Google configuré, ou null si les variables manquent */
function getOAuth2Client(): OAuth2Client | null {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
}

/** Helper : renvoie 503 si Google OAuth n'est pas configuré */
function requireGoogleConfig(res: Response): boolean {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(503).json({ success: false, error: { code: 'GOOGLE_DISABLED', message: 'Connexion Google non configurée' } })
    return false
  }
  return true
}

const GAUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 10 * 60 * 1000, // 10 minutes
  path: '/',
}

// GET /auth/google — redirige vers la page d'autorisation Google
router.get('/google', async (req: Request, res: Response): Promise<void> => {
  if (!requireGoogleConfig(res)) return
  try {
    const oauth2Client = getOAuth2Client()!
    const state = randomBytes(16).toString('hex')
    res.cookie('gauth_state', state, GAUTH_COOKIE_OPTIONS)
    const url = oauth2Client.generateAuthUrl({
      access_type: 'online',
      prompt: 'select_account',
      scope: ['openid', 'email', 'profile'],
      state,
    })
    res.redirect(url)
  } catch (err) { handleRouteError(err, res) }
})

// GET /auth/google/callback — callback OAuth2 de Google
router.get('/google/callback', async (req: Request, res: Response): Promise<void> => {
  if (!requireGoogleConfig(res)) return
  const { code, state, error: oauthError } = req.query as Record<string, string>

  // Erreur renvoyée par Google (ex: accès refusé par l'utilisateur)
  if (oauthError) {
    logger.warn({ oauthError }, '[GOOGLE OAUTH] Erreur renvoyée par Google')
    res.redirect(`${FRONTEND_URL}/login?error=google_unauthorized`)
    return
  }

  // Vérification anti-CSRF du state
  const storedState = req.cookies?.gauth_state
  if (!state || !storedState || state !== storedState) {
    // Cause fréquente : flux démarré depuis un autre hôte que celui du redirect URI
    // (le cookie gauth_state est posé sur l'hôte d'origine), ou state expiré (10 min).
    logger.warn({ host: req.headers.host, hasCookie: Boolean(storedState) }, '[GOOGLE OAUTH] INVALID_STATE')
    res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: 'State CSRF invalide' } })
    return
  }
  res.clearCookie('gauth_state', { path: '/' })

  try {
    const oauth2Client = getOAuth2Client()!

    // Échange le code d'autorisation contre des tokens
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    if (!tokens.id_token) {
      res.status(400).json({ success: false, error: { code: 'NO_ID_TOKEN', message: 'Impossible d\'obtenir le id_token Google' } })
      return
    }

    // Vérifie et décode le id_token
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID!,
    })
    const payload = ticket.getPayload()
    if (!payload) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID_TOKEN', message: 'id_token invalide' } })
      return
    }

    const { sub: googleId, email, email_verified, given_name, family_name } = payload
    if (!email || !email_verified) {
      res.redirect(`${FRONTEND_URL}/login?error=google_unauthorized`)
      return
    }

    // ── Logique de liaison / création d'utilisateur ──────────────────────────

    // Cherche par googleId d'abord
    let user = await prisma.user.findUnique({
      where: { googleId },
      include: { roleRef: { include: { permissions: { include: { permission: true } } } } },
    })

    if (!user) {
      // Cherche par email
      const userByEmail = await prisma.user.findUnique({
        where: { email },
        include: { roleRef: { include: { permissions: { include: { permission: true } } } } },
      })

      if (userByEmail) {
        // Cas 2 : utilisateur existant par email → liaison
        if (!userByEmail.isActive) {
          res.redirect(`${FRONTEND_URL}/login?error=account_disabled`)
          return
        }
        user = await prisma.user.update({
          where: { id: userByEmail.id },
          data: { googleId },
          include: { roleRef: { include: { permissions: { include: { permission: true } } } } },
        })
        const fakeReq = { userId: user.id } as AuthRequest
        audit(fakeReq, 'GOOGLE_ACCOUNT_LINKED', 'User', user.id, { email, googleId })
      } else {
        // Cas 3 ou 4 : vérification domaine autorisé
        const emailDomain = email.split('@')[1] ?? ''

        // Lire le setting googleAllowedDomain (fallback : dcb-technologies.fr)
        const domainSetting = await prisma.setting.findUnique({ where: { key: 'googleAllowedDomain' } })
        const allowedDomain = domainSetting?.value ?? 'dcb-technologies.fr'

        // Lire le setting googleAutoCreateRole (fallback : COMMERCIAL)
        const roleSetting = await prisma.setting.findUnique({ where: { key: 'googleAutoCreateRole' } })
        const rawAutoRole = roleSetting?.value ?? 'COMMERCIAL'
        // Défense en profondeur : ne jamais auto-créer un ADMIN via OAuth (ADMIN = bypass total des
        // permissions), même si le setting a été forcé directement en base. Fallback sécurisé : COMMERCIAL.
        const autoRole = rawAutoRole.toUpperCase() === 'ADMIN' ? 'COMMERCIAL' : rawAutoRole

        if (emailDomain !== allowedDomain) {
          res.redirect(`${FRONTEND_URL}/login?error=google_unauthorized`)
          return
        }

        // Auto-création
        const roleRef = await prisma.role.findUnique({ where: { name: autoRole } })
        const newPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 12)

        user = await prisma.user.create({
          data: {
            email,
            password: newPassword,
            firstName: given_name ?? email.split('@')[0],
            lastName: family_name ?? '',
            googleId,
            role: autoRole,
            roleId: roleRef?.id ?? null,
          },
          include: { roleRef: { include: { permissions: { include: { permission: true } } } } },
        })
        const fakeReq = { userId: user.id } as AuthRequest
        audit(fakeReq, 'USER_AUTOCREATED_GOOGLE', 'User', user.id, { email, googleId, role: autoRole })
      }
    }

    // Vérification isActive (pour les cas où l'user existait par googleId)
    if (!user.isActive) {
      res.redirect(`${FRONTEND_URL}/login?error=account_disabled`)
      return
    }

    // Si Google renvoie un refresh_token, on le chiffre et stocke dans GoogleCredential
    if (tokens.refresh_token) {
      try {
        const encryptedToken = encrypt(tokens.refresh_token)
        await prisma.googleCredential.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            googleEmail: email,
            refreshTokenEnc: encryptedToken,
          },
          update: {
            googleEmail: email,
            refreshTokenEnc: encryptedToken,
          },
        })
      } catch (err) {
        // Ne pas bloquer la connexion si le stockage du token échoue
        logger.warn({ err }, '[GOOGLE OAUTH] Impossible de stocker le refresh token Google')
      }
    }

    // ── Génère les tokens CRM ────────────────────────────────────────────────
    const permissions: string[] = user.role === 'ADMIN'
      ? ['*']
      : (user.roleRef?.permissions.map(rp => rp.permission.key) ?? [])

    const { accessToken, refreshToken } = generateTokens(user.id, user.role, permissions)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await prisma.refreshToken.upsert({
      where: { token: hashToken(refreshToken) },
      create: { token: hashToken(refreshToken), userId: user.id, expiresAt },
      update: { expiresAt },
    })

    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS)

    const fakeReq2 = { userId: user.id } as AuthRequest
    audit(fakeReq2, 'LOGIN_GOOGLE', 'User', user.id, { email, googleId })

    // Redirige vers la page de finalisation — le client utilisera POST /auth/refresh pour récupérer l'accessToken
    res.redirect(`${FRONTEND_URL}/auth/google/success`)
  } catch (err) {
    logger.error({ err }, '[GOOGLE OAUTH] Erreur dans le callback')
    res.redirect(`${FRONTEND_URL}/login?error=google_unauthorized`)
  }
})

export default router
