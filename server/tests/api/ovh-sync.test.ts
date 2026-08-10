/**
 * ovh-sync.test.ts — régressions sur l'import OVH VoIP.
 *
 * 1. Un même appel réémis par OVH sous un NOUVEL id de consommation ne doit pas
 *    créer de doublon : la fiche existante est mise à jour.
 * 2. Un appel de GROUPE (plusieurs lignes sonnent) produit un CDR par ligne :
 *    une seule fiche doit être créée (bug observé en prod le 10/08/2026 :
 *    4 numéros = 4 fiches pour un seul appel).
 * 3. OVH_SERVICE_NAME accepte une liste de lignes à importer.
 * 4. Rattachement rétroactif : créer un contact dont le numéro correspond à des
 *    appels orphelins doit les lier.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { runOvhVoipSync, _clearOvhSyncCache } from '../../src/services/ovh-voip'
import { linkOrphanCallsToContact } from '../../src/lib/call-linking'

const prisma = new PrismaClient()

const BA = 'ovhtest-ba'
const LINE = '0033972999999'
const LINE2 = '0033972999998'
const CALLER = '0033688776655'
const BA_PREFIX = `ovh:${BA}:`

/**
 * Simule l'API OVH. `lines` : pour chaque ligne, l'id de consommation listé
 * et le détail du CDR correspondant.
 */
function stubOvhApi(lines: Record<string, { id: number; detail: Record<string, unknown> }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    const json = (data: unknown) => ({ ok: true, text: async () => JSON.stringify(data), json: async () => data })
    if (u.endsWith('/auth/time')) return { ok: true, text: async () => String(Math.floor(Date.now() / 1000)), json: async () => 0 }
    if (u.endsWith('/1.0/telephony')) return json([BA])
    if (u.endsWith('/service')) return json(Object.keys(lines))
    const m = u.match(/\/service\/([^/]+)\/voiceConsumption/)
    if (m) {
      const line = lines[decodeURIComponent(m[1])]
      if (!line) throw new Error(`Ligne inconnue dans le stub : ${m[1]}`)
      return u.includes('voiceConsumption?') ? json([line.id]) : json(line.detail)
    }
    throw new Error(`URL OVH inattendue dans le test : ${u}`)
  }))
}

async function purge() {
  await prisma.call.deleteMany({ where: { externalId: { startsWith: BA_PREFIX } } })
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

beforeEach(() => {
  _clearOvhSyncCache()
  delete process.env.OVH_SERVICE_NAME
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Horodatage stable et récent (dans la fenêtre d'import de 3 jours)
const STARTED = new Date(Date.now() - 60 * 60 * 1000)
const STARTED_ISO = STARTED.toISOString()

function inboundDetail(overrides: Record<string, unknown> = {}) {
  return { creationDatetime: STARTED_ISO, calling: CALLER, called: LINE, duration: 0, wayType: 'incoming', ...overrides }
}

describe('Sync OVH — déduplication', () => {
  it('un appel réémis sous un nouvel id met à jour la fiche au lieu de la dupliquer', async () => {
    await prisma.call.deleteMany({ where: { externalId: { startsWith: BA_PREFIX } } })

    // Run 1 : l'appel vient d'arriver, id 101, pas encore de durée
    stubOvhApi({ [LINE]: { id: 101, detail: inboundDetail() } })
    const run1 = await runOvhVoipSync()
    expect(run1.imported).toBe(1)

    // Run 2 : OVH a finalisé le CDR sous un NOUVEL id 202, durée renseignée
    stubOvhApi({ [LINE]: { id: 202, detail: inboundDetail({ duration: 63 }) } })
    const run2 = await runOvhVoipSync()
    expect(run2.imported).toBe(0)
    expect(run2.updated).toBe(1)

    const rows = await prisma.call.findMany({ where: { externalId: { startsWith: BA_PREFIX } } })
    expect(rows).toHaveLength(1)
    // La fiche garde son premier id ; statut et durée sont mis à jour
    expect(rows[0].externalId).toBe(`${BA_PREFIX}${LINE}:101`)
    expect(rows[0].status).toBe('ANSWERED')
    expect(rows[0].duration).toBe(63)

    // Run 3 : rien n'a changé → simple skip, toujours une seule fiche
    stubOvhApi({ [LINE]: { id: 202, detail: inboundDetail({ duration: 63 }) } })
    const run3 = await runOvhVoipSync()
    expect(run3.imported).toBe(0)
    expect(run3.updated).toBe(0)
    expect(run3.skipped).toBe(1)
    expect(await prisma.call.count({ where: { externalId: { startsWith: BA_PREFIX } } })).toBe(1)
  })

  it('un appel de groupe vu sur plusieurs lignes ne crée qu\'une seule fiche', async () => {
    await prisma.call.deleteMany({ where: { externalId: { startsWith: BA_PREFIX } } })
    const started = new Date(Date.now() - 30 * 60 * 1000).toISOString()

    // Le même appel entrant sonne sur LINE et LINE2 → un CDR par ligne, ids différents
    stubOvhApi({
      [LINE]:  { id: 301, detail: inboundDetail({ creationDatetime: started, duration: 42 }) },
      [LINE2]: { id: 999, detail: inboundDetail({ creationDatetime: started, duration: 42, called: LINE2 }) },
    })
    const run = await runOvhVoipSync()
    expect(run.imported).toBe(1)
    expect(run.skipped).toBe(1) // le CDR de la 2e ligne fusionne avec la fiche existante
    expect(await prisma.call.count({ where: { externalId: { startsWith: BA_PREFIX } } })).toBe(1)

    // Passage suivant : les deux ids sont connus (base + cache de fusion) → aucun doublon
    stubOvhApi({
      [LINE]:  { id: 301, detail: inboundDetail({ creationDatetime: started, duration: 42 }) },
      [LINE2]: { id: 999, detail: inboundDetail({ creationDatetime: started, duration: 42, called: LINE2 }) },
    })
    const run2 = await runOvhVoipSync()
    expect(run2.imported).toBe(0)
    expect(await prisma.call.count({ where: { externalId: { startsWith: BA_PREFIX } } })).toBe(1)
  })

  it('OVH_SERVICE_NAME restreint l\'import aux lignes listées', async () => {
    await prisma.call.deleteMany({ where: { externalId: { startsWith: BA_PREFIX } } })
    const started = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    process.env.OVH_SERVICE_NAME = ` ${LINE} , 0033999000000 `
    // Deux appels distincts, un par ligne — seule LINE est dans la liste autorisée
    stubOvhApi({
      [LINE]:  { id: 401, detail: inboundDetail({ creationDatetime: started, calling: '0033611110001' }) },
      [LINE2]: { id: 402, detail: inboundDetail({ creationDatetime: started, calling: '0033611110002', called: LINE2 }) },
    })
    const run = await runOvhVoipSync()
    expect(run.imported).toBe(1)

    const rows = await prisma.call.findMany({ where: { externalId: { startsWith: BA_PREFIX } } })
    expect(rows).toHaveLength(1)
    expect(rows[0].externalId).toBe(`${BA_PREFIX}${LINE}:401`)
  })
})

describe('Rattachement rétroactif des appels orphelins', () => {
  it('créer un contact avec un numéro correspondant lie ses appels passés', async () => {
    // Isolation : retire les fiches créées par la suite de dédup (même numéro appelant)
    await prisma.call.deleteMany({ where: { externalId: { startsWith: BA_PREFIX } } })

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
