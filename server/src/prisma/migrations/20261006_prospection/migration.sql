-- AlterTable : nouveaux champs de prospection sur Opportunity (spec §3). "leadId" est
-- conservé pour le moment : la conversion des leads non convertis, ci-dessous, doit encore
-- pouvoir déterminer quels leads ont déjà une opportunité liée.
ALTER TABLE "Opportunity" ADD COLUMN     "callAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastContactedAt" TIMESTAMP(3),
ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "prospectStatus" TEXT NOT NULL DEFAULT 'TODO',
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- Conversion des leads non convertis en opportunités (spec §3) : pour chaque Lead dont le
-- statut n'est pas CONVERTED et qui n'a pas déjà d'opportunité liée, crée une opportunité
-- sur la première étape ouverte (ni gagnée ni perdue) du pipeline par défaut actif.
-- En production actuelle, aucun lead n'existe encore à convertir (table vide) ; ce bloc
-- reste correct pour toute base (dev/legacy) qui en contiendrait au moment de la migration.
INSERT INTO "Opportunity" (
  "id", "title", "contactId", "companyId", "pipelineId", "stage",
  "source", "notes", "value", "probability", "autoArchive",
  "prospectStatus", "callAttempts", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  l."title",
  l."contactId",
  c."companyId",
  dp."id",
  COALESCE(fs."key", 'NEW'),
  l."source",
  l."description",
  0,
  20,
  true,
  'TODO',
  0,
  l."createdAt",
  l."updatedAt"
FROM "Lead" l
JOIN "Contact" c ON c."id" = l."contactId"
LEFT JOIN "Opportunity" existing ON existing."leadId" = l."id"
LEFT JOIN LATERAL (
  SELECT p."id"
  FROM "Pipeline" p
  WHERE p."isDefault" = true AND p."isActive" = true
  ORDER BY p."order" ASC, p."createdAt" ASC
  LIMIT 1
) dp ON true
LEFT JOIN LATERAL (
  SELECT ps."key"
  FROM "PipelineStage" ps
  WHERE ps."pipelineId" = dp."id" AND ps."isWon" = false AND ps."isLost" = false
  ORDER BY ps."order" ASC
  LIMIT 1
) fs ON true
WHERE l."status" <> 'CONVERTED'
  AND existing."id" IS NULL;

-- Suppression des automatisations utilisant l'ancien déclencheur LEAD_SCORE_THRESHOLD
-- (le scoring de lead n'existe plus, Lead étant fusionné dans Opportunity). AutomationLog
-- porte onDelete: Cascade sur Automation : les logs liés sont supprimés automatiquement.
DELETE FROM "Automation" WHERE "trigger" = 'LEAD_SCORE_THRESHOLD';

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_leadId_fkey";

-- DropIndex
DROP INDEX "Opportunity_leadId_key";

-- AlterTable
ALTER TABLE "Opportunity" DROP COLUMN "leadId";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_contactId_fkey";

-- DropTable
DROP TABLE "Lead";
