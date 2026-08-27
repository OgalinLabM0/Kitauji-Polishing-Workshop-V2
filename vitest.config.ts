import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    include: /.*\.[cm]?[jt]sx?$/,
  },
  test: {
    include: ['src/**/*.test.ts', 'electron/**/*.test.cts'],
    exclude: ['node_modules/**', 'dist/**', '备份/**'],
  },
});
