import * as fs from 'fs';
import { TEST_DB_PATH } from './test-db-env';

export default async function globalTeardown(): Promise<void> {
  for (const suffix of ['', '-journal']) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
