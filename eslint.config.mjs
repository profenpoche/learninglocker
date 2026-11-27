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
    // API NestJS : les options de Mongoose et de NestJS sont typées par des classes mais s'écrivent en
    // objets littéraux ; les modules NestJS sont des classes vides décorées.
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-class-instance-assignment': 'off',
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
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
    files: ['tools/seed/legacy/presave-server.js', 'tools/oracle/legacy/lib-oracle-server.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
);
