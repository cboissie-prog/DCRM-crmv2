/**
 * global-setup.ts — exécuté UNE FOIS avant tous les tests.
 * 1. Pose les variables d'env (DATABASE_URL pointe sur test.db, jamais dev.db).
 * 2. Réinitialise la base de test via `prisma db push --force-reset`.
 * 3. Seed de base (permissions + rôles + admin).
 */
import { execSync } from 'child_process'
import path from 'path'

export async function setup() {
  // ── 1. Variables d'env ────────────────────────────────────────────────────────
  // Ces variables sont posées ICI pour le processus global-setup (CLI Prisma).
  // Pour les fichiers de test eux-mêmes, elles sont posées via setup-env.ts (setupFiles).
  process.env.DATABASE_URL = 'file:./test.db'
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod'
  process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-do-not-use-in-prod'
  process.env.NODE_ENV = 'test'
  process.env.ADMIN_INITIAL_PASSWORD = 'test-admin-pwd-123'

  // ── 2. Reset + création de la base de test ────────────────────────────────────
  // Le schéma est à src/prisma/schema.prisma.
  // DATABASE_URL=file:./test.db est résolu relatif au schéma → src/prisma/test.db.
  // On passe DATABASE_URL explicitement dans l'env de execSync pour écraser le .env.
  const schemaPath = path.join(process.cwd(), 'src', 'prisma', 'schema.prisma')
  console.log('[global-setup] Resetting test.db via prisma db push --force-reset...')
  execSync(
    `npx prisma db push --force-reset --skip-generate --schema="${schemaPath}"`,
    {
      stdio: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: 'file:./test.db',
      },
    }
  )
  console.log('[global-setup] test.db schema applied.')

  // ── 3. Seed de base ───────────────────────────────────────────────────────────
  // Import dynamique APRÈS avoir posé DATABASE_URL pour que le PrismaClient
  // instancié dans seed.ts cible bien test.db.
  // ATTENTION : seed.ts instancie son propre PrismaClient (pas le singleton).
  // On le déconnecte après usage pour libérer le verrou SQLite.
  const { seedBase } = await import('../src/prisma/seed')
  await seedBase()
  console.log('[global-setup] Seed terminé.')
}

export async function teardown() {
  // Rien à faire — test.db sera réutilisé ou ignoré.
}
