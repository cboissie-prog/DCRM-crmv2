import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { REFERENCE_DOMAINS, DOMAIN_BY_KEY } from '../lib/reference-domains'
import { invalidateReferenceCache } from '../lib/references'

const router = Router()
router.use(authenticate)

const COLOR_TOKENS = ['gray', 'slate', 'blue', 'indigo', 'violet', 'purple', 'pink', 'red', 'orange', 'amber', 'yellow', 'green', 'emerald', 'cyan'] as const

/** Clé technique générée du libellé : « SAV Caisse tactile » → SAV_CAISSE_TACTILE. */
function slugKey(label: string): string {
  return label.normalize('NFD').replace(/\p{Diacritic}/gu, '') // accents
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

async function countUsage(domain: string, key: string): Promise<number> {
  const cfg = DOMAIN_BY_KEY[domain]
  if (!cfg) return 0
  let total = 0
  for (const u of cfg.usage) {
    // Accès dynamique aux delegates Prisma (ticket, call, equipment, …)
    const delegate = (prisma as unknown as Record<string, { count: (args: unknown) => Promise<number> }>)[u.model]
    if (!delegate) continue
    total += await delegate.count({ where: { [u.field]: key } })
  }
  return total
}

// GET /api/references — tous les domaines + leurs valeurs (tout utilisateur connecté :
// nécessaire pour afficher libellés/couleurs partout dans l'app)
router.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rows = await prisma.referenceValue.findMany({ orderBy: [{ domain: 'asc' }, { order: 'asc' }, { label: 'asc' }] })
    const data = REFERENCE_DOMAINS.map(d => ({
      domain: d.domain,
      label: d.label,
      description: d.description,
      validate: d.validate,
      keyStyle: d.keyStyle,
      hasColor: d.hasColor,
      hasIcon: d.hasIcon,
      values: rows
        .filter(r => r.domain === d.domain)
        .map(r => ({
          id: r.id, key: r.key, label: r.label, color: r.color, icon: r.icon,
          order: r.order, isActive: r.isActive, isSystem: r.isSystem,
          meta: r.meta ? JSON.parse(r.meta) : null,
        })),
    }))
    res.json({ success: true, data })
  } catch (err) { handleRouteError(err, res) }
})

const createSchema = z.object({
  label: z.string().trim().min(1, 'Libellé requis').max(80),
  key: z.string().trim().max(80).optional(),
  color: z.enum(COLOR_TOKENS).nullable().optional(),
  icon: z.string().trim().max(40).nullable().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
})

// POST /api/references/:domain — ajouter une valeur
router.post('/:domain', requirePermission('references:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cfg = DOMAIN_BY_KEY[req.params.domain]
    if (!cfg) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Domaine inconnu' } }); return }
    const body = createSchema.parse(req.body)

    const key = cfg.keyStyle === 'free'
      ? body.label
      : (body.key?.trim() ? slugKey(body.key) : slugKey(body.label))
    if (!key) { res.status(400).json({ success: false, error: { code: 'INVALID_KEY', message: 'Impossible de générer une clé depuis ce libellé' } }); return }

    const existing = await prisma.referenceValue.findUnique({ where: { domain_key: { domain: cfg.domain, key } } })
    if (existing) { res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: `La valeur ${key} existe déjà dans cette liste` } }); return }

    const max = await prisma.referenceValue.aggregate({ where: { domain: cfg.domain }, _max: { order: true } })
    const created = await prisma.referenceValue.create({
      data: {
        domain: cfg.domain, key,
        label: body.label,
        color: cfg.hasColor ? body.color ?? null : null,
        icon: cfg.hasIcon ? body.icon ?? null : null,
        meta: body.meta ? JSON.stringify(body.meta) : null,
        order: (max._max.order ?? -1) + 1,
      },
    })
    invalidateReferenceCache()
    res.status(201).json({ success: true, data: created })
  } catch (err) { handleRouteError(err, res) }
})

const updateSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  color: z.enum(COLOR_TOKENS).nullable().optional(),
  icon: z.string().trim().max(40).nullable().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
  isActive: z.boolean().optional(),
})

// PUT /api/references/:id — modifier libellé/couleur/icône/meta/actif (la clé est immuable)
router.put('/:id', requirePermission('references:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const row = await prisma.referenceValue.findUnique({ where: { id: req.params.id } })
    if (!row) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Valeur introuvable' } }); return }
    const body = updateSchema.parse(req.body)

    if (body.isActive === false && row.isSystem) {
      res.status(400).json({ success: false, error: { code: 'SYSTEM_VALUE', message: 'Cette valeur est utilisée par le fonctionnement de l\'application et ne peut pas être désactivée' } })
      return
    }

    const updated = await prisma.referenceValue.update({
      where: { id: row.id },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
        ...(body.meta !== undefined ? { meta: body.meta ? JSON.stringify(body.meta) : null } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    })
    invalidateReferenceCache()
    res.json({ success: true, data: updated })
  } catch (err) { handleRouteError(err, res) }
})

// PATCH /api/references/:domain/reorder — { ids: [...] } dans l'ordre voulu
router.patch('/:domain/reorder', requirePermission('references:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cfg = DOMAIN_BY_KEY[req.params.domain]
    if (!cfg) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Domaine inconnu' } }); return }
    const { ids } = z.object({ ids: z.array(z.string()).min(1) }).parse(req.body)
    await prisma.$transaction(
      ids.map((id, i) => prisma.referenceValue.updateMany({ where: { id, domain: cfg.domain }, data: { order: i } }))
    )
    invalidateReferenceCache()
    res.json({ success: true, data: { reordered: ids.length } })
  } catch (err) { handleRouteError(err, res) }
})

// DELETE /api/references/:id — suppression ; si la valeur est utilisée par des
// données existantes, elle est désactivée à la place (le libellé reste affichable)
router.delete('/:id', requirePermission('references:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const row = await prisma.referenceValue.findUnique({ where: { id: req.params.id } })
    if (!row) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Valeur introuvable' } }); return }
    if (row.isSystem) {
      res.status(400).json({ success: false, error: { code: 'SYSTEM_VALUE', message: 'Cette valeur est utilisée par le fonctionnement de l\'application et ne peut pas être supprimée' } })
      return
    }
    const usage = await countUsage(row.domain, row.key)
    if (usage > 0) {
      await prisma.referenceValue.update({ where: { id: row.id }, data: { isActive: false } })
      invalidateReferenceCache()
      res.json({ success: true, data: { deactivated: true, usage } })
      return
    }
    await prisma.referenceValue.delete({ where: { id: row.id } })
    invalidateReferenceCache()
    res.json({ success: true, data: { deleted: true } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
