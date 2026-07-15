-- CreateTable
CREATE TABLE "DeletedAttack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "intensity" INTEGER,
    "auraSeverity" INTEGER,
    "hasAura" BOOLEAN,
    "auraType" TEXT,
    "hadPostdrome" BOOLEAN,
    "postdromeNotes" TEXT,
    "triggers" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "medications" TEXT,
    "weather" TEXT,
    "episodeGroupId" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "DeletedAttack_deletedAt_idx" ON "DeletedAttack"("deletedAt");
