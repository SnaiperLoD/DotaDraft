-- AlterTable
ALTER TABLE "PooledDraft" ADD COLUMN "sourceDraftId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PooledDraft_sourceDraftId_key" ON "PooledDraft"("sourceDraftId");
