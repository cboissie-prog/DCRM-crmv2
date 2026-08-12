import { Router } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import prisma from '../prisma/client'
import type { AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { audit } from '../lib/audit'

const router = Router()

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(24).toString('base64url')
  const key = `dcrm_${raw}`
  const prefix = key.slice(0, 12) // "dcrm_" + 7 chars
  const hash = hashKey(key)
  return { key, prefix, hash }
}

/** Scopes stockés en JSON — illisible/invalide → aucun droit. */
function parseScopes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string')
  } catch { /* corrompu → [] */ }
  return []
}

/**
 * Valide une liste de scopes demandée : chaque clé doit exister dans la table Permission
 * et, pour un non-admin, appartenir aux droits de l'appelant.
 * Retourne null si OK, sinon le message d'erreur.
 */
async function validateRequestedScopes(req: AuthRequest, requested: string[]): Promise<string | null> {
  if (requested.length === 0) return null
  const unique = [...new Set(requested)]
  const found = await prisma.permission.findMany({
    where: { key: { in: unique } },
    select: { key: true },
  })
  const foundKeys = new Set(found.map(p => p.key))
  const unknown = unique.filter(k => !foundKeys.has(k))
  if (unknown.length > 0) return `Permissions inconnues : ${unknown.join(', ')}`

  const isAdmin = req.permissions?.includes('*') ?? false
  if (!isAdmin) {
    const own = new Set(req.permissions ?? [])
    const beyond = unique.filter(k => !own.has(k))
    if (beyond.length > 0) return `Permissions au-delà de vos droits : ${beyond.join(', ')}`
  }
  return null
}

// GET /api/apikeys — liste les clés de l'utilisateur courant
router.get('/', requirePermission('apikeys:manage'), async (req: AuthRequest, res) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.userId, isActive: true },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({
      success: true,
      data: keys.map(({ scopes, ...k }) => ({ ...k, permissions: parseScopes(scopes) })),
    })
  } catch (err) { handleRouteError(err, res) }
})

// GET /api/apikeys/permissions — permissions attribuables à une clé par l'utilisateur courant,
// groupées par catégorie (toutes pour un admin, les siennes sinon).
// Déclarée AVANT les routes /:id pour éviter toute collision.
router.get('/permissions', requirePermission('apikeys:manage'), async (req: AuthRequest, res) => {
  try {
    const isAdmin = req.permissions?.includes('*') ?? false
    const permissions = await prisma.permission.findMany({
      where: isAdmin ? {} : { key: { in: req.permissions ?? [] } },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    })
    const grouped = permissions.reduce<Record<string, typeof permissions>>((acc, perm) => {
      if (!acc[perm.category]) acc[perm.category] = []
      acc[perm.category].push(perm)
      return acc
    }, {})
    res.json({ success: true, data: grouped })
  } catch (err) { handleRouteError(err, res) }
})

// POST /api/apikeys — génère une nouvelle clé (scopes explicites, [] = aucun droit)
router.post('/', requirePermission('apikeys:manage'), async (req: AuthRequest, res) => {
  // Parsing dans le try : hors du bloc, toute exception devenait un rejet non géré au lieu
  // d'une réponse d'erreur. `expiresAt` non validé produisait par ailleurs une Invalid Date
  // transmise à Prisma.
  try {
    const { name, expiresAt, permissions } = z.object({
      name: z.string().trim().min(1, 'Le nom est requis'),
      // Le formulaire envoie un <input type="date"> ("YYYY-MM-DD"), pas un ISO 8601 complet :
      // on vérifie simplement que la valeur donne une date valide.
      expiresAt: z.string()
        .refine(v => !isNaN(new Date(v).getTime()), 'Date d\'expiration invalide')
        .optional()
        .nullable(),
      permissions: z.array(z.string()).optional().default([]),
    }).parse(req.body)

    const scopeError = await validateRequestedScopes(req, permissions)
    if (scopeError) {
      res.status(400).json({ success: false, error: { code: 'INVALID_PERMISSIONS', message: scopeError } })
      return
    }

    const requestedScopes = [...new Set(permissions)]
    const { key, prefix, hash } = generateApiKey()
    const record = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        keyHash: hash,
        prefix,
        userId: req.userId!,
        scopes: JSON.stringify(requestedScopes),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    })
    audit(req, 'APIKEY_CREATED', 'ApiKey', record.id, { name: record.name, prefix, permissionsCount: requestedScopes.length })
    res.status(201).json({
      success: true,
      data: {
        id: record.id,
        name: record.name,
        key, // affiché une seule fois
        prefix,
        permissions: requestedScopes,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      },
    })
  } catch (err) { handleRouteError(err, res) }
})

// PUT /api/apikeys/:id/permissions — remplace les droits d'une clé (propriétaire uniquement)
router.put('/:id/permissions', requirePermission('apikeys:manage'), async (req: AuthRequest, res) => {
  try {
    const { permissions } = z.object({
      permissions: z.array(z.string()),
    }).parse(req.body)

    const existing = await prisma.apiKey.findUnique({ where: { id: req.params.id } })
    if (!existing || !existing.isActive || existing.userId !== req.userId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Clé introuvable' } })
      return
    }

    const scopeError = await validateRequestedScopes(req, permissions)
    if (scopeError) {
      res.status(400).json({ success: false, error: { code: 'INVALID_PERMISSIONS', message: scopeError } })
      return
    }

    const requestedScopes = [...new Set(permissions)]
    await prisma.apiKey.update({
      where: { id: existing.id },
      data: { scopes: JSON.stringify(requestedScopes) },
    })
    audit(req, 'APIKEY_PERMISSIONS_CHANGED', 'ApiKey', existing.id, {
      name: existing.name,
      prefix: existing.prefix,
      permissionsCount: requestedScopes.length,
    })
    res.json({ success: true, data: { id: existing.id, permissions: requestedScopes } })
  } catch (err) { handleRouteError(err, res) }
})

// DELETE /api/apikeys/:id — révoque une clé
router.delete('/:id', requirePermission('apikeys:manage'), async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.apiKey.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.userId !== req.userId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Clé introuvable' } })
      return
    }
    await prisma.apiKey.update({
      where: { id: req.params.id },
      data: { isActive: false },
    })
    audit(req, 'APIKEY_REVOKED', 'ApiKey', req.params.id, { name: existing.name, prefix: existing.prefix })
    res.json({ success: true, data: { message: 'Clé révoquée' } })
  } catch (err) { handleRouteError(err, res) }
})

export { hashKey }
export default router
