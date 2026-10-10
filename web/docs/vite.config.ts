import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { cspOptionsFromEnv } from './build/csp'
import { woff2FontsPlugin } from './build/fonts-woff2'
import { fontBuildOptions, webDocsManifestPlugin } from './build/plugin'
import { resolveVersion } from './build/version'

// Standalone web build of the Docs renderer (no Electron): `npm run build:web`.
// The entry lives in web/docs but imports renderer sources from apps/docs, so the
// whole repo root is allowed for the dev server and workspace packages resolve via
// the hoisted root node_modules (npm workspaces symlinks).
//
// Output: dist-web/docs/<version>/ with manifest.json, csp.json, headers.json (see web/docs/build/).
// base './' keeps every URL relative, so the directory can be served under any prefix
// (/office-frame/docs/<version>/) or on its own subdomain without a rebuild.
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const version = resolveVersion(repoRoot)

export default defineConfig({
  root: here,
  base: './',
  plugins: [
    woff2FontsPlugin(),
    react(),
    webDocsManifestPlugin({ version, csp: cspOptionsFromEnv() }),
  ],
  server: {
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: process.env.WEB_DOCS_OUT_DIR
      ? resolve(repoRoot, process.env.WEB_DOCS_OUT_DIR)
      : resolve(repoRoot, 'dist-web/docs', version.version),
    emptyOutDir: true,
    // sourcemaps are ~12 MiB and not served by the host; WEB_DOCS_SOURCEMAP=1 keeps them (composition analysis, debugging)
    sourcemap: process.env.WEB_DOCS_SOURCEMAP === '1',
    assetsInlineLimit: fontBuildOptions.assetsInlineLimit,
    rollupOptions: { output: { assetFileNames: fontBuildOptions.assetFileNames } },
  },
})
