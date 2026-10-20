import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@genoffice/shortcuts': fileURLToPath(
        new URL('../../packages/shortcuts/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['tests/setup-node-env.ts'],
    testTimeout: 20000,
  },
})
