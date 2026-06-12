/**
 * normalizePhone — normalise un numéro de téléphone en chaîne de chiffres uniquement.
 *
 * Règles :
 *  1. Retourne null si la valeur est vide/null/undefined.
 *  2. Supprime tout sauf les chiffres.
 *  3. Convertit le préfixe international français (0033 ou 33 suivi de 9 chiffres)
 *     en format national (0 + 9 chiffres).
 *  4. Retourne null si le résultat est inférieur à 6 chiffres (numéro invalide).
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null

  // Supprime tout sauf les chiffres
  const digits = raw.replace(/\D/g, '')

  if (!digits) return null

  // Préfixe international français → format national
  // 0033 + 9 chiffres
  if (/^0033\d{9}$/.test(digits)) {
    return '0' + digits.slice(4)
  }
  // 33 + 9 chiffres (ex : +33 6 01 02 03 04 → 330601020304)
  if (/^33\d{9}$/.test(digits)) {
    return '0' + digits.slice(2)
  }

  // Numéro trop court → invalide
  if (digits.length < 6) return null

  return digits
}
