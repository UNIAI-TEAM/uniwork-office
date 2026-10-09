import { defineConfig } from 'vitest/config'

// Standalone: web/modules is not an npm workspace.
// Run: npx vitest run --root web/modules (part of `npm run test:web`)
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['**/*.test.ts'],
  },
})
