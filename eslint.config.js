import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'legacy/**', 'test-results*/**', 'playwright-report*/**', '**/*.tmp.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly',
        fetch: 'readonly', location: 'readonly', history: 'readonly', setTimeout: 'readonly',
        clearTimeout: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', getSelection: 'readonly',
        Blob: 'readonly', confirm: 'readonly', console: 'readonly', HTMLElement: 'readonly', Event: 'readonly',
        requestAnimationFrame: 'readonly', addEventListener: 'readonly', Node: 'readonly', btoa: 'readonly', queueMicrotask: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', CSS: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['src/cli/**', 'src/db/*-cli.ts', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', fetch: 'readonly', performance: 'readonly', console: 'readonly' } },
  },
  {
    // The showcase video: Node build scripts, and the player that runs in the rendering browser.
    files: ['marketing/product-showcase/video-project/**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: {
        process: 'readonly', console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', performance: 'readonly',
        window: 'readonly', document: 'readonly', Node: 'readonly', Image: 'readonly', requestAnimationFrame: 'readonly',
        getComputedStyle: 'readonly', HTMLElement: 'readonly', DataTransfer: 'readonly', File: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
);
