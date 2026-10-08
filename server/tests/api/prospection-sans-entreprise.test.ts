/**
 * prospection-sans-entreprise.test.ts — un prospect peut être un particulier (société en création) :
 * l'import accepte une ligne sans entreprise si un contact est renseigné.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()
let token: string

describe('Import de prospects sans entreprise', () => {
  beforeAll(async () => { token = (await loginAs(app, 'admin@crm.local', 'test-admin-pwd-123')).accessToken })
  afterAll(async () => {
    const contacts = await prisma.contact.findMany({ where: { lastName: { contains: 'SansSociete' } }, select: { id: true } })
    await prisma.opportunity.deleteMany({ where: { contactId: { in: contacts.map(c => c.id) } } })
    await prisma.contact.deleteMany({ where: { id: { in: contacts.map(c => c.id) } } })
    await prisma.$disconnect()
  })

  it('crée contact + opportunité quand seule la personne est connue', async () => {
    const res = await request(app).post('/api/pipeline/opportunities/import/csv').set('Authorization', `Bearer ${token}`)
      .send({ rows: [{ firstName: 'Léa', lastName: 'SansSociete', phone: '0601020304' }] })
    expect(res.status).toBe(200)
    expect(res.body.data.created).toEqual({ companies: 0, contacts: 1, opportunities: 1 })
    expect(res.body.data.errors).toEqual([])
    const opp = await prisma.opportunity.findFirst({ where: { contact: { lastName: 'SansSociete' } } })
    expect(opp?.companyId).toBeNull()
    expect(opp?.title).toBe('Léa SansSociete')
  })

  it('éclate une colonne « nom complet » en prénom + nom', async () => {
    const res = await request(app).post('/api/pipeline/opportunities/import/csv').set('Authorization', `Bearer ${token}`)
      .send({ rows: [{ fullName: 'Jean-Pierre De La Tour SansSociete', phone: '0600000001' }] })
    expect(res.status).toBe(200)
    expect(res.body.data.created.contacts).toBe(1)
    const contact = await prisma.contact.findFirst({ where: { lastName: 'De La Tour SansSociete' } })
    expect(contact?.firstName).toBe('Jean-Pierre')
  })

  it('ignore le doublon par contact et refuse une ligne sans entreprise ni contact', async () => {
    const res = await request(app).post('/api/pipeline/opportunities/import/csv').set('Authorization', `Bearer ${token}`)
      .send({ rows: [{ firstName: 'Léa', lastName: 'SansSociete' }, { phone: '0600000000' }] })
    expect(res.status).toBe(200)
    expect(res.body.data.created.opportunities).toBe(0)
    expect(res.body.data.skipped).toBe(1)
    expect(res.body.data.errors).toEqual([{ row: 1, reason: 'Entreprise ou contact manquant' }])
  })
})
