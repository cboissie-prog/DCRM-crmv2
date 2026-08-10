-- Migration additive : refonte du module Tickets (SLA, historique, temps détaillé, pièces jointes)
-- Générée manuellement le 2026-08-04 — types alignés avec les migrations précédentes (PostgreSQL)

-- ─── Ticket : poids numérique de la priorité (tri correct) ────────────────────
-- `priority` est un String : orderBy dessus trie alphabétiquement (NORMAL avant CRITICAL).
ALTER TABLE "Ticket" ADD COLUMN "priorityOrder" INTEGER NOT NULL DEFAULT 1;

UPDATE "Ticket" SET "priorityOrder" = CASE "priority"
  WHEN 'LOW' THEN 0
  WHEN 'NORMAL' THEN 1
  WHEN 'HIGH' THEN 2
  WHEN 'CRITICAL' THEN 3
  ELSE 1
END;

-- ─── Ticket : index de filtres/tri de la liste ────────────────────────────────
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");
CREATE INDEX "Ticket_assignedToId_idx" ON "Ticket"("assignedToId");
CREATE INDEX "Ticket_companyId_idx" ON "Ticket"("companyId");
CREATE INDEX "Ticket_createdAt_idx" ON "Ticket"("createdAt");
CREATE INDEX "Ticket_priorityOrder_idx" ON "Ticket"("priorityOrder");
CREATE INDEX "Ticket_slaDeadline_idx" ON "Ticket"("slaDeadline");

-- ─── TicketComment : auteur identifié + index ─────────────────────────────────
ALTER TABLE "TicketComment" ADD COLUMN "authorId" TEXT;
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "TicketComment_ticketId_idx" ON "TicketComment"("ticketId");

-- ─── TicketEvent : historique du ticket ───────────────────────────────────────
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "authorId" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketEvent_ticketId_idx" ON "TicketEvent"("ticketId");

ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── TicketTimeEntry : temps passé détaillé ───────────────────────────────────
CREATE TABLE "TicketTimeEntry" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketTimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketTimeEntry_ticketId_idx" ON "TicketTimeEntry"("ticketId");

ALTER TABLE "TicketTimeEntry" ADD CONSTRAINT "TicketTimeEntry_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketTimeEntry" ADD CONSTRAINT "TicketTimeEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── TicketAttachment : pièces jointes ────────────────────────────────────────
CREATE TABLE "TicketAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TicketAttachment_storedName_key" ON "TicketAttachment"("storedName");
CREATE INDEX "TicketAttachment_ticketId_idx" ON "TicketAttachment"("ticketId");

ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
