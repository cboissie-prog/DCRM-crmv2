import { Router, Response } from 'express'
import prisma from '../prisma/client'
import { authenticate, AuthRequest } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { ciContains } from '../lib/query'

const router = Router()
router.use(authenticate)

// GET /api/search?q=...
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const q = (req.query.q as string || '').trim()
    if (q.length < 2) {
      res.json({ success: true, data: { contacts: [], companies: [], tickets: [], opportunities: [] } })
      return
    }

    const [contacts, companies, tickets, opportunities] = await Promise.all([
      prisma.contact.findMany({
        where: {
          isActive: true,
          OR: [
            { firstName: ciContains(q) },
            { lastName: ciContains(q) },
            { email: ciContains(q) },
            { phone: ciContains(q) },
          ],
        },
        include: { company: { select: { name: true } } },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.company.findMany({
        where: {
          isActive: true,
          OR: [
            { name: ciContains(q) },
            { siret: ciContains(q) },
            { vatNumber: ciContains(q) },
            { city: ciContains(q) },
          ],
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.ticket.findMany({
        where: {
          OR: [
            { title: ciContains(q) },
            { reference: ciContains(q) },
            { description: ciContains(q) },
          ],
        },
        include: { company: { select: { name: true } } },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.opportunity.findMany({
        where: {
          OR: [
            { title: ciContains(q) },
            { company: { name: ciContains(q) } },
          ],
        },
        include: { company: { select: { name: true } } },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
    ])

    res.json({
      success: true,
      data: {
        contacts: contacts.map(c => ({
          id: c.id,
          label: `${c.firstName} ${c.lastName}`,
          sub: c.company?.name ?? c.email ?? '',
          link: `/contacts/${c.id}`,
          type: 'contact',
        })),
        companies: companies.map(c => ({
          id: c.id,
          label: c.name,
          sub: [c.city, c.sector].filter(Boolean).join(' · '),
          link: `/companies/${c.id}`,
          type: 'company',
        })),
        tickets: tickets.map(t => ({
          id: t.id,
          label: t.title,
          sub: [t.reference, t.company?.name].filter(Boolean).join(' · '),
          link: `/tickets/${t.id}`,
          type: 'ticket',
        })),
        opportunities: opportunities.map(o => ({
          id: o.id,
          label: o.title,
          sub: o.company?.name ?? '',
          link: `/pipeline`,
          type: 'opportunity',
        })),
      },
    })
  } catch (err) { handleRouteError(err, res) }
})

export default router
