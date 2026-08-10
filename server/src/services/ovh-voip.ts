/**
 * ovh-voip.ts — import des appels de la ligne VoIP OVH dans le module Appels.
 *
 * Poll de l'API téléphonie OVH (relevé `voiceConsumption`) depuis le scheduler :
 * pas de webhook natif côté OVH, on interroge périodiquement le relevé d'appels
 * et on crée les fiches Call manquantes (dédup par externalId).
 *
 * Auth OVH : signature « $1$ + sha1(AS+CK+METHOD+URL+BODY+TS) » — implémentée ici
 * pour éviter une dépendance au SDK. Clés en lecture seule (GET /telephony*) :
 * une fuite ne permet aucune modification de la ligne.
 *
 * Variables d'env : OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY,
 * OVH_ENDPOINT (défaut ovh-eu), OVH_SERVICE_NAME (optionnel : restreint aux lignes
 * listées, séparées par des virgules — ex: 0033972000001,0033972000002).
 */
import crypto from 'crypto'
import prisma from '../prisma/client'
import logger from '../lib/logger'
import { normalizePhone } from '../lib/phone'

const ENDPOINTS: Record<string, string> = {
  'ovh-eu': 'https://eu.api.ovh.com/1.0',
  'ovh-ca': 'https://ca.api.ovh.com/1.0',
  'ovh-us': 'https://api.us.ovhcloud.com/1.0',
}

// Fenêtre d'import : on ne remonte jamais plus loin (même logique que l'import
// Google Calendar). La dédup par externalId rend les passages suivants idempotents.
const IMPORT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

export function isOvhConfigured(): boolean {
  return Boolean(process.env.OVH_APP_KEY && process.env.OVH_APP_SECRET && process.env.OVH_CONSUMER_KEY)
}

function apiBase(): string {
  return ENDPOINTS[process.env.OVH_ENDPOINT ?? 'ovh-eu'] ?? ENDPOINTS['ovh-eu']
}

// Décalage horloge locale ↔ serveur OVH (la signature est rejetée au-delà de
// quelques secondes de dérive). Calculé une fois par process.
let timeDelta: number | null = null

async function getTimeDelta(): Promise<number> {
  if (timeDelta !== null) return timeDelta
  const res = await fetch(`${apiBase()}/auth/time`)
  if (!res.ok) throw new Error(`OVH /auth/time a répondu ${res.status}`)
  const serverTime = Number(await res.text())
  timeDelta = serverTime - Math.floor(Date.now() / 1000)
  return timeDelta
}

async function ovhGet<T>(path: string): Promise<T> {
  const appKey = process.env.OVH_APP_KEY!
  const appSecret = process.env.OVH_APP_SECRET!
  const consumerKey = process.env.OVH_CONSUMER_KEY!
  const url = `${apiBase()}${path}`
  const timestamp = Math.floor(Date.now() / 1000) + (await getTimeDelta())
  const signature = '$1$' + crypto
    .createHash('sha1')
    .update([appSecret, consumerKey, 'GET', url, '', timestamp].join('+'))
    .digest('hex')
  const res = await fetch(url, {
    headers: {
      'X-Ovh-Application': appKey,
      'X-Ovh-Consumer': consumerKey,
      'X-Ovh-Timestamp': String(timestamp),
      'X-Ovh-Signature': signature,
    },
  })
  if (!res.ok) {
    throw new Error(`OVH API ${res.status} sur GET ${path} : ${(await res.text()).slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

export interface OvhVoiceConsumption {
  consumptionId: number
  creationDatetime: string
  calling: string
  called: string
  dialed?: string
  duration: number
  wayType: 'incoming' | 'outgoing' | 'transfer'
}

/**
 * Convertit une ligne du relevé OVH en données Call.
 * `externalParty` = le numéro du tiers (pour le rattachement au contact) :
 * l'appelant en entrant, l'appelé en sortant.
 */
export function mapConsumptionToCall(billingAccount: string, serviceName: string, c: OvhVoiceConsumption) {
  const direction = c.wayType === 'outgoing' ? 'OUTBOUND' : 'INBOUND'
  const startedAt = new Date(c.creationDatetime)
  const answered = c.duration > 0
  const callerNumber = (direction === 'INBOUND' ? c.calling : c.calling || serviceName) || 'Inconnu'
  const receiverNumber = c.called || c.dialed || (direction === 'INBOUND' ? serviceName : undefined)
  return {
    call: {
      externalId: `ovh:${billingAccount}:${serviceName}:${c.consumptionId}`,
      direction,
      status: answered ? 'ANSWERED' : 'MISSED',
      callerNumber,
      receiverNumber,
      startedAt,
      answeredAt: answered ? startedAt : undefined,
      endedAt: answered ? new Date(startedAt.getTime() + c.duration * 1000) : undefined,
      duration: c.duration,
    },
    externalParty: direction === 'INBOUND' ? c.calling : c.called || c.dialed || '',
  }
}

// Ids de consommation déjà résolus vers une fiche existante (fusion inter-lignes) :
// évite de re-télécharger leur détail à chaque passage. Réinitialisé au restart du
// process — au pire un re-fetch de détail par appel de la fenêtre, puis re-caché.
const mergedConsumptionIds = new Set<string>()

/** Réservé aux tests : vide le cache de fusion. */
export function _clearOvhSyncCache(): void {
  mergedConsumptionIds.clear()
}

/**
 * Parcourt les comptes de facturation et lignes OVH, importe les appels
 * de la fenêtre récente absents de la base. Idempotent.
 */
export async function runOvhVoipSync(): Promise<{ imported: number; updated: number; skipped: number; warning?: string }> {
  if (!isOvhConfigured()) return { imported: 0, updated: 0, skipped: 0 }

  // Filtre de lignes : comparaison sur numéros NORMALISÉS pour tolérer tous les
  // formats de saisie (0033972…, +33 9 72…, 09 72…) face aux noms de service OVH.
  const restrictRaw = (process.env.OVH_SERVICE_NAME ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const restrict = restrictRaw.map(s => normalizePhone(s) ?? s)
  const from = new Date(Date.now() - IMPORT_MAX_AGE_MS).toISOString()
  let imported = 0
  let updated = 0
  let skipped = 0
  const allServices: string[] = []
  let matchedServices = 0

  const matchedNames: string[] = []
  const servicesByBa = new Map<string, string[]>()

  const billingAccounts = await ovhGet<string[]>('/telephony')
  for (const ba of billingAccounts) {
    let services = await ovhGet<string[]>(`/telephony/${encodeURIComponent(ba)}/service`)
    allServices.push(...services)
    servicesByBa.set(ba, services)
    if (restrict.length > 0) services = services.filter(s => restrict.includes(normalizePhone(s) ?? s))
    matchedServices += services.length
    matchedNames.push(...services)

    for (const service of services) {
      const basePath = `/telephony/${encodeURIComponent(ba)}/service/${encodeURIComponent(service)}`
      let ids: number[]
      try {
        ids = await ovhGet<number[]>(`${basePath}/voiceConsumption?creationDatetime.from=${encodeURIComponent(from)}`)
      } catch (err) {
        // Service sans relevé voix (fax, trunk…) : on l'ignore sans faire échouer le reste
        logger.debug({ err, service }, '[OVH VOIP] Service ignoré (pas de voiceConsumption)')
        continue
      }
      if (ids.length === 0) continue

      // Dédup en une requête : on ne télécharge le détail que des appels inconnus
      const externalIds = ids.map(id => `ovh:${ba}:${service}:${id}`)
      const existing = await prisma.call.findMany({
        where: { externalId: { in: externalIds } },
        select: { externalId: true },
      })
      const known = new Set(existing.map(e => e.externalId))

      for (const id of ids) {
        const candidateId = `ovh:${ba}:${service}:${id}`
        if (known.has(candidateId) || mergedConsumptionIds.has(candidateId)) { skipped++; continue }
        try {
          const detail = await ovhGet<OvhVoiceConsumption>(`${basePath}/voiceConsumption/${id}`)
          const { call, externalParty } = mapConsumptionToCall(ba, service, { ...detail, consumptionId: id })

          // Rattachement automatique au contact par numéro normalisé (même logique que le webhook)
          const norm = normalizePhone(externalParty)
          const contact = (norm && norm.length >= 6)
            ? await prisma.contact.findFirst({
                where: { OR: [{ phoneNormalized: norm }, { mobileNormalized: norm }] },
                select: { id: true, companyId: true },
              })
            : null

          // L'id de consommation ne suffit pas à dédupliquer : un appel de GROUPE
          // sonne sur plusieurs lignes et produit un CDR par ligne, et un CDR récent
          // peut être réémis sous un nouvel id (finalisation, re-tarification).
          // Empreinte naturelle à l'échelle du compte : même seconde de début, même
          // appelant, même sens = un seul et même appel → on met à jour la fiche
          // existante au lieu d'en créer une deuxième. externalId garde le premier
          // id rencontré ; les ids fusionnés sont cachés pour éviter les re-fetch.
          const sameCall = await prisma.call.findFirst({
            where: {
              externalId: { startsWith: `ovh:${ba}:` },
              startedAt: call.startedAt,
              callerNumber: call.callerNumber,
              direction: call.direction,
            },
            select: { id: true, contactId: true, status: true, duration: true },
          })
          if (sameCall) {
            mergedConsumptionIds.add(candidateId)
            const changed = sameCall.status !== call.status || sameCall.duration !== call.duration
            const linkContact = sameCall.contactId === null && contact !== null
            if (changed || linkContact) {
              await prisma.call.update({
                where: { id: sameCall.id },
                data: {
                  status: call.status,
                  duration: call.duration,
                  answeredAt: call.answeredAt,
                  endedAt: call.endedAt,
                  // Lie le contact si la fiche ne l'était pas encore (jamais d'écrasement)
                  ...(linkContact ? { contactId: contact!.id, companyId: contact!.companyId ?? undefined } : {}),
                },
              })
              updated++
            } else {
              skipped++
            }
            continue
          }

          await prisma.call.create({
            data: { ...call, contactId: contact?.id, companyId: contact?.companyId },
          })
          imported++
        } catch (err) {
          // Un appel en erreur ne bloque pas les suivants ; il sera retenté au prochain passage
          logger.error({ err, service, consumptionId: id }, '[OVH VOIP] Échec import d\'un appel')
        }
      }
    }
  }

  // Filtre posé mais aucune ligne ne correspond : plus AUCUN appel ne serait importé
  // silencieusement — on le dit explicitement, avec les lignes réellement disponibles.
  if (restrict.length > 0 && matchedServices === 0) {
    const warning = `Aucune ligne OVH ne correspond à OVH_SERVICE_NAME (${restrictRaw.join(', ')}). Lignes disponibles sur le compte : ${allServices.join(', ') || 'aucune'}`
    logger.warn({ restrictRaw, allServices }, `[OVH VOIP] ${warning}`)
    return { imported, updated, skipped, warning }
  }

  // Filtre posé, lignes reconnues, mais AUCUN CDR vu dessus : avec un groupe d'appel,
  // OVH peut enregistrer les relevés sur d'autres services (numéro principal du groupe).
  // On diagnostique où se trouvent réellement les appels récents pour guider la config.
  if (restrict.length > 0 && imported + updated + skipped === 0) {
    const withCalls: string[] = []
    for (const [ba, services] of servicesByBa) {
      for (const s of services) {
        if (matchedNames.includes(s)) continue
        try {
          const ids = await ovhGet<number[]>(`/telephony/${encodeURIComponent(ba)}/service/${encodeURIComponent(s)}/voiceConsumption?creationDatetime.from=${encodeURIComponent(from)}`)
          if (ids.length > 0) withCalls.push(`${s} (${ids.length} appel${ids.length > 1 ? 's' : ''})`)
        } catch { /* service sans relevé voix */ }
      }
    }
    const warning = `Aucun appel récent sur les lignes filtrées (${matchedNames.join(', ')}). ` +
      (withCalls.length > 0
        ? `Les appels récents sont enregistrés sur : ${withCalls.join(', ')} — ajoutez ce(s) numéro(s) à OVH_SERVICE_NAME.`
        : 'Aucun appel récent sur les autres lignes non plus (fenêtre de 3 jours).')
    logger.warn({ matchedNames, withCalls }, `[OVH VOIP] ${warning}`)
    return { imported, updated, skipped, warning }
  }
  return { imported, updated, skipped }
}
