/**
 * societe.ts — client API societe.com (recherche d'entreprises françaises).
 *
 * Le CSP du serveur (connect-src 'self') interdit les appels tiers depuis le
 * navigateur : toute consultation passe par les routes proxy de companies.ts.
 *
 * Clé : variable d'environnement SOCIETE_API_TOKEN (espace client societe.com).
 * Sans clé, le service est désactivé silencieusement (isSocieteConfigured).
 * Doc : https://api.societe.com/apisite/documentations/v1/documentation-api.html
 */
import logger from './logger'

const BASE_URL = 'https://api.societe.com/api/v1'
const TIMEOUT_MS = 6000

export function isSocieteConfigured(): boolean {
  return !!process.env.SOCIETE_API_TOKEN
}

async function societeGet(path: string): Promise<unknown | null> {
  const token = process.env.SOCIETE_API_TOKEN
  if (!token) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'X-Authorization': `socapi ${token}` },
      signal: controller.signal,
    })
    if (!res.ok) {
      logger.warn({ path, status: res.status }, '[societe] réponse non-OK')
      return null
    }
    return await res.json()
  } catch (err) {
    logger.warn({ path, err: (err as Error).message }, '[societe] appel échoué')
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ─── Recherche ────────────────────────────────────────────────────────────────

export interface SocieteSearchResult {
  siren:      string
  name:       string
  activity:   string   // libellé NAF
  city:       string
  postalCode: string
  status:     string   // active | ...
}

/** "92200 NEUILLY-SUR-SEINE" → { postalCode, city } */
function splitCpVille(cpville: string): { postalCode: string; city: string } {
  const m = (cpville ?? '').match(/^(\d{4,5})\s+(.+)$/)
  return m ? { postalCode: m[1], city: m[2] } : { postalCode: '', city: cpville ?? '' }
}

export async function searchSocieteCompanies(query: string): Promise<SocieteSearchResult[]> {
  const data = await societeGet(`/entreprise/search?nom=${encodeURIComponent(query)}&nbrep=8`) as
    { data?: { results?: Array<Record<string, string>> } } | null
  const results = data?.data?.results ?? []
  return results
    .filter(r => r.siren)
    .map(r => {
      const { postalCode, city } = splitCpVille(r.cpville ?? '')
      return {
        siren:      r.siren,
        name:       r.nomcommercial || r.deno || '',
        activity:   r.naflib ?? '',
        city,
        postalCode,
        status:     r.status ?? '',
      }
    })
    .filter(r => r.name)
}

// ─── Fiche entreprise (pré-remplissage) ───────────────────────────────────────

export interface SocieteCompanyDetails {
  name:           string
  siret:          string
  vatNumber:      string
  billingAddress: string
  city:           string
  postalCode:     string
  country:        string
  activity:       string
}

export async function getSocieteCompanyDetails(siren: string): Promise<SocieteCompanyDetails | null> {
  const data = await societeGet(`/entreprise/${encodeURIComponent(siren)}/infoslegales`) as
    { infolegales?: Record<string, string> } | null
  const info = data?.infolegales
  if (!info) return null
  return {
    name:           info.denoinsee || info.denorcs || info.nomcommercialinsee || '',
    siret:          info.siretsiege ?? '',
    vatNumber:      info.numtva ?? '',
    billingAddress: info.voieadressageinsee || info.voieadressagercs || '',
    city:           info.villeinsee || info.villercs || '',
    postalCode:     info.codepostalinsee || info.codepostalrcs || '',
    country:        info.paysinsee || 'France',
    activity:       info.naflibinsee || info.naflibrcs || '',
  }
}
