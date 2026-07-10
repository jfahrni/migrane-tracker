-- HistoryEntry neu aufbauen: getrennte Typen statt Freitext-Kategorie,
-- precision/approximate statt whenText. Die Tabelle ist produktiv leer (0 Zeilen),
-- daher ist Drop+Create verlustfrei.
DROP TABLE IF EXISTS "HistoryEntry";

CREATE TABLE "HistoryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "occurredAt" DATETIME,
    "precision" TEXT,
    "approximate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "HistoryEntry_occurredAt_idx" ON "HistoryEntry"("occurredAt" DESC);
CREATE INDEX "HistoryEntry_type_idx" ON "HistoryEntry"("type");

-- Medication: Datums-Präzision ergänzen (additiv, Bestandszeilen unverändert).
-- Ohne das sieht ein hingeschriebenes 01.01.2020 in sechs Monaten wie ein Fakt aus.
ALTER TABLE "Medication" ADD COLUMN "startPrecision" TEXT;
ALTER TABLE "Medication" ADD COLUMN "startApproximate" BOOLEAN NOT NULL DEFAULT false;

-- Dauerhafte Einstellungen (u.a. standingInstructions für das Pflicht-Briefing).
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
