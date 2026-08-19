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

const equipmentSchema = z.object({
  companyId: z.string(),
  contractId: z.string().optional(),
  productId: z.string().optional(),
  type: z.string(),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  purchaseDate: optionalDateString,
  warrantyExpiry: optionalDateString,
  location: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
})

router.get('/', requirePermission('equipment:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { companyId, type, status, warrantyExpiringSoon, page, limit } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50))
    const where: Record<string, unknown> = {}
    if (companyId) where.companyId = companyId
    if (type) where.type = type
    if (status) where.status = status
    if (warrantyExpiringSoon === 'true') {
      const days = await getSettingInt('warrantyExpiringSoonDays', 60)
      const threshold = new Date()
      threshold.setDate(threshold.getDate() + days)
      where.warrantyExpiry = { lte: threshold, gte: new Date() }
    }
    const [total, equipments] = await Promise.all([
      prisma.equipment.count({ where }),
      prisma.equipment.findMany({
        where, skip: (pageNum - 1) * limitNum, take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true } },
          contract: { select: { id: true, reference: true, title: true } },
          product: { select: { id: true, name: true, reference: true } },
          _count: { select: { tickets: true, licenses: true } },
        },
      }),
    ])
    res.json({ success: true, data: equipments, meta: { total, page: pageNum, limit: limitNum } })
  } catch (err) { handleRouteError(err, res) }
})

router.post('/', requirePermission('equipment:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = equipmentSchema.parse(req.body)
    const refError = await checkReferences([
      { domain: 'equipment_type', value: body.type },
      { domain: 'equipment_status', value: body.status },
    ])
    if (refError) { res.status(400).json({ success: false, error: { code: 'INVALID_REFERENCE', message: refError } }); return }
    const data: Record<string, unknown> = { ...body }
    if (body.purchaseDate) data.purchaseDate = new Date(body.purchaseDate)
    if (body.warrantyExpiry) data.warrantyExpiry = new Date(body.warrantyExpiry)
    // FK optionnelles : une chaîne vide doit devenir NULL (sinon violation de contrainte)
    if (body.productId === '') data.productId = null
    if (body.contractId === '') data.contractId = null

    if (!await ensureExists(res, body.companyId, 'COMPANY_NOT_FOUND', 'Entreprise introuvable', id => prisma.company.findUnique({ where: { id }, select: { id: true } }))) return
    if (body.contractId) {
      const contract = await fetchOrFail(res, body.contractId, 'CONTRACT_NOT_FOUND', 'Contrat introuvable', id => prisma.contract.findUnique({ where: { id }, select: { id: true, companyId: true } }))
      if (contract === null) return
      if (contract && !ensureCompanyMatch(res, contract.companyId, body.companyId, 'CONTRACT_COMPANY_MISMATCH', 'Ce contrat appartient à une autre entreprise')) return
    }
    if (body.productId) {
      if (!await ensureExists(res, body.productId, 'PRODUCT_NOT_FOUND', 'Produit introuvable', id => prisma.product.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const equipment = await prisma.equipment.create({
      data: data as Parameters<typeof prisma.equipment.create>[0]['data'],
      include: {
        company: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, reference: true } },
      },
    })
    res.status(201).json({ success: true, data: equipment })
  } catch (err) { handleRouteError(err, res) }
})

router.get('/:id', requirePermission('equipment:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const equipment = await prisma.equipment.findUnique({
      where: { id: req.params.id },
      include: {
        company: true,
        contract: true,
        tickets: { orderBy: { createdAt: 'desc' }, take: 10 },
        licenses: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!equipment) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Équipement introuvable' } }); return }
    res.json({ success: true, data: equipment })
  } catch (err) { handleRouteError(err, res) }
})

router.put('/:id', requirePermission('equipment:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = equipmentSchema.partial().parse(req.body)
    const refError = await checkReferences([
      { domain: 'equipment_type', value: body.type },
      { domain: 'equipment_status', value: body.status },
    ])
    if (refError) { res.status(400).json({ success: false, error: { code: 'INVALID_REFERENCE', message: refError } }); return }
    const current = await prisma.equipment.findUnique({ where: { id: req.params.id } })
    if (!current) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Équipement introuvable' } }); return }

    const data: Record<string, unknown> = { ...body }
    if (body.purchaseDate) data.purchaseDate = new Date(body.purchaseDate)
    if (body.warrantyExpiry) data.warrantyExpiry = new Date(body.warrantyExpiry)
    // FK optionnelles : une chaîne vide signifie « retirer le lien » → NULL
    if (body.productId === '') data.productId = null
    if (body.contractId === '') data.contractId = null

    // companyId « effectif » = celui du body s'il est fourni, sinon celui déjà en base
    const effectiveCompanyId = body.companyId !== undefined ? body.companyId : current.companyId
    if (body.companyId !== undefined) {
      if (!await ensureExists(res, body.companyId, 'COMPANY_NOT_FOUND', 'Entreprise introuvable', id => prisma.company.findUnique({ where: { id }, select: { id: true } }))) return
    }
    // Re-vérifié même si contractId n'a pas changé : un changement de companyId seul
    // doit rester cohérent avec le contrat déjà lié.
    const effectiveContractId = body.contractId !== undefined ? (body.contractId || null) : current.contractId
    if (effectiveContractId) {
      const contract = await fetchOrFail(res, effectiveContractId, 'CONTRACT_NOT_FOUND', 'Contrat introuvable', id => prisma.contract.findUnique({ where: { id }, select: { id: true, companyId: true } }))
      if (contract === null) return
      if (contract && !ensureCompanyMatch(res, contract.companyId, effectiveCompanyId, 'CONTRACT_COMPANY_MISMATCH', 'Ce contrat appartient à une autre entreprise')) return
    }
    if (body.productId !== undefined) {
      if (!await ensureExists(res, body.productId, 'PRODUCT_NOT_FOUND', 'Produit introuvable', id => prisma.product.findUnique({ where: { id }, select: { id: true } }))) return
    }

    const equipment = await prisma.equipment.update({
      where: { id: req.params.id },
      data: data as Parameters<typeof prisma.equipment.update>[0]['data'],
      include: {
        company: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, reference: true } },
      },
    })
    res.json({ success: true, data: equipment })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/:id', requirePermission('equipment:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.equipment.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: { message: 'Équipement supprimé' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
