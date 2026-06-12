import { describe, it, expect } from 'vitest'
import { normalizePhone } from '../../src/lib/phone'

describe('normalizePhone', () => {
  it('normalise un numéro français avec espaces', () => {
    expect(normalizePhone('04 72 12 34 56')).toBe('0472123456')
  })

  it('normalise un numéro international +33 en format national', () => {
    expect(normalizePhone('+33 6 01 02 03 04')).toBe('0601020304')
  })

  it('normalise un numéro 0033 en format national', () => {
    expect(normalizePhone('0033601020304')).toBe('0601020304')
  })

  it('retourne null pour une chaîne vide', () => {
    expect(normalizePhone('')).toBeNull()
  })

  it('retourne null pour null', () => {
    expect(normalizePhone(null)).toBeNull()
  })

  it('retourne null pour undefined', () => {
    expect(normalizePhone(undefined)).toBeNull()
  })

  it('retourne null si moins de 6 chiffres', () => {
    expect(normalizePhone('123')).toBeNull()
  })

  it('retourne null pour 5 chiffres exactement', () => {
    expect(normalizePhone('12345')).toBeNull()
  })

  it('accepte exactement 6 chiffres', () => {
    expect(normalizePhone('123456')).toBe('123456')
  })

  it('supprime les tirets et points', () => {
    expect(normalizePhone('04.72.12.34.56')).toBe('0472123456')
  })

  it('ne confond pas un numéro commençant par 33 sans le bon pattern', () => {
    // 33 + 8 chiffres → ne match pas /^33\d{9}$/ → retourne tel quel (10 chiffres)
    expect(normalizePhone('3312345678')).toBe('3312345678')
  })
})
