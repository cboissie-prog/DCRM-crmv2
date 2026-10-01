import { describe, it, expect } from 'vitest'
import { splitFullName, toNationalPhone } from './contactName'

describe('splitFullName', () => {
  it('sépare prénom et nom composé', () => {
    expect(splitFullName('Jean de La Fontaine')).toEqual({ firstName: 'Jean', lastName: 'de La Fontaine' })
  })
  it('gère un mot seul et une valeur vide', () => {
    expect(splitFullName('Madonna')).toEqual({ firstName: 'Madonna', lastName: '' })
    expect(splitFullName(null)).toEqual({ firstName: '', lastName: '' })
  })
})

describe('toNationalPhone', () => {
  it('convertit les préfixes internationaux français', () => {
    expect(toNationalPhone('0033601020304')).toBe('0601020304')
    expect(toNationalPhone('+33 6 01 02 03 04')).toBe('0601020304')
  })
  it('laisse les autres numéros intacts', () => {
    expect(toNationalPhone('0601020304')).toBe('0601020304')
    expect(toNationalPhone(undefined)).toBe('')
  })
})
