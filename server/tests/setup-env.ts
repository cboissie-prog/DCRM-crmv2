/**
 * setup-env.ts — chargé via setupFiles AVANT chaque fichier de test.
 * Pose les variables d'env AVANT tout import du client Prisma.
 */

// Chemin relatif au schéma prisma (src/prisma/schema.prisma)
// Prisma résout DATABASE_URL relatif au schéma quand le path est file:./
process.env.DATABASE_URL = 'file:./test.db'
process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod'
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-do-not-use-in-prod'
process.env.NODE_ENV = 'test'
// ADMIN_INITIAL_PASSWORD utilisé par seedBase
process.env.ADMIN_INITIAL_PASSWORD = 'test-admin-pwd-123'
// Désactive le VOIP_WEBHOOK_SECRET par défaut (chaque test webhook le posera)
delete process.env.VOIP_WEBHOOK_SECRET
