// Tiny static server for the web/docs build (no dependencies). Used by web/e2e and web/measure.
//
// Which build it serves (first match):
//   DIST_DIR=<path>   an explicit build dir (absolute, or relative to the repo root)
//   dist-web/docs/<v> the most recently built versioned dir that has a manifest.json (`npm run build:web`)
//   web/docs/dist     the UNI-1011 spike layout (kept so old measurements stay reproducible)
// MOUNT=/office-frame/docs/<v>/ serves the build under that URL prefix (subpath hosting check).
// /office-frame/<module>/<version|latest>/... (GO-B4/B5/B6) serves dist-web/<module>/<version>/ (latest = the
// newest build with a manifest.json) with that build's own headers.json, the URL layout of the UniWork host. The
// test host picks the frame through it: /test-host/?module=pdf.
// COMPRESS=gzip     gzip text/font responses (what a real host does), so measured transfer sizes are realistic.
// When the build dir has headers.json (written by `build:web`) its response headers are applied, so the
// Content-Security-Policy under test is the exact header the host will send (no <meta> CSP).
import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import zlib from 'node:zlib'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')

const MODULES = new Set(['docs', 'pdf', 'markdown', 'html', 'slides', 'sheets'])

function newestVersionDir(module = 'docs') {
  const root = resolve(repoRoot, 'dist-web', module)
  if (!existsSync(root)) return null
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, 'manifest.json')))
    .map((e) => join(root, e.name))
    .sort(
      (a, b) =>
        statSync(join(b, 'manifest.json')).mtimeMs - statSync(join(a, 'manifest.json')).mtimeMs,
    )
  return dirs[0] ?? null
}
const distDir = process.env.DIST_DIR
  ? resolve(repoRoot, process.env.DIST_DIR)
  : (newestVersionDir() ?? resolve(repoRoot, 'web/docs/dist'))
const mount = process.env.MOUNT ? `/${process.env.MOUNT.replace(/^\/+|\/+$/g, '')}` : ''
const compress = process.env.COMPRESS === 'gzip' || process.env.COMPRESS === '1'
// headers.json: [{ source: '/index.html' | '/assets/**' | '/**', headers: { name: value } }], first match wins per header name
function readHeaderRules(dir) {
  return existsSync(join(dir, 'headers.json'))
    ? JSON.parse(readFileSync(join(dir, 'headers.json'), 'utf8')).rules
    : []
}
const headerRules = readHeaderRules(distDir)

/** /office-frame/<module>/<version|latest>/<rest> -> { dir, rules, rel } | { error } | null */
function moduleFrame(pathname) {
  const m = /^\/office-frame\/([a-z]+)\/([0-9A-Za-z][0-9A-Za-z._-]{0,63})(\/.*)?$/.exec(pathname)
  if (!m) return null
  const [, module, version, rest] = m
  if (!MODULES.has(module) || version.includes('..')) return { error: 'unknown module or version' }
  const dir =
    version === 'latest' ? newestVersionDir(module) : resolve(repoRoot, 'dist-web', module, version)
  if (!dir || !existsSync(join(dir, 'manifest.json'))) {
    return { error: `no ${module} build: run \`npm run build:web -- --module ${module}\`` }
  }
  return { dir, rules: readHeaderRules(dir), rel: !rest || rest === '/' ? '/index.html' : rest }
}
const fixturesDir = resolve(repoRoot, 'fixtures/generated')
// hand-made samples for the other modules (sample.pdf / .md / .html), GO-B4
const webFixturesDir = resolve(repoRoot, 'web/fixtures')
// fixtures an e2e generates at run time (e.g. large synthetic workbooks), never committed
const e2eFixturesDir = resolve(repoRoot, 'web/e2e/.results/fixtures')
// GO-B3: test-only host page that embeds the frame and speaks the protocol (web/e2e)
const testHostDir = resolve(here, 'test-host')
const port = Number(process.env.PORT) || 4180

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.map',
  '.svg',
  '.txt',
  '.ttf',
  '.otf',
  '.wasm',
])
const gzipCache = new Map()

// glob subset: `/**` = anything, `/x/**` = prefix, otherwise exact match
function ruleMatches(source, path) {
  if (source === '/**') return true
  if (source.endsWith('/**')) return path.startsWith(source.slice(0, -2))
  return source === path
}

function headersFor(path, rules = headerRules) {
  const out = {}
  for (const rule of rules) {
    if (!ruleMatches(rule.source, path)) continue
    for (const [k, v] of Object.entries(rule.headers)) if (!(k in out)) out[k] = v
  }
  return out
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

// `path` is the build-relative URL path (e.g. /assets/x.js), used for headers.json matching
async function sendFile(req, res, file, path = '/', rules = headerRules) {
  const s = await stat(file)
  const ext = extname(file).toLowerCase()
  const headers = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    ...headersFor(path, rules),
  }
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
  if (compress && acceptsGzip && COMPRESSIBLE.has(ext)) {
    let gz = gzipCache.get(file)
    if (!gz || gz.mtimeMs !== s.mtimeMs) {
      gz = { mtimeMs: s.mtimeMs, body: zlib.gzipSync(await readFile(file), { level: 9 }) }
      gzipCache.set(file, gz)
    }
    res.writeHead(200, {
      ...headers,
      'Content-Encoding': 'gzip',
      Vary: 'Accept-Encoding',
      'Content-Length': gz.body.length,
    })
    return res.end(req.method === 'HEAD' ? undefined : gz.body)
  }
  res.writeHead(200, { ...headers, 'Content-Length': s.size })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

// resolve `rel` under `base`, rejecting traversal
function safeJoin(base, rel) {
  const p = normalize(join(base, rel))
  return p === base || p.startsWith(base + sep) ? p : null
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)

    if (pathname === '/healthz') return send(res, 200, 'ok')

    const fx = /^\/fixtures\/([^/]+\.(?:docx|pdf|md|html|pptx|xlsx|xlsm|xls))$/.exec(pathname)
    if (fx) {
      for (const dir of [fixturesDir, webFixturesDir, e2eFixturesDir]) {
        const file = safeJoin(dir, fx[1])
        if (file && (await isFile(file))) return sendFile(req, res, file)
      }
      return send(res, 404, 'fixture not found')
    }
    const th = /^\/test-host\/(.*)$/.exec(pathname)
    if (th) {
      const file = safeJoin(testHostDir, th[1] || 'index.html')
      if (file && (await isFile(file))) return sendFile(req, res, file)
      return send(res, 404, 'not found')
    }

    const mf = moduleFrame(pathname)
    if (mf) {
      if (mf.error) return send(res, 404, mf.error)
      const file = safeJoin(mf.dir, mf.rel)
      if (file && (await isFile(file))) return sendFile(req, res, file, mf.rel, mf.rules)
      return send(res, 404, 'not found')
    }

    // MOUNT: only the prefixed URL space serves the build (proves the build has no root-absolute URLs)
    let rel = pathname
    if (mount) {
      if (pathname !== mount && !pathname.startsWith(mount + '/'))
        return send(res, 404, 'outside MOUNT')
      rel = pathname.slice(mount.length) || '/'
    }
    const file = safeJoin(distDir, rel === '/' ? 'index.html' : rel)
    if (file && (await isFile(file)))
      return sendFile(req, res, file, rel === '/' ? '/index.html' : rel)

    // a missing asset (has an extension) is a real 404; anything else is an SPA route
    if (extname(rel)) return send(res, 404, 'not found')
    const index = join(distDir, 'index.html')
    if (await isFile(index)) return sendFile(req, res, index, '/index.html')
    return send(res, 503, `${distDir} missing: run \`npm run build:web\``)
  } catch (err) {
    send(res, 500, String(err))
  }
})

server.listen(port, () =>
  console.log(
    `web/docs server: http://localhost:${port}${mount} (dist: ${distDir}${compress ? ', gzip' : ''})`,
  ),
)
