import { z } from 'zod'

/**
 * Champ date optionnel provenant d'un formulaire.
 *
 * Un `<input type="date">` non renseigné rend `""`, pas `undefined`. Or les routes construisent
 * leur payload par `const data = { ...body }` puis convertissent la date derrière un test de
 * véracité : la chaîne vide échoue au test, la conversion est sautée, et le `""` recopié par le
 * spread part tel quel vers Prisma — qui répond « Expected ISO-8601 DateTime » en erreur 500.
 * Concrètement, une licence sans date d'expiration était impossible à créer.
 *
 * Normaliser dès le parsing évite d'avoir à s'en souvenir sur chaque route.
 */
export const optionalDateString = z.preprocess(
  v => (v === '' ? undefined : v),
  z.string().optional(),
)

/**
 * Champ numérique optionnel provenant d'un formulaire.
 *
 * Même motif : `<input type="number">` vidé rend `""`, et une coercition numérique le
 * convertirait en `0` — un SLA vide devenant « 0 heure », donc dépassé d'emblée.
 */
export const optionalNumber = z.preprocess(
  v => (v === '' || v === null ? undefined : v),
  z.coerce.number().optional(),
)
