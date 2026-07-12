-- CreateTable
CREATE TABLE "Hero" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "primaryAttribute" TEXT NOT NULL,
    "attackType" TEXT NOT NULL,
    "roles" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "synergyTags" TEXT NOT NULL,
    "counterTags" TEXT NOT NULL,
    "evaluationValues" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'PICKING',
    "seed" INTEGER NOT NULL,
    "pool" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DraftHero" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "draftId" TEXT NOT NULL,
    "heroId" INTEGER NOT NULL,
    "assignedRole" TEXT,
    "pickOrder" INTEGER NOT NULL,
    CONSTRAINT "DraftHero_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DraftHero_draftId_heroId_key" ON "DraftHero"("draftId", "heroId");
