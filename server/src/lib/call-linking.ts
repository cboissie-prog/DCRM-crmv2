/**
 * call-linking.ts — rattachement rétroactif des appels orphelins à un contact.
 *
 * À l'import (webhook ou sync OVH), un appel dont le numéro ne correspond à aucun
 * contact reste orphelin (contactId null). Quand un contact est créé ou que son
 * numéro change, on rattache ses appels passés : le numéro appelant (entrant) ou
 * appelé (sortant) est comparé aux numéros normalisés du contact.
 *
 * Les numéros des appels sont stockés bruts (formats VoIP variés : 0033…, +33…),
 * la normalisation se fait donc en JS, pas en SQL. Volume borné : uniquement les
 * appels sans contact.
 */
import prisma from '../prisma/client'
import logger from '../lib/logger'
import { normalizePhone } from './phone'

export async function linkOrphanCallsToContact(contact: {
  id: string
  companyId?: string | null
  phoneNormalized?: string | null
  mobileNormalized?: string | null
}): Promise<number> {
  const numbers = new Set([contact.phoneNormalized, contact.mobileNormalized].filter(Boolean) as string[])
  if (numbers.size === 0) return 0

  const orphans = await prisma.call.findMany({
    where: { contactId: null },
    select: { id: true, callerNumber: true, receiverNumber: true },
  })

  const matching = orphans
    .filter(c => {
      const caller = normalizePhone(c.callerNumber)
      const receiver = normalizePhone(c.receiverNumber)
      return (caller && numbers.has(caller)) || (receiver && numbers.has(receiver))
    })
    .map(c => c.id)

  if (matching.length === 0) return 0

  await prisma.call.updateMany({
    where: { id: { in: matching } },
    data: { contactId: contact.id, companyId: contact.companyId ?? undefined },
  })
  return matching.length
}

/** Variante fire-and-forget : ne doit jamais faire échouer la route appelante. */
export function linkOrphanCallsInBackground(contact: Parameters<typeof linkOrphanCallsToContact>[0]): void {
  linkOrphanCallsToContact(contact)
    .then(n => { if (n > 0) logger.info(`📞 ${n} appel(s) orphelin(s) rattaché(s) au contact ${contact.id}`) })
    .catch(err => logger.error({ err, contactId: contact.id }, 'Échec du rattachement rétroactif des appels'))
}
