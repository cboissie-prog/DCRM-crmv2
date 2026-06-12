import { describe, it, expect } from 'vitest'
import { csvEscape } from '../../src/lib/csv'

describe('csvEscape', () => {
  // ── Neutralisation de formules ───────────────────────────────────────────────
  it('neutralise une formule Excel commençant par =', () => {
    expect(csvEscape('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)")
  })

  it('neutralise une formule commençant par +', () => {
    expect(csvEscape('+x')).toBe("'+x")
  })

  it('neutralise une formule commençant par -', () => {
    expect(csvEscape('-x')).toBe("'-x")
  })

  it('neutralise une formule commençant par @', () => {
    expect(csvEscape('@x')).toBe("'@x")
  })

  it('neutralise une valeur commençant par tab', () => {
    expect(csvEscape('\tformule')).toBe("'\tformule")
  })

  // ── Échappement guillemets/virgules ──────────────────────────────────────────
  it('encadre de guillemets une valeur contenant une virgule', () => {
    expect(csvEscape('hello, world')).toBe('"hello, world"')
  })

  it('double les guillemets internes et encadre', () => {
    expect(csvEscape('say "hello"')).toBe('"say ""hello"""')
  })

  it('encadre de guillemets une valeur contenant un retour à la ligne', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
  })

  // ── Valeurs normales inchangées ───────────────────────────────────────────────
  it('laisse une valeur normale intacte', () => {
    expect(csvEscape('hello world')).toBe('hello world')
  })

  it('laisse un nombre intacte', () => {
    expect(csvEscape(42)).toBe('42')
  })

  it('convertit null en chaîne vide', () => {
    expect(csvEscape(null)).toBe('')
  })

  it('convertit undefined en chaîne vide', () => {
    expect(csvEscape(undefined)).toBe('')
  })

  it('laisse une valeur commençant par un chiffre intacte', () => {
    expect(csvEscape('123abc')).toBe('123abc')
  })
})
