import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Factor packages have broken ESM directory imports; force CJS
      '@factordao/sdk-studio': path.resolve(__dirname, 'node_modules/@factordao/sdk-studio/dist/cjs/index.js'),
      '@factordao/sdk': path.resolve(__dirname, 'node_modules/@factordao/sdk/dist/cjs/index.js'),
      '@factordao/tokenlist': path.resolve(__dirname, 'node_modules/@factordao/tokenlist/dist/cjs/index.js'),
    },
  },
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
