import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // this checkout's table sources (a worktree's node_modules may link into another checkout)
      '@genoffice/shortcuts': fileURLToPath(
        new URL('../../packages/shortcuts/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
})
