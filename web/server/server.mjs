// UNI-1011 spike: tiny static server for web/docs/dist (no dependencies).
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const distDir = resolve(repoRoot, 'web/docs/dist')
const fixturesDir = resolve(repoRoot, 'fixtures/generated')
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
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

async function sendFile(req, res, file) {
  const s = await stat(file)
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': s.size,
    'Cache-Control': 'no-store',
  })
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

    const fx = /^\/fixtures\/([^/]+\.docx)$/.exec(pathname)
    if (fx) {
      const file = safeJoin(fixturesDir, fx[1])
      if (file && (await isFile(file))) return sendFile(req, res, file)
      return send(res, 404, 'fixture not found')
    }

    const file = safeJoin(distDir, pathname === '/' ? 'index.html' : pathname)
    if (file && (await isFile(file))) return sendFile(req, res, file)

    // a missing asset (has an extension) is a real 404; anything else is an SPA route
    if (extname(pathname)) return send(res, 404, 'not found')
    const index = join(distDir, 'index.html')
    if (await isFile(index)) return sendFile(req, res, index)
    return send(res, 503, 'web/docs/dist missing: run `npm run build:web`')
  } catch (err) {
    send(res, 500, String(err))
  }
})

server.listen(port, () => console.log(`web/docs server: http://localhost:${port} (dist: ${distDir})`))
