-- Redact coin-flip easter eggs from run leaderboards; persist opponent match
-- ids so History can show the TI Finals badge. Index fights by draft.

ALTER TABLE "BattleResult" ADD COLUMN "coinFlip" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "BattleResult" ADD COLUMN "opponentMatchId" TEXT;

CREATE INDEX "BattleResult_draftId_idx" ON "BattleResult"("draftId");
