import { Response } from 'express'

/**
 * Résout une relation optionnelle et vérifie son existence avant écriture.
 * - id absent (undefined/null/'') → ne fait rien, renvoie `undefined` (rien à valider).
 * - id fourni mais introuvable → écrit une réponse 400 `{ code, message }`, renvoie `null`.
 * - id fourni et trouvé → renvoie l'enregistrement (pour d'éventuels contrôles de cohérence).
 *
 * L'appelant doit toujours tester `=== null` et `return` immédiatement dans ce cas
 * (la réponse HTTP a déjà été envoyée).
 */
export async function fetchOrFail<T>(
  res: Response,
  id: string | null | undefined,
  code: string,
  message: string,
  finder: (id: string) => Promise<T | null>
): Promise<T | null | undefined> {
  if (!id) return undefined
  const found = await finder(id)
  if (!found) {
    res.status(400).json({ success: false, error: { code, message } })
    return null
  }
  return found
}

/**
 * Vérification d'existence simple (l'enregistrement complet n'est pas nécessaire).
 * Renvoie `false` si l'id est fourni mais introuvable (réponse 400 déjà écrite) ;
 * `true` sinon (id absent ou trouvé).
 */
export async function ensureExists(
  res: Response,
  id: string | null | undefined,
  code: string,
  message: string,
  finder: (id: string) => Promise<{ id: string } | null>
): Promise<boolean> {
  return (await fetchOrFail(res, id, code, message, finder)) !== null
}

/**
 * Vérifie la cohérence entre deux `companyId`. Ne déclenche que lorsque les deux
 * valeurs sont renseignées ET diffèrent : un enregistrement sans société, ou une
 * cible sans société, n'est jamais considéré en conflit (cohérence « souple »
 * par construction — utiliser tel quel pour du strict comme pour du souple selon
 * ce qui est chargé en amont).
 */
export function ensureCompanyMatch(
  res: Response,
  actualCompanyId: string | null | undefined,
  expectedCompanyId: string | null | undefined,
  code: string,
  message: string
): boolean {
  if (actualCompanyId && expectedCompanyId && actualCompanyId !== expectedCompanyId) {
    res.status(400).json({ success: false, error: { code, message } })
    return false
  }
  return true
}
