-- Migration additive : portée (scopes) des clés API
-- Généré manuellement le 2026-08-12 — types alignés avec les migrations précédentes (PostgreSQL)

-- Tableau JSON de clés de permission (ex. '["tickets:read","contacts:read"]').
-- Décision produit : toutes les clés existantes repartent à '[]' = aucun droit,
-- à reconfigurer via Paramètres → Clés API → Modifier les droits.
ALTER TABLE "ApiKey" ADD COLUMN "scopes" TEXT NOT NULL DEFAULT '[]';
