-- CreateTable
CREATE TABLE "CaptainsSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFTING',
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "playerReserveMs" INTEGER NOT NULL,
    "aiReserveMs" INTEGER NOT NULL,
    "stepStartedAt" DATETIME NOT NULL,
    "actionsJson" TEXT NOT NULL,
    "draftId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CaptainsSession_ownerToken_idx" ON "CaptainsSession"("ownerToken");
