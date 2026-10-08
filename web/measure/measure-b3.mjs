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

const median = (xs) => {
  const v = [...xs].sort((x, y) => x - y)
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
const stat = (xs) => ({
  median: median(xs),
  min: Math.min(...xs),
  max: Math.max(...xs),
  n: xs.length,
})

// Cold loads are timing-sensitive and this host is shared: run before/after alternately, one run per
// invocation, so both builds see the same background load; aggregate the per-run records afterwards.
function loadInterleaved(builds, mode) {
  const runs = Object.fromEntries(builds.map((b) => [b.label, {}]))
  const meta = {}
  for (let round = 0; round < RUNS; round++) {
    for (const b of builds) {
      const f = join(tmp, `${b.label}-load-${mode}-${round}.json`)
      run('load.mjs', [
        '--runs',
        '1',
        '--dist',
        b.dist,
        '--out',
        f,
        ...(mode === 'gzip' ? ['--compress'] : []),
      ])
      const res = readJson(f)
      meta.chromium = res.chromium
      for (const [doc, d] of Object.entries(res.docs)) (runs[b.label][doc] ??= []).push(...d.raw)
    }
  }
  const out = {}
  for (const b of builds) {
    out[b.label] = { docs: {} }
    for (const [doc, rs] of Object.entries(runs[b.label])) {
      const good = rs.filter((r) => r.ok)
      const col = (k) => good.map((r) => r[k]).filter((v) => v != null)
      out[b.label].docs[doc] = {
        okRuns: good.length,
        timeToEditableMs: stat(col('tte')),
        transferredAtEditableBytes: stat(col('transferredAtEditable')),
        transferredBytes: stat(col('transferred')),
        requests: stat(col('requests')),
        failedRequests: rs.reduce((n, r) => n + r.failed.length, 0),
        firstRunRequests: rs[0].reqLog.filter((q) => !q.url.startsWith('data:')),
      }
    }
  }
  return { out, chromium: meta.chromium }
}

function measureStatic(label, dist) {
  console.log(`== ${label}: ${dist}`)
  const out = { label, dist: relative(repoRoot, dist) || dist }
  const bs = join(tmp, `${label}-bundle.json`)
  run('bundle-size.mjs', [bs, '--dist', dist])
  out.bundle = readJson(bs)
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

const before = measureStatic('before', resolve(beforeDist))
const after = measureStatic('after', afterDist)
const loadAvgStart = os.loadavg()
const builds = [
  { label: 'before', dist: resolve(beforeDist) },
  { label: 'after', dist: afterDist },
]
let chromium = ''
for (const mode of ['gzip', 'raw']) {
  const { out, chromium: c } = loadInterleaved(builds, mode)
  chromium = c
  before.load = { ...before.load, [mode]: out.before }
  after.load = { ...after.load, [mode]: out.after }
}

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
    chromium,
    loadAvgBefore: loadAvgStart,
    loadAvgAfter: os.loadavg(),
  },
  runsPerDoc: RUNS,
  before,
  after,
  subpath,
}
const outJson = resolve(repoRoot, arg('--out-json', 'web/measure/measurements-b3.json'))
const outMd = resolve(repoRoot, arg('--out-md', 'web/measure/measurements-b3.md'))
writeFileSync(outJson, JSON.stringify(result, null, 2) + '\n')

run('make-b3-md.mjs', ['--json', outJson, '--out', outMd])
rmSync(tmp, { recursive: true, force: true })
console.log('wrote measurements-b3.{json,md}')
