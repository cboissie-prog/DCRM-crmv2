-- Migration additive : objectifs d'entreprise
-- Généré manuellement le 2026-08-12 — types alignés avec les migrations précédentes (PostgreSQL)

-- ─── CompanyTarget : cible collective par période ("2026", "2026-Q3" ou "2026-01") ─
-- pipelineId NULL = objectif global (tous pipelines). Le réalisé et la répartition
-- sont calculés à la volée par l'API (pas de colonne "actual").
CREATE TABLE "CompanyTarget" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "pipelineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTarget_pkey" PRIMARY KEY ("id")
);

-- FK optionnelle : si le pipeline est supprimé, l'objectif redevient global
ALTER TABLE "CompanyTarget" ADD CONSTRAINT "CompanyTarget_pipelineId_fkey"
  FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
