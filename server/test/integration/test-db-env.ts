import * as path from 'path';

// Same relative-to-schema convention as server/.env's DATABASE_URL, pointed
// at a dedicated file so integration tests never touch database/dev.db.
export const TEST_DATABASE_URL = 'file:../../database/test.db';
export const TEST_DB_PATH = path.resolve(__dirname, '../../../database/test.db');

process.env.DATABASE_URL = TEST_DATABASE_URL;
