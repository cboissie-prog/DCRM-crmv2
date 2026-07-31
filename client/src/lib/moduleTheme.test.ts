import { describe, it, expect } from 'vitest'
import { moduleColors } from '../../module.colors.js'
import { moduleTheme } from './moduleTheme'

const EXPECTED_KEYS = ['dashboard', 'calls', 'commercial', 'agenda', 'contacts', 'parc', 'tickets', 'tools']

describe('module.colors.js', () => {
  it('définit une palette pour chacun des 8 modules', () => {
    expect(Object.keys(moduleColors).sort()).toEqual([...EXPECTED_KEYS].sort())
  })

  it('chaque palette contient les teintes utilisées par le thème (50, 400, 600, 700)', () => {
    for (const [key, palette] of Object.entries(moduleColors)) {
      for (const shade of ['50', '400', '600', '700']) {
        expect(palette[shade], `teinte ${shade} manquante pour ${key}`).toBeTruthy()
      }
    }
  })
})

describe('moduleTheme', () => {
  it('couvre exactement les mêmes clés que module.colors.js', () => {
    expect(Object.keys(moduleTheme).sort()).toEqual(Object.keys(moduleColors).sort())
  })

  it('utilise uniquement des classes sémantiques module-<clé>', () => {
    for (const [key, theme] of Object.entries(moduleTheme)) {
      expect(theme.icon).toBe(`text-module-${key}-600`)
      expect(theme.bg).toBe(`bg-module-${key}-50`)
      expect(theme.activeBg).toBe(`bg-module-${key}-50`)
      expect(theme.activeText).toBe(`text-module-${key}-700`)
    }
  })
})
