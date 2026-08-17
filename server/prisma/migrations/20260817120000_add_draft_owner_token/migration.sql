-- AlterTable
ALTER TABLE "Draft" ADD COLUMN "ownerToken" TEXT;

-- CreateIndex
CREATE INDEX "Draft_ownerToken_idx" ON "Draft"("ownerToken");
