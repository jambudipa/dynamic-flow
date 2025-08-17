import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '*.config.ts',
        '**/*.spec.ts',
        '**/*.test.ts',
        'examples/**',
        'specs/**',
        'tests/setup.ts'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    },
    include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@jambudipa/dynamic-flow': path.resolve(__dirname, './src/index.ts')
    }
  }
})