import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/lib/index.ts'),
      name: 'DynamicFlow',
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: [
        // Node.js built-ins
        'fs',
        'path',
        'url',
        'util',
        'stream',
        'events',
        'crypto',
        'zlib',
        'os',
        'child_process',
        'node:fs',
        'node:path',
        'node:url',
        'node:util',
        'node:stream',
        'node:events',
        'node:crypto',
        'node:zlib',
        'node:os',
        'node:child_process',
        // Optional runtime deps we load dynamically when available
        'openai',
        'openai/helpers/zod',
        'zod',
        // Database dependencies (optional for persistence backends)
        'redis',
        'pg',
        'mongodb',
        'neo4j-driver',
        'sqlite3',
        'mysql2'
      ]
    },
    sourcemap: true,
    target: 'node18',
    minify: false,
    ssr: true
  }
});
