/**
 * Import de prospects (CSV) — correspondance des colonnes du fichier vers les champs du CRM.
 *
 * Voir docs/superpowers/specs/2026-10-05-prospection-design.md §5 « Import CSV avec
 * correspondance ». Les en-têtes du fichier importé sont normalisés (accents, casse) pour
 * l'auto-détection, et la correspondance choisie est mémorisée en localStorage pour un même
 * jeu d'en-têtes.
 */

export type CrmField =
  | 'companyName'
  | 'firstName'
  | 'lastName'
  | 'phone'
  | 'email'
  | 'title'
  | 'value'
  | 'city'
  | 'postalCode'
  | 'website'
  | 'siret'
  | 'notes'

export interface CrmFieldDef {
  key: CrmField
  label: string
  required?: boolean
}

export const CRM_FIELDS: CrmFieldDef[] = [
  { key: 'companyName', label: 'Entreprise', required: true },
  { key: 'firstName',   label: 'Prénom' },
  { key: 'lastName',    label: 'Nom' },
  { key: 'phone',       label: 'Téléphone' },
  { key: 'email',       label: 'Email' },
  { key: 'title',       label: "Titre de l'opportunité" },
  { key: 'value',       label: 'Montant HT' },
  { key: 'city',        label: 'Ville' },
  { key: 'postalCode',  label: 'Code postal' },
  { key: 'website',     label: 'Site web' },
  { key: 'siret',       label: 'SIRET' },
  { key: 'notes',       label: 'Notes' },
]

/**
 * Normalise un en-tête de colonne : sans accents, minuscules, espaces/ponctuation compactés.
 * « Société » et « SOCIETE » et « société ' » normalisent vers la même chaîne « societe ».
 */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Synonymes déjà normalisés (sans accent, minuscules) — ordre de priorité pour le pass « exact ».
const SYNONYMS: Record<CrmField, string[]> = {
  companyName: ['entreprise', 'societe', 'raison sociale', 'company', 'company name', 'nom societe', 'nom entreprise', 'nom de la societe'],
  firstName: ['prenom', 'firstname', 'first name', 'prenom contact', 'first'],
  lastName: ['nom', 'lastname', 'last name', 'nom contact', 'nom de famille', 'last'],
  phone: ['telephone', 'tel', 'mobile', 'portable', 'phone', 'numero de telephone', 'num tel', 'tel fixe', 'telephone fixe', 'telephone mobile'],
  email: ['email', 'mail', 'e mail', 'courriel', 'adresse email'],
  title: ['titre', 'titre opportunite', 'opportunite', 'objet', 'sujet', "titre de l opportunite"],
  value: ['montant', 'ca', 'budget', 'valeur', 'montant ht', 'prix', 'chiffre d affaires'],
  city: ['ville', 'city', 'commune'],
  postalCode: ['code postal', 'cp', 'postal code', 'zip', 'zip code'],
  website: ['site web', 'site', 'website', 'url', 'web', 'site internet'],
  siret: ['siret', 'siren'],
  notes: ['notes', 'note', 'commentaire', 'commentaires', 'remarque', 'remarques', 'description'],
}

const FIELD_ORDER: CrmField[] = CRM_FIELDS.map(f => f.key)

/**
 * Auto-détecte la correspondance en-tête du fichier → champ CRM.
 * Deux passes : correspondance exacte (normalisée) d'abord, puis sous-chaîne — pour que
 * "Téléphone mobile" matche `phone` même sans entrée exacte dans la table de synonymes.
 * Un même en-tête n'est jamais assigné à deux champs CRM.
 */
export function autoDetectMapping(headers: string[]): Partial<Record<CrmField, string>> {
  const result: Partial<Record<CrmField, string>> = {}
  const entries = headers.map(h => ({ raw: h, norm: normalizeHeader(h) }))
  const used = new Set<string>()

  for (const field of FIELD_ORDER) {
    const synonyms = SYNONYMS[field]
    const match = entries.find(e => !used.has(e.raw) && synonyms.includes(e.norm))
    if (match) { result[field] = match.raw; used.add(match.raw) }
  }

  for (const field of FIELD_ORDER) {
    if (result[field]) continue
    const synonyms = SYNONYMS[field]
    const match = entries.find(e =>
      !used.has(e.raw) && e.norm.length > 0 &&
      synonyms.some(syn => e.norm.includes(syn) || syn.includes(e.norm)),
    )
    if (match) { result[field] = match.raw; used.add(match.raw) }
  }

  return result
}

const STORAGE_PREFIX = 'pipeline-import-mapping:'

/** Clé de mémorisation : en-têtes normalisés, triés, joints par « | » (ordre des colonnes indifférent). */
function mappingStorageKey(headers: string[]): string {
  return headers.map(normalizeHeader).sort().join('|')
}

/** Correspondance mémorisée pour un jeu d'en-têtes donné, ou null si aucune / en cas d'erreur de lecture. */
export function loadSavedMapping(headers: string[]): Partial<Record<CrmField, string>> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + mappingStorageKey(headers))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/** Mémorise la correspondance choisie pour ce jeu d'en-têtes (clé insensible à l'ordre des colonnes). */
export function saveMapping(headers: string[], mapping: Partial<Record<CrmField, string>>): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + mappingStorageKey(headers), JSON.stringify(mapping))
  } catch {
    // localStorage indisponible (navigation privée, quota) : la correspondance manuelle reste
    // utilisable pour cet import, seule la mémorisation pour le prochain est perdue.
  }
}
