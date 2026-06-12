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

// Variables Google OAuth — posées avec des valeurs de test génériques.
// Les fichiers de test Google peuvent surcharger ou supprimer selon leur besoin.
// Ces variables sont lues comme constantes au niveau module dans les services Google ;
// elles doivent donc être présentes avant le premier import de ces modules.
process.env.GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     ?? 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? 'test-google-client-secret'
process.env.TOKEN_ENC_KEY        = process.env.TOKEN_ENC_KEY        ?? 'a'.repeat(64)
