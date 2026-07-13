-- CreateTable
CREATE TABLE "ProMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "radiantName" TEXT,
    "direName" TEXT,
    "leagueName" TEXT,
    "radiantWin" BOOLEAN NOT NULL,
    "radiantHeroIds" TEXT NOT NULL,
    "direHeroIds" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
