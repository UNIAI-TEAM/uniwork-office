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
  /**
   * repo-relative module whose default export returns web-only Vite plugins (e.g. browser shims
   * for an engine that runs in the frame); added after the renderer's own plugins
   */
  webPlugins?: string
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
    // the save core imports main's redaction.ts (createHash('sha256') over image data). Redaction
    // is off on the web (capability `redaction`), but the import is static: the Slides shim is the
    // real synchronous SHA-256, so the bundle resolves and a stray call still hashes correctly
    aliases: {
      'node:crypto': 'web/modules/slides/shims/crypto.ts',
    },
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
    // preview with scripts, like the app (CONTRACT C15(1)): the document runs in preview.html,
    // embedded sandboxed (opaque origin, credentialless) with a policy of its own
    csp: {
      directives: { 'frame-src': ["'self'"] },
      why: [
        "html: frame-src 'self' embeds the bundle's preview.html (the document preview with scripts). It is loaded in an iframe with sandbox=\"allow-scripts allow-forms allow-popups allow-modals\" (no allow-same-origin: opaque origin) and credentialless; a srcdoc/blob preview cannot run scripts because it inherits this frame policy, and loosening this policy would loosen the same-origin frame itself (inventory-b4 C-3). frame-src also stops the preview from navigating itself to any other origin.",
      ],
      documents: [
        {
          path: '/preview.html',
          directives: {
            'default-src': ["'none'"],
            'script-src': ["'unsafe-inline'", "'unsafe-eval'", 'https:'],
            'style-src': ["'unsafe-inline'", 'https:'],
            'img-src': ['data:', 'blob:', 'https:'],
            'font-src': ['data:', 'https:'],
            'media-src': ['data:', 'blob:', 'https:'],
            'connect-src': ["'none'"],
            'frame-src': ["'none'"],
            'worker-src': ["'none'"],
            'object-src': ["'none'"],
            'base-uri': ['https:'],
            'form-action': ["'none'"],
            sandbox: ['allow-scripts', 'allow-forms', 'allow-popups', 'allow-modals'],
          },
          why: [
            "html preview.html: own policy (the document's scripts run here, so it must not share the frame policy). sandbox allow-scripts allow-forms allow-popups allow-modals = the iframe's flags, repeated in the header so the file is opaque-origin even when opened directly. script-src 'unsafe-inline' 'unsafe-eval' https: and style/img/font/media https: = the app's behaviour (inline scripts, CDN libraries and pictures run and load); safe only because the origin is opaque and the frame is credentialless (no cookies, no storage of the app, nothing of the frame/host reachable). No 'self': nothing is loaded from the app origin by URL (document pictures arrive as data: URIs).",
            "html preview.html: connect-src 'none' (no fetch / XHR / WebSocket / EventSource / sendBeacon anywhere, the UniWork API included), form-action 'none' (no form post leaves the preview), frame-src / worker-src / object-src 'none', base-uri https: (a document's <base> only re-resolves its own URLs).",
          ],
        },
      ],
    },
  },
  slides: {
    module: 'slides',
    root: 'web/modules/slides',
    installer: 'web/modules/slides/install.ts',
    rendererConfig: 'apps/slides/vite.renderer.config.ts',
    renderer: 'apps/slides/src/renderer/main.tsx',
    globals: ['slidesApi', 'desktop', 'projectApi'],
    csp: {
      directives: { 'media-src': ['blob:'] },
      why: [
        "slides: media-src blob: plays the audio/video embedded in a pptx: the frame's getMediaData hands <audio>/<video> a blob: URL of the zip entry (default-src 'none' would block it). No data: (a 100 MB video as a base64 string), no 'self' (no media file is served), and external linked media stay hidden (poster only), so no remote source (inventory-b5 3.3).",
      ],
    },
    // the pptx engine runs in the frame: node:* shims + Buffer for engine/ops/render
    webPlugins: 'web/modules/slides/vite-web.ts',
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
