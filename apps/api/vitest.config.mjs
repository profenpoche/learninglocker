import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    include: ['src/**/*.test.ts'],
    // Les tests d'intégration (MongoDB, Redis) partagent une base : pas de parallélisme entre fichiers.
    fileParallelism: false,
  },
});
