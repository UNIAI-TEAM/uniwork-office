/**
 * extraResources for the bundled Tesseract OCR helper (packages/pdf2docx/
 * ocr-tesseract), shared by electron-builder.cjs and its tests.
 *
 * The helper (tess-ocr.cjs) is not bundled by electron-vite: it runs unbundled
 * under ELECTRON_RUN_AS_NODE, so its npm runtime must travel as plain files:
 *   Resources/ocr/tesseract/node_modules/<pkg>     tesseract.js, pngjs + closure
 *
 * electron-builder copies a `from` directory without ITS OWN root node_modules
 * (fileMatcher createFilter), so a package that keeps dependencies nested
 * (node-fetch -> whatwg-url@5 -> tr46@0.0.3 ...) needs one entry per package,
 * with the nested path preserved. The list is therefore derived from the
 * installed tree by Node's own resolution (never hand-copied versions), and
 * checked against a reviewed name list: a tesseract.js upgrade that adds a
 * dependency fails packaging until the new package has a license review
 * (docs/go1/LICENSE_AUDIT.md) and is added to REVIEWED_PACKAGES below.
 *
 * Plain CommonJS and path-injectable (`from`) so tests can feed a fake tree.
 */
'use strict'

const { existsSync, readFileSync } = require('node:fs')
const { join, relative, resolve, sep } = require('node:path')

const SHELL_DIR = resolve(__dirname, '..')
/** where resolution starts: the package that declares tesseract.js + pngjs */
const DEFAULT_FROM = resolve(SHELL_DIR, '../../packages/pdf2docx')
/** under Resources/ */
const DEST_ROOT = 'ocr/tesseract/node_modules'

/** what tess-ocr.cjs requires itself */
const ROOTS = ['tesseract.js', 'pngjs']

/**
 * The runtime closure that was reviewed for UNI-2165 (tesseract.js 7.0.0, from
 * package-lock.json): tesseract.js's dependencies (bmp-js, idb-keyval, is-url,
 * node-fetch, regenerator-runtime, tesseract.js-core, wasm-feature-detect,
 * zlibjs), node-fetch's nested whatwg-url closure, and pngjs.
 */
const REVIEWED_PACKAGES = [
  'bmp-js',
  'idb-keyval',
  'is-url',
  'node-fetch',
  'pngjs',
  'regenerator-runtime',
  'tesseract.js',
  'tesseract.js-core',
  'tr46',
  'wasm-feature-detect',
  'webidl-conversions',
  'whatwg-url',
  'zlibjs',
]

/** declared dependencies that are deliberately not shipped, with the reason */
const UNSHIPPED = {
  // tesseract.js "postinstall" script only (funding banner); never required at runtime
  'opencollective-postinstall': 'postinstall script only',
}

/**
 * Per-package copy filters (electron-builder `filter`; absent = whole package).
 * Only what Node resolves at runtime ships: the browser bundles, docs, examples,
 * tests and the WASM builds it never loads stay out.
 */
const FILTERS = {
  // src/ holds the node worker; dist/ is the 10 MB browser bundle
  'tesseract.js': ['package.json', 'LICENSE.md', 'src/**'],
  // getCore.js picks relaxed-simd / simd / plain by wasm-feature-detect and each
  // build loads its sibling .wasm. tesseract.js 7.0.0 passes its `lstmOnly`
  // boolean where getCore expects an OEM number ([3, 1].includes(true) is false),
  // so on Node it always loads the combined builds, never the *-lstm ones; those
  // and the base64 .wasm.js twins stay out. The staged-helper test in
  // apps/shell/tests/ocr-tesseract-packaging.test.ts fails if a tesseract.js
  // upgrade changes which build is loaded.
  // README.md lists the changes made to Tesseract (NOTICE refers to it)
  'tesseract.js-core': [
    'package.json',
    'LICENSE',
    'README.md',
    'tesseract-core.js',
    'tesseract-core.wasm',
    'tesseract-core-simd.js',
    'tesseract-core-simd.wasm',
    'tesseract-core-relaxedsimd.js',
    'tesseract-core-relaxedsimd.wasm',
  ],
  pngjs: ['package.json', 'LICENSE', 'lib/**'],
  'bmp-js': ['package.json', 'LICENSE', 'index.js', 'lib/**'],
  'node-fetch': ['package.json', 'LICENSE.md', 'lib/**'],
  // only the browser worker requires it; main is bin/node-zlib.js
  zlibjs: ['package.json', 'LICENSE', 'bin/node-zlib.js'],
}

/** Node's resolution: <dir>/node_modules/<name> from `fromDir` upward */
function findPackage(name, fromDir) {
  let dir = fromDir
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = resolve(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * The shipped runtime closure of the helper: [{ name, version, dir, dest }],
 * `dest` relative to Resources/. `missing` lists packages that did not
 * resolve (an uninstalled tree).
 */
function collectTesseractRuntime({ from = DEFAULT_FROM } = {}) {
  const found = []
  const missing = []
  const byDest = new Map()
  const queue = ROOTS.map((name) => ({ name, fromDir: from, top: null }))
  const seenDirs = new Set()
  while (queue.length > 0) {
    const { name, fromDir, top } = queue.shift()
    const dir = findPackage(name, fromDir)
    if (dir === null) {
      missing.push(name)
      continue
    }
    if (seenDirs.has(dir)) continue
    seenDirs.add(dir)
    // mirror the source position below the node_modules that holds the root
    // package (node-fetch/node_modules/tr46 stays nested), so Node's upward
    // resolution inside Resources finds exactly what it found in the repo
    const topNodeModules = top ?? resolve(dir, '..')
    const dest = `${DEST_ROOT}/${
      dir.startsWith(topNodeModules + sep) ? relative(topNodeModules, dir).split(sep).join('/') : name
    }`
    const clash = byDest.get(dest)
    if (clash !== undefined && clash !== dir) {
      throw new Error(`two versions of ${name} would land in ${dest}: ${clash} and ${dir}`)
    }
    byDest.set(dest, dir)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    found.push({ name, version: manifest.version, dir, dest })
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (dep in UNSHIPPED) continue
      queue.push({ name: dep, fromDir: dir, top: topNodeModules })
    }
  }
  return { packages: found, missing }
}

/** electron-builder extraResources entries (`from` relative to apps/shell, / separated) */
function tesseractExtraResources(options = {}) {
  return collectTesseractRuntime(options).packages.map(({ name, dir, dest }) => ({
    from: relative(SHELL_DIR, dir).split(sep).join('/'),
    to: dest,
    ...(FILTERS[name] ? { filter: FILTERS[name] } : {}),
  }))
}

/** throws when the shipped closure is not exactly the reviewed one */
function assertTesseractResources(options = {}) {
  const { packages, missing } = collectTesseractRuntime(options)
  if (missing.length > 0) {
    throw new Error(
      `bundled OCR runtime package(s) not installed: ${[...new Set(missing)].join(', ')} (run npm ci)`,
    )
  }
  const shipped = new Set(packages.map((p) => p.name))
  const reviewed = new Set(REVIEWED_PACKAGES)
  const added = [...shipped].filter((n) => !reviewed.has(n))
  const gone = [...reviewed].filter((n) => !shipped.has(n))
  if (added.length > 0 || gone.length > 0) {
    throw new Error(
      'bundled OCR runtime closure changed' +
        (added.length > 0 ? `; new: ${added.join(', ')}` : '') +
        (gone.length > 0 ? `; gone: ${gone.join(', ')}` : '') +
        ' — review the license (docs/go1/LICENSE_AUDIT.md) and update REVIEWED_PACKAGES in ' +
        'apps/shell/build/ocr-tesseract-resources.cjs',
    )
  }
}

module.exports = {
  REVIEWED_PACKAGES,
  UNSHIPPED,
  FILTERS,
  collectTesseractRuntime,
  tesseractExtraResources,
  assertTesseractResources,
}
