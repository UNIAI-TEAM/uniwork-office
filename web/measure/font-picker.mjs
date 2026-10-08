// Font traffic measurements beyond the first paint (UNI-1013 B3):
//   1. font files fetched when the editor becomes editable (document-driven, on demand)
//   2. font files fetched when the font picker dropdown is opened for the first time
// Usage: node web/measure/font-picker.mjs [--dist <dir>] [--compress] [--out file.json] [--doc simple|kitchen-sink|long]
// Spawns web/server/server.mjs itself (PORT=4183). HTTP cache disabled, fresh context.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : d
}
const DIST = arg('--dist', '')
const OUT = arg('--out', '')
const DOC = arg('--doc', 'simple')
const COMPRESS = process.argv.includes('--compress')
const PORT = 4183
const ORIGIN = `http://localhost:${PORT}`

const server = spawn('node', ['web/server/server.mjs'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(PORT),
    ...(DIST ? { DIST_DIR: DIST } : {}),
    ...(COMPRESS ? { COMPRESS: 'gzip' } : {}),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => /http:\/\/localhost/.test(String(d)) && res())
  server.on('exit', (c) => rej(new Error('server exited ' + c)))
  setTimeout(() => rej(new Error('server start timeout')), 15000)
})

try {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  const info = new Map()
  const fonts = []
  let phase = 'load'
  cdp.on('Network.requestWillBeSent', (e) =>
    info.set(e.requestId, { url: e.request.url, type: e.type }),
  )
  cdp.on('Network.loadingFinished', (e) => {
    const i = info.get(e.requestId)
    if (i && i.type === 'Font')
      fonts.push({
        phase,
        file: i.url.replace(ORIGIN, '').replace(/^.*\//, ''),
        wire: e.encodedDataLength,
      })
  })
  await page.goto(`${ORIGIN}/?open=${encodeURIComponent(`/fixtures/${DOC}.docx`)}`)
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 30000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  phase = 'picker'
  await page.locator('.rb-combo-caret').first().click()
  await page.waitForSelector('.rb-font-family-menu')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(2500)
  const menuItems = await page.locator('.rb-font-family-menu button').count()
  const sum = (p) => fonts.filter((f) => f.phase === p).reduce((n, f) => n + f.wire, 0)
  const result = {
    generatedAt: new Date().toISOString(),
    dist: DIST || '(server default)',
    compress: COMPRESS,
    doc: DOC,
    onLoad: {
      files: fonts.filter((f) => f.phase === 'load').length,
      wireBytes: sum('load'),
      list: fonts.filter((f) => f.phase === 'load'),
    },
    onPickerOpen: {
      menuItems,
      files: fonts.filter((f) => f.phase === 'picker').length,
      wireBytes: sum('picker'),
      list: fonts.filter((f) => f.phase === 'picker'),
    },
  }
  console.log(
    JSON.stringify({
      ...result,
      onLoad: { ...result.onLoad, list: undefined },
      onPickerOpen: { ...result.onPickerOpen, list: undefined },
    }),
  )
  for (const f of fonts) console.log(' ', f.phase.padEnd(6), String(f.wire).padStart(9), f.file)
  if (OUT) writeFileSync(resolve(repoRoot, OUT), JSON.stringify(result, null, 2))
  await browser.close()
} finally {
  server.kill()
}
