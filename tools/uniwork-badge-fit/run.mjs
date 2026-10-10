// Measures the UniWork status chip against the divider that follows it in the
// tab strip, in a real Electron window running the real TabBar renderer code.
//
//   node tools/uniwork-badge-fit/run.mjs --out <dir> [--baseline]
//
// For every chip / notice state x vi+en x 1024/1280/1440 px x light+dark it
// checks that no pill overlaps the divider (gap >= --uw-divider-gap), that the
// pills stay clear of the tab strip, and that a truncated label carries its
// full text as the title. Screenshots of the strip go to --out. --baseline
// zeroes the chrome's right margin to reproduce the unfixed layout.
/* global document, window, getComputedStyle -- the page.evaluate callbacks run in the renderer */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const require = createRequire(resolve(root, 'package.json'))
const { build } = require('vite')
const react = require('@vitejs/plugin-react').default
const { _electron: electron } = require('playwright-core')

const argv = process.argv.slice(2)
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
const outDir = resolve(option('--out') ?? resolve(here, 'out'))
const baseline = argv.includes('--baseline')
mkdirSync(outDir, { recursive: true })
const distDir = resolve(outDir, '.harness-dist')

await build({
  root: here,
  base: './',
  logLevel: 'warn',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { fs: { allow: [root] } },
  build: { outDir: distDir, emptyOutDir: true, minify: false },
})
const pageUrl = pathToFileURL(resolve(distDir, 'index.html')).href

const WIDTHS = [1024, 1280, 1440]
const LANGS = ['vi', 'en']
const THEMES = ['light', 'dark']
const results = []

async function show(page, { theme, lang, state }) {
  await page.goto(`${pageUrl}?lang=${lang}&theme=${theme}&state=${state}`)
  await page.waitForSelector('.uw-pill .uw-pill-label')
  if (baseline) await page.addStyleTag({ content: '.uw-chrome{margin-right:0 !important}' })
  await page.waitForTimeout(120)
}

async function measure(page, key) {
  const m = await page.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right }
    }
    const btn = document.querySelector('.tab-overflow-btn')
    const before = getComputedStyle(btn, '::before')
    const dividerLeft = btn.getBoundingClientRect().left + parseFloat(before.left)
    const chromeEl = document.querySelector('.uw-chrome')
    return {
      dividerLeft,
      gapToken: parseFloat(
        getComputedStyle(document.querySelector('.tab-bar')).getPropertyValue('--uw-divider-gap'),
      ),
      strip: rect(document.querySelector('.tab-strip')),
      chrome: chromeEl ? rect(chromeEl) : null,
      innerWidth: window.innerWidth,
      pills: [...document.querySelectorAll('.uw-pill')].map((pill) => {
        const label = pill.querySelector('.uw-pill-label')
        return {
          rect: rect(pill),
          text: label.textContent,
          title: pill.getAttribute('title') || '',
          truncated: label.scrollWidth > label.clientWidth,
          buttons: [...pill.querySelectorAll('button')].map(rect),
        }
      }),
    }
  })
  const failures = []
  if (m.pills.length === 0) failures.push('no pill rendered')
  if (!(m.gapToken > 0)) failures.push('--uw-divider-gap is not defined')
  const gap = m.dividerLeft - Math.max(...m.pills.map((p) => p.rect.right))
  if (gap < m.gapToken - 0.01) failures.push(`gap to divider ${gap.toFixed(1)}px < ${m.gapToken}px`)
  if (gap < 0) failures.push('a pill overlaps the divider')
  if (m.chrome && m.chrome.left < m.strip.right - 0.5)
    failures.push('chrome overlaps the tab strip')
  for (const pill of m.pills) {
    if (
      m.chrome &&
      (pill.rect.left < m.chrome.left - 0.5 || pill.rect.right > m.chrome.right + 0.5)
    ) {
      failures.push('a pill is wider than its holder')
    }
    if (pill.truncated && !pill.title.includes(pill.text)) {
      failures.push(`truncated "${pill.text}" has no full-text title`)
    }
    for (const button of pill.buttons) {
      if (button.left < pill.rect.left - 0.5 || button.right > pill.rect.right + 0.5) {
        failures.push('a pill button leaves the pill')
      }
    }
  }
  if (m.innerWidth !== key.width)
    failures.push(`window is ${m.innerWidth}px wide, wanted ${key.width}`)
  const name = `${key.theme}-${key.lang}-${key.width}-${key.state}`
  await page.screenshot({
    path: resolve(outDir, `${name}.png`),
    clip: { x: 0, y: 0, width: m.innerWidth, height: 44 },
  })
  return {
    ...key,
    gap: Number(gap.toFixed(1)),
    gapToken: m.gapToken,
    truncated: m.pills.some((p) => p.truncated),
    labels: m.pills.map((p) => p.text),
    ok: failures.length === 0,
    failures,
  }
}

for (const theme of THEMES) {
  const app = await electron.launch({
    args: [resolve(here, 'main.cjs')],
    env: { ...process.env, FIT_DARK: theme === 'dark' ? '1' : '0' },
  })
  const page = await app.firstWindow()
  await page.goto(`${pageUrl}?state=saved`)
  await page.waitForFunction(() => Array.isArray(window.__scenarios))
  const states = await page.evaluate(() => window.__scenarios)
  for (const lang of LANGS) {
    for (const width of WIDTHS) {
      await app.evaluate(({ BrowserWindow }, w) => {
        BrowserWindow.getAllWindows()[0].setContentSize(w, 240)
      }, width)
      for (const state of states) {
        const key = { theme, lang, width, state }
        await show(page, key)
        results.push(await measure(page, key))
      }
    }
  }
  await app.close()
}

const bad = results.filter((r) => !r.ok)
writeFileSync(
  resolve(outDir, baseline ? 'results-baseline.json' : 'results.json'),
  JSON.stringify(results, null, 2),
)
const gaps = results.map((r) => r.gap)
console.log(
  `${baseline ? 'BASELINE ' : ''}${results.length} combinations, ${bad.length} failing; ` +
    `gap to divider min ${Math.min(...gaps)}px max ${Math.max(...gaps)}px`,
)
for (const r of bad.slice(0, 15))
  console.log(`  ${r.theme}/${r.lang}/${r.width}/${r.state}: ${r.failures.join('; ')}`)
process.exit(baseline ? 0 : bad.length ? 1 : 0)
