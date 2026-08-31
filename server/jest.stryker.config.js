/** @type {import('jest').Config} */
const base = require('./jest.config.js');

// Same as jest.config.js, except it neutralizes the live-Postgres
// regression block in opponent-pool.service.spec.ts (see
// src/test-utils/disable-pool-db-for-stryker.ts) — Stryker's concurrent
// mutant runs aren't safe to point at real shared infrastructure.
// Do not map `shared` to source here: Stryker sandboxes under
// `.stryker-tmp/` and `<rootDir>/../../shared` would miss the real package.
module.exports = {
  ...base,
  moduleNameMapper: {},
  setupFiles: ['<rootDir>/test-utils/disable-pool-db-for-stryker.ts'],
};
