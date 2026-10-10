import { defineConfig } from 'vitest/config'

// Standalone: web/modules is not an npm workspace.
// Run: npx vitest run --root web/modules (part of `npm run test:web`)
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['**/*.test.ts'],
    // slides/ and pdf/ run under their own configs (engine shims, long golden tests): --root web/modules/<m>
    exclude: ['**/node_modules/**', 'slides/**', 'pdf/**'],
  },
})
