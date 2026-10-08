// UNI-1011 spike: bundle size report for web/docs/dist.
// Usage: node web/measure/bundle-size.mjs [outfile.json] [--dist <dir>]
//   --dist  build dir to measure (default: web/docs/dist, the spike layout; `npm run build:web` now emits
//           dist-web/docs/<version>/). Also reports the *initial* set: index.html plus the files its
//           <script>/<link> tags and their static JS imports pull in (what the browser must download before
//           the app can start, as opposed to lazily-fetched fonts / dynamic chunks).
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const argv = process.argv.slice(2)
const distArg = argv.indexOf('--dist')
const dist = resolve(repoRoot, distArg >= 0 ? argv[distArg + 1] : 'web/docs/dist')
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--dist')
const out = positional[0] ? resolve(positional[0]) : resolve(here, 'bundle-size.json')

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}
const typeOf = (f) => {
  const e = extname(f).toLowerCase()
  if (['.js', '.mjs'].includes(e)) return 'js'
  if (e === '.css') return 'css'
  if (['.woff', '.woff2', '.ttf', '.otf'].includes(e)) return 'font'
  if (e === '.wasm') return 'wasm'
  if (e === '.html') return 'html'
  return 'other'
}

const files = walk(dist)
  .filter((f) => !f.endsWith('.map'))
  .map((f) => {
    const buf = readFileSync(f)
    return {
      file: relative(dist, f),
      type: typeOf(f),
      raw: buf.length,
      gzip: zlib.gzipSync(buf, { level: 9 }).length,
      brotli: zlib.brotliCompressSync(buf, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
        },
      }).length,
    }
  })
  .sort((a, b) => b.raw - a.raw)

const sum = (xs, k) => xs.reduce((n, x) => n + x[k], 0)
const byType = {}
for (const f of files) {
  const g = (byType[f.type] ??= { files: 0, raw: 0, gzip: 0, brotli: 0 })
  g.files++
  g.raw += f.raw
  g.gzip += f.gzip
  g.brotli += f.brotli
}
const total = {
  files: files.length,
  raw: sum(files, 'raw'),
  gzip: sum(files, 'gzip'),
  brotli: sum(files, 'brotli'),
}
const mapBytes = walk(dist)
  .filter((f) => f.endsWith('.map'))
  .reduce((n, f) => n + statSync(f).size, 0)

// ---- composition of the biggest JS chunk -------------------------------------------------
// Method: parse the .map, decode VLQ `mappings`, and attribute each *generated* byte span
// (segment start -> next segment start on the same line, +1 for newline gaps ignored) to the
// source index of the segment. This approximates what source-map-explorer does (we do not
// have it installed, and the spike must not npm install). Falls back to sourcesContent length.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64IDX = Object.fromEntries([...B64].map((c, i) => [c, i]))
function decodeVlqSegment(s, pos, out) {
  // decode one VLQ value starting at pos; returns [value, newPos]
  let result = 0
  let shift = 0
  let cont
  do {
    const d = B64IDX[s[pos++]]
    cont = d & 32
    result += (d & 31) << shift
    shift += 5
  } while (cont)
  return [result & 1 ? -(result >> 1) : result >> 1, pos]
}
function pkgOf(src) {
  // normalise "../../node_modules/.pnpm/x/node_modules/@scope/pkg/..." -> "@scope/pkg"
  const i = src.lastIndexOf('node_modules/')
  if (i >= 0) {
    const rest = src.slice(i + 'node_modules/'.length).split('/')
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
  }
  const norm = src.replace(/^(\.\.\/)+/, '')
  if (norm.startsWith('packages/')) return norm.split('/').slice(0, 2).join('/')
  if (norm.startsWith('apps/docs/src/renderer')) {
    const sub = norm.split('/')[4]
    return `apps/docs/src/renderer${sub && !sub.includes('.') ? '/' + sub : ''}`
  }
  if (norm.startsWith('apps/')) return norm.split('/').slice(0, 3).join('/')
  if (norm.startsWith('web/')) return norm.split('/').slice(0, 3).join('/')
  return `(other) ${norm.split('/')[0]}`
}

let composition = null
const bigJs = files.find((f) => f.type === 'js')
if (bigJs && existsSync(join(dist, bigJs.file + '.map'))) {
  const code = readFileSync(join(dist, bigJs.file), 'utf8')
  const lines = code.split('\n')
  const map = JSON.parse(readFileSync(join(dist, bigJs.file + '.map'), 'utf8'))
  const perSrc = new Array(map.sources.length).fill(0)
  let unmapped = 0
  let srcIdx = 0
  const mlines = map.mappings.split(';')
  for (let li = 0; li < mlines.length; li++) {
    const lineLen = Buffer.byteLength(lines[li] ?? '', 'utf8')
    const segs = mlines[li] === '' ? [] : mlines[li].split(',')
    let genCol = 0
    const spans = []
    for (const seg of segs) {
      let p = 0
      let v
      ;[v, p] = decodeVlqSegment(seg, p)
      genCol += v
      let idx = null
      if (p < seg.length) {
        ;[v, p] = decodeVlqSegment(seg, p)
        srcIdx += v
        idx = srcIdx
        ;[v, p] = decodeVlqSegment(seg, p) // orig line
        ;[v, p] = decodeVlqSegment(seg, p) // orig col
        if (p < seg.length) [v, p] = decodeVlqSegment(seg, p) // name
      }
      spans.push([genCol, idx])
    }
    if (spans.length === 0) {
      unmapped += lineLen
      continue
    }
    if (spans[0][0] > 0) unmapped += spans[0][0]
    for (let i = 0; i < spans.length; i++) {
      const end = i + 1 < spans.length ? spans[i + 1][0] : lineLen
      const n = Math.max(0, end - spans[i][0])
      if (spans[i][1] == null) unmapped += n
      else perSrc[spans[i][1]] += n
    }
  }
  const perPkg = {}
  map.sources.forEach((s, i) => {
    const k = pkgOf(s)
    perPkg[k] = (perPkg[k] ?? 0) + perSrc[i]
  })
  perPkg['(unmapped / bundler glue)'] = unmapped
  const totalAttr = Object.values(perPkg).reduce((a, b) => a + b, 0)
  composition = {
    file: bigJs.file,
    method:
      'sourcemap VLQ decode: generated bytes attributed to originating source by segment span, grouped by top-level npm package / workspace dir (source-map-explorer is not installed; not run)',
    attributedBytes: totalAttr,
    top: Object.entries(perPkg)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name, bytes]) => ({ name, bytes, pct: +((bytes / totalAttr) * 100).toFixed(1) })),
  }
}

// ---- initial set: html + referenced scripts/styles + their static imports ---------------
const byFile = new Map(files.map((f) => [f.file, f]))
const initialSet = new Set(['index.html'])
const queue = ['index.html']
const refRe = /(?:src|href)=["']([^"']+\.(?:js|mjs|css))["']/g
const importRe = /(?:\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+\.(?:js|mjs|css))["']/g
while (queue.length) {
  const cur = queue.pop()
  const abs = join(dist, cur)
  if (!existsSync(abs)) continue
  const text = readFileSync(abs, 'utf8')
  const found = []
  if (cur.endsWith('.html')) for (const m of text.matchAll(refRe)) found.push(m[1])
  else if (!cur.endsWith('.css')) for (const m of text.matchAll(importRe)) found.push(m[1])
  for (const ref of found) {
    if (/^(https?:)?\/\//.test(ref)) continue
    const target = relative(dist, resolve(dirname(abs), ref))
    if (byFile.has(target) && !initialSet.has(target)) {
      initialSet.add(target)
      queue.push(target)
    }
  }
}
const initialFiles = [...initialSet].map((f) => byFile.get(f)).filter(Boolean)
const initial = {
  note: 'index.html + <script>/<link> targets + static JS imports (no dynamic import(), no CSS url() fonts)',
  files: initialFiles.map((f) => f.file),
  total: {
    files: initialFiles.length,
    raw: sum(initialFiles, 'raw'),
    gzip: sum(initialFiles, 'gzip'),
    brotli: sum(initialFiles, 'brotli'),
  },
}

const result = {
  generatedAt: new Date().toISOString(),
  dist: relative(repoRoot, dist),
  total,
  initial,
  sourcemapBytes: mapBytes,
  byType,
  top15: files.slice(0, 15),
  files,
  biggestJsComposition: composition,
}
writeFileSync(out, JSON.stringify(result, null, 2))
console.log(`wrote ${relative(repoRoot, out)}`)
console.log('total', total)
console.log('initial', initial.total, initial.files)
console.log('byType', byType)
console.log('biggest JS', bigJs?.file)
console.log(composition?.top.slice(0, 15))
