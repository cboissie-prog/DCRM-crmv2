/**
 * entreprises.ts — recherche d'entreprises françaises via l'API publique
 * « Recherche d'entreprises » (recherche-entreprises.api.gouv.fr).
 *
 * Gratuite, sans clé API, sans whitelist IP. Limite : 7 req/s par IP
 * (le debounce côté client suffit largement).
 *
 * Le CSP du serveur (connect-src 'self') interdit les appels tiers depuis le
 * navigateur : la consultation passe par la route proxy de companies.ts.
 *
 * Doc : https://recherche-entreprises.api.gouv.fr/docs/
 */
import logger from './logger'

const BASE_URL = 'https://recherche-entreprises.api.gouv.fr'
const TIMEOUT_MS = 6000

export interface EntrepriseResult {
  siren:          string
  name:           string
  siret:          string   // SIRET du siège
  vatNumber:      string
  billingAddress: string   // voie seule (numéro + type + libellé)
  city:           string
  postalCode:     string
  country:        string
  activity:       string   // code NAF (ex: 77.33Z)
  status:         string   // 'A' = active, 'C' = cessée
}

interface GouvSiege {
  siret?:             string
  numero_voie?:       string | null
  indice_repetition?: string | null
  type_voie?:         string | null
  libelle_voie?:      string | null
  code_postal?:       string | null
  libelle_commune?:   string | null
}

interface GouvResult {
  siren:               string
  nom_complet?:        string
  nom_raison_sociale?: string
  activite_principale?: string
  etat_administratif?: string
  tva?:                string[]
  siege?:              GouvSiege
}

export async function searchEntreprises(query: string): Promise<EntrepriseResult[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(
      `${BASE_URL}/search?q=${encodeURIComponent(query)}&per_page=8&page=1`,
      { signal: controller.signal, headers: { 'User-Agent': 'DCRM-crmv2 (CRM interne DCB Technologies)' } },
    )
    if (!res.ok) {
      logger.warn({ status: res.status }, '[entreprises] réponse non-OK')
      return []
    }
    const data = await res.json() as { results?: GouvResult[] }
    return (data.results ?? [])
      .filter(r => r.siren && (r.nom_complet || r.nom_raison_sociale))
      .map(r => {
        const s = r.siege ?? {}
        const street = [s.numero_voie, s.indice_repetition, s.type_voie, s.libelle_voie]
          .filter(Boolean).join(' ')
        return {
          siren:          r.siren,
          name:           r.nom_complet || r.nom_raison_sociale || '',
          siret:          s.siret ?? '',
          vatNumber:      r.tva?.[0] ?? '',
          billingAddress: street,
          city:           s.libelle_commune ?? '',
          postalCode:     s.code_postal ?? '',
          country:        'France',
          activity:       r.activite_principale ?? '',
          status:         r.etat_administratif ?? '',
        }
      })
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[entreprises] appel échoué')
    return []
  } finally {
    clearTimeout(timer)
  }
}
