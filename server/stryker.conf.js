const { syncSharedSrcForStryker } = require('./scripts/sync-shared-src-for-stryker.cjs');

syncSharedSrcForStryker();

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
module.exports = {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  packageManager: 'npm',
  reporters: ['html', 'json', 'clear-text', 'progress'],
  testRunner: 'jest',
  jest: {
    configFile: 'jest.stryker.config.js',
  },
  coverageAnalysis: 'perTest',
  timeoutMS: 20000,
  concurrency: 8,
  tsconfigFile: 'tsconfig.json',
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
  ignorePatterns: ['shared-src/dist'],
  mutate: [
    'src/battle/battle-resolution.ts',
    'src/battle/battle-story.ts',
    'src/battle/battle-lanes.ts',
    'src/battle/battle-explanation.ts',
    'src/battle/battle-cast.ts',
    'src/battle/custom-tags.ts',
    'src/battle/opponent-alignment.ts',
    'src/common/hard-carry.ts',
    'src/common/role-fit.ts',
    'src/common/shutdown.ts',
    'src/draft/draft.service.ts',
    'src/evaluation/analyzers/axis.analyzer.ts',
    'src/evaluation/analyzers/counter.analyzer.ts',
    'src/evaluation/analyzers/pro-similarity.analyzer.ts',
    'src/evaluation/analyzers/synergy.analyzer.ts',
    'src/evaluation/draft-archetype.ts',
    'src/health/health.controller.ts',
    'src/hero-meta/benchmark-calibration.ts',
    'src/hero-meta/hero-meta.service.ts',
    'src/hero/hero-abilities.service.ts',
    'src/hero/hero.controller.ts',
    'src/hero/hero.service.ts',
    'src/opponent-pool/opponent-pool.service.ts',
    'src/battle/challenge-mirror.ts',
    'shared-src/utils/copiedDraft.ts',
  ],
};
