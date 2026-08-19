import { Router, Response } from 'express'
import { z } from 'zod'
import { optionalDateString } from '../lib/zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { checkReferences } from '../lib/references'
import { getSettingInt } from '../lib/settings'
import { ensureExists, fetchOrFail, ensureCompanyMatch } from '../lib/relationChecks'

const router = Router()
router.use(authenticate)

const licenseSchema = z.object({
  companyId: z.string(),
  equipmentId: z.string().optional(),
  productId: z.string().optional(),
  software: z.string().min(1),
  vendor: z.string().optional(),
  licenseKey: z.string().optional(),
  seats: z.number().int().optional(),
  type: z.string().optional(),
  purchaseDate: optionalDateString,
  expiryDate: optionalDateString,
  cost: z.number().optional(),
  notes: z.string().optional(),
})

router.get('/', requirePermission('equipment:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { companyId, type, expiringSoon, page, limit } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50))
    const where: Record<string, unknown> = {}
    if (companyId) where.companyId = companyId
    if (type) where.type = type
    if (expiringSoon === 'true') {
      const days = await getSettingInt('licenseExpiringSoonDays', 30)
      const threshold = new Date()
      threshold.setDate(threshold.getDate() + days)
      where.expiryDate = { lte: threshold, gte: new Date() }
    }
    const [total, licenses] = await Promise.all([
      prisma.license.count({ where }),
      prisma.license.findMany({
        where, skip: (pageNum - 1) * limitNum, take: limitNum,
        orderBy: { expiryDate: 'asc' },
        include: {
          company: { select: { id: true, name: true } },
          equipment: { select: { id: true, type: true, brand: true, model: true } },
          product: { select: { id: true, name: true, reference: true } },
        },
      }),
    ])
    res.json({ success: true, data: licenses, meta: { total, page: pageNum, limit: limitNum } })
  } catch (err) { handleRouteError(err, res) }
})

router.post('/', requirePermission('equipment:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = licenseSchema.parse(req.body)
    const refError = await checkReferences([{ domain: 'license_type', value: body.type }])
    if (refError) { res.status(400).json({ success: false, error: { code: 'INVALID_REFERENCE', message: refError } }); return }
    const data: Record<string, unknown> = { ...body }
    if (body.purchaseDate) data.purchaseDate = new Date(body.purchaseDate)
    if (body.expiryDate) data.expiryDate = new Date(body.expiryDate)
    // FK optionnelles : une chaîne vide doit devenir NULL (sinon violation de contrainte)
    if (body.productId === '') data.productId = null
    if (body.equipmentId === '') data.equipmentId = null

    if (!await ensureExists(res, body.companyId, 'COMPANY_NOT_FOUND', 'Entreprise introuvable', id => prisma.company.findUnique({ where: { id }, select: { id: true } }))) return
    if (body.equipmentId) {
      const equipment = await fetchOrFail(res, body.equipmentId, 'EQUIPMENT_NOT_FOUND', 'Équipement introuvable', id => prisma.equipment.findUnique({ where: { id }, select: { id: true, companyId: true } }))
      if (equipment === null) return
      if (equipment && !ensureCompanyMatch(res, equipment.companyId, body.companyId, 'EQUIPMENT_COMPANY_MISMATCH', 'Cet équipement appartient à une autre entreprise')) return
    }
    if (body.productId) {
      if (!await ensureExists(res, body.productId, 'PRODUCT_NOT_FOUND', 'Produit introuvable', id => prisma.product.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const license = await prisma.license.create({
      data: data as Parameters<typeof prisma.license.create>[0]['data'],
      include: {
        company: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, reference: true } },
      },
    })
    res.status(201).json({ success: true, data: license })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/:id', requirePermission('equipment:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = licenseSchema.partial().parse(req.body)
    const refError = await checkReferences([{ domain: 'license_type', value: body.type }])
    if (refError) { res.status(400).json({ success: false, error: { code: 'INVALID_REFERENCE', message: refError } }); return }
    const current = await prisma.license.findUnique({ where: { id: req.params.id } })
    if (!current) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Licence introuvable' } }); return }

    const data: Record<string, unknown> = { ...body }
    if (body.purchaseDate) data.purchaseDate = new Date(body.purchaseDate)
    if (body.expiryDate) data.expiryDate = new Date(body.expiryDate)
    // FK optionnelles : une chaîne vide signifie « retirer le lien » → NULL
    if (body.productId === '') data.productId = null
    if (body.equipmentId === '') data.equipmentId = null

    // companyId « effectif » = celui du body s'il est fourni, sinon celui déjà en base
    const effectiveCompanyId = body.companyId !== undefined ? body.companyId : current.companyId
    if (body.companyId !== undefined) {
      if (!await ensureExists(res, body.companyId, 'COMPANY_NOT_FOUND', 'Entreprise introuvable', id => prisma.company.findUnique({ where: { id }, select: { id: true } }))) return
    }
    // Re-vérifié même si equipmentId n'a pas changé : un changement de companyId seul
    // doit rester cohérent avec l'équipement déjà lié.
    const effectiveEquipmentId = body.equipmentId !== undefined ? (body.equipmentId || null) : current.equipmentId
    if (effectiveEquipmentId) {
      const equipment = await fetchOrFail(res, effectiveEquipmentId, 'EQUIPMENT_NOT_FOUND', 'Équipement introuvable', id => prisma.equipment.findUnique({ where: { id }, select: { id: true, companyId: true } }))
      if (equipment === null) return
      if (equipment && !ensureCompanyMatch(res, equipment.companyId, effectiveCompanyId, 'EQUIPMENT_COMPANY_MISMATCH', 'Cet équipement appartient à une autre entreprise')) return
    }
    if (body.productId !== undefined) {
      if (!await ensureExists(res, body.productId, 'PRODUCT_NOT_FOUND', 'Produit introuvable', id => prisma.product.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const license = await prisma.license.update({
      where: { id: req.params.id },
      data: data as Parameters<typeof prisma.license.update>[0]['data'],
      include: {
        company: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, reference: true } },
      },
    })
    res.json({ success: true, data: license })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/:id', requirePermission('equipment:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.license.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: { message: 'Licence supprimée' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
