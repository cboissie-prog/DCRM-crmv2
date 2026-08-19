/**
 * references.test.ts — référentiels personnalisables (Réglages > Listes).
 *
 * Les valeurs métier (types d'équipement, catégories de tickets…) vivent dans la
 * table ReferenceValue : les routes d'entités valident les clés à l'écriture
 * (INVALID_REFERENCE), et une valeur ajoutée via l'API devient immédiatement
 * utilisable. Les valeurs système ne sont ni supprimables ni désactivables.
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
const createdEquipmentIds: string[] = []
let createdReferenceId: string | null = null

describe('Référentiels personnalisables', () => {
  beforeAll(async () => {
    token = (await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)).accessToken
    const company = await prisma.company.create({ data: { name: 'Société test références' } })
    companyId = company.id
  })

  afterAll(async () => {
    if (createdEquipmentIds.length) await prisma.equipment.deleteMany({ where: { id: { in: createdEquipmentIds } } })
    if (createdReferenceId) await prisma.referenceValue.deleteMany({ where: { id: createdReferenceId } })
    if (companyId) await prisma.company.delete({ where: { id: companyId } })
    await prisma.$disconnect()
  })

  it('liste les domaines avec leurs valeurs seedées', async () => {
    const res = await request(app)
      .get('/api/references')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const equipmentType = res.body.data.find((d: { domain: string }) => d.domain === 'equipment_type')
    expect(equipmentType).toBeDefined()
    expect(equipmentType.values.map((v: { key: string }) => v.key)).toContain('DESKTOP')
  })

  it('rejette une clé inconnue à l\'écriture d\'une entité (INVALID_REFERENCE)', async () => {
    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId, type: 'FRIGO_CONNECTE' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_REFERENCE')
  })

  it('une valeur ajoutée via l\'API est immédiatement utilisable', async () => {
    const created = await request(app)
      .post('/api/references/equipment_type')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Borne interactive' })

    expect(created.status).toBe(201)
    expect(created.body.data.key).toBe('BORNE_INTERACTIVE')
    createdReferenceId = created.body.data.id

    const equipment = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId, type: 'BORNE_INTERACTIVE' })

    expect(equipment.status).toBe(201)
    createdEquipmentIds.push(equipment.body.data.id)
  })

  it('refuse de supprimer une valeur système', async () => {
    const list = await request(app)
      .get('/api/references')
      .set('Authorization', `Bearer ${token}`)
    const equipmentType = list.body.data.find((d: { domain: string }) => d.domain === 'equipment_type')
    const other = equipmentType.values.find((v: { key: string; isSystem: boolean }) => v.key === 'OTHER')
    expect(other?.isSystem).toBe(true)

    const res = await request(app)
      .delete(`/api/references/${other.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('SYSTEM_VALUE')
  })

  it('désactive au lieu de supprimer une valeur utilisée par des données', async () => {
    // BORNE_INTERACTIVE est référencée par l'équipement créé plus haut
    const res = await request(app)
      .delete(`/api/references/${createdReferenceId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.deactivated).toBe(true)
    expect(res.body.data.usage).toBeGreaterThan(0)

    const row = await prisma.referenceValue.findUnique({ where: { id: createdReferenceId! } })
    expect(row?.isActive).toBe(false)
  })
})
