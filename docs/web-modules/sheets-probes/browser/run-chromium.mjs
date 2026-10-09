/* global window */
// Runs page.html (served by serve.mjs) in headless Chromium and writes the results.
// Samples the peak RSS (VmHWM) of Chromium's renderer processes while it runs.
// Usage: node run-chromium.mjs <url> <out.json> <timeout-ms>
import { chromium } from 'playwright'
import { readFile, readdir, writeFile } from 'node:fs/promises'

const [url, out, timeoutArg] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
const consoleErrors = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
let crashed = null
page.on('crash', () => (crashed = 'renderer process crashed'))

async function rendererPeakKb() {
  let peak = 0
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    try {
      const cmd = await readFile(`/proc/${pid}/cmdline`, 'utf8')
      if (!cmd.includes('--type=renderer')) continue
      const status = await readFile(`/proc/${pid}/status`, 'utf8')
      peak = Math.max(peak, Number(/VmHWM:\s+(\d+) kB/.exec(status)?.[1] ?? 0))
    } catch {}
  }
  return peak
}

await page.goto(url)
const deadline = Date.now() + Number(timeoutArg ?? 900_000)
let peakKb = 0
let probe = null
while (Date.now() < deadline && !crashed) {
  peakKb = Math.max(peakKb, await rendererPeakKb())
  probe = await page.evaluate(() => window.__probe ?? null).catch(() => null)
  if (probe) break
  await new Promise((r) => setTimeout(r, 250))
}
const current = crashed
  ? null
  : await page.evaluate(() => window.__current ?? null).catch(() => null)
await writeFile(
  out,
  `${JSON.stringify({ browser: browser.version(), crashed, current, rendererPeakRssKb: peakKb, consoleErrors, ...(probe ?? {}) }, null, 2)}\n`,
)
await browser.close()
