-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "ts" DATETIME NOT NULL,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "draftKey" TEXT,
    "props" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "FunnelEvent_sessionId_idx" ON "FunnelEvent"("sessionId");

-- CreateIndex
CREATE INDEX "FunnelEvent_name_idx" ON "FunnelEvent"("name");
