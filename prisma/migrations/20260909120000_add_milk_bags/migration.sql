-- MilkBag discrete breast-milk inventory (issue #8) + family settings blob.
-- SQLite migration; PostgreSQL deploys via `prisma db push` (no migration files).

-- CreateTable
CREATE TABLE "MilkBag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT,
    "dayNight" TEXT NOT NULL DEFAULT 'day',
    "storageLocation" TEXT NOT NULL DEFAULT 'fridge',
    "provenance" TEXT NOT NULL DEFAULT 'fresh',
    "amount" REAL NOT NULL,
    "unitAbbr" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "startedAt" DATETIME NOT NULL,
    "lastLocationChangedAt" DATETIME,
    "usedAt" DATETIME,
    "discardedAmount" REAL,
    "familyId" TEXT,
    "babyId" TEXT NOT NULL,
    "caretakerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "MilkBag_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MilkBag_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MilkBag_caretakerId_fkey" FOREIGN KEY ("caretakerId") REFERENCES "Caretaker" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MilkBag_babyId_idx" ON "MilkBag"("babyId");
CREATE INDEX "MilkBag_familyId_idx" ON "MilkBag"("familyId");
CREATE INDEX "MilkBag_caretakerId_idx" ON "MilkBag"("caretakerId");
CREATE INDEX "MilkBag_status_idx" ON "MilkBag"("status");
CREATE INDEX "MilkBag_deletedAt_idx" ON "MilkBag"("deletedAt");
CREATE INDEX "MilkBag_startedAt_idx" ON "MilkBag"("startedAt");

-- Bag links on existing tables. SQLite cannot add FK constraints via ALTER TABLE,
-- so the PumpLog.milkBagId / FeedLog.milkBagId / FeedLog.sourceBagId columns are
-- plain columns here; the Prisma schema declares the relations and the client
-- enforces referential behavior (as with existing nullable link columns added
-- under the same constraint in restore/re-init flows).
ALTER TABLE "PumpLog" ADD COLUMN "milkBagId" TEXT;
ALTER TABLE "FeedLog" ADD COLUMN "milkBagId" TEXT;
ALTER TABLE "FeedLog" ADD COLUMN "sourceBagId" TEXT;

-- Link indexes (SQLite 3.35+ allows index over columns added in-session)
CREATE INDEX "PumpLog_milkBagId_idx" ON "PumpLog"("milkBagId");
CREATE INDEX "FeedLog_milkBagId_idx" ON "FeedLog"("milkBagId");
CREATE INDEX "FeedLog_sourceBagId_idx" ON "FeedLog"("sourceBagId");

-- Family-level milk-bag settings (day/night boundary, freezer type, upgrade marker)
ALTER TABLE "Settings" ADD COLUMN "milkBagSettings" TEXT;
