-- CreateTable
CREATE TABLE "SleepLocationSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "location" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sleepId" TEXT NOT NULL,
    CONSTRAINT "SleepLocationSegment_sleepId_fkey" FOREIGN KEY ("sleepId") REFERENCES "SleepLog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SleepLocationSegment_sleepId_startTime_idx" ON "SleepLocationSegment"("sleepId", "startTime");
