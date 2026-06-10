import { Router, Response, Request } from 'express'
import { z } from 'zod'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import prisma from '../prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'

const router = Router()

// ─── Upload multer ───────────────────────────────────────
const uploadsDir = path.join(process.cwd(), 'uploads', 'recordings')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  },
})
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } })

// ─── Webhook VoIP (public) ───────────────────────────────
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
  recording_url:   z.string().optional(),
})

router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = webhookSchema.parse(req.body)
    const normalized = body.caller_number.replace(/[\s\-.()+]/g, '')

    // Auto-detect caller from contacts
    const contact = await prisma.contact.findFirst({
      where: {
        OR: [
          { phone:  { contains: normalized } },
          { mobile: { contains: normalized } },
        ],
      },
      select: { id: true, companyId: true },
    })

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
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: e.errors[0].message } })
      return
    }
    console.error(e)
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// ─── Auth sur toutes les routes suivantes ────────────────
router.use(authenticate)

// ─── Liste ───────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
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
        { callerNumber: { contains: search } },
        { callerName:   { contains: search } },
        { notes:        { contains: search } },
        { contact: { OR: [{ firstName: { contains: search } }, { lastName: { contains: search } }] } },
        { company: { name: { contains: search } } },
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// ─── Détail ───────────────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
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
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: e.errors[0].message } })
      return
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// ─── Mise à jour ─────────────────────────────────────────
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: e.errors[0].message } })
      return
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// ─── Suppression ─────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// ─── Upload enregistrement ───────────────────────────────
router.post('/:id/recording', upload.single('recording'), async (req: AuthRequest, res: Response): Promise<void> => {
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
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

// ─── Streaming enregistrement (authentifié) ──────────────
router.get('/:id/recording/stream', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const call = await prisma.call.findUnique({ where: { id: req.params.id }, select: { recordingPath: true, recordingUrl: true } })
    if (!call) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Appel introuvable' } })
      return
    }
    if (call.recordingPath && fs.existsSync(call.recordingPath)) {
      const stat = fs.statSync(call.recordingPath)
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
          'Content-Type':   'audio/mpeg',
        })
        fs.createReadStream(call.recordingPath, { start, end }).pipe(res)
      } else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'audio/mpeg' })
        fs.createReadStream(call.recordingPath).pipe(res)
      }
      return
    }
    if (call.recordingUrl) {
      res.redirect(call.recordingUrl)
      return
    }
    res.status(404).json({ success: false, error: { code: 'NO_RECORDING', message: 'Aucun enregistrement disponible' } })
  } catch {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur serveur' } })
  }
})

export default router
