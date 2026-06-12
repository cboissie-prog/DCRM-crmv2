import { describe, it, expect, afterEach } from 'vitest'

describe('ciContains', () => {
  afterEach(() => {
    // Remet DATABASE_PROVIDER à son état initial
    delete process.env.DATABASE_PROVIDER
  })

  it('retourne { contains } sans mode pour SQLite (pas de DATABASE_PROVIDER)', async () => {
    delete process.env.DATABASE_PROVIDER
    // Re-import pour prendre en compte l'env au moment de l'appel
    const { ciContains } = await import('../../src/lib/query')
    const result = ciContains('foo')
    expect(result).toEqual({ contains: 'foo' })
    expect((result as Record<string, unknown>).mode).toBeUndefined()
  })

  it('retourne { contains, mode: insensitive } pour PostgreSQL', async () => {
    process.env.DATABASE_PROVIDER = 'postgresql'
    const { ciContains } = await import('../../src/lib/query')
    const result = ciContains('bar') as Record<string, unknown>
    expect(result.contains).toBe('bar')
    expect(result.mode).toBe('insensitive')
  })
})
