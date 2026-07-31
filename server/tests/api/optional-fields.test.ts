/**
 * optional-fields.test.ts — champs optionnels laissés vides dans les formulaires.
 *
 * Un <input type="date"> non renseigné rend "" et non undefined. Les routes construisant leur
 * payload par `const data = { ...body }` recopiaient ce "" avant la conversion gardée, qui était
 * sautée puisque "" est falsy : Prisma recevait la chaîne vide et répondait 500.
 * Une licence sans date d'expiration était donc impossible à créer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

let token: string
let companyId: string
const createdLicenseIds: string[] = []
const createdEquipmentIds: string[] = []

describe('Champs optionnels vides', () => {
  beforeAll(async () => {
    token = (await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)).accessToken
    const company = await prisma.company.create({
      data: { name: 'Société test champs optionnels' },
    })
    companyId = company.id
  })

  afterAll(async () => {
    if (createdLicenseIds.length) await prisma.license.deleteMany({ where: { id: { in: createdLicenseIds } } })
    if (createdEquipmentIds.length) await prisma.equipment.deleteMany({ where: { id: { in: createdEquipmentIds } } })
    if (companyId) await prisma.company.delete({ where: { id: companyId } })
    await prisma.$disconnect()
  })

  it('crée une licence sans date d\'expiration (dates envoyées à "")', async () => {
    const res = await request(app)
      .post('/api/licenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        software: 'Licence sans échéance',
        purchaseDate: '',
        expiryDate: '',
      })

    expect(res.status).toBe(201)
    createdLicenseIds.push(res.body.data.id)
    expect(res.body.data.expiryDate).toBeNull()
  })

  it('crée un équipement sans date d\'achat ni garantie', async () => {
    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        type: 'Poste de travail',
        purchaseDate: '',
        warrantyExpiry: '',
      })

    expect(res.status).toBe(201)
    createdEquipmentIds.push(res.body.data.id)
    expect(res.body.data.purchaseDate).toBeNull()
  })

  it('accepte toujours une date réelle', async () => {
    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        type: 'Serveur',
        purchaseDate: '2026-01-15',
      })

    expect(res.status).toBe(201)
    createdEquipmentIds.push(res.body.data.id)
    expect(res.body.data.purchaseDate).not.toBeNull()
    expect(new Date(res.body.data.purchaseDate).getUTCFullYear()).toBe(2026)
  })
})
