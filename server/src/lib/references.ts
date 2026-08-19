import prisma from '../prisma/client'
import { DOMAIN_BY_KEY } from './reference-domains'

/**
 * Validation d'une valeur de référentiel à l'écriture (routes tickets, calls,
 * equipment, contracts, licenses, contacts, appointments, products, knowledge,
 * pipeline).
 *
 * Règle : la clé doit exister dans la table pour le domaine — active ou non.
 * Une valeur désactivée reste acceptée pour ne pas bloquer la modification
 * d'une entité ancienne qui la porte encore ; `isActive` ne gouverne que les
 * listes proposées dans les formulaires.
 *
 * Les domaines `validate: false` (secteurs) et inconnus passent toujours.
 */

// Cache court (30 s) : évite une requête SQL par écriture d'entité.
let cache: { at: number; byDomain: Map<string, Set<string>> } | null = null
const CACHE_TTL_MS = 30_000

async function getKeys(): Promise<Map<string, Set<string>>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.byDomain
  const rows = await prisma.referenceValue.findMany({ select: { domain: true, key: true } })
  const byDomain = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!byDomain.has(r.domain)) byDomain.set(r.domain, new Set())
    byDomain.get(r.domain)!.add(r.key)
  }
  cache = { at: Date.now(), byDomain }
  return byDomain
}

/** À appeler après toute écriture sur ReferenceValue. */
export function invalidateReferenceCache(): void {
  cache = null
}

export async function isValidReference(domain: string, key: string | null | undefined): Promise<boolean> {
  if (key == null || key === '') return true // champs optionnels : l'absence est gérée par Zod
  const cfg = DOMAIN_BY_KEY[domain]
  if (!cfg || !cfg.validate) return true
  const byDomain = await getKeys()
  const keys = byDomain.get(domain)
  // Table pas encore seedée (première migration) : ne pas bloquer les écritures.
  if (!keys || keys.size === 0) return true
  return keys.has(key)
}

/**
 * Vérifie une série de champs d'un coup ; retourne le message d'erreur de la
 * première valeur inconnue, ou null si tout est valide.
 */
export async function checkReferences(
  fields: { domain: string; value: string | null | undefined }[]
): Promise<string | null> {
  for (const f of fields) {
    if (!(await isValidReference(f.domain, f.value))) {
      const label = DOMAIN_BY_KEY[f.domain]?.label ?? f.domain
      return `Valeur « ${f.value} » inconnue pour ${label} — gérez la liste dans Réglages > Listes`
    }
  }
  return null
}
