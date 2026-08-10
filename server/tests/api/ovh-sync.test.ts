/**
 * ovh-sync.test.ts — régressions sur l'import OVH VoIP.
 *
 * 1. Un même appel réémis par OVH sous un NOUVEL id de consommation (appel en cours
 *    finalisé, re-tarification) ne doit PAS créer de doublon : la fiche existante est
 *    mise à jour (bug observé en prod le 10/08/2026 : 6 clics = 6 fiches).
 * 2. Rattachement rétroactif : créer un contact dont le numéro correspond à des
 *    appels orphelins doit les lier.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { runOvhVoipSync } from '../../src/services/ovh-voip'
import { linkOrphanCallsToContact } from '../../src/lib/call-linking'

const prisma = new PrismaClient()

const BA = 'ovhtest-ba'
const LINE = '0033972999999'
const CALLER = '0033688776655'
const EXTERNAL_PREFIX = `ovh:${BA}:${LINE}:`

/** Simule l'API OVH : une seule ligne, un seul appel listé sous `consumptionId`. */
function stubOvhApi(consumptionId: number, detail: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    const json = (data: unknown) => ({ ok: true, text: async () => JSON.stringify(data), json: async () => data })
    if (u.endsWith('/auth/time')) return { ok: true, text: async () => String(Math.floor(Date.now() / 1000)), json: async () => 0 }
    if (u.endsWith('/1.0/telephony')) return json([BA])
    if (u.endsWith('/service')) return json([LINE])
    if (u.includes('/voiceConsumption?')) return json([consumptionId])
    if (u.includes('/voiceConsumption/')) return json(detail)
    throw new Error(`URL OVH inattendue dans le test : ${u}`)
  }))
}

async function purge() {
  await prisma.call.deleteMany({ where: { externalId: { startsWith: EXTERNAL_PREFIX } } })
  await prisma.call.deleteMany({ where: { callerNumber: CALLER } })
  await prisma.contact.deleteMany({ where: { email: 'ovh-link-test@test.local' } })
}

beforeAll(async () => {
  process.env.OVH_APP_KEY = 'test-ak'
  process.env.OVH_APP_SECRET = 'test-as'
  process.env.OVH_CONSUMER_KEY = 'test-ck'
  await purge()
})

afterAll(async () => {
  delete process.env.OVH_APP_KEY
  delete process.env.OVH_APP_SECRET
  delete process.env.OVH_CONSUMER_KEY
  await purge()
  await prisma.$disconnect()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Horodatage stable et récent (dans la fenêtre d'import de 3 jours)
const STARTED = new Date(Date.now() - 60 * 60 * 1000)
const STARTED_ISO = STARTED.toISOString()

describe('Sync OVH — déduplication', () => {
  it('un appel réémis sous un nouvel id met à jour la fiche au lieu de la dupliquer', async () => {
    // Run 1 : l'appel vient d'arriver, id 101, pas encore de durée (non répondu à ce stade)
    stubOvhApi(101, { creationDatetime: STARTED_ISO, calling: CALLER, called: LINE, duration: 0, wayType: 'incoming' })
    const run1 = await runOvhVoipSync()
    expect(run1.imported).toBe(1)

    // Run 2 : OVH a finalisé le CDR sous un NOUVEL id 202, durée renseignée
    stubOvhApi(202, { creationDatetime: STARTED_ISO, calling: CALLER, called: LINE, duration: 63, wayType: 'incoming' })
    const run2 = await runOvhVoipSync()
    expect(run2.imported).toBe(0)
    expect(run2.updated).toBe(1)

    const rows = await prisma.call.findMany({ where: { externalId: { startsWith: EXTERNAL_PREFIX } } })
    expect(rows).toHaveLength(1)
    expect(rows[0].externalId).toBe(`${EXTERNAL_PREFIX}202`)
    expect(rows[0].status).toBe('ANSWERED')
    expect(rows[0].duration).toBe(63)

    // Run 3 : id stable → simple skip, toujours une seule fiche
    stubOvhApi(202, { creationDatetime: STARTED_ISO, calling: CALLER, called: LINE, duration: 63, wayType: 'incoming' })
    const run3 = await runOvhVoipSync()
    expect(run3.imported).toBe(0)
    expect(run3.updated).toBe(0)
    expect(run3.skipped).toBe(1)
    expect(await prisma.call.count({ where: { externalId: { startsWith: EXTERNAL_PREFIX } } })).toBe(1)
  })
})

describe('Rattachement rétroactif des appels orphelins', () => {
  it('créer un contact avec un numéro correspondant lie ses appels passés', async () => {
    // Isolation : retire les fiches créées par la suite de dédup (même numéro appelant)
    await prisma.call.deleteMany({ where: { externalId: { startsWith: EXTERNAL_PREFIX } } })

    // Un appel orphelin importé avant que le contact existe (numéro au format OVH 0033…)
    const orphan = await prisma.call.create({
      data: { direction: 'INBOUND', status: 'ANSWERED', callerNumber: CALLER, startedAt: STARTED },
    })

    // Le contact est créé après, numéro au format national avec espaces
    const contact = await prisma.contact.create({
      data: {
        firstName: 'Ovh',
        lastName: 'LinkTest',
        email: 'ovh-link-test@test.local',
        mobile: '06 88 77 66 55',
        mobileNormalized: '0688776655',
      },
    })

    const linked = await linkOrphanCallsToContact(contact)
    expect(linked).toBe(1)

    const refreshed = await prisma.call.findUnique({ where: { id: orphan.id } })
    expect(refreshed?.contactId).toBe(contact.id)
  })

  it('ne touche pas aux appels déjà liés à un autre contact', async () => {
    const other = await prisma.contact.findFirst({ where: { email: { not: 'ovh-link-test@test.local' } }, select: { id: true } })
    const contact = await prisma.contact.findFirst({ where: { email: 'ovh-link-test@test.local' } })
    if (!contact) throw new Error('Contact de test absent')

    const alreadyLinked = await prisma.call.create({
      data: { direction: 'INBOUND', status: 'ANSWERED', callerNumber: CALLER, startedAt: STARTED, contactId: other?.id ?? contact.id },
    })

    await linkOrphanCallsToContact(contact)
    const refreshed = await prisma.call.findUnique({ where: { id: alreadyLinked.id } })
    expect(refreshed?.contactId).toBe(other?.id ?? contact.id)
  })
})
