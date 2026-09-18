/** @type {import('jest').Config} */
const base = require('./jest.config.js');

// Same as jest.config.js, except it neutralizes the live-Postgres
// regression block in opponent-pool.service.spec.ts (see
// src/test-utils/disable-pool-db-for-stryker.ts) — Stryker's concurrent
// mutant runs aren't safe to point at real shared infrastructure.
// Do NOT path.resolve(__dirname) here: Jest loads this config from server/,
// while mutants live in the sandbox. <rootDir> is src/ in both places, so
// ../shared-src hits the instrumented copy inside .stryker-tmp/sandbox-*.
// Do not map the `shared` barrel to shared-src: every spec that imports
// `shared` would then be --findRelatedTests for copiedDraft.ts and static
// mutants would rerun hundreds of tests. copied-draft.spec.ts imports
// `shared/utils/copiedDraft` so only that file is remapped into the sandbox.
module.exports = {
  ...base,
  roots: ['<rootDir>', '<rootDir>/../shared-src'],
  moduleNameMapper: {
    '^shared/utils/copiedDraft$': '<rootDir>/../shared-src/utils/copiedDraft.ts',
  },
  setupFiles: ['<rootDir>/test-utils/disable-pool-db-for-stryker.ts'],
};
