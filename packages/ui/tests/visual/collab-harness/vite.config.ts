import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// the harness page is its own Vite root; vitest never loads it (tests/**/*.test.ts only)
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1' },
})
