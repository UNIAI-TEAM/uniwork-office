// Static server for the probe page under the Sheets frame CSP plus 'wasm-unsafe-eval'
// (base policy = web/docs/build/csp.ts baseDirectives; option A/C adds only the wasm keyword).
// Usage: node serve.mjs <port> <probe-dir> <shim-dist-dir> <wasm-file> <fixtures-dir> <recalc-max-bytes>
import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const [port, probeDir, shimDir, wasmFile, fixturesDir, recalcMax] = process.argv.slice(2)
export const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ')
const TYPES = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
}

async function resolvePath(url) {
  const path = normalize(decodeURIComponent(url.split('?')[0]))
  if (path === '/') return join(probeDir, 'page.html')
  if (path === '/xlsx-sidecar.wasm') return wasmFile
  if (path.startsWith('/shim/')) return join(shimDir, path.slice(6))
  if (path.startsWith('/fixtures/')) return join(fixturesDir, path.slice(10))
  return join(probeDir, path)
}

createServer(async (req, res) => {
  try {
    if (req.url === '/fixtures.json') {
      const names = (await readdir(fixturesDir)).filter((n) => /\.xls[xm]$/.test(n)).sort()
      const list = []
      for (const name of names) {
        const size = (await stat(join(fixturesDir, name))).size
        list.push({
          name,
          wasmUrl: '/xlsx-sidecar.wasm',
          fixtureUrl: `/fixtures/${name}`,
          recalc: size <= Number(recalcMax),
        })
      }
      list.sort((a, b) => a.name.localeCompare(b.name))
      res.writeHead(200, { 'content-type': 'application/json', 'content-security-policy': CSP })
      return res.end(JSON.stringify(list))
    }
    const file = await resolvePath(req.url)
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-security-policy': CSP,
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}).listen(Number(port), '127.0.0.1')
