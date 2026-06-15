import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { ciContains } from '../lib/query'
import { csvEscape } from '../lib/csv'
import { geocodeAddress, buildAddressQuery, sleep } from '../lib/geocode'
import logger from '../lib/logger'

const router = Router()
router.use(authenticate)

const companySchema = z.object({
  name: z.string().min(1),
  siret: z.string().optional(),
  vatNumber: z.string().optional(),
  website: z.string().optional(),
  sector: z.string().optional(),
  employees: z.number().int().optional(),
  annualRevenue: z.number().optional(),
  billingAddress: z.string().optional(),
  shippingAddress: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
})

const COMPANY_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'name', 'city', 'sector', 'employees', 'annualRevenue'])

router.get('/', requirePermission('companies:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, sector, page, limit, sortBy, sortOrder } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25))
    const validSortBy = COMPANY_SORT_FIELDS.has(sortBy) ? sortBy : 'createdAt'
    const validSortOrder = sortOrder === 'asc' ? 'asc' : 'desc'
    const skip = (pageNum - 1) * limitNum
    const where: Record<string, unknown> = { isActive: true }
    if (sector) where.sector = sector
    if (search) where.OR = [
      { name: ciContains(search) },
      { siret: ciContains(search) },
      { city: ciContains(search) },
    ]
    const [total, companies] = await Promise.all([
      prisma.company.count({ where }),
      prisma.company.findMany({
        where, skip, take: limitNum,
        orderBy: { [validSortBy]: validSortOrder },
        include: {
          _count: { select: { contacts: true, tickets: true, contracts: true, opportunities: true } },
        },
      }),
    ])
    res.json({ success: true, data: companies, meta: { total, page: pageNum, limit: limitNum } })
  } catch (err) { handleRouteError(err, res) }
})

router.post('/', requirePermission('companies:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = companySchema.parse(req.body)
    // Géocodage auto : si aucune coordonnée n'est fournie mais qu'une adresse l'est,
    // on déduit lat/lng depuis l'adresse (sans bloquer la création en cas d'échec).
    if (body.lat === undefined && body.lng === undefined && buildAddressQuery(body)) {
      const geo = await geocodeAddress(body)
      if (geo) { body.lat = geo.lat; body.lng = geo.lng }
    }
    const company = await prisma.company.create({ data: body })
    res.status(201).json({ success: true, data: company })
  } catch (err) { handleRouteError(err, res) }
})

// POST /companies/import/csv
router.post('/import/csv', requirePermission('companies:import'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows } = z.object({ rows: z.array(z.record(z.string())) }).parse(req.body)
    if (rows.length === 0) { res.status(400).json({ success: false, error: { code: 'EMPTY', message: 'Aucune ligne à importer' } }); return }
    if (rows.length > 500) { res.status(400).json({ success: false, error: { code: 'TOO_MANY', message: 'Maximum 500 lignes par import' } }); return }

    // Parse et déduplique dans le CSV lui-même
    const candidates = new Map<string, Record<string, string>>()
    let skipped = 0
    for (const row of rows) {
      const name = (row['Nom'] || row['Raison sociale'] || row['Company'] || row['Name'])?.trim()
      if (!name) { skipped++; continue }
      if (!candidates.has(name)) candidates.set(name, row)
      else skipped++ // doublon dans le fichier
    }

    // Déduplication batch contre la DB (1 requête)
    const names = [...candidates.keys()]
    const existing = await prisma.company.findMany({ where: { name: { in: names } }, select: { name: true } })
    const existingNames = new Set(existing.map(c => c.name))

    const toCreate = names
      .filter(name => !existingNames.has(name))
      .map(name => {
        const row = candidates.get(name)!
        return {
          name,
          siret: row['SIRET']?.trim() || undefined,
          vatNumber: row['N° TVA']?.trim() || undefined,
          website: row['Site web']?.trim() || undefined,
          sector: row['Secteur']?.trim() || undefined,
          city: row['Ville']?.trim() || undefined,
          postalCode: row['Code postal']?.trim() || undefined,
          billingAddress: row['Adresse']?.trim() || undefined,
          notes: row['Notes']?.trim() || undefined,
        }
      })

    skipped += existingNames.size

    // 1 seule requête d'insertion pour tout le batch
    await prisma.company.createMany({ data: toCreate })

    res.json({ success: true, data: { created: toCreate.length, skipped, total: rows.length } })
  } catch (err) { handleRouteError(err, res) }
})

// GET /companies/export/csv
router.get('/export/csv', requirePermission('companies:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, sector } = req.query as Record<string, string>
    const where: Record<string, unknown> = { isActive: true }
    if (sector) where.sector = sector
    if (search) where.OR = [
      { name: ciContains(search) },
      { city: ciContains(search) },
    ]
    const companies = await prisma.company.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: true, tickets: true, contracts: true } } },
    })
    const header = ['Nom', 'Secteur', 'Ville', 'Code postal', 'SIRET', 'CA annuel', 'Effectif', 'Contacts', 'Tickets', 'Contrats', 'Créé le']
    const rows = companies.map(c => [
      csvEscape(c.name), csvEscape(c.sector), csvEscape(c.city), csvEscape(c.postalCode),
      csvEscape(c.siret), csvEscape(c.annualRevenue), csvEscape(c.employees),
      csvEscape(c._count.contacts), csvEscape(c._count.tickets), csvEscape(c._count.contracts),
      csvEscape(new Date(c.createdAt).toLocaleDateString('fr-FR')),
    ].join(','))
    const csv = [header.join(','), ...rows].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="entreprises-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send('﻿' + csv)
  } catch (err) { handleRouteError(err, res) }
})

router.get('/:id', requirePermission('companies:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: {
        contacts: { where: { isActive: true } },
        opportunities: { orderBy: { createdAt: 'desc' }, take: 10 },
        tickets: { orderBy: { createdAt: 'desc' }, take: 10 },
        contracts: { orderBy: { createdAt: 'desc' } },
        equipments: { orderBy: { createdAt: 'desc' } },
        licenses: { orderBy: { createdAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 20 },
        npsResponses: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!company) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entreprise introuvable' } }); return }
    res.json({ success: true, data: company })
  } catch (err) { handleRouteError(err, res) }
})

const ADDRESS_FIELDS = ['billingAddress', 'city', 'postalCode', 'country'] as const

router.put('/:id', requirePermission('companies:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = companySchema.partial().parse(req.body)
    // Re-géocodage si un champ d'adresse est modifié et que des coordonnées ne sont pas fournies
    // explicitement — uniquement quand l'adresse a réellement changé ou que les coords manquent encore.
    const addressInPayload = ADDRESS_FIELDS.some(f => f in body)
    if (addressInPayload && body.lat === undefined && body.lng === undefined) {
      const existing = await prisma.company.findUnique({
        where: { id: req.params.id },
        select: { billingAddress: true, city: true, postalCode: true, country: true, lat: true, lng: true },
      })
      if (existing) {
        const merged = {
          billingAddress: body.billingAddress ?? existing.billingAddress,
          city:           body.city           ?? existing.city,
          postalCode:     body.postalCode     ?? existing.postalCode,
          country:        body.country        ?? existing.country,
        }
        const newQuery = buildAddressQuery(merged)
        if (newQuery && (newQuery !== buildAddressQuery(existing) || existing.lat == null || existing.lng == null)) {
          const geo = await geocodeAddress(merged)
          if (geo) { body.lat = geo.lat; body.lng = geo.lng }
        }
      }
    }
    const company = await prisma.company.update({ where: { id: req.params.id }, data: body })
    res.json({ success: true, data: company })
  } catch (err) { handleRouteError(err, res) }
})

router.delete('/:id', requirePermission('companies:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.company.update({ where: { id: req.params.id }, data: { isActive: false } })
    res.json({ success: true, data: { message: 'Entreprise supprimée' } })
  } catch (err) { handleRouteError(err, res) }
})

// GET /companies/map - données pour la carte
router.get('/data/map', requirePermission('companies:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const companies = await prisma.company.findMany({
      where: { isActive: true, lat: { not: null }, lng: { not: null } },
      select: { id: true, name: true, city: true, lat: true, lng: true, sector: true,
        _count: { select: { contacts: true, tickets: true } } },
    })
    res.json({ success: true, data: companies })
  } catch (err) { handleRouteError(err, res) }
})

// Garde anti-concurrence : un seul backfill de géocodage à la fois (limite Nominatim 1 req/s)
let geocodeBackfillRunning = false

// POST /companies/data/geocode-missing — géocode en arrière-plan les entreprises ayant une
// adresse mais pas (ou plus) de coordonnées. Répond immédiatement ; le travail se poursuit en fond.
router.post('/data/geocode-missing', requirePermission('companies:update'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targets = await prisma.company.findMany({
      where: { isActive: true, OR: [{ lat: null }, { lng: null }] },
      select: { id: true, billingAddress: true, city: true, postalCode: true, country: true },
    })
    // Ne garder que les entreprises ayant une adresse exploitable
    const geocodable = targets.filter(c => buildAddressQuery(c))

    if (geocodeBackfillRunning) {
      res.json({ success: true, data: { started: false, alreadyRunning: true, pending: geocodable.length } })
      return
    }
    if (geocodable.length === 0) {
      res.json({ success: true, data: { started: false, pending: 0 } })
      return
    }

    geocodeBackfillRunning = true
    res.json({ success: true, data: { started: true, pending: geocodable.length } })

    // Traitement séquentiel en arrière-plan, ~1,1 s entre chaque appel (politique Nominatim : max 1 req/s)
    setImmediate(async () => {
      let done = 0
      try {
        for (const c of geocodable) {
          const geo = await geocodeAddress(c)
          if (geo) {
            await prisma.company.update({ where: { id: c.id }, data: { lat: geo.lat, lng: geo.lng } }).catch(() => {})
            done++
          }
          await sleep(1100)
        }
        logger.info({ done, total: geocodable.length }, '[GEOCODE] Backfill terminé')
      } catch (err) {
        logger.error({ err }, '[GEOCODE] Erreur pendant le backfill')
      } finally {
        geocodeBackfillRunning = false
      }
    })
  } catch (err) { handleRouteError(err, res) }
})

export default router
