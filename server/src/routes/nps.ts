import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../prisma/client'
import { handleRouteError } from '../middleware/errorHandler'
import { verifyNpsToken } from '../lib/nps-token'
import { logTicketEvent, notifyUsers } from '../lib/ticket-helpers'

/**
 * Enquête de satisfaction publique (SANS authentification).
 * L'accès est protégé par un jeton HMAC signé, lié à un ticket et expirant.
 * Rate-limitée dans app.ts. Aucune donnée sensible n'est exposée : uniquement
 * la référence du ticket et son titre, nécessaires à la page de notation.
 */
const router = Router()

const scoreSchema = z.object({
  score: z.number().int().min(0).max(10),
  comment: z.string().trim().max(1000).optional(),
})

// GET /api/nps/:token — infos minimales pour afficher la page de notation
router.get('/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const ticketId = verifyNpsToken(req.params.token)
    if (!ticketId) { res.status(404).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Lien invalide ou expiré' } }); return }
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { reference: true, title: true, npsResponse: { select: { id: true } } },
    })
    if (!ticket) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket introuvable' } }); return }
    res.json({ success: true, data: { reference: ticket.reference, title: ticket.title, alreadyAnswered: !!ticket.npsResponse } })
  } catch (err) { handleRouteError(err, res) }
})

// POST /api/nps/:token — enregistre la réponse (une seule par ticket)
router.post('/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const ticketId = verifyNpsToken(req.params.token)
    if (!ticketId) { res.status(404).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Lien invalide ou expiré' } }); return }
    const { score, comment } = scoreSchema.parse(req.body)
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, reference: true, title: true, contactId: true, companyId: true, assignedToId: true },
    })
    if (!ticket) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket introuvable' } }); return }

    let response
    try {
      response = await prisma.npsResponse.create({
        data: {
          ticketId: ticket.id,
          contactId: ticket.contactId,
          companyId: ticket.companyId,
          score,
          comment: comment || null,
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        res.status(409).json({ success: false, error: { code: 'ALREADY_ANSWERED', message: 'Une réponse a déjà été enregistrée pour ce ticket' } })
        return
      }
      throw err
    }

    await logTicketEvent({ ticketId: ticket.id, type: 'NPS_RECEIVED', toValue: String(score) })
    await notifyUsers([ticket.assignedToId], {
      type: 'NPS_RECEIVED',
      title: 'Avis client reçu',
      message: `Note ${score}/10 sur ${ticket.reference} : ${ticket.title}`,
      link: `/tickets/${ticket.id}`,
    })
    res.status(201).json({ success: true, data: { score: response.score } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
