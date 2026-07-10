-- Additive Migration: neue Tabelle, kein Bestandsdatensatz wird verändert.

-- Freie Anamnese / Vorgeschichte (Vorbefunde, Bildgebung, Ereignisse, Komorbiditäten)
CREATE TABLE "HistoryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "occurredAt" DATETIME,
    "whenText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "HistoryEntry_occurredAt_idx" ON "HistoryEntry"("occurredAt" DESC);
