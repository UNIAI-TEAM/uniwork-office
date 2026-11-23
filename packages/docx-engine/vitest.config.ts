import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
<<<<<<< ours
    setupFiles: ['tests/setup-equality.ts'],
=======
    setupFiles: ['tests/setup-equality.ts', 'tests/setup-strict-xml.ts'],
>>>>>>> theirs
    testTimeout: 20000,
  },
})
