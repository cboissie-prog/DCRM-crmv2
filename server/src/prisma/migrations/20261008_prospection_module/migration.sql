-- Module Prospection (spec docs/superpowers/specs/2026-10-08-prospection-module-design.md, §3)
-- Migration additive : aucune donnée existante à migrer.

-- ─── CreateTable : ProspectList (listes de prospection) ────────────────────
CREATE TABLE "ProspectList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'COLD_CALL',
    "pipelineId" TEXT,
    "assignedToId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectList_pkey" PRIMARY KEY ("id")
);

-- ─── AlterTable : Opportunity — champs de prospection (listId, qualification,
-- documentsSent, qualifiedAt, lastActivityAt). prospectStatus (déjà TEXT depuis la
-- migration 20261006_prospection) accepte désormais aussi UNREACHABLE, NOT_INTERESTED,
-- QUALIFIED sans changement de colonne (String libre).
ALTER TABLE "Opportunity" ADD COLUMN     "listId" TEXT,
ADD COLUMN     "qualification" TEXT,
ADD COLUMN     "documentsSent" TEXT,
ADD COLUMN     "qualifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastActivityAt" TIMESTAMP(3);

-- ─── AlterTable : Appointment — lien vers l'opportunité/prospect d'origine
-- (créé par l'action rapide MEETING_SET).
ALTER TABLE "Appointment" ADD COLUMN     "opportunityId" TEXT;

-- ─── AddForeignKey ──────────────────────────────────────────────────────────
ALTER TABLE "ProspectList" ADD CONSTRAINT "ProspectList_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProspectList" ADD CONSTRAINT "ProspectList_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProspectList" ADD CONSTRAINT "ProspectList_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ProspectList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
