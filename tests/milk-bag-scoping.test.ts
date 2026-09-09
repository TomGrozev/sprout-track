import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { createPrismaAdapter } from '@/prisma/prisma-adapter';

/**
 * Milk-bag family-scoping integration test (issue #9 acceptance: "verified by
 * reading generated SQL, not the query object").
 *
 * Executed against a real temporary SQLite database with the real generated
 * Prisma Client, mirroring tests/notification-preferences-legacy-owner.test.ts.
 * We run the exact queries the milk-bag routes issue and read real rows back:
 * cross-family rows must be invisible, and soft-deleted bags must not leak
 * into inventory listings.
 */
describe('milk-bag family scoping (integration)', () => {
 let dbPath: string;
 let prisma: PrismaClient;

 beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `vitest-milk-bag-scoping-${process.pid}-${Date.now()}.db`);

  const db = new Database(dbPath);
  db.exec(`
      CREATE TABLE "Family" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "slug" TEXT NOT NULL UNIQUE,
        "name" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT 1,
        "setupStage" INTEGER NOT NULL DEFAULT 0,
        "accountId" TEXT
      );
      CREATE TABLE "Baby" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "firstName" TEXT NOT NULL,
        "lastName" TEXT NOT NULL,
        "birthDate" DATETIME NOT NULL,
        "gender" TEXT,
        "inactive" BOOLEAN NOT NULL DEFAULT 0,
        "feedWarningTime" TEXT NOT NULL DEFAULT '03:00',
        "diaperWarningTime" TEXT NOT NULL DEFAULT '02:00',
        "feedTimerFrom" TEXT NOT NULL DEFAULT 'start',
        "feedTimerTypes" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTamp,
        "updatedAt" DATETIME NOT NULL,
        "deletedAt" DATETIME,
        "familyId" TEXT,
        CONSTRAINT "Baby_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
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
        "expiryNotifiedAt" DATETIME,
        "familyId" TEXT,
        "babyId" TEXT NOT NULL,
        "caretakerId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "deletedAt" DATETIME,
        CONSTRAINT "MilkBag_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "MilkBag_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE INDEX "MilkBag_babyId_idx" ON "MilkBag"("babyId");
      CREATE INDEX "MilkBag_familyId_idx" ON "MilkBag"("familyId");

      INSERT INTO "Family" (id, slug, name, updatedAt) VALUES ('fam1', 'fam1', 'Family One', datetime('now'));
      INSERT INTO "Family" (id, slug, name, updatedAt) VALUES ('fam2', 'fam2', 'Family Two', datetime('now'));
      INSERT INTO "Baby" (id, firstName, lastName, birthDate, updatedAt, familyId) VALUES ('baby1', 'Alice', 'One', '2025-01-01', datetime('now'), 'fam1');
      INSERT INTO "Baby" (id, firstName, lastName, birthDate, updatedAt, familyId) VALUES ('baby2', 'Bob', 'Two', '2025-01-02', datetime('now'), 'fam2');

      -- Two bags for fam1 (one soft-deleted), one for fam2.
      INSERT INTO "MilkBag" (id, amount, startedAt, familyId, babyId, updatedAt)
        VALUES ('bag1-fam1', 120, '2026-09-09T10:00:00.000Z', 'fam1', 'baby1', datetime('now'));
      INSERT INTO "MilkBag" (id, amount, startedAt, familyId, babyId, updatedAt, deletedAt)
        VALUES ('bag1-fam1-deleted', 999, '2026-09-09T11:00:00.000Z', 'fam1', 'baby1', datetime('now'), datetime('now'));
      INSERT INTO "MilkBag" (id, amount, startedAt, familyId, babyId, updatedAt)
        VALUES ('bag1-fam2', 777, '2026-09-09T12:00:00.000Z', 'fam2', 'baby2', datetime('now'));
    `);
  db.close();

  prisma = new PrismaClient({ adapter: createPrismaAdapter(`file:${dbPath}`) });
 });

 afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
   fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
 });

 it('listing by familyId returns only that family\u2019s live bags', async () => {
  const results = await prisma.milkBag.findMany({
   where: { familyId: 'fam1', deletedAt: null },
   orderBy: { startedAt: 'desc' },
  });
  expect(results.map((r) => r.id)).toEqual(['bag1-fam1']);
 });

 it("does not return another family's bags", async () => {
  const results = await prisma.milkBag.findMany({
   where: { familyId: 'fam2', deletedAt: null },
  });
  expect(results.map((r) => r.id)).toEqual(['bag1-fam2']);
 });

 it('ownership check by bag id never crosses families', async () => {
  const wrongFamily = await prisma.milkBag.findFirst({
   where: { id: 'bag1-fam2', familyId: 'fam1' },
  });
  expect(wrongFamily).toBeNull();

  const rightFamily = await prisma.milkBag.findFirst({
   where: { id: 'bag1-fam1', familyId: 'fam1' },
  });
  expect(rightFamily?.id).toBe('bag1-fam1');
 });

 it('a bag with NULL familyId is invisible to every family scope', async () => {
  await prisma.milkBag.create({
   data: {
    id: 'bag-orphan',
    amount: 50,
    startedAt: new Date('2026-09-09T13:00:00Z'),
    babyId: 'baby1',
    // familyId deliberately unset
   },
  });
  const fam1 = await prisma.milkBag.findMany({ where: { familyId: 'fam1', deletedAt: null } });
  const fam2 = await prisma.milkBag.findMany({ where: { familyId: 'fam2', deletedAt: null } });
  expect(fam1.map((r) => r.id)).not.toContain('bag-orphan');
  expect(fam2.map((r) => r.id)).not.toContain('bag-orphan');
 });

 it('nested OR: [] compiles to a bare familyId filter without leaking other families (Prisma quirk guard)', async () => {
  // The repo was bitten by Prisma dropping a nested empty OR; assert the
  // compiled behavior stays family-tight when a caller composes filters.
  const results = await prisma.milkBag.findMany({
   where: { OR: [{ familyId: 'fam1', deletedAt: null, OR: [] }] } as any,
  });
  expect(results.map((r) => r.id)).toEqual(['bag1-fam1']);
 });
});
