/**
 * The web module registry (GO-B4/B5/B6, UNI-1014/1015/1016): ONE table that says how each
 * genoffice editor is built for the browser. Adding a module is one entry here plus its
 * web/modules/<module>/ directory (index.html + install.ts).
 *
 *   root            directory holding the module's index.html (the Vite root); the html loads the
 *                   bridge installer first, then the app's renderer entry
 *   installer       the preload-globals installer index.html runs first (documentation + tests)
 *   rendererConfig  the app's own renderer Vite config; its `plugins` and `resolve` are reused
 *                   (e.g. pdf.js asset copies, the markdown tiptap dedupe). Docs has none: its
 *                   build predates the registry and stays byte-for-byte what it was
 *   globals         the window globals the installer provides (the app's preload contextBridge names)
 *   csp             sources on top of the shared header-only policy (csp.ts), each with its reason
 *   aliases         module-specific import aliases (repo-relative targets), e.g. browser stubs for
 *                   `node:*` imports of shared packages whose Node-only helpers the frame never calls
 *   prebuild        node scripts (repo-relative) run before Vite, e.g. a native module build
 *   workerFormat    'es' when the module starts module Workers that import other chunks
 *
 * Output: dist-web/<module>/<pkgver>-<sha>[-dirty]/ (docs: dist-web/docs/<v>/, unchanged).
 */
import { resolve } from 'node:path'
import type { CspExtra } from './csp'

export const WEB_MODULE_NAMES = ['docs', 'pdf', 'markdown', 'html', 'slides', 'sheets'] as const
export type WebModule = (typeof WEB_MODULE_NAMES)[number]

export const DEFAULT_WEB_MODULE: WebModule = 'docs'

export interface WebModuleSpec {
  module: WebModule
  /** repo-relative directory holding index.html */
  root: string
  /** repo-relative bridge installer that index.html loads before the renderer */
  installer: string
  /** repo-relative renderer Vite config whose plugins/resolve the web build reuses */
  rendererConfig?: string
  /** the renderer's entry (repo-relative), loaded by index.html after the installer */
  renderer: string
  /** window globals the installer sets (besides __officeWebModule) */
  globals: readonly string[]
  csp?: CspExtra
  /** import specifier -> repo-relative replacement module */
  aliases?: Readonly<Record<string, string>>
  /** repo-relative node scripts run (in order) before the Vite build starts */
  prebuild?: readonly string[]
  /** output format of `new Worker(new URL(...), { type: 'module' })` bundles (Vite default: iife) */
  workerFormat?: 'es'
  /** top-level output directories with fixed (unhashed) names to serve as immutable */
  immutableDirs?: readonly string[]
}

export const WEB_MODULES: Readonly<Record<WebModule, WebModuleSpec>> = {
  docs: {
    module: 'docs',
    root: 'web/docs',
    installer: 'web/docs/bridge/install.ts',
    renderer: 'apps/docs/src/renderer/main.tsx',
    globals: ['desktop', 'projectApi'],
  },
  pdf: {
    module: 'pdf',
    root: 'web/modules/pdf',
    installer: 'web/modules/pdf/install.ts',
    rendererConfig: 'apps/pdf/vite.renderer.config.ts',
    renderer: 'apps/pdf/src/renderer/main.tsx',
    globals: ['pdfApi', 'projectApi'],
    csp: {
      directives: { 'script-src': ["'wasm-unsafe-eval'"] },
      alsoOn: ['/assets/**'],
      why: [
        "pdf: script-src 'wasm-unsafe-eval' compiles same-origin WebAssembly: pdf.js's image codecs (openjpeg / jbig2 / qcms, pdfjs/wasm/*.wasm) and pdfium (annotation delete, text and image edit). It allows WebAssembly compilation only, not JavaScript eval; Docs-style 'self' blocks every compile (measured, inventory-b4 3.3).",
        'pdf: the policy is also sent on /assets/** because the pdf.js worker (assets/pdf.worker.min-*.mjs) takes its CSP from its own script response, not from the page.',
      ],
    },
    // pdf.js CMaps, standard fonts and wasm keep their upstream names (viteStaticCopy)
    immutableDirs: ['pdfjs'],
  },
  markdown: {
    module: 'markdown',
    root: 'web/modules/markdown',
    installer: 'web/modules/markdown/install.ts',
    rendererConfig: 'apps/markdown/vite.renderer.config.ts',
    renderer: 'apps/markdown/src/renderer/main.tsx',
    globals: ['markdownApi', 'projectApi'],
  },
  html: {
    module: 'html',
    root: 'web/modules/html',
    installer: 'web/modules/html/install.ts',
    rendererConfig: 'apps/html/vite.renderer.config.ts',
    renderer: 'apps/html/src/renderer/main.tsx',
    globals: ['htmlApi', 'projectApi'],
    // the desktop preview iframe uses the html-preview: protocol; its web replacement (and any
    // frame-src it needs) is the html module worker's decision, so the scaffold keeps frame-src 'none'
  },
  slides: {
    module: 'slides',
    root: 'web/modules/slides',
    installer: 'web/modules/slides/install.ts',
    rendererConfig: 'apps/slides/vite.renderer.config.ts',
    renderer: 'apps/slides/src/renderer/main.tsx',
    globals: ['slidesApi', 'desktop', 'projectApi'],
    csp: {
      directives: { 'media-src': ["'self'", 'data:', 'blob:'] },
      why: [
        "slides: media-src 'self' data: blob: plays the audio/video embedded in a pptx, which the renderer hands to <audio>/<video> as blob:/data: URLs (default-src 'none' would block them).",
      ],
    },
  },
  sheets: {
    module: 'sheets',
    root: 'web/modules/sheets',
    installer: 'web/modules/sheets/install.ts',
    rendererConfig: 'apps/sheets/vite.renderer.config.ts',
    renderer: 'apps/sheets/src/renderer/main.tsx',
    globals: ['desktopApi', 'projectApi'],
    csp: {
      directives: { 'script-src': ["'wasm-unsafe-eval'"] },
      alsoOn: ['/assets/**'],
      why: [
        "sheets: script-src 'wasm-unsafe-eval' compiles the same-origin xlsx engine (xlsx-sidecar built for wasm32-wasip1, assets/xlsx-sidecar-*.wasm) in the frame's engine Worker (GO-D3 = C, CONTRACT C11). It allows WebAssembly compilation only, not JavaScript eval; 'self' alone blocks every compile.",
        'sheets: the policy is also sent on /assets/** because the engine Worker (assets/engine.worker-*.js) takes its CSP from its own script response, not from the page.',
      ],
    },
    // the Sheets save planner (@genoffice/xlsx-gateway) imports node:* for file helpers the
    // frame never calls; the stubs keep those imports resolvable in the browser bundle
    aliases: {
      'node:crypto': 'web/modules/sheets/engine/node-stubs.ts',
      'node:fs': 'web/modules/sheets/engine/node-stubs.ts',
      'node:fs/promises': 'web/modules/sheets/engine/node-stubs.ts',
      'node:os': 'web/modules/sheets/engine/node-stubs.ts',
      'node:path': 'web/modules/sheets/engine/node-stubs.ts',
    },
    // the engine module: built reproducibly with the pinned toolchain, checksum-verified
    prebuild: ['apps/sheets/native/xlsx-engine/wasm/build-wasm.mjs'],
    workerFormat: 'es',
  },
}

export function isWebModule(x: unknown): x is WebModule {
  return typeof x === 'string' && (WEB_MODULE_NAMES as readonly string[]).includes(x)
}

export function assertWebModule(x: unknown): WebModule {
  if (!isWebModule(x)) {
    throw new Error(`unknown web module "${String(x)}" (one of: ${WEB_MODULE_NAMES.join(', ')})`)
  }
  return x
}

/**
 * The module to build: `--module <m>` / `--module=<m>` in argv, else WEB_MODULE, else docs.
 * (`npm run build:web -- --module pdf` reaches web/scripts/build-web.mjs, which sets WEB_MODULE
 * for the Vite run.)
 */
export function resolveWebModule(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = [],
): WebModule {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--module') return assertWebModule(argv[i + 1])
    if (arg.startsWith('--module=')) return assertWebModule(arg.slice('--module='.length))
  }
  return env.WEB_MODULE ? assertWebModule(env.WEB_MODULE) : DEFAULT_WEB_MODULE
}

/** dist-web/<module>/<version> (WEB_DOCS_OUT_DIR overrides, as before) */
export function moduleOutDir(
  repoRoot: string,
  module: WebModule,
  version: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.WEB_DOCS_OUT_DIR
    ? resolve(repoRoot, env.WEB_DOCS_OUT_DIR)
    : resolve(repoRoot, 'dist-web', module, version)
}
