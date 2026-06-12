import { Router, Response, Request } from 'express'
import { z } from 'zod'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import prisma from '../prisma/client'
import { authenticate, requirePermission, AuthRequest } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { ciContains } from '../lib/query'
import { normalizePhone } from '../lib/phone'

const router = Router()

// ─── Upload multer ───────────────────────────────────────
const uploadsDir = path.join(process.cwd(), 'uploads', 'recordings')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
  'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/webm',
])
const ALLOWED_AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm'])

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  },
})

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()
  if (ALLOWED_AUDIO_MIMES.has(file.mimetype) && ALLOWED_AUDIO_EXTS.has(ext)) {
    cb(null, true)
  } else {
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'recording')
    ;(err as unknown as Record<string, string>)['customCode'] = 'INVALID_FILE_TYPE'
    cb(err)
  }
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } })

// ─── Helper Content-Type audio selon extension ───────────
function audioContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.webm': 'audio/webm',
  }
  return map[ext] ?? 'audio/mpeg'
}

// ─── Webhook VoIP (public, protégé par secret) ──────────
const webhookSchema = z.object({
  call_id:         z.string().optional(),
  direction:       z.enum(['INBOUND', 'OUTBOUND']).optional(),
  status:          z.enum(['ANSWERED', 'MISSED', 'VOICEMAIL', 'IN_PROGRESS']).optional(),
  caller_number:   z.string(),
  caller_name:     z.string().optional(),
  receiver_number: z.string().optional(),
  started_at:      z.string().optional(),
  answered_at:     z.string().optional(),
  ended_at:        z.string().optional(),
  duration:        z.number().optional(),
  recording_url:   z.string().url().optional(),
})

router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  // ── Vérification du secret webhook ──────────────────────
  const webhookSecret = process.env.VOIP_WEBHOOK_SECRET
  if (!webhookSecret) {
    res.status(503).json({ success: false, error: { code: 'WEBHOOK_DISABLED', message: 'Webhook VoIP non configuré' } })
    return
  }
  const provided = req.headers['x-webhook-secret'] as string | undefined
  if (!provided) {
    res.status(401).json({ success: false, error: { code: 'INVALID_WEBHOOK_SECRET', message: 'Secret webhook manquant' } })
    return
  }
  // Comparaison en temps constant (longueurs normalisées pour éviter les timing leaks)
  const secretBuf   = Buffer.from(webhookSecret)
  const providedBuf = Buffer.alloc(secretBuf.length)
  providedBuf.write(provided)
  const match = secretBuf.length === Buffer.from(provided).length &&
    crypto.timingSafeEqual(secretBuf, Buffer.from(provided))
  if (!match) {
    res.status(401).json({ success: false, error: { code: 'INVALID_WEBHOOK_SECRET', message: 'Secret webhook invalide' } })
    return
  }

  try {
    const body = webhookSchema.parse(req.body)

    // Validation https sur recording_url
    if (body.recording_url) {
      try {
        const url = new URL(body.recording_url)
        if (url.protocol !== 'https:') {
          res.status(400).json({ success: false, error: { code: 'INVALID_RECORDING_URL', message: 'recording_url doit utiliser le protocole https' } })
          return
        }
      } catch {
        res.status(400).json({ success: false, error: { code: 'INVALID_RECORDING_URL', message: 'recording_url invalide' } })
        return
      }
    }
    // Auto-detect caller from contacts via les champs pré-normalisés (égalité stricte)
    const norm = normalizePhone(body.caller_number)
    const contact = (norm && norm.length >= 6)
      ? await prisma.contact.findFirst({
          where: {
            OR: [
              { phoneNormalized:  norm },
              { mobileNormalized: norm },
            ],
          },
          select: { id: true, companyId: true },
        })
      : null

    // Dedup: si externalId déjà connu, mettre à jour plutôt que créer
    const data = {
      direction:     body.direction     ?? 'INBOUND',
      status:        body.status        ?? 'ANSWERED',
      callerNumber:  body.caller_number,
      callerName:    body.caller_name,
      receiverNumber: body.receiver_number,
      startedAt:     body.started_at  ? new Date(body.started_at)  : new Date(),
      answeredAt:    body.answered_at ? new Date(body.answered_at) : undefined,
      endedAt:       body.ended_at    ? new Date(body.ended_at)    : undefined,
      duration:      body.duration,
      recordingUrl:  body.recording_url,
      contactId:     contact?.id,
      companyId:     contact?.companyId ?? undefined,
    }

    let call
    if (body.call_id) {
      call = await prisma.call.upsert({
        where: { externalId: body.call_id },
        create: { ...data, externalId: body.call_id },
        update: data,
      })
    } else {
      call = await prisma.call.create({ data })
    }

    res.json({ success: true, data: call })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Auth sur toutes les routes suivantes ────────────────
router.use(authenticate)

// ─── Liste ───────────────────────────────────────────────
router.get('/', requirePermission('calls:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, status, direction, category, assignedToId, companyId, contactId, dateFrom, dateTo, page, limit } = req.query as Record<string, string>
    const pageNum  = Math.max(1, parseInt(page)  || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 25))

    const where: Record<string, unknown> = {}
    if (status)      where.status      = status
    if (direction)   where.direction   = direction
    if (category)    where.category    = category
    if (assignedToId) where.assignedToId = assignedToId
    if (companyId)   where.companyId   = companyId
    if (contactId)   where.contactId   = contactId
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {}
      if (dateFrom) dateFilter.gte = new Date(dateFrom)
      if (dateTo)   dateFilter.lte = new Date(dateTo + 'T23:59:59')
      where.startedAt = dateFilter
    }
    if (search) {
      where.OR = [
        { callerNumber: ciContains(search) },
        { callerName:   ciContains(search) },
        { notes:        ciContains(search) },
        { contact: { OR: [{ firstName: ciContains(search) }, { lastName: ciContains(search) }] } },
        { company: { name: ciContains(search) } },
      ]
    }

    const [total, calls] = await Promise.all([
      prisma.call.count({ where }),
      prisma.call.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        orderBy: { startedAt: 'desc' },
        include: {
          contact:    { select: { id: true, firstName: true, lastName: true } },
          company:    { select: { id: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          _count:     { select: { tickets: true } },
        },
      }),
    ])

    res.json({ success: true, data: calls, meta: { total, page: pageNum, limit: limitNum } })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Détail ───────────────────────────────────────────────
router.get('/:id', requirePermission('calls:read'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const call = await prisma.call.findUnique({
      where: { id: req.params.id },
      include: {
        contact:    { select: { id: true, firstName: true, lastName: true, phone: true, mobile: true } },
        company:    { select: { id: true, name: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        tickets:    { select: { id: true, reference: true, title: true, status: true, priority: true } },
      },
    })
    if (!call) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Appel introuvable' } })
      return
    }
    res.json({ success: true, data: call })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Schéma création/mise à jour ─────────────────────────
const callSchema = z.object({
  direction:      z.enum(['INBOUND', 'OUTBOUND']).optional(),
  status:         z.enum(['ANSWERED', 'MISSED', 'VOICEMAIL', 'IN_PROGRESS']).optional(),
  callerNumber:   z.string().min(1),
  callerName:     z.string().optional(),
  receiverNumber: z.string().optional(),
  startedAt:      z.string().optional(),
  answeredAt:     z.string().optional(),
  endedAt:        z.string().optional(),
  duration:       z.number().optional(),
  category:       z.string().optional(),
  priority:       z.string().optional(),
  notes:          z.string().optional(),
  isHandled:      z.boolean().optional(),
  contactId:      z.string().optional(),
  companyId:      z.string().optional(),
  assignedToId:   z.string().optional(),
})

// ─── Création manuelle ───────────────────────────────────
router.post('/', requirePermission('calls:create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = callSchema.parse(req.body)
    const call = await prisma.call.create({
      data: {
        direction:      body.direction     ?? 'INBOUND',
        status:         body.status        ?? 'ANSWERED',
        callerNumber:   body.callerNumber,
        callerName:     body.callerName,
        receiverNumber: body.receiverNumber,
        startedAt:      body.startedAt  ? new Date(body.startedAt)  : new Date(),
        answeredAt:     body.answeredAt ? new Date(body.answeredAt) : undefined,
        endedAt:        body.endedAt    ? new Date(body.endedAt)    : undefined,
        duration:       body.duration,
        category:       body.category,
        priority:       body.priority   ?? 'NORMAL',
        notes:          body.notes,
        contactId:      body.contactId  || undefined,
        companyId:      body.companyId  || undefined,
        assignedToId:   body.assignedToId || undefined,
      },
      include: {
        contact:    { select: { id: true, firstName: true, lastName: true } },
        company:    { select: { id: true, name: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    })
    res.status(201).json({ success: true, data: call })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Mise à jour ─────────────────────────────────────────
router.put('/:id', requirePermission('calls:update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = callSchema.partial().parse(req.body)
    const call = await prisma.call.update({
      where: { id: req.params.id },
      data: {
        ...body,
        startedAt:    body.startedAt  !== undefined ? new Date(body.startedAt)  : undefined,
        answeredAt:   body.answeredAt !== undefined ? (body.answeredAt ? new Date(body.answeredAt) : null) : undefined,
        endedAt:      body.endedAt    !== undefined ? (body.endedAt    ? new Date(body.endedAt)    : null) : undefined,
        contactId:    body.contactId  !== undefined ? (body.contactId  || null) : undefined,
        companyId:    body.companyId  !== undefined ? (body.companyId  || null) : undefined,
        assignedToId: body.assignedToId !== undefined ? (body.assignedToId || null) : undefined,
      },
      include: {
        contact:    { select: { id: true, firstName: true, lastName: true } },
        company:    { select: { id: true, name: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        tickets:    { select: { id: true, reference: true, title: true, status: true, priority: true } },
      },
    })
    res.json({ success: true, data: call })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Suppression ─────────────────────────────────────────
router.delete('/:id', requirePermission('calls:delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const call = await prisma.call.findUnique({ where: { id: req.params.id } })
    if (!call) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Appel introuvable' } })
      return
    }
    if (call.recordingPath && fs.existsSync(call.recordingPath)) {
      fs.unlinkSync(call.recordingPath)
    }
    await prisma.call.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { handleRouteError(err, res) }
})

// ─── Upload enregistrement ───────────────────────────────
router.post('/:id/recording', requirePermission('calls:listen'), (req: AuthRequest, res: Response): void => {
  upload.single('recording')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        const customCode = (err as unknown as Record<string, string>)['customCode']
        if (customCode === 'INVALID_FILE_TYPE') {
          res.status(400).json({ success: false, error: { code: 'INVALID_FILE_TYPE', message: 'Type de fichier non autorisé (audio uniquement)' } })
          return
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ success: false, error: { code: 'FILE_TOO_LARGE', message: 'Fichier trop volumineux (max 50 Mo)' } })
          return
        }
      }
      res.status(400).json({ success: false, error: { code: 'UPLOAD_ERROR', message: 'Erreur lors de l\'upload' } })
      return
    }
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'Aucun fichier envoyé' } })
        return
      }
      const existing = await prisma.call.findUnique({ where: { id: req.params.id } })
      if (existing?.recordingPath && fs.existsSync(existing.recordingPath)) {
        fs.unlinkSync(existing.recordingPath)
      }
      const call = await prisma.call.update({
        where: { id: req.params.id },
        data: { recordingPath: req.file.path },
      })
      res.json({ success: true, data: call })
    } catch (err) { handleRouteError(err, res) }
  })
})

// ─── Streaming enregistrement (authentifié) ──────────────
router.get('/:id/recording/stream', requirePermission('calls:listen'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const call = await prisma.call.findUnique({ where: { id: req.params.id }, select: { recordingPath: true, recordingUrl: true } })
    if (!call) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Appel introuvable' } })
      return
    }
    if (call.recordingPath && fs.existsSync(call.recordingPath)) {
      const stat = fs.statSync(call.recordingPath)
      const contentType = audioContentType(call.recordingPath)
      const range = req.headers.range
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end   = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
        const chunkSize = end - start + 1
        res.writeHead(206, {
          'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges':  'bytes',
          'Content-Length': chunkSize,
          'Content-Type':   contentType,
        })
        fs.createReadStream(call.recordingPath, { start, end }).pipe(res)
      } else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType })
        fs.createReadStream(call.recordingPath).pipe(res)
      }
      return
    }
    if (call.recordingUrl) {
      // Vérification https avant redirection
      try {
        const url = new URL(call.recordingUrl)
        if (url.protocol !== 'https:') {
          res.status(404).json({ success: false, error: { code: 'NO_RECORDING', message: 'Aucun enregistrement disponible' } })
          return
        }
      } catch {
        res.status(404).json({ success: false, error: { code: 'NO_RECORDING', message: 'Aucun enregistrement disponible' } })
        return
      }
      res.redirect(call.recordingUrl)
      return
    }
    res.status(404).json({ success: false, error: { code: 'NO_RECORDING', message: 'Aucun enregistrement disponible' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
