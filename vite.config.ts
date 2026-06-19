import { defineConfig } from 'vitest/config';

// Relative base so the build works on any static host, including GitHub Pages
// project pages (served from a sub-path) without rewriting asset URLs.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
