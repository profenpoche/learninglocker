// Configuration ESLint (format « flat »), commune à tout le monorepo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // Code d'origine : référence, jamais modifié ni analysé.
    ignores: ['legacy/**', '**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }] },
  },
  {
    // Scripts mongosh : variables globales du shell MongoDB.
    files: ['tools/verify-db/inventory.js', 'tools/seed/legacy-quirks.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { db: 'readonly', printjson: 'readonly', ObjectId: 'readonly', print: 'readonly' },
    },
  },
  {
    // Exécuté dans l'image legacy (Node 10, babel-node) : CommonJS.
    files: ['tools/seed/legacy/presave-server.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
);
