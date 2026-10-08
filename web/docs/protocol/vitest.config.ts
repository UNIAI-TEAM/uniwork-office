import { defineConfig } from 'vitest/config'

// Standalone: web/docs/protocol is not an npm workspace.
// Run: npx vitest run --root web/docs/protocol
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
})
