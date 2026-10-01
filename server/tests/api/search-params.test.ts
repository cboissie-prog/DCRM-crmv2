/**
 * search-params.test.ts — paramètre `search` sur GET /equipment et GET /contracts
 * (alimente le composant EntityPicker : recherche serveur à la frappe).
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
const equipmentIds: string[] = []
const productIds: string[] = []
const contractIds: string[] = []

describe('Recherche serveur (?search=) équipements et contrats', () => {
  beforeAll(async () => {
    token = (await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)).accessToken
    const company = await prisma.company.create({ data: { name: 'Société test recherche' } })
    companyId = company.id

    const eq1 = await prisma.equipment.create({ data: { companyId, type: 'DESKTOP', brand: 'Dell', model: 'OptiPlex Zebra', serialNumber: 'SN-ZQX-001' } })
    const eq2 = await prisma.equipment.create({ data: { companyId, type: 'LAPTOP', brand: 'Lenovo', model: 'ThinkPad', serialNumber: 'SN-ABC-002' } })
    equipmentIds.push(eq1.id, eq2.id)

    for (const title of ['Maintenance caisses Zebra', 'Hébergement site vitrine']) {
      const res = await request(app)
        .post('/api/contracts')
        .set('Authorization', `Bearer ${token}`)
        .send({ companyId, type: 'IT_MAINTENANCE', title, startDate: '2026-01-01', endDate: '2026-12-31' })
      expect(res.status).toBe(201)
      contractIds.push(res.body.data.id)
    }
  })

  afterAll(async () => {
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } })
    if (contractIds.length) await prisma.contract.deleteMany({ where: { id: { in: contractIds } } })
    if (equipmentIds.length) await prisma.equipment.deleteMany({ where: { id: { in: equipmentIds } } })
    if (companyId) await prisma.company.delete({ where: { id: companyId } })
    await prisma.$disconnect()
  })

  it('GET /equipment?search= filtre sur le modèle, insensible à la casse', async () => {
    const res = await request(app).get('/api/equipment').query({ search: 'zebra', companyId }).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.map((e: { model: string }) => e.model)).toEqual(['OptiPlex Zebra'])
  })

  it('GET /equipment?search= filtre sur le numéro de série et la marque', async () => {
    const bySerial = await request(app).get('/api/equipment').query({ search: 'abc-002', companyId }).set('Authorization', `Bearer ${token}`)
    expect(bySerial.body.data).toHaveLength(1)
    expect(bySerial.body.data[0].serialNumber).toBe('SN-ABC-002')

    const byBrand = await request(app).get('/api/equipment').query({ search: 'LENOVO', companyId }).set('Authorization', `Bearer ${token}`)
    expect(byBrand.body.data.map((e: { id: string }) => e.id)).toEqual([equipmentIds[1]])
  })

  it('GET /equipment sans search renvoie tout, search sans correspondance renvoie vide', async () => {
    const all = await request(app).get('/api/equipment').query({ companyId }).set('Authorization', `Bearer ${token}`)
    expect(all.body.data).toHaveLength(2)
    const none = await request(app).get('/api/equipment').query({ search: 'introuvable-xyz', companyId }).set('Authorization', `Bearer ${token}`)
    expect(none.body.data).toHaveLength(0)
    expect(none.body.meta.total).toBe(0)
  })

  it('GET /contracts?search= filtre sur le titre, insensible à la casse', async () => {
    const res = await request(app).get('/api/contracts').query({ search: 'ZEBRA', companyId }).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.map((c: { title: string }) => c.title)).toEqual(['Maintenance caisses Zebra'])
  })

  it('GET /contracts?search= filtre sur la référence générée', async () => {
    const created = await prisma.contract.findUniqueOrThrow({ where: { id: contractIds[1] } })
    const res = await request(app).get('/api/contracts').query({ search: created.reference.toLowerCase(), companyId }).set('Authorization', `Bearer ${token}`)
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([contractIds[1]])
  })

  it('GET /products?category= accepte plusieurs catégories séparées par des virgules', async () => {
    const cats = ['HARDWARE', 'SOFTWARE', 'SERVICE']
    for (const category of cats) {
      const p = await prisma.product.create({ data: { name: `Produit test recherche ${category}`, category, price: 10 } })
      productIds.push(p.id)
    }
    const multi = await request(app).get('/api/products').query({ category: 'HARDWARE,SERVICE', search: 'Produit test recherche' }).set('Authorization', `Bearer ${token}`)
    expect(multi.status).toBe(200)
    expect(multi.body.data.map((p: { category: string }) => p.category).sort()).toEqual(['HARDWARE', 'SERVICE'])
    const single = await request(app).get('/api/products').query({ category: 'SOFTWARE', search: 'Produit test recherche' }).set('Authorization', `Bearer ${token}`)
    expect(single.body.data.map((p: { category: string }) => p.category)).toEqual(['SOFTWARE'])
  })

  it('GET /contracts combine search et les autres filtres (companyId, status)', async () => {
    const res = await request(app).get('/api/contracts').query({ search: 'site', companyId, status: 'ACTIVE' }).set('Authorization', `Bearer ${token}`)
    expect(res.body.data.map((c: { title: string }) => c.title)).toEqual(['Hébergement site vitrine'])
  })
})
