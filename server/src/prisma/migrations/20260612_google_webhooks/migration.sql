-- Migration additive : Push notifications Google Calendar (watch channels)
-- Généré manuellement le 2026-06-12 — types alignés avec migration précédente (PostgreSQL)

-- ─── GoogleCredential : ajout des champs de canal watch ──────────────────────
ALTER TABLE "GoogleCredential" ADD COLUMN "channelId"         TEXT;
ALTER TABLE "GoogleCredential" ADD COLUMN "channelResourceId" TEXT;
ALTER TABLE "GoogleCredential" ADD COLUMN "channelToken"      TEXT;
ALTER TABLE "GoogleCredential" ADD COLUMN "channelExpiresAt"  TIMESTAMP(3);

-- Index unique sur channelId (lookup rapide à la réception d'une notification)
CREATE UNIQUE INDEX "GoogleCredential_channelId_key" ON "GoogleCredential"("channelId");
