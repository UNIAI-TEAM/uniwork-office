import { defineConfig } from 'vitest/config'

// Standalone: web/modules is not an npm workspace (the bridges of the module frames).
// Run: npx vitest run --root web/modules
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['**/*.test.ts'],
  },
})
