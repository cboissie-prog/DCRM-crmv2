-- Migration additive : Pipelines personnels + templates
-- Généré manuellement le 2026-07-02 — types alignés avec 0_init/migration.sql (PostgreSQL)

-- ─── Pipeline : ajout isTemplate + ownerId ───────────────────────────────────
-- isTemplate : true = modèle admin copié à la création d'un compte
-- ownerId    : null = pipeline partagé (legacy) ou template ; défini = pipeline personnel
ALTER TABLE "Pipeline" ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Pipeline" ADD COLUMN "ownerId" TEXT;

-- ─── FK ownerId → User (SetNull à la suppression de l'utilisateur) ───────────
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
