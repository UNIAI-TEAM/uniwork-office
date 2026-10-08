// UNI-1013 B3: render web/measure/measurements-b3.json as markdown.
//   node web/measure/make-b3-md.mjs [--json web/measure/measurements-b3.json] [--out web/measure/measurements-b3.md]
// (measure-b3.mjs calls this at the end; run it alone to re-render without re-measuring)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : d
}
const result = JSON.parse(
  readFileSync(resolve(repoRoot, arg('--json', 'web/measure/measurements-b3.json')), 'utf8'),
)
const { before, after, subpath, runsPerDoc: RUNS } = result

// ---------------------------------------------------------------- markdown
const MiB = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`
const KiB = (n) => `${(n / 1024).toFixed(0)} KiB`
const ms = (n) => `${Math.round(n)} ms`
const pct = (a, b) => {
  const d = Math.round((1 - b / a) * 100)
  return d === 0 ? 'same' : d > 0 ? `−${d}%` : `+${-d}%`
}
const cmp = (fmt, a, b) => `${fmt(a)} → ${fmt(b)} (${pct(a, b)})`
const fileName = (url) => {
  const n = url.split('?')[0].split('/').pop()
  return n || 'index.html'
}
const byType = (b, t) => b.byType[t] ?? { files: 0, raw: 0, gzip: 0, brotli: 0 }
const docs = Object.keys(after.load.gzip.docs)

const md = []
md.push('# Web bundle measurements (UNI-1013 B3)', '')
md.push(
  `Generated ${result.generatedAt} on ${result.host.platform}, ${result.host.cpus} CPUs, node ${result.host.node}, chromium ${result.host.chromium} (headless), 1-min load average ${result.host.loadAvgBefore[0].toFixed(1)} → ${result.host.loadAvgAfter[0].toFixed(1)} (the host is shared with other workers: before/after runs are interleaved, absolute times still carry noise). Raw data: \`measurements-b3.json\`. Reproduce: \`node web/measure/measure-b3.mjs --before-dist <spike build>\` (before = \`npm run build:web\` at 4a70857, i.e. \`web/docs/dist\`).`,
  '',
  `- **before**: UNI-1011 spike build (single-directory output, TTF faces, meta CSP).`,
  `- **after**: \`${after.manifest?.version ?? after.dist}\` (${after.manifest?.files ?? '?'} files; versioned dir, manifest + csp.json + headers.json, WOFF2 Latin faces, fonts under \`fonts/\` never inlined, no sourcemaps).`,
  `- Both are served by the same \`web/server/server.mjs\`; "gzip" = server compresses text/font responses level 9 (what a host sends), "raw" = no compression (the spike's original measurement setup). Cold load, HTTP cache disabled, ${RUNS} rounds of (before, after) per document, median shown.`,
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
  const reqs = after.load.gzip.docs[d].firstRunRequests
  const fonts = reqs.filter((q) => q.type === 'Font')
  const code = reqs.filter((q) => q.type !== 'Font' && !q.url.startsWith('data:'))
  md.push(
    `- **${d}**: ${code.map((q) => `\`${fileName(q.url)}\` ${KiB(q.wire)}`).join(', ')}; fonts: ${fonts.length ? fonts.map((q) => `\`${fileName(q.url)}\` ${KiB(q.wire)}${q.afterEditable ? ' (after editable)' : ''}`).join(', ') : 'none'}`,
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
md.push('## 5. Reading the numbers', '')
md.push(
  '- **The 14 MiB of fonts was never downloaded up front**: every face is an `@font-face` `url()` and a browser fetches it only when text in that family/range is laid out, so the spike already transferred only the faces a document used (section 2). What this lane changes is that this is now guaranteed and visible: fonts live under `fonts/`, are never inlined into the CSS as `data:` URIs (so they cannot silently join the initial download and `font-src` needs no `data:`), and `manifest.json` reports `initial` vs `deferred` bytes for the host.',
  '- **Initial download is the JS bundle** (3.83 MiB raw / 1.14 MiB gzip, unchanged here). 35% of that chunk is the 19-language i18n dictionaries (spike report, composition table); lazy-loading locales is the next lever and is renderer work outside this lane.',
  '- **WOFF2** for the 20 Latin faces (Carlito GO, Caladea, Liberation) cuts a Latin document\'s font transfer by ~30% (section 3, doc "long") and the build by ~4.6 MiB.',
  '- **CJK/Korean fallback faces dominate what remains.** A document with Chinese text pulls Noto Sans CJK SC (2.4 MiB) after first paint; opening the font picker renders every family name in its own face and pulls the bundled CJK/KR fallbacks (Noto Serif CJK SC 3.4 MiB, Noto Sans CJK SC 2.4 MiB, KR serif/sans 0.8 MiB) on machines that have no local CJK/KR fonts (this headless Linux host is that worst case; Windows/macOS resolve most picker names to system fonts and fetch nothing). Fixing this needs a renderer change (lazy/hover previews in `Ribbon.tsx`, or `unicode-range` slices of the CJK faces), not a build change.',
  '- "wire by editable" depends on which late fonts happen to have finished when the editor became editable, so it can move by a few hundred KiB between runs; "settled" is the stable number.',
  '',
)
writeFileSync(
  resolve(repoRoot, arg('--out', 'web/measure/measurements-b3.md')),
  md.join('\n') + '\n',
)
