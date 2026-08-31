-- AlterTable
ALTER TABLE "Draft" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'battle';

-- AlterTable
ALTER TABLE "BattleResult" ADD COLUMN "stage" TEXT;

-- AlterTable
ALTER TABLE "CaptainsSession" ADD COLUMN "aiDraftId" TEXT;

-- CreateTable
CREATE TABLE "TiRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerToken" TEXT NOT NULL,
    "bracketId" TEXT NOT NULL,
    "leagueName" TEXT NOT NULL,
    "teamName" TEXT,
    "draftId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PICKING_TEAM',
    "losses" INTEGER NOT NULL DEFAULT 0,
    "currentMatchId" TEXT,
    "choiceJson" TEXT NOT NULL,
    "pathJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "TiRun_ownerToken_idx" ON "TiRun"("ownerToken");
CREATE INDEX "TiRun_draftId_idx" ON "TiRun"("draftId");
