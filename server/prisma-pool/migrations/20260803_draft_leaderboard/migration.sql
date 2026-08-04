-- AlterTable
ALTER TABLE "PooledDraft" ADD COLUMN     "evaluationScore" DOUBLE PRECISION,
ADD COLUMN     "losses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wins" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "LeaderboardEntry";

