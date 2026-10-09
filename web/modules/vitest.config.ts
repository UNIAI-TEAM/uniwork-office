import { defineConfig } from 'vitest/config'

// Standalone: web/modules is not an npm workspace.
// Run: npx vitest run --root web/modules (part of `npm run test:web`)
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['**/*.test.ts'],
    // slides/ runs under its own config (engine shims as Vite plugins): --root web/modules/slides
    exclude: ['**/node_modules/**', 'slides/**'],
  },
})
