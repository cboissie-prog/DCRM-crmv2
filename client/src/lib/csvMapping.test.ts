import { describe, it, expect, beforeEach } from 'vitest'
import { normalizeHeader, autoDetectMapping, loadSavedMapping, saveMapping } from './csvMapping'

describe('normalizeHeader', () => {
  it('retire les accents et met en minuscules', () => {
    expect(normalizeHeader('Société')).toBe('societe')
    expect(normalizeHeader('Téléphone')).toBe('telephone')
  })

  it('compacte espaces et ponctuation', () => {
    expect(normalizeHeader('  Raison   Sociale  ')).toBe('raison sociale')
    expect(normalizeHeader('E-mail')).toBe('e mail')
  })

  it('normalise deux variantes vers la même chaîne', () => {
    expect(normalizeHeader('SOCIÉTÉ')).toBe(normalizeHeader('société'))
  })
})

describe('autoDetectMapping', () => {
  it('détecte les synonymes usuels (société/tel/email)', () => {
    const mapping = autoDetectMapping(['Société', 'Prénom', 'Nom', 'Téléphone', 'Email'])
    expect(mapping.companyName).toBe('Société')
    expect(mapping.firstName).toBe('Prénom')
    expect(mapping.lastName).toBe('Nom')
    expect(mapping.phone).toBe('Téléphone')
    expect(mapping.email).toBe('Email')
  })

  it("reconnaît d'autres synonymes (raison sociale, mobile, mail, CA)", () => {
    const mapping = autoDetectMapping(['Raison sociale', 'Mobile', 'Mail', 'CA'])
    expect(mapping.companyName).toBe('Raison sociale')
    expect(mapping.phone).toBe('Mobile')
    expect(mapping.email).toBe('Mail')
    expect(mapping.value).toBe('CA')
  })

  it('matche par sous-chaîne quand aucun synonyme exact ne correspond', () => {
    const mapping = autoDetectMapping(['Téléphone portable', 'Site internet'])
    expect(mapping.phone).toBe('Téléphone portable')
    expect(mapping.website).toBe('Site internet')
  })

  it("n'assigne jamais deux fois le même en-tête", () => {
    const mapping = autoDetectMapping(['Nom'])
    const assignedHeaders = Object.values(mapping)
    expect(assignedHeaders.length).toBe(new Set(assignedHeaders).size)
  })

  it('ignore les colonnes sans correspondance connue', () => {
    const mapping = autoDetectMapping(['Colonne inconnue'])
    expect(Object.keys(mapping).length).toBe(0)
  })

  it('est insensible à la casse et aux accents', () => {
    const mapping = autoDetectMapping(['SOCIETE', 'telephone'])
    expect(mapping.companyName).toBe('SOCIETE')
    expect(mapping.phone).toBe('telephone')
  })
})

describe('saveMapping / loadSavedMapping', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('mémorise puis retrouve la correspondance pour un jeu d\'en-têtes', () => {
    const headers = ['Société', 'Téléphone']
    expect(loadSavedMapping(headers)).toBeNull()
    saveMapping(headers, { companyName: 'Société', phone: 'Téléphone' })
    expect(loadSavedMapping(headers)).toEqual({ companyName: 'Société', phone: 'Téléphone' })
  })

  it("retrouve la correspondance même si l'ordre des colonnes change", () => {
    saveMapping(['Société', 'Téléphone'], { companyName: 'Société', phone: 'Téléphone' })
    expect(loadSavedMapping(['Téléphone', 'Société'])).toEqual({ companyName: 'Société', phone: 'Téléphone' })
  })

  it('ne retrouve rien pour un jeu d\'en-têtes différent', () => {
    saveMapping(['Société', 'Téléphone'], { companyName: 'Société', phone: 'Téléphone' })
    expect(loadSavedMapping(['Société', 'Email'])).toBeNull()
  })

  it('ne lève pas si localStorage est indisponible', () => {
    const original = window.localStorage.setItem
    window.localStorage.setItem = () => { throw new Error('quota') }
    expect(() => saveMapping(['Société'], { companyName: 'Société' })).not.toThrow()
    window.localStorage.setItem = original
  })
})
