/**
 * Géocodage d'adresses via Nominatim (OpenStreetMap) — gratuit, sans clé API.
 *
 * Appelé UNIQUEMENT côté serveur :
 *  - le CSP du front (connect-src 'self') bloque les appels directs depuis le navigateur ;
 *  - la politique d'usage Nominatim impose un User-Agent identifiable et max 1 requête/seconde.
 *
 * Toute erreur renvoie `null` : le géocodage ne doit jamais faire échouer un enregistrement.
 */

import logger from './logger'

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'DCRM-CRM/1.0 (+https://dcb-technologies.fr)'
const TIMEOUT_MS = 6000

export interface AddressParts {
  billingAddress?: string | null
  postalCode?: string | null
  city?: string | null
  country?: string | null
}

export interface GeoPoint {
  lat: number
  lng: number
}

/** Construit une requête lisible à partir des champs d'adresse. Renvoie '' si rien d'exploitable. */
export function buildAddressQuery(parts: AddressParts): string {
  return [parts.billingAddress, parts.postalCode, parts.city, parts.country]
    .map(v => v?.trim())
    .filter((v): v is string => Boolean(v))
    .join(', ')
}

/** Géocode une adresse. Renvoie `{ lat, lng }` ou `null` si introuvable / erreur. */
export async function geocodeAddress(parts: AddressParts): Promise<GeoPoint | null> {
  const q = buildAddressQuery(parts)
  // Sans aucun champ d'adresse exploitable, inutile d'appeler le service.
  if (!q) return null

  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', q })
  // Biais France par défaut (pas de pays renseigné ou pays = France).
  const country = parts.country?.trim().toLowerCase()
  if (!country || country === 'france' || country === 'fr') {
    params.set('countrycodes', 'fr')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      logger.warn({ status: res.status, q }, '[GEOCODE] Réponse Nominatim non OK')
      return null
    }
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>
    if (!Array.isArray(data) || data.length === 0) {
      logger.debug({ q }, '[GEOCODE] Aucun résultat')
      return null
    }
    const lat = parseFloat(data[0].lat ?? '')
    const lng = parseFloat(data[0].lon ?? '')
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null
    return { lat, lng }
  } catch (err) {
    logger.warn({ err, q }, '[GEOCODE] Échec du géocodage')
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Pause utilitaire — respecte la limite Nominatim (max 1 req/s) lors des traitements par lot. */
export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
