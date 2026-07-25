-- AlterTable
ALTER TABLE "Draft" ADD COLUMN "evaluationResult" TEXT;

-- CreateTable
CREATE TABLE "BattleResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "draftId" TEXT NOT NULL,
    "resolvedOutcome" TEXT NOT NULL,
    "advantageDirection" TEXT NOT NULL,
    "confidenceTier" TEXT NOT NULL,
    "opponentSource" TEXT NOT NULL,
    "opponentTeamName" TEXT,
    "opponentLeagueName" TEXT,
    "opponentHeroIds" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BattleResult_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
