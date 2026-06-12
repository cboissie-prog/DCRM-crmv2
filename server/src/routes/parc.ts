import { Router, Response } from 'express'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'

const router = Router()
router.use(authenticate)

const ALERT_DAYS = 60 // jours avant expiration = alerte

// ── GET /parc/overview ─────────────────────────────────────────────────────────
// Retourne les entreprises ayant au moins un équipement, une licence ou un contrat,
// avec les compteurs et le nombre d'alertes actives.

router.get('/overview', requirePermission('equipment:read'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const alertThreshold = new Date()
    alertThreshold.setDate(alertThreshold.getDate() + ALERT_DAYS)

    const companies = await prisma.company.findMany({
      where: {
        isActive: true,
        OR: [
          { equipments: { some: {} } },
          { licenses: { some: {} } },
          { contracts: { some: {} } },
        ],
      },
      include: {
        _count: { select: { equipments: true, licenses: true, contracts: true } },
        equipments: {
          where: { status: 'ACTIVE' },
          select: { warrantyExpiry: true, status: true },
        },
        licenses: {
          select: { expiryDate: true },
        },
        contracts: {
          select: { status: true, endDate: true },
        },
      },
      orderBy: { name: 'asc' },
    })

    const data = companies.map(company => {
      const now = new Date()

      const warrantyExpired = company.equipments.filter(
        e => e.warrantyExpiry && new Date(e.warrantyExpiry) < now
      ).length

      const warrantyExpiring = company.equipments.filter(
        e => e.warrantyExpiry
          && new Date(e.warrantyExpiry) >= now
          && new Date(e.warrantyExpiry) <= alertThreshold
      ).length

      const licenseExpired = company.licenses.filter(
        l => l.expiryDate && new Date(l.expiryDate) < now
      ).length

      const licenseExpiring = company.licenses.filter(
        l => l.expiryDate
          && new Date(l.expiryDate) >= now
          && new Date(l.expiryDate) <= alertThreshold
      ).length

      const activeContracts = company.contracts.filter(c => c.status === 'ACTIVE').length

      return {
        id: company.id,
        name: company.name,
        city: company.city,
        sector: company.sector,
        equipmentCount: company._count.equipments,
        licenseCount: company._count.licenses,
        contractCount: company._count.contracts,
        activeContracts,
        warrantyExpired,
        warrantyExpiring,
        licenseExpired,
        licenseExpiring,
        alertCount: warrantyExpired + warrantyExpiring + licenseExpired + licenseExpiring,
      }
    })

    // Companies with alerts first, then alphabetically
    data.sort((a, b) => {
      if (b.alertCount !== a.alertCount) return b.alertCount - a.alertCount
      return a.name.localeCompare(b.name, 'fr')
    })

    res.json({ success: true, data })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

export default router
