import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@api': path.resolve(__dirname, 'src'),
      '@cio/core': path.resolve(__dirname, '../../packages/core/src'),
      '@cio/db': path.resolve(__dirname, '../../packages/db/src'),
      '@db': path.resolve(__dirname, '../../packages/db/src')
    }
  },
  test: {
    env: {
      NODE_ENV: 'test'
    },
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/']
    }
  }
});
