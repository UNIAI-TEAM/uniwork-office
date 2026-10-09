import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadConfigFromFile, type PluginOption, type UserConfig } from 'vite'
import { cspOptionsFromEnv } from './build/csp'
import { woff2FontsPlugin } from './build/fonts-woff2'
import { moduleOutDir, resolveWebModule, WEB_MODULES, type WebModuleSpec } from './build/modules'
import { fontBuildOptions, webDocsManifestPlugin } from './build/plugin'
import { resolveVersion } from './build/version'

// Standalone web build of a genoffice renderer (no Electron): `npm run build:web [-- --module <m>]`.
// The module comes from WEB_MODULE (set by web/scripts/build-web.mjs from --module), default docs;
// the registry web/docs/build/modules.ts says where each module's index.html and renderer config are.
// Each entry imports renderer sources from apps/<app>, so the whole repo root is allowed for the dev
// server and workspace packages resolve via the hoisted root node_modules (npm workspaces symlinks).
//
// Output: dist-web/<module>/<version>/ with manifest.json, csp.json, headers.json (see web/docs/build/).
// base './' keeps every URL relative, so the directory can be served under any prefix
// (/office-frame/<module>/<version>/) or on its own subdomain without a rebuild.
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const version = resolveVersion(repoRoot)
const spec = WEB_MODULES[resolveWebModule(process.env, process.argv)]

/** the app's own renderer config: its plugins (incl. react) and resolve rules are reused */
async function rendererParts(
  s: WebModuleSpec,
  env: { command: 'build' | 'serve'; mode: string },
): Promise<Pick<UserConfig, 'plugins' | 'resolve'>> {
  if (!s.rendererConfig) return { plugins: [react()] }
  const file = resolve(repoRoot, s.rendererConfig)
  const loaded = await loadConfigFromFile(env, file, dirname(file))
  if (!loaded) throw new Error(`web-${s.module}: cannot load ${s.rendererConfig}`)
  return { plugins: loaded.config.plugins ?? [], resolve: loaded.config.resolve }
}

export default defineConfig(async ({ command, mode }) => {
  const renderer = await rendererParts(spec, { command, mode })
  const plugins: PluginOption[] = [
    woff2FontsPlugin(),
    ...(renderer.plugins ?? []),
    webDocsManifestPlugin({
      version,
      module: spec.module,
      csp: { ...cspOptionsFromEnv(), ...(spec.csp ? { extra: spec.csp } : {}) },
      headers: { immutableDirs: [...(spec.immutableDirs ?? [])] },
    }),
  ]
  return {
    root: resolve(repoRoot, spec.root),
    base: './',
    plugins,
    ...(renderer.resolve ? { resolve: renderer.resolve } : {}),
    server: {
      fs: { allow: [repoRoot] },
    },
    build: {
      outDir: moduleOutDir(repoRoot, spec.module, version.version),
      emptyOutDir: true,
      // sourcemaps are ~12 MiB and not served by the host; WEB_DOCS_SOURCEMAP=1 keeps them (composition analysis, debugging)
      sourcemap: process.env.WEB_DOCS_SOURCEMAP === '1',
      assetsInlineLimit: fontBuildOptions.assetsInlineLimit,
      rollupOptions: { output: { assetFileNames: fontBuildOptions.assetFileNames } },
    },
  }
})
