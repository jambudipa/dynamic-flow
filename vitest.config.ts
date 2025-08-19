import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types.ts',
        '**/index.ts', // Exclude pure export files
        '**/*.d.ts',
        '**/optional-modules.d.ts'
      ],
      thresholds: {
        lines: 25,
        functions: 15,
        branches: 65,
        statements: 25
      },
      reportsDirectory: './coverage'
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    include: [
      'src/**/*.{test,spec}.ts',
      'tests/**/*.{test,spec}.ts'
    ],
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache'
    ],
    typecheck: {
      enabled: true,
      include: ['src/**/*.{test,spec}.ts']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@tests': path.resolve(__dirname, './tests')
    }
  }
})