import { Router, Response } from 'express'
import { z } from 'zod'
import prisma from '../prisma/client'
import { authenticate, AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { ciContains } from '../lib/query'
import { csvEscape } from '../lib/csv'

const router = Router()
router.use(authenticate)

const contactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  position: z.string().optional(),
  companyId: z.string().optional(),
  source: z.string().optional(),
  status: z.string().optional(),
  tags: z.string().optional(),
  notes: z.string().optional(),
})

const CONTACT_SORT_FIELDS = new Set(['createdAt', 'updatedAt', 'firstName', 'lastName', 'email', 'status', 'source', 'leadScore'])

// GET /contacts
router.get('/', requirePermission('contacts:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, status, source, companyId, page, limit, sortBy, sortOrder } = req.query as Record<string, string>
    const pageNum = Math.max(1, parseInt(page) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25))
    const validSortBy = CONTACT_SORT_FIELDS.has(sortBy) ? sortBy : 'createdAt'
    const validSortOrder = sortOrder === 'asc' ? 'asc' : 'desc'
    const skip = (pageNum - 1) * limitNum
    const where: Record<string, unknown> = { isActive: true }
    if (status) where.status = status
    if (source) where.source = source
    if (companyId) where.companyId = companyId
    if (search) where.OR = [
      { firstName: ciContains(search) },
      { lastName: ciContains(search) },
      { email: ciContains(search) },
      { phone: ciContains(search) },
    ]
    const [total, contacts] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where, skip, take: limitNum,
        orderBy: { [validSortBy]: validSortOrder },
        include: { company: { select: { id: true, name: true } } },
      }),
    ])
    res.json({ success: true, data: contacts, meta: { total, page: pageNum, limit: limitNum } })
  } catch (err) { handleRouteError(err, res) }
})

// POST /contacts
router.post('/', requirePermission('contacts:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = contactSchema.parse(req.body)
    const contact = await prisma.contact.create({ data: body, include: { company: { select: { id: true, name: true } } } })
    res.status(201).json({ success: true, data: contact })
  } catch (err) { handleRouteError(err, res) }
})

// POST /contacts/import/csv
const importRowSchema = z.object({
  Prénom: z.string().optional(),
  Nom: z.string().optional(),
  Email: z.string().optional(),
  Téléphone: z.string().optional(),
  Mobile: z.string().optional(),
  Poste: z.string().optional(),
  Source: z.string().optional(),
  Statut: z.string().optional(),
  Entreprise: z.string().optional(),
  Notes: z.string().optional(),
})

const SOURCE_MAP: Record<string, string> = {
  'site web': 'WEBSITE', 'appel entrant': 'PHONE_INBOUND', 'email': 'EMAIL',
  'salon': 'TRADE_SHOW', 'référence': 'REFERRAL', 'prospection': 'COLD_CALL',
  'réseaux sociaux': 'SOCIAL_MEDIA',
}
const STATUS_MAP: Record<string, string> = {
  'prospect': 'PROSPECT', 'client': 'CLIENT', 'inactif': 'INACTIVE', 'perdu': 'LOST',
}

router.post('/import/csv', requirePermission('contacts:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows } = z.object({ rows: z.array(z.record(z.string())) }).parse(req.body)
    if (rows.length === 0) { res.status(400).json({ success: false, error: { code: 'EMPTY', message: 'Aucune ligne à importer' } }); return }
    if (rows.length > 500) { res.status(400).json({ success: false, error: { code: 'TOO_MANY', message: 'Maximum 500 lignes par import' } }); return }

    // Parse toutes les lignes valides en une passe
    const valid: { r: z.infer<typeof importRowSchema>; firstName: string; lastName: string }[] = []
    let skipped = 0
    for (const row of rows) {
      const parsed = importRowSchema.safeParse(row)
      if (!parsed.success) { skipped++; continue }
      const r = parsed.data
      const firstName = r.Prénom?.trim() || ''
      const lastName = r.Nom?.trim() || ''
      if (!firstName && !lastName) { skipped++; continue }
      valid.push({ r, firstName, lastName })
    }

    // Résolution batch des entreprises (1 requête pour tous les noms uniques)
    const companyNames = [...new Set(valid.map(v => v.r.Entreprise?.trim()).filter(Boolean) as string[])]
    const companies = companyNames.length > 0
      ? await prisma.company.findMany({ where: { name: { in: companyNames } }, select: { id: true, name: true } })
      : []
    const companyMap = new Map(companies.map(c => [c.name, c.id]))

    // Déduplication batch par email (1 requête)
    const emails = [...new Set(valid.map(v => v.r.Email?.trim()).filter(Boolean) as string[])]
    const existingEmails = emails.length > 0
      ? await prisma.contact.findMany({ where: { email: { in: emails } }, select: { email: true } })
      : []
    const existingEmailSet = new Set(existingEmails.map(c => c.email))

    // Prépare les données à insérer
    const toCreate = valid
      .filter(v => !v.r.Email?.trim() || !existingEmailSet.has(v.r.Email.trim()))
      .map(({ r, firstName, lastName }) => ({
        firstName: firstName || '—',
        lastName: lastName || '—',
        email: r.Email?.trim() || undefined,
        phone: r.Téléphone?.trim() || undefined,
        mobile: r.Mobile?.trim() || undefined,
        position: r.Poste?.trim() || undefined,
        notes: r.Notes?.trim() || undefined,
        source: SOURCE_MAP[r.Source?.toLowerCase() ?? ''] ?? 'OTHER',
        status: STATUS_MAP[r.Statut?.toLowerCase() ?? ''] ?? 'PROSPECT',
        companyId: r.Entreprise?.trim() ? companyMap.get(r.Entreprise.trim()) : undefined,
      }))

    skipped += valid.length - toCreate.length

    // 1 seule requête d'insertion pour tout le batch
    await prisma.contact.createMany({ data: toCreate })

    res.json({ success: true, data: { created: toCreate.length, skipped, total: rows.length } })
  } catch (err) { handleRouteError(err, res) }
})

// GET /contacts/export/csv
router.get('/export/csv', requirePermission('contacts:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, status } = req.query as Record<string, string>
    const where: Record<string, unknown> = { isActive: true }
    if (status) where.status = status
    if (search) where.OR = [
      { firstName: ciContains(search) },
      { lastName: ciContains(search) },
      { email: ciContains(search) },
    ]
    const contacts = await prisma.contact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { company: { select: { name: true } } },
    })
    const header = ['Prénom', 'Nom', 'Email', 'Téléphone', 'Mobile', 'Poste', 'Entreprise', 'Statut', 'Source', 'Score', 'Créé le']
    const rows = contacts.map(c => [
      csvEscape(c.firstName), csvEscape(c.lastName), csvEscape(c.email), csvEscape(c.phone),
      csvEscape(c.mobile), csvEscape(c.position), csvEscape(c.company?.name),
      csvEscape(c.status), csvEscape(c.source), csvEscape(c.leadScore),
      csvEscape(new Date(c.createdAt).toLocaleDateString('fr-FR')),
    ].join(','))
    const csv = [header.join(','), ...rows].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send('﻿' + csv)
  } catch (err) { handleRouteError(err, res) }
})

// GET /contacts/:id
router.get('/:id', requirePermission('contacts:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: {
        company: true,
        leads: { orderBy: { createdAt: 'desc' } },
        opportunities: { include: { company: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
        tickets: { orderBy: { createdAt: 'desc' }, take: 10 },
        activities: { orderBy: { createdAt: 'desc' }, take: 20 },
        npsResponses: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!contact) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Contact introuvable' } }); return }
    res.json({ success: true, data: contact })
  } catch (err) { handleRouteError(err, res) }
})

// PUT /contacts/:id
router.put('/:id', requirePermission('contacts:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = contactSchema.partial().parse(req.body)
    const contact = await prisma.contact.update({ where: { id: req.params.id }, data: body, include: { company: { select: { id: true, name: true } } } })
    res.json({ success: true, data: contact })
  } catch (err) { handleRouteError(err, res) }
})

// DELETE /contacts/:id (soft delete)
router.delete('/:id', requirePermission('contacts:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.contact.update({ where: { id: req.params.id }, data: { isActive: false } })
    res.json({ success: true, data: { message: 'Contact supprimé' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
