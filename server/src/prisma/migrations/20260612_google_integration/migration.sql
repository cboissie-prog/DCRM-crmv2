-- Migration additive : Intégration Google OAuth + fondations Calendar
-- Généré manuellement le 2026-06-12 — types alignés avec 0_init/migration.sql (PostgreSQL)

-- ─── User : ajout googleId ────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- ─── Appointment : ajout sourceGoogle + createdById ──────────────────────────
ALTER TABLE "Appointment" ADD COLUMN "sourceGoogle" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN "createdById" TEXT;

-- ─── GoogleCredential ─────────────────────────────────────────────────────────
CREATE TABLE "GoogleCredential" (
    "id"                  TEXT NOT NULL,
    "userId"              TEXT NOT NULL,
    "googleEmail"         TEXT NOT NULL,
    "refreshTokenEnc"     TEXT NOT NULL,
    "calendarSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "syncToken"           TEXT,
    "lastSyncAt"          TIMESTAMP(3),
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleCredential_userId_key" ON "GoogleCredential"("userId");

ALTER TABLE "GoogleCredential"
    ADD CONSTRAINT "GoogleCredential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── AppointmentGoogleEvent ───────────────────────────────────────────────────
CREATE TABLE "AppointmentGoogleEvent" (
    "appointmentId" TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "etag"          TEXT,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentGoogleEvent_pkey" PRIMARY KEY ("appointmentId", "userId")
);

CREATE INDEX "AppointmentGoogleEvent_googleEventId_idx" ON "AppointmentGoogleEvent"("googleEventId");

ALTER TABLE "AppointmentGoogleEvent"
    ADD CONSTRAINT "AppointmentGoogleEvent_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── CalendarAccess ───────────────────────────────────────────────────────────
CREATE TABLE "CalendarAccess" (
    "viewerId"  TEXT NOT NULL,
    "ownerId"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarAccess_pkey" PRIMARY KEY ("viewerId", "ownerId")
);
