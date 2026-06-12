import { describe, it, expect } from 'vitest'
import { parseJwtPayload } from './api'

describe('parseJwtPayload', () => {
  it('décoder un payload JWT valide', () => {
    const payload = { userId: '123', role: 'ADMIN', permissions: ['contacts:read'] }
    const encoded = btoa(JSON.stringify(payload))
    const token = `header.${encoded}.signature`
    expect(parseJwtPayload(token)).toEqual(payload)
  })

  it('retourner {} pour une chaîne invalide', () => {
    expect(parseJwtPayload('invalid')).toEqual({})
  })

  it('retourner {} pour un token sans payload', () => {
    expect(parseJwtPayload('a.b')).toEqual({})
  })

  it('retourner {} pour un token avec payload non-JSON', () => {
    const token = `header.${btoa('not-json')}.signature`
    expect(parseJwtPayload(token)).toEqual({})
  })
})
