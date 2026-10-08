// UNI-1013 B3: before/after report for the web bundle pipeline.
//   node web/measure/measure-b3.mjs --before-dist <spike build dir> [--after-dist <dir>] [--runs 5]
//     [--out-json web/measure/measurements-b3.json] [--out-md web/measure/measurements-b3.md]
// before = the UNI-1011 spike build (`npm run build:web` at 4a70857 -> web/docs/dist)
// after  = this branch's build (default: newest dist-web/docs/<version>)
// Everything runs through the same tools (bundle-size.mjs, load.mjs, font-picker.mjs) against the same
// server (web/server/server.mjs, gzip on = what a host sends; raw = no compression) so the two builds are
// compared under identical conditions. Wire bytes are CDP encodedDataLength.
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : d
}
const RUNS = Number(arg('--runs', 5))
const beforeDist = arg('--before-dist')
if (!beforeDist) {
  console.error('--before-dist <dir> is required (the spike build to compare against)')
  process.exit(2)
}

function newestVersionDir() {
  const root = resolve(repoRoot, 'dist-web/docs')
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, 'manifest.json')))
    .map((e) => join(root, e.name))
    .sort(
      (a, b) =>
        statSync(join(b, 'manifest.json')).mtimeMs - statSync(join(a, 'manifest.json')).mtimeMs,
    )
  if (!dirs[0]) throw new Error('no dist-web/docs/<version> build: run npm run build:web')
  return dirs[0]
}
const afterDist = resolve(arg('--after-dist', newestVersionDir()))
const tmp = mkdtempSync(join(tmpdir(), 'measure-b3-'))

function run(script, args) {
  const r = spawnSync('node', [join(here, script), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (r.status !== 0) throw new Error(`${script} ${args.join(' ')} failed (${r.status})`)
}
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))

function measure(label, dist) {
  console.log(`== ${label}: ${dist}`)
  const out = { label, dist: relative(repoRoot, dist) || dist }
  const bs = join(tmp, `${label}-bundle.json`)
  run('bundle-size.mjs', [bs, '--dist', dist])
  out.bundle = readJson(bs)
  out.load = {}
  for (const mode of ['gzip', 'raw']) {
    const f = join(tmp, `${label}-load-${mode}.json`)
    run('load.mjs', [
      '--runs',
      String(RUNS),
      '--dist',
      dist,
      '--out',
      f,
      ...(mode === 'gzip' ? ['--compress'] : []),
    ])
    out.load[mode] = readJson(f)
  }
  out.picker = {}
  for (const doc of ['simple', 'long']) {
    const f = join(tmp, `${label}-picker-${doc}.json`)
    run('font-picker.mjs', ['--dist', dist, '--compress', '--doc', doc, '--out', f])
    out.picker[doc] = readJson(f)
  }
  const mf = join(dist, 'manifest.json')
  if (existsSync(mf)) {
    const m = readJson(mf)
    out.manifest = {
      version: m.version,
      gitSha: m.gitSha,
      dirty: m.dirty,
      totalBytes: m.totalBytes,
      gzipBytes: m.gzipBytes,
      initial: m.initial,
      deferred: m.deferred,
      files: m.files.length,
    }
  }
  return out
}

const before = measure('before', resolve(beforeDist))
const after = measure('after', afterDist)

// the build must also work under a sub-path (host serves /office-frame/docs/<version>/): one cold load there
const mount = `/office-frame/docs/${after.manifest?.version ?? 'v'}/`
const mountFile = join(tmp, 'mount.json')
run('load.mjs', [
  '--runs',
  '1',
  '--dist',
  afterDist,
  '--compress',
  '--mount',
  mount,
  '--out',
  mountFile,
])
const mountRes = readJson(mountFile)
const subpath = {
  mount,
  allEditable: Object.values(mountRes.docs).every((d) => d.okRuns === 1),
  failedRequests: Object.values(mountRes.docs).reduce(
    (n, d) => n + d.raw.reduce((k, r) => k + r.failed.length, 0),
    0,
  ),
  timeToEditableMs: Object.fromEntries(
    Object.entries(mountRes.docs).map(([k, d]) => [
      k,
      Math.round(d.timeToEditableMs?.median ?? -1),
    ]),
  ),
}

const result = {
  generatedAt: new Date().toISOString(),
  host: {
    cpus: os.cpus().length,
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
  },
  runsPerDoc: RUNS,
  before,
  after,
  subpath,
}
writeFileSync(
  resolve(repoRoot, arg('--out-json', 'web/measure/measurements-b3.json')),
  JSON.stringify(result, null, 2) + '\n',
)

// ---------------------------------------------------------------- markdown
const MiB = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`
const KiB = (n) => `${(n / 1024).toFixed(0)} KiB`
const ms = (n) => `${Math.round(n)} ms`
const pct = (a, b) => `${a <= b ? '−' : '+'}${Math.abs(Math.round((1 - b / a) * 100))}%`
const cmp = (fmt, a, b) => `${fmt(a)} → ${fmt(b)} (${pct(a, b)})`
const byType = (b, t) => b.byType[t] ?? { files: 0, raw: 0, gzip: 0, brotli: 0 }
const docs = Object.keys(after.load.gzip.docs)

const md = []
md.push('# Web bundle measurements (UNI-1013 B3)', '')
md.push(
  `Generated ${result.generatedAt} on ${result.host.platform}, ${result.host.cpus} CPUs, node ${result.host.node}, chromium ${after.load.gzip.chromium} (headless). Raw data: \`measurements-b3.json\`. Reproduce: \`node web/measure/measure-b3.mjs --before-dist <spike build>\` (before = \`npm run build:web\` at 4a70857, i.e. \`web/docs/dist\`).`,
  '',
  `- **before**: UNI-1011 spike build (single-directory output, TTF faces, meta CSP).`,
  `- **after**: \`${after.manifest?.version ?? after.dist}\` (${after.manifest?.files ?? '?'} files; versioned dir, manifest + csp.json + headers.json, WOFF2 Latin faces, fonts under \`fonts/\` never inlined, no sourcemaps).`,
  `- Both are served by the same \`web/server/server.mjs\`; "gzip" = server compresses text/font responses level 9 (what a host sends), "raw" = no compression (the spike's original measurement setup). Cold load, HTTP cache disabled, ${RUNS} runs per document, median shown.`,
  '',
)

md.push('## 1. What the browser downloads before the app starts (initial) vs on demand', '')
md.push(
  '"Initial" = `index.html` + its `<script>`/`<link>` targets + their static imports. Fonts are `@font-face` `url()`s: the browser fetches a face only when text in that family/range is laid out, so they are not part of the initial set (section 3 shows what actually gets fetched).',
  '',
)
md.push('| | before | after |', '|---|---|---|')
const bi = before.bundle.initial.total
const ai = after.bundle.initial.total
md.push(`| initial files | ${bi.files} | ${ai.files} |`)
md.push(`| **initial raw** | ${MiB(bi.raw)} | ${cmp(MiB, bi.raw, ai.raw).split(' → ')[1]} |`)
md.push(`| **initial gzip** | ${MiB(bi.gzip)} | ${cmp(MiB, bi.gzip, ai.gzip).split(' → ')[1]} |`)
md.push(
  `| initial brotli | ${MiB(bi.brotli)} | ${cmp(MiB, bi.brotli, ai.brotli).split(' → ')[1]} |`,
)
md.push(
  `| total raw (everything the host stores) | ${MiB(before.bundle.total.raw)} | ${cmp(MiB, before.bundle.total.raw, after.bundle.total.raw).split(' → ')[1]} |`,
)
md.push(
  `| total gzip | ${MiB(before.bundle.total.gzip)} | ${cmp(MiB, before.bundle.total.gzip, after.bundle.total.gzip).split(' → ')[1]} |`,
)
const bf = byType(before.bundle, 'font')
const af = byType(after.bundle, 'font')
md.push(
  `| font files | ${bf.files} (${MiB(bf.raw)} raw, ${MiB(bf.gzip)} gzip) | ${af.files} (${MiB(af.raw)} raw, ${MiB(af.gzip)} gzip) |`,
)
md.push(
  `| fonts as share of total raw | ${Math.round((bf.raw / before.bundle.total.raw) * 100)}% | ${Math.round((af.raw / after.bundle.total.raw) * 100)}% |`,
)
md.push(`| fonts in the initial download | ${MiB(0)} | ${MiB(0)} |`, '')
if (after.manifest) {
  const mi = after.manifest
  md.push(
    `Consistency check: manifest.json says initial = ${mi.initial.files} files / ${mi.initial.bytes} B / ${mi.initial.gzipBytes} B gzip, bundle-size.mjs measured ${ai.files} files / ${ai.raw} B / ${ai.gzip} B gzip ${mi.initial.bytes === ai.raw && mi.initial.files === ai.files ? '(identical)' : '**(MISMATCH)**'}.`,
    '',
  )
}

md.push('## 2. Cold load: transferred bytes and time-to-editable', '')
md.push(
  "time-to-editable = first moment a visible `.ProseMirror[contenteditable=true]` contains the document's known text (ms since navigation start). Wire bytes = sum of CDP `encodedDataLength`: *by editable* = finished when the doc became editable, *settled* = after network idle + 1.5 s (late fonts included).",
  '',
)
for (const mode of ['gzip', 'raw']) {
  md.push(
    `### ${mode === 'gzip' ? 'Server with gzip (production-like)' : 'Server without compression (spike setup)'}`,
    '',
  )
  md.push(
    '| doc | time-to-editable | wire by editable | wire settled | requests |',
    '|---|---|---|---|---|',
  )
  for (const d of docs) {
    const b = before.load[mode].docs[d]
    const a = after.load[mode].docs[d]
    md.push(
      `| ${d} | ${ms(b.timeToEditableMs.median)} → ${ms(a.timeToEditableMs.median)} (${pct(b.timeToEditableMs.median, a.timeToEditableMs.median)}) | ${cmp(MiB, b.transferredAtEditableBytes.median, a.transferredAtEditableBytes.median)} | ${cmp(MiB, b.transferredBytes.median, a.transferredBytes.median)} | ${b.requests.median} → ${a.requests.median} |`,
    )
  }
  md.push('')
}

md.push('### What was fetched (gzip run 1, after build)', '')
for (const d of docs) {
  const r = after.load.gzip.docs[d].raw[0]
  const fonts = r.reqLog.filter((q) => q.type === 'Font')
  const code = r.reqLog.filter((q) => q.type !== 'Font' && !q.url.startsWith('data:'))
  md.push(
    `- **${d}**: ${code.map((q) => `\`${q.url.split('/').pop().split('?')[0]}\` ${KiB(q.wire)}`).join(', ')}; fonts: ${fonts.length ? fonts.map((q) => `\`${q.url.split('/').pop()}\` ${KiB(q.wire)}${q.afterEditable ? ' (after editable)' : ''}`).join(', ') : 'none'}`,
  )
}
md.push('')

md.push('## 3. Fonts on demand: what each user action costs', '')
md.push(
  'Font bytes on the wire (gzip server). *document open* = faces the document needed by the time the page is idle; *font picker* = additional faces fetched when the font dropdown is opened (every family name is rendered in its own face).',
  '',
)
md.push('| doc | | font files | font wire bytes |', '|---|---|---|---|')
for (const d of Object.keys(after.picker)) {
  const b = before.picker[d]
  const a = after.picker[d]
  md.push(`| ${d} | document open, before | ${b.onLoad.files} | ${MiB(b.onLoad.wireBytes)} |`)
  md.push(
    `| | document open, **after** | ${a.onLoad.files} | ${cmp(MiB, b.onLoad.wireBytes, a.onLoad.wireBytes).split(' → ')[1]} |`,
  )
  md.push(
    `| | + font picker first open, before | ${b.onPickerOpen.files} | ${MiB(b.onPickerOpen.wireBytes)} |`,
  )
  md.push(
    `| | + font picker first open, **after** | ${a.onPickerOpen.files} | ${cmp(MiB, b.onPickerOpen.wireBytes, a.onPickerOpen.wireBytes).split(' → ')[1]} |`,
  )
}
md.push('')
md.push('Font files fetched on first picker open (after build, doc "simple"):', '')
for (const f of after.picker.simple.onPickerOpen.list) md.push(`- \`${f.file}\` ${KiB(f.wire)}`)
md.push('')

md.push('## 4. Served under a sub-path', '')
md.push(
  `Loaded the build from \`${subpath.mount}\` (server MOUNT, nothing is served outside that prefix except the fixture documents): ${subpath.allEditable ? 'all 3 documents became editable' : '**not all documents became editable**'}, ${subpath.failedRequests} failed requests; time-to-editable ${Object.entries(
    subpath.timeToEditableMs,
  )
    .map(([k, v]) => `${k} ${v} ms`)
    .join(', ')}.`,
  '',
)
writeFileSync(
  resolve(repoRoot, arg('--out-md', 'web/measure/measurements-b3.md')),
  md.join('\n') + '\n',
)
rmSync(tmp, { recursive: true, force: true })
console.log('wrote measurements-b3.{json,md}')
