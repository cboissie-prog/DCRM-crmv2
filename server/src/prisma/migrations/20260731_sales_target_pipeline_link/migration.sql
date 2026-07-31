-- Migration additive : lien Objectif de vente → Pipeline
-- Généré manuellement le 2026-07-31 — types alignés avec les migrations précédentes (PostgreSQL)

-- ─── SalesTarget : ajout de la référence optionnelle vers un pipeline ─────────
-- NULL = objectif global (tous pipelines confondus)
ALTER TABLE "SalesTarget" ADD COLUMN "pipelineId" TEXT;

-- FK optionnelle : si le pipeline est supprimé, l'objectif redevient global
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_pipelineId_fkey"
  FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
