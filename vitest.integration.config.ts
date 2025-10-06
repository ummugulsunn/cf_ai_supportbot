import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000, // Longer timeout for integration tests
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['tests/unit/**', 'tests/load/**', 'tests/chaos/**', 'tests/performance/**'],
  },
});