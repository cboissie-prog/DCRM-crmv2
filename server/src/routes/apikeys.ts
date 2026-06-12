import { Router } from 'express'
import crypto from 'crypto'
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

// GET /api/apikeys — liste les clés de l'utilisateur courant
router.get('/', requirePermission('apikeys:manage'), async (req: AuthRequest, res) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.userId, isActive: true },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        expiresAt: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: keys })
  } catch (err) { handleRouteError(err, res) }
})

// POST /api/apikeys — génère une nouvelle clé
router.post('/', requirePermission('apikeys:manage'), async (req: AuthRequest, res) => {
  const { name, expiresAt } = req.body
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Le nom est requis' } })
    return
  }
  try {
    const { key, prefix, hash } = generateApiKey()
    const record = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        keyHash: hash,
        prefix,
        userId: req.userId!,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    })
    audit(req, 'APIKEY_CREATED', 'ApiKey', record.id, { name: record.name, prefix })
    res.status(201).json({
      success: true,
      data: {
        id: record.id,
        name: record.name,
        key, // affiché une seule fois
        prefix,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      },
    })
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
