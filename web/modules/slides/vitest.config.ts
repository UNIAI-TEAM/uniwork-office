import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import slidesWebPlugins from './vite-web'

// Standalone (web/modules is not an npm workspace): npx vitest run --root web/modules/slides
// The engine closure runs on the same browser shims as the web build (./vite-web.ts), so these
// tests exercise exactly what ships in the frame.
const here = dirname(fileURLToPath(import.meta.url))
const pkg = (p: string) => resolve(here, '../../../packages', p)

export default defineConfig({
  plugins: [slidesWebPlugins()],
  // the engine's `?raw` op docs live outside this root
  server: { fs: { allow: [resolve(here, '../../..')] } },
  resolve: {
    // subpaths before the bare names: string aliases are prefix replacements
    alias: {
      '@genoffice/pptx-engine/table-grid': pkg('pptx-engine/src/table-grid.ts'),
      '@genoffice/pptx-engine/identity': pkg('pptx-engine/src/identity.ts'),
      '@genoffice/pptx-engine/background-promote': pkg('pptx-engine/src/background-promote.ts'),
      '@genoffice/pptx-engine/custgeom': pkg('pptx-engine/src/custgeom.ts'),
      '@genoffice/pptx-engine/named-action': pkg('pptx-engine/src/named-action.ts'),
      '@genoffice/pptx-engine': pkg('pptx-engine/src/index.ts'),
      '@genoffice/pptx-ops/op-docs': pkg('pptx-ops/src/op-docs.ts'),
      '@genoffice/pptx-ops/font-size': pkg('pptx-ops/src/font-size.ts'),
      '@genoffice/pptx-ops': pkg('pptx-ops/src/index.ts'),
      '@genoffice/pptx-render/preset-geometry': pkg('pptx-render/src/preset-geometry.ts'),
      '@genoffice/pptx-render': pkg('pptx-render/src/index.ts'),
      '@genoffice/docx-engine/metafile': pkg('docx-engine/src/metafile.ts'),
      '@genoffice/electron-utils/safe-external-url': pkg('electron-utils/src/safe-external-url.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['**/*.test.ts'],
    testTimeout: 30_000,
  },
})
