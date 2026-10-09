// F4 (UNI-1013) before/after captures of the Docs web frame through the test host.
// usage: node capture.mjs <repoRoot> <baseUrl> <outDir> <variant>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const [repoRoot, base, outDir, variant] = process.argv.slice(2)
const require = createRequire(join(repoRoot, 'package.json'))
const { chromium } = require('playwright-core')
mkdirSync(outDir, { recursive: true })
const DOCX = readFileSync(join(repoRoot, 'fixtures/generated/simple.docx'))
const EDITOR = '.ProseMirror[contenteditable="true"]'
const facts = {}

// host page: delay / fail chosen frame->host requests by wrapping the host's message listener
const hostInit = () => {
  const orig = window.addEventListener.bind(window)
  window.__delay = {}
  window.__fail = {}
  window.addEventListener = (type, fn, opts) => {
    if (type !== 'message' || window.top !== window) return orig(type, fn, opts)
    return orig(
      type,
      (ev) => {
        const d = ev.data
        if (d && d.kind === 'request' && window.__fail[d.type]) {
          ev.source.postMessage(
            {
              ns: d.ns,
              v: d.v,
              id: d.id,
              kind: 'response',
              type: d.type,
              error: { code: 'unsupported', message: 'office_not_configured', status: 503 },
            },
            ev.origin,
          )
          return
        }
        const ms = d && d.kind === 'request' ? window.__delay[d.type] : 0
        if (ms) setTimeout(() => fn(ev), ms)
        else fn(ev)
      },
      opts,
    )
  }
  // headless print: settle like a closed print dialog
  if (window.top !== window) window.print = () => window.dispatchEvent(new Event('afterprint'))
}

async function open(browser, { lang, theme, width = 1440, height = 900, delayOpen = 0 }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    locale: lang === 'vi' ? 'vi-VN' : 'en-US',
  })
  await ctx.route('**/fixtures/simple.docx', (r) =>
    r.fulfill({ status: 200, body: DOCX, headers: { 'content-type': 'application/octet-stream' } }),
  )
  await ctx.addInitScript(hostInit)
  const page = await ctx.newPage()
  if (delayOpen)
    await page.addInitScript((ms) => {
      if (window.top === window) window.__delay = { 'api.open': ms }
    }, delayOpen)
  await page.goto(
    `${base}/test-host/?open=${encodeURIComponent('/fixtures/simple.docx')}&lang=${lang}&theme=${theme}`,
  )
  const frame = await (await page.waitForSelector('#frame')).contentFrame()
  return { ctx, page, frame }
}

async function ready(frame) {
  await frame
    .locator(EDITOR)
    .first()
    .getByText('第一段')
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 })
  await frame.waitForTimeout(800)
}

async function shot(target, name, opts = {}) {
  await target.screenshot({ path: join(outDir, `${name}.png`), ...opts })
}

const browser = await chromium.launch({ args: ['--no-sandbox'] })
try {
  // 1. dark File button (vi, dark, 1440)
  {
    const { ctx, page, frame } = await open(browser, { lang: 'vi', theme: 'dark' })
    await ready(frame)
    await shot(page, '01-dark-ribbon-file', { clip: { x: 0, y: 20, width: 720, height: 140 } })
    facts.fileButton = await frame.evaluate(() => {
      const b = document.querySelector('.ribbon-tab-file')
      const cs = getComputedStyle(b)
      return { color: cs.color, background: cs.backgroundColor }
    })
    await ctx.close()
  }
  // 2-4. status bar opened/dirty/saved + conflict dialog (vi, light, 1440)
  {
    const { ctx, page, frame } = await open(browser, { lang: 'vi', theme: 'light' })
    await ready(frame)
    const bar = frame.locator('.status-bar')
    await shot(bar, '03a-status-opened')
    await frame.locator(EDITOR).first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' sửa đổi')
    await frame.waitForTimeout(600)
    await shot(bar, '03b-status-dirty')
    facts.hostDirtyEvents = await page.evaluate(() =>
      (window.__host.events || []).filter((e) => e.type === 'dirty').map((e) => e.payload),
    )
    await page.keyboard.press('Control+s')
    await frame.waitForTimeout(2500)
    await shot(bar, '03c-status-saved')
    // conflict: another writer saves first, then Ctrl+S
    await page.keyboard.type(' lần hai')
    await page.evaluate(() => window.__host.bumpRemote(window.__host.files()[0].fileId))
    await page.keyboard.press('Control+s')
    await frame.locator('[data-docs-web="conflict"]').waitFor({ timeout: 15_000 })
    await frame.waitForTimeout(400)
    await shot(page, '02-conflict-dialog')
    facts.conflictFocus = await frame.evaluate(() =>
      document.activeElement?.getAttribute('data-choice'),
    )
    facts.hostModalEvents = await page.evaluate(() =>
      (window.__host.events || []).filter((e) => e.type === 'modal').map((e) => e.payload),
    )
    await page.keyboard.press('Escape')
    await frame.waitForTimeout(500)
    facts.conflictAfterEsc = await frame.evaluate(
      () => !!document.querySelector('[data-docs-web="conflict"]'),
    )
    await ctx.close()
  }
  // 5. export fallback message (vi, light): host answers api.export with an error
  {
    const { ctx, page, frame } = await open(browser, { lang: 'vi', theme: 'light' })
    await ready(frame)
    await page.evaluate(() => (window.__fail['api.export'] = true))
    await frame.evaluate(() => window.__exportPdf())
    await frame.waitForTimeout(1500)
    await shot(frame.locator('.status-bar'), '04-export-fallback-vi')
    facts.exportStatus = await frame.evaluate(
      () => document.querySelector('.status-bar')?.textContent,
    )
    await ctx.close()
  }
  // 6. Styles gallery in a 944px frame (UniWork at 1024x768), vi light + en dark
  for (const [lang, theme] of [
    ['vi', 'light'],
    ['en', 'dark'],
  ]) {
    const { ctx, page, frame } = await open(browser, { lang, theme, width: 944, height: 700 })
    await ready(frame)
    await shot(page, `05-ribbon-944-${lang}-${theme}`, {
      clip: { x: 0, y: 20, width: 944, height: 150 },
    })
    facts[`ribbon944_${lang}`] = await frame.evaluate(() => {
      const body = document.querySelector('.ribbon-body')
      const g = document.querySelector('.ribbon-group-styles')
      return {
        scrollW: body.scrollWidth,
        clientW: body.clientWidth,
        stylesRight: Math.round(g.getBoundingClientRect().right),
        more: !!document.querySelector('.style-gallery-more'),
      }
    })
    await ctx.close()
  }
  // 7. loading feedback (api.open held 4 s) + save-as progress (api.saveAs held 4 s), en dark
  {
    const { ctx, page, frame } = await open(browser, { lang: 'en', theme: 'dark', delayOpen: 4000 })
    await frame.waitForSelector('.status-bar', { timeout: 30_000 })
    await frame.waitForTimeout(1200)
    await shot(page, '06a-opening')
    await ready(frame)
    await page.evaluate(() => (window.__delay['api.saveAs'] = 4000))
    const p = page.evaluate(() => window.__host.request('saveAs', { name: 'copy.docx' }))
    await frame.waitForTimeout(1500)
    await shot(frame.locator('.status-bar'), '06b-saving-as')
    await p
    await frame.waitForTimeout(1500)
    await shot(frame.locator('.status-bar'), '06c-saved-as')
    await ctx.close()
  }
} finally {
  await browser.close()
}
writeFileSync(join(outDir, `facts-${variant}.json`), JSON.stringify(facts, null, 2))
console.log(JSON.stringify(facts, null, 2))
