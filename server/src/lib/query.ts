// contains insensible à la casse, portable SQLite (dev) / PostgreSQL (prod).
// SQLite : LIKE déjà insensible (ASCII) et le client généré n'accepte pas `mode`.
// PostgreSQL : nécessite mode: 'insensitive'.
export function ciContains(value: string): { contains: string } {
  if (process.env.DATABASE_PROVIDER === 'postgresql') {
    return { contains: value, mode: 'insensitive' } as unknown as { contains: string }
  }
  return { contains: value }
}
