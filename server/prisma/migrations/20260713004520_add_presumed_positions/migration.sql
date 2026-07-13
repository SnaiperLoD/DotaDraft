-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Hero" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "primaryAttribute" TEXT NOT NULL,
    "attackType" TEXT NOT NULL,
    "roles" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "synergyTags" TEXT NOT NULL,
    "counterTags" TEXT NOT NULL,
    "evaluationValues" TEXT NOT NULL,
    "presumedPositions" TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO "new_Hero" ("attackType", "counterTags", "evaluationValues", "id", "name", "primaryAttribute", "roles", "synergyTags", "tags") SELECT "attackType", "counterTags", "evaluationValues", "id", "name", "primaryAttribute", "roles", "synergyTags", "tags" FROM "Hero";
DROP TABLE "Hero";
ALTER TABLE "new_Hero" RENAME TO "Hero";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
