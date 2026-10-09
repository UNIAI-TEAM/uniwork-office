import { defineConfig } from 'vitest/config'

// Standalone: web/modules/pdf is not an npm workspace (GO-B4 pdf bridge + save-core golden test).
// Run: npx vitest run --root web/modules/pdf
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['**/*.test.ts'],
    testTimeout: 60_000,
  },
})
