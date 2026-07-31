import { z } from 'zod'

/**
 * Champs numériques de formulaire.
 *
 * `<input type="number">` rend `""` quand il est vide — et aussi quand la saisie est invalide
 * pour le navigateur, ce qui inclut « 12,50 » avec une virgule décimale en locale française.
 * Or `z.coerce.number().parse('')` renvoie `0` sans erreur : un champ laissé vide était
 * enregistré à zéro, et un prix saisi avec une virgule devenait 0 € silencieusement.
 *
 * Ces deux fabriques normalisent la chaîne vide en `undefined` avant validation :
 * - `optionalNumber` la laisse passer (champ réellement facultatif),
 * - `requiredNumber` la fait échouer avec un message, au lieu d'enregistrer 0.
 *
 * Ne pas remplacer par `.or(z.literal(''))` : dans une union zod, la branche de coercition
 * l'emporte et renvoie 0 — la garde est inopérante.
 */
const emptyToUndefined = (v: unknown) =>
  v === '' || v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v

/** Champ facultatif : vide → `undefined`. */
export function optionalNumber(schema: z.ZodNumber = z.number()) {
  return z.preprocess(emptyToUndefined, z.coerce.number().pipe(schema).optional())
}

/** Champ obligatoire : vide → erreur de validation explicite, jamais 0. */
export function requiredNumber(schema: z.ZodNumber = z.number(), message = 'Valeur requise') {
  return z.preprocess(
    emptyToUndefined,
    z.coerce.number({ error: message }).pipe(schema),
  )
}
