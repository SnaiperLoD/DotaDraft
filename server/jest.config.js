/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/*.spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/../.stryker-tmp/'],
  watchPathIgnorePatterns: ['<rootDir>/../.stryker-tmp/'],
  moduleNameMapper: {
    '^shared$': '<rootDir>/../../shared/index.ts',
    '^shared/(.*)$': '<rootDir>/../../shared/$1',
  },
};
