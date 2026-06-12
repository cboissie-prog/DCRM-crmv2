import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { PrismaClient } from '@prisma/client'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const TEST_SECRET = 'my-voip-webhook-secret-test'

// Nettoie les appels créés par ces tests
const createdCallIds: string[] = []

afterAll(async () => {
  if (createdCallIds.length > 0) {
    await prisma.call.deleteMany({ where: { id: { in: createdCallIds } } })
  }
  await prisma.$disconnect()
})

describe('POST /api/calls/webhook', () => {
  beforeEach(() => {
    // S'assure que VOIP_WEBHOOK_SECRET est absent avant chaque test
    delete process.env.VOIP_WEBHOOK_SECRET
  })

  afterEach(() => {
    // Nettoie après chaque test
    delete process.env.VOIP_WEBHOOK_SECRET
  })

  it('sans VOIP_WEBHOOK_SECRET configuré → 503', async () => {
    const res = await request(app)
      .post('/api/calls/webhook')
      .send({ caller_number: '0601020304' })

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('WEBHOOK_DISABLED')
  })

  it('avec secret configuré mais header absent → 401', async () => {
    process.env.VOIP_WEBHOOK_SECRET = TEST_SECRET

    const res = await request(app)
      .post('/api/calls/webhook')
      .send({ caller_number: '0601020304' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_SECRET')
  })

  it('avec secret configuré mais header faux → 401', async () => {
    process.env.VOIP_WEBHOOK_SECRET = TEST_SECRET

    const res = await request(app)
      .post('/api/calls/webhook')
      .set('x-webhook-secret', 'wrong-secret')
      .send({ caller_number: '0601020304' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_SECRET')
  })

  it('avec bon header → 200 et call créé', async () => {
    process.env.VOIP_WEBHOOK_SECRET = TEST_SECRET

    const res = await request(app)
      .post('/api/calls/webhook')
      .set('x-webhook-secret', TEST_SECRET)
      .send({
        caller_number: '0601020304',
        direction: 'INBOUND',
        status: 'ANSWERED',
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.id).toBeTruthy()
    expect(res.body.data.callerNumber).toBe('0601020304')

    createdCallIds.push(res.body.data.id)
  })

  it('recording_url avec protocole http:// → 400', async () => {
    process.env.VOIP_WEBHOOK_SECRET = TEST_SECRET

    const res = await request(app)
      .post('/api/calls/webhook')
      .set('x-webhook-secret', TEST_SECRET)
      .send({
        caller_number: '0601020304',
        recording_url: 'http://example.com/recording.mp3',
      })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_RECORDING_URL')
  })

  it('recording_url avec protocole https:// → accepté', async () => {
    process.env.VOIP_WEBHOOK_SECRET = TEST_SECRET

    const res = await request(app)
      .post('/api/calls/webhook')
      .set('x-webhook-secret', TEST_SECRET)
      .send({
        caller_number: '0601020304',
        recording_url: 'https://example.com/recording.mp3',
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    createdCallIds.push(res.body.data.id)
  })
})
