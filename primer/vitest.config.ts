import { defineConfig } from 'vitest/config';

// Tests import the TypeScript sources directly (vitest transforms them); the MCP +
// installer tests exercise the BUILT launcher (dist/bin/primer.js), so `pretest`
// runs `npm run build` first. `node:sqlite` is a newer builtin Vite doesn't yet
// auto-externalize, so we externalize it explicitly.
export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    server: {
      deps: {
        external: ['node:sqlite'],
      },
    },
  },
});
