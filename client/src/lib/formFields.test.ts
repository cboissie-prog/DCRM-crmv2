import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { optionalNumber, requiredNumber } from './formFields'

/**
 * Le piège que ces helpers neutralisent : `z.coerce.number().parse('')` renvoie 0 sans erreur.
 * Un champ laissé vide était donc enregistré à zéro — SLA à 0 h (dépassé d'emblée), stock à 0
 * avec badge de rupture, effectif d'entreprise écrasé au simple réenregistrement d'une fiche.
 */
describe('optionalNumber', () => {
  it('traite une saisie vide comme non renseignée, pas comme zéro', () => {
    const schema = optionalNumber(z.number().int())
    expect(schema.parse('')).toBeUndefined()
    expect(schema.parse('   ')).toBeUndefined()
    expect(schema.parse(undefined)).toBeUndefined()
    expect(schema.parse(null)).toBeUndefined()
  })

  it('conserve une valeur saisie, zéro compris', () => {
    const schema = optionalNumber()
    expect(schema.parse('42')).toBe(42)
    expect(schema.parse('0')).toBe(0)
    expect(schema.parse('19.99')).toBe(19.99)
  })

  it('applique toujours les bornes', () => {
    const schema = optionalNumber(z.number().min(0).max(100))
    expect(schema.safeParse('150').success).toBe(false)
    expect(schema.safeParse('50').success).toBe(true)
  })

  it('rejette une virgule décimale au lieu de la convertir en zéro', () => {
    // En locale française, <input type="number"> rend "" pour « 12,50 » ; si la valeur brute
    // arrive quand même, elle doit échouer visiblement et non devenir 0.
    expect(optionalNumber().safeParse('12,50').success).toBe(false)
  })
})

describe('requiredNumber', () => {
  it('refuse une saisie vide avec un message, au lieu d\'enregistrer zéro', () => {
    const schema = requiredNumber(z.number().min(0), 'Prix requis')
    const result = schema.safeParse('')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toBe('Prix requis')
  })

  it('accepte zéro lorsqu\'il est saisi explicitement', () => {
    expect(requiredNumber(z.number().min(0)).parse('0')).toBe(0)
  })

  it('applique toujours les bornes', () => {
    expect(requiredNumber(z.number().min(0)).safeParse('-5').success).toBe(false)
    expect(requiredNumber(z.number().min(1)).safeParse('3').success).toBe(true)
  })
})
