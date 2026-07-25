-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'PICKING',
    "seed" INTEGER NOT NULL,
    "pool" TEXT NOT NULL,
    "rerollsRemaining" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Draft" ("createdAt", "id", "pool", "seed", "status") SELECT "createdAt", "id", "pool", "seed", "status" FROM "Draft";
DROP TABLE "Draft";
ALTER TABLE "new_Draft" RENAME TO "Draft";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
