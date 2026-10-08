import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// UNI-1011 spike: standalone web build of the Docs renderer (no Electron).
// The entry lives in web/docs but imports renderer sources from apps/docs, so the
// whole repo root is allowed for the dev server and workspace packages resolve via
// the hoisted root node_modules (npm workspaces symlinks).
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  server: {
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
})
