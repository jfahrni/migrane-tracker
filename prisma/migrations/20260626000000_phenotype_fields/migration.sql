-- Additive Migration: alle neuen Spalten nullable → kein Bestandswert wird verändert.

-- Attack: Phänotyp-Felder
ALTER TABLE "Attack" ADD COLUMN "auraSeverity" INTEGER;
ALTER TABLE "Attack" ADD COLUMN "hadPostdrome" BOOLEAN;
ALTER TABLE "Attack" ADD COLUMN "postdromeNotes" TEXT;
ALTER TABLE "Attack" ADD COLUMN "episodeGroupId" TEXT;

CREATE INDEX "Attack_episodeGroupId_idx" ON "Attack"("episodeGroupId");

-- Medikamenten-Phasen (löst CANDESARTAN_START_DATE ab; Env bleibt Seed-Fallback)
CREATE TABLE "Medication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "Medication_startedAt_idx" ON "Medication"("startedAt" DESC);
