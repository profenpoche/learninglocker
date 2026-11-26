import { defineConfig } from 'vitest/config';

// Chaque paquet de packages/ et application de apps/ est un projet Vitest.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
