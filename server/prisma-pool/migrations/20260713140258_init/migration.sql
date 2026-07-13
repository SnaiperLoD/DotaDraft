-- CreateTable
CREATE TABLE "PooledDraft" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'player',
    "submitterToken" TEXT,
    "heroIds" JSONB NOT NULL,
    "teamName" TEXT,
    "leagueName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PooledDraft_pkey" PRIMARY KEY ("id")
);
