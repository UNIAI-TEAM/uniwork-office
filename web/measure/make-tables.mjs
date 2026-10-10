// UNI-1011 spike: merge web/measure/{bundle-size,load,css-evidence}.json into
// docs/web-spike/measurements.json + measurements.md.
// Usage: node web/measure/make-tables.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const rd = (f) =>
  existsSync(resolve(here, f)) ? JSON.parse(readFileSync(resolve(here, f), 'utf8')) : null
const bundle = rd('bundle-size.json')
const load = rd('load.json')
const css = rd('css-evidence.json')

writeFileSync(
  resolve(repoRoot, 'docs/web-spike/measurements.json'),
  JSON.stringify({ bundle, load, cssEvidence: css }, null, 2),
)

const kb = (n) => (n / 1024).toFixed(1) + ' KiB'
const mb = (n) => (n / 1048576).toFixed(2) + ' MiB'
const ms = (n) => (n == null ? '-' : Math.round(n) + ' ms')
const trip = (s, f) => (s ? `${f(s.median)} (${f(s.min)} – ${f(s.max)})` : '-')
let md = '# Docs-on-the-web measurements (UNI-1011 spike)\n\n'
md +=
  'Raw data: `measurements.json`. Produced by `web/measure/{bundle-size,load,css-evidence,make-tables}.mjs`.\n\n'

if (bundle) {
  md += `## Bundle size (web/docs/dist, generated ${bundle.generatedAt})\n\n`
  md +=
    'gzip = zlib level 9, brotli = quality 11, both computed per file. `.map` files excluded (sourcemaps: ' +
    mb(bundle.sourcemapBytes) +
    ').\n\n'
  md += '| | files | raw | gzip | brotli |\n|---|---|---|---|---|\n'
  md += `| **total** | ${bundle.total.files} | ${mb(bundle.total.raw)} | ${mb(bundle.total.gzip)} | ${mb(bundle.total.brotli)} |\n`
  for (const [t, g] of Object.entries(bundle.byType).sort((a, b) => b[1].raw - a[1].raw))
    md += `| ${t} | ${g.files} | ${mb(g.raw)} | ${mb(g.gzip)} | ${mb(g.brotli)} |\n`
  const nonFont = Object.entries(bundle.byType)
    .filter(([t]) => t !== 'font')
    .reduce(
      (a, [, g]) => ({ raw: a.raw + g.raw, gzip: a.gzip + g.gzip, brotli: a.brotli + g.brotli }),
      { raw: 0, gzip: 0, brotli: 0 },
    )
  md += `| *total without fonts* | | ${mb(nonFont.raw)} | ${mb(nonFont.gzip)} | ${mb(nonFont.brotli)} |\n\n`
  md += '### Top 15 files\n\n| file | type | raw | gzip | brotli |\n|---|---|---|---|---|\n'
  for (const f of bundle.top15)
    md += `| \`${f.file}\` | ${f.type} | ${kb(f.raw)} | ${kb(f.gzip)} | ${kb(f.brotli)} |\n`
  if (bundle.biggestJsComposition) {
    const c = bundle.biggestJsComposition
    md += `\n### Composition of the biggest JS chunk (\`${c.file}\`)\n\nMethod: ${c.method}.\n\n| source group | bytes (pre-gzip) | % |\n|---|---|---|\n`
    for (const r of c.top.slice(0, 20)) md += `| ${r.name} | ${kb(r.bytes)} | ${r.pct}% |\n`
  }
  md += '\n'
}

if (load) {
  md += `## Cold load (Playwright chromium ${load.chromium}, headless, ${load.runs} runs per doc)\n\n`
  md += `Each run: fresh browser context, HTTP cache disabled. Server: ${load.server}. Cells are **median (min – max)**.\n`
  md +=
    "time-to-editable = first moment a visible `.ProseMirror[contenteditable=true]` contains the document's known text (ms since navigation start). Heap = CDP `JSHeapUsedSize` right after editable (and after a forced GC). Transferred = sum of CDP `encodedDataLength` (server sends no compression, so this equals raw bytes): *by editable* = requests finished when the doc became editable, *settled* = after network idle + 1.5 s (late-loading fonts included).\n\n"
  md +=
    '| doc | ok runs | DOMContentLoaded | load | time-to-editable | JS heap | JS heap after GC | transferred by editable | transferred settled | requests |\n|---|---|---|---|---|---|---|---|---|---|\n'
  for (const [name, d] of Object.entries(load.docs))
    md += `| ${name} | ${d.okRuns}/${load.runs} | ${trip(d.domContentLoadedMs, ms)} | ${trip(d.loadMs, ms)} | ${trip(d.timeToEditableMs, ms)} | ${trip(d.jsHeapUsedBytes, mb)} | ${trip(d.jsHeapUsedAfterGcBytes, mb)} | ${trip(d.transferredAtEditableBytes, mb)} | ${trip(d.transferredBytes, mb)} | ${d.requests ? d.requests.median : '-'} |\n`
  const notes = Object.entries(load.docs).filter(([, d]) => d.fixtureServedBy !== 'server')
  if (notes.length)
    md +=
      '\n' +
      notes.map(([n, d]) => `- ${n}: fixture served by ${d.fixtureServedBy}`).join('\n') +
      '\n'
  md += '\n'
}

if (css) {
  md += '## Isolation evidence (built CSS + JS)\n\n'
  md += `- CSS: ${css.cssFiles.join(', ')}, ${(css.cssBytes / 1024).toFixed(0)} KiB, ${css.totalSelectors} selectors, ${css.classCount} distinct classes, ${css.customPropertyCount} custom properties, ${css.keyframes.length} @keyframes (${css.keyframes.join(', ')}).\n`
  md += `- @font-face: ${css.fontFaceCount} declarations across ${Object.keys(css.families).length} families.\n`
  md += `- Generic class names shipped un-namespaced: ${css.genericUnprefixedClassNames.map((c) => '`.' + c + '`').join(', ') || 'none'}.\n\n`
  md += '| global-reaching selector kind | count | samples |\n|---|---|---|\n'
  for (const [k, v] of Object.entries(css.globalSelectors))
    md += `| ${k} | ${v.count} | ${v.samples
      .slice(0, 5)
      .map((s) => '`' + s.replace(/\|/g, '\\|') + '`')
      .join('<br>')} |\n`
  md +=
    '\n**window globals written by the bundle:** ' +
    Object.entries(css.windowGlobalsWritten)
      .map(([k]) => `\`${k}\``)
      .join(', ') +
    '\n\n'
  md +=
    '**window globals read:** ' +
    Object.entries(css.windowGlobalsRead)
      .map(([k, n]) => `\`${k}\` ×${n}`)
      .join(', ') +
    '\n\n'
  md += '| browser API / global-state usage in bundle | occurrences |\n|---|---|\n'
  for (const [k, n] of Object.entries(css.browserApiUsage)) md += `| \`${k}\` | ${n} |\n`
  md += '\n### @font-face families\n\n| family | faces |\n|---|---|\n'
  for (const [k, n] of Object.entries(css.families)) md += `| ${k} | ${n} |\n`
}
writeFileSync(resolve(repoRoot, 'docs/web-spike/measurements.md'), md)
console.log('wrote docs/web-spike/measurements.{json,md}')
