/** @type {import('jest').Config} */
const base = require('./jest.config.js');

// Same as jest.config.js, except it neutralizes the live-Postgres
// regression block in opponent-pool.service.spec.ts (see
// src/test-utils/disable-pool-db-for-stryker.ts) — Stryker's concurrent
// mutant runs aren't safe to point at real shared infrastructure.
// Do NOT path.resolve(__dirname) here: Jest loads this config from server/,
// while mutants live in the sandbox. <rootDir> is src/ in both places, so
// ../shared-src hits the instrumented copy inside .stryker-tmp/sandbox-*.
// Do not map the `shared` barrel to source: every spec that imports `shared`
// would then be --findRelatedTests for copiedDraft.ts and static mutants would
// rerun hundreds of tests (timeouts look like kills). copied-draft.spec.ts
// imports ../../shared-src/utils/copiedDraft so Jest can see the file.
module.exports = {
  ...base,
  roots: ['<rootDir>', '<rootDir>/../shared-src'],
  moduleNameMapper: {},
  setupFiles: ['<rootDir>/test-utils/disable-pool-db-for-stryker.ts'],
};
