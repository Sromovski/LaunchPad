import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'runs', 'data', 'tools', 'test-results', 'playwright-report', 'tests/e2e/.tmp'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Channel-art renderer runs in Node and evaluates code in a browser page.
  { files: ['assets/**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', document: 'readonly', window: 'readonly' } } },
);
