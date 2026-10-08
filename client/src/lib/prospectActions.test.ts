import { describe, it, expect } from 'vitest'
import {
  PROSPECT_ACTIONS, PROSPECT_STATUS_CONFIG, PROSPECT_STATUS_ORDER,
  getProspectAction, visibleActions, isDueOrOverdue, inDays, nextMonday, DATE_SHORTCUTS,
} from './prospectActions'

describe('PROSPECT_STATUS_CONFIG', () => {
  it('a une entrée libellé/couleur pour chacun des 7 statuts', () => {
    expect(PROSPECT_STATUS_ORDER).toHaveLength(7)
    for (const status of PROSPECT_STATUS_ORDER) {
      expect(PROSPECT_STATUS_CONFIG[status].label).toBeTruthy()
      expect(PROSPECT_STATUS_CONFIG[status].className).toContain('border')
    }
  })
})

describe('PROSPECT_ACTIONS', () => {
  it('contient les 10 actions du catalogue (spec §4), sans QUALIFICATION', () => {
    const keys = PROSPECT_ACTIONS.map(a => a.key)
    expect(keys).toEqual([
      'NO_ANSWER', 'REACHED', 'CALLBACK', 'DOC_SENT', 'EMAIL_SENT',
      'MEETING_SET', 'NOTE', 'NEXT_ACTION', 'NOT_INTERESTED', 'REOPEN',
    ])
    expect(keys).not.toContain('QUALIFICATION')
  })

  it('getProspectAction retrouve une action par clé', () => {
    expect(getProspectAction('REACHED')?.label).toBe('Joint')
    expect(getProspectAction('UNKNOWN' as never)).toBeUndefined()
  })

  it('porte les raccourcis clavier N/J/R sur Sans réponse/Joint/Rappeler', () => {
    expect(getProspectAction('NO_ANSWER')?.shortcut).toBe('N')
    expect(getProspectAction('REACHED')?.shortcut).toBe('J')
    expect(getProspectAction('CALLBACK')?.shortcut).toBe('R')
  })

  describe('validation des mini-formulaires', () => {
    it('REACHED exige nextAction et remindAt', () => {
      const action = getProspectAction('REACHED')!
      expect(action.validate?.({})).toEqual({ nextAction: 'Champ requis', remindAt: 'Champ requis' })
      expect(action.validate?.({ nextAction: 'Rappeler', remindAt: '2026-10-09T09:00' })).toBeNull()
    })

    it('CALLBACK exige remindAt mais pas nextAction', () => {
      const action = getProspectAction('CALLBACK')!
      expect(action.validate?.({})).toEqual({ remindAt: 'Champ requis' })
      expect(action.validate?.({ remindAt: '2026-10-09T09:00' })).toBeNull()
    })

    it('DOC_SENT exige document', () => {
      const action = getProspectAction('DOC_SENT')!
      expect(action.validate?.({})).toEqual({ document: 'Champ requis' })
      expect(action.validate?.({ document: 'PLAQUETTE' })).toBeNull()
    })

    it('MEETING_SET exige startAt', () => {
      const action = getProspectAction('MEETING_SET')!
      expect(action.validate?.({})).toEqual({ startAt: 'Champ requis' })
    })

    it('NOTE exige une note non vide (espaces rejetés)', () => {
      const action = getProspectAction('NOTE')!
      expect(action.validate?.({ note: '   ' })).toEqual({ note: 'Champ requis' })
      expect(action.validate?.({ note: 'RAS' })).toBeNull()
    })

    it('NEXT_ACTION exige remindAt et nextAction', () => {
      const action = getProspectAction('NEXT_ACTION')!
      expect(action.validate?.({ remindAt: '2026-10-09T09:00' })).toEqual({ nextAction: 'Champ requis' })
    })

    it('NOT_INTERESTED exige reason mais pas note', () => {
      const action = getProspectAction('NOT_INTERESTED')!
      expect(action.validate?.({})).toEqual({ reason: 'Champ requis' })
      expect(action.validate?.({ reason: 'NO_NEED' })).toBeNull()
    })

    it("NO_ANSWER, EMAIL_SENT et REOPEN n'ont aucun champ requis", () => {
      expect(getProspectAction('NO_ANSWER')?.fields).toHaveLength(0)
      expect(getProspectAction('EMAIL_SENT')?.validate).toBeUndefined()
      expect(getProspectAction('REOPEN')?.fields).toHaveLength(0)
    })
  })

  describe('visibleActions', () => {
    it('masque NOT_INTERESTED et REOPEN en mode deal (on perd via l\'étape Perdu)', () => {
      const dealKeys = visibleActions('deal').map(a => a.key)
      expect(dealKeys).not.toContain('NOT_INTERESTED')
      expect(dealKeys).not.toContain('REOPEN')
      expect(dealKeys).toContain('REACHED')
    })

    it('les montre en mode prospect', () => {
      const prospectKeys = visibleActions('prospect', 'NOT_INTERESTED').map(a => a.key)
      expect(prospectKeys).toContain('NOT_INTERESTED')
    })

    it('REOPEN seulement visible depuis NOT_INTERESTED/UNREACHABLE', () => {
      expect(visibleActions('prospect', 'TODO').map(a => a.key)).not.toContain('REOPEN')
      expect(visibleActions('prospect', 'NOT_INTERESTED').map(a => a.key)).toContain('REOPEN')
      expect(visibleActions('prospect', 'UNREACHABLE').map(a => a.key)).toContain('REOPEN')
    })
  })
})

describe('raccourcis de dates', () => {
  it('DATE_SHORTCUTS propose Demain / Dans 3 jours / Lundi prochain', () => {
    expect(DATE_SHORTCUTS.map(s => s.label)).toEqual(['Demain', 'Dans 3 jours', 'Lundi prochain'])
    for (const s of DATE_SHORTCUTS) expect(s.getValue()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('inDays(1) tombe le lendemain à 9h par défaut', () => {
    const value = inDays(1)
    const expected = new Date()
    expected.setDate(expected.getDate() + 1)
    expect(value.slice(0, 10)).toBe(`${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`)
    expect(value.endsWith('T09:00')).toBe(true)
  })

  it('nextMonday() tombe toujours un lundi', () => {
    const value = nextMonday()
    const d = new Date(value)
    expect(d.getDay()).toBe(1)
  })

  it('isDueOrOverdue : vide = false, passé/aujourd\'hui = true, futur = false', () => {
    expect(isDueOrOverdue(undefined)).toBe(false)
    expect(isDueOrOverdue('2000-01-01T00:00')).toBe(true)
    expect(isDueOrOverdue(inDays(5))).toBe(false)
  })
})
