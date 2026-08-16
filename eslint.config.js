const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

module.exports = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'server/generated/**',
      'server/data/**',
      'shared/dist/**',
      'client/public/**',
      'e2e/**',
      'playwright.config.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'client/vite.config.ts', 'server/jest.config.js'],
        },
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // Deliberately lean ruleset — a solo/pet-project doesn't benefit from a
      // maximalist style guide, but a missed `await` on a Prisma/fetch call
      // is exactly the class of silent bug this session kept finding by
      // hand (NULL SQL filter, JSON-typed damage_taken column).
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // One-off data/research scripts: `any` from OpenDota's untyped Explorer
    // responses is inherent to the shape of the work, not sloppiness.
    files: ['server/scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    // Test files intentionally use `as any` to build lightweight Prisma
    // mocks — already an established pattern, not worth fighting. Mock
    // methods are also declared `async` to match the real Prisma API shape
    // even when a given mock body has no `await` inside it.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Plain CommonJS config files (this file included) — not part of any
    // app tsconfig, and intentionally use require()/module.exports.
    files: ['eslint.config.js', 'server/jest.config.js'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  prettierConfig,
);
