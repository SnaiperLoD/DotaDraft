/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^shared$': '<rootDir>/../../shared/index.ts',
    '^shared/(.*)$': '<rootDir>/../../shared/$1',
    // copied-draft.spec imports via shared-src so Stryker --findRelatedTests
    // can see copiedDraft.ts; map that path to the real package for unit tests.
    '^\\.\\./\\.\\./shared-src/(.*)$': '<rootDir>/../../shared/$1',
  },
};
