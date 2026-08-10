-- Migration additive : verrouillage de compte + invalidation immédiate des access tokens
-- Générée manuellement le 2026-08-10 — types alignés avec les migrations précédentes (PostgreSQL)

-- Verrouillage de compte après échecs de connexion répétés (complète le rate limiting IP)
ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- Incrémenté à chaque désactivation / changement de rôle / changement de mot de passe :
-- invalide immédiatement tous les access tokens déjà émis (vérifié dans authenticate)
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
