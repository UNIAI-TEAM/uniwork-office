// UNI-1011 spike: cold-load measurements for web/docs (Playwright chromium, headless).
// Usage: node web/measure/load.mjs [--runs 5] [--out web/measure/load.json]
// Spawns `node web/server/server.mjs` itself (PORT=4182). Each run = fresh browser context,
// HTTP cache disabled (CDP Network.setCacheDisabled), so every run is a cold load.
//
// time-to-editable: first moment a *visible* [contenteditable=true] element contains the doc's
// known text snippet (detected in-page via MutationObserver + rAF; value = performance.now(),
// i.e. ms since navigation start). Same selector/text check as web/e2e/docs-web.spec.ts.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : d
}
const RUNS = Number(arg('--runs', 5))
const OUT = resolve(repoRoot, arg('--out', 'web/measure/load.json'))
const PORT = 4182
const BASE = `http://localhost:${PORT}`
const TIMEOUT = 60_000

const DOCS = [
  { name: 'simple.docx', snippet: '第一段', local: 'fixtures/generated/simple.docx' },
  { name: 'kitchen-sink.docx', snippet: '普通段落', local: 'fixtures/generated/kitchen-sink.docx' },
  { name: 'long.docx', snippet: 'Chapter 1', local: 'web/fixtures/long.docx' },
]

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const stat = (xs) => ({ median: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length })

async function startServer() {
  const p = spawn('node', ['web/server/server.mjs'], { cwd: repoRoot, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise((res, rej) => {
    p.stdout.on('data', (d) => /http:\/\/localhost/.test(String(d)) && res())
    p.on('exit', (c) => rej(new Error('server exited ' + c)))
    setTimeout(() => rej(new Error('server start timeout')), 15000)
  })
  return p
}

// in-page detector, installed before any page script runs
const DETECTOR = (snippet) => {
  window.__tte = null
  const check = () => {
    for (const el of document.querySelectorAll('.ProseMirror[contenteditable="true"]')) {
      if (el.textContent && el.textContent.includes(snippet) && el.getClientRects().length > 0) {
        window.__tte = performance.now()
        return true
      }
    }
    return false
  }
  const tick = () => {
    if (window.__tte != null) return
    if (!check()) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

async function fixtureServed(doc) {
  const r = await fetch(`${BASE}/fixtures/${doc.name}`)
  return r.ok
}

async function runOnce(browser, doc, viaRoute) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Performance.enable')
  let transferred = 0
  let requests = 0
  const failed = []
  cdp.on('Network.loadingFinished', (e) => {
    transferred += e.encodedDataLength
    requests++
  })
  page.on('requestfailed', (r) => failed.push(r.url()))
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)))
  if (viaRoute) {
    // server does not serve this fixture: fulfil it from disk (4-5 KB; negligible vs. the bundle)
    await page.route(`**/fixtures/${doc.name}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: readFileSync(resolve(repoRoot, doc.local)) }),
    )
  }
  await page.addInitScript(DETECTOR, doc.snippet)

  const url = `${BASE}/?open=${encodeURIComponent('/fixtures/' + doc.name)}`
  await page.goto(url, { waitUntil: 'commit' })
  let opened = 'query'
  // fall back to the shim API if ?open= is not honoured
  const fallbackTimer = setTimeout(() => {}, 0)
  clearTimeout(fallbackTimer)
  let tte = null
  const deadline = Date.now() + TIMEOUT
  let triedShim = false
  while (Date.now() < deadline) {
    tte = await page.evaluate(() => window.__tte).catch(() => null)
    if (tte != null) break
    if (!triedShim && Date.now() > deadline - TIMEOUT + 15_000) {
      const has = await page.evaluate(() => typeof window.__docsWeb?.openUrl === 'function').catch(() => false)
      if (has) {
        triedShim = true
        opened = 'openUrl'
        await page.evaluate((u) => window.__docsWeb.openUrl(u), '/fixtures/' + doc.name).catch(() => {})
      }
    }
    await page.waitForTimeout(25)
  }
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0]
    return n ? { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null
  })
  const transferredAtEditable = transferred
  let heap = null
  let heapAfterGc = null
  if (tte != null) {
    const m = await cdp.send('Performance.getMetrics')
    heap = m.metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? null
    await cdp.send('HeapProfiler.enable').catch(() => {})
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {})
    const m2 = await cdp.send('Performance.getMetrics')
    heapAfterGc = m2.metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? null
  }
  // let late font requests finish, then take the settled total
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1500)
  await ctx.close()
  return { transferredAtEditable, ok: tte != null, opened, dcl: nav?.dcl ?? null, load: nav?.load ?? null, tte, heap, heapAfterGc, transferred, requests, failed, consoleErrors }
}

const server = await startServer()
try {
  const browser = await chromium.launch({ headless: true })
  const results = { generatedAt: new Date().toISOString(), runs: RUNS, chromium: browser.version(), server: 'web/server/server.mjs (no compression, Cache-Control: no-store)', docs: {} }
  for (const doc of DOCS) {
    const viaRoute = !(await fixtureServed(doc))
    const runs = []
    for (let i = 0; i < RUNS; i++) {
      const r = await runOnce(browser, doc, viaRoute)
      runs.push(r)
      console.log(doc.name, i + 1, JSON.stringify({ ...r, failed: r.failed.length, consoleErrors: r.consoleErrors.length }))
    }
    const good = runs.filter((r) => r.ok)
    const col = (k) => good.map((r) => r[k]).filter((v) => v != null)
    results.docs[doc.name] = {
      fixtureServedBy: viaRoute ? 'playwright route (server 404)' : 'server',
      okRuns: good.length,
      domContentLoadedMs: col('dcl').length ? stat(col('dcl')) : null,
      loadMs: col('load').length ? stat(col('load')) : null,
      timeToEditableMs: col('tte').length ? stat(col('tte')) : null,
      jsHeapUsedBytes: col('heap').length ? stat(col('heap')) : null,
      jsHeapUsedAfterGcBytes: col('heapAfterGc').length ? stat(col('heapAfterGc')) : null,
      transferredAtEditableBytes: col('transferredAtEditable').length ? stat(col('transferredAtEditable')) : null,
      transferredBytes: col('transferred').length ? stat(col('transferred')) : null,
      requests: col('requests').length ? stat(col('requests')) : null,
      raw: runs,
    }
  }
  await browser.close()
  writeFileSync(OUT, JSON.stringify(results, null, 2))
  console.log('wrote', OUT)
} finally {
  server.kill()
}
