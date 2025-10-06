import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000, // 30 seconds timeout for tests
    hookTimeout: 10000, // 10 seconds for setup/teardown
    teardownTimeout: 5000,
    isolate: true, // Run tests in isolation
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
        useAtomics: true
      }
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'scripts/',
        '*.config.*',
        'coverage/',
        'dist/',
        'build/'
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70
        }
      }
    },
    retry: 2, // Retry flaky tests up to 2 times
    bail: 0, // Don't bail on first failure
    reporter: ['verbose', 'json'],
    outputFile: {
      json: './test-results.json'
    }
  },
  esbuild: {
    target: 'node18'
  }
});