// UNI-1232 A1 + A5 + B (HTML): the preview runs a page whose stylesheet, script and pictures are
// files of the same UniWork folder (the open answer's `assets`: CSS and JS are inlined into the
// preview copy, SVG/WebP pictures become data: URIs; preview.html's policy stays as it is), Export
// HTML downloads the page from the ribbon, and a page that uses fetch/XHR or nested frames gets one
// inline note above the preview (with Open in app while the host grants desktopOpen).
// Run: npx playwright test -c web/e2e html-assets-web   (needs npm run build:web -- --module html)
import { test, expect, type Frame, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  built,
  cspViolations,
  encode,
  openModule,
  screenshotPath,
  serveFixture,
  watch,
} from './text-modules'

test.skip(!built('html'), 'no dist-web/html build: npm run build:web -- --module html')

const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#08f"/></svg>'

const PAGE = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <title>Assets page</title>',
  '    <link rel="stylesheet" href="style.css" />',
  '    <script defer src="app.js"></script>',
  '  </head>',
  '  <body>',
  '    <h1 id="h">Assets page</h1>',
  '    <p id="out">before</p>',
  '    <img id="logo" src="logo.svg" alt="logo" />',
  '    <img id="photo" src="./photo.webp" alt="photo" />',
  '  </body>',
  '</html>',
  '',
].join('\n')
const PAGE_PATH = '/e2e-fixtures/Assets.html'
const ASSETS = {
  'style.css': '/e2e-assets/style.css',
  'app.js': '/e2e-assets/app.js',
  'logo.svg': '/e2e-assets/logo.svg',
  './photo.webp': '/e2e-assets/photo.webp',
}

const FETCHING = [
  '<!doctype html><html><head><meta charset="utf-8"><title>Fetching page</title></head>',
  '<body><h1>Fetching page</h1><p id="data">waiting</p>',
  '<script>fetch("/api/data").then((r) => r.text()).then((t) => (document.getElementById("data").textContent = t))</script>',
  '</body></html>',
  '',
].join('\n')
const FETCHING_PATH = '/e2e-fixtures/Fetching.html'

const PLAIN_PATH = '/e2e-fixtures/Plain.html'
const PLAIN =
  '<!doctype html><html><head><title>Plain</title></head><body><h1>Plain page</h1></body></html>\n'

async function serveAssets(page: Page) {
  await page.route('**/e2e-assets/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!
    const table: Record<string, { type: string; body: Buffer | string }> = {
      'style.css': { type: 'text/css', body: '#h { color: rgb(1, 2, 3) }' },
      'app.js': {
        type: 'text/javascript',
        body: "document.getElementById('out').textContent = 'script ran'",
      },
      'logo.svg': { type: 'image/svg+xml', body: SVG },
      'photo.webp': { type: 'image/webp', body: WEBP },
    }
    const found = table[name]
    if (!found) return route.fulfill({ status: 404, body: 'none' })
    return route.fulfill({ status: 200, body: found.body, headers: { 'content-type': found.type } })
  })
}

function previewFrame(page: Page): Frame | undefined {
  return page.frames().find((f) => f.url().includes('/preview.html'))
}

async function ready(page: Page, frame: Frame, text: RegExp) {
  await expect(frame.locator('.workspace')).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(
      async () => (await previewFrame(page)?.evaluate(() => document.body?.innerText ?? '')) ?? '',
      {
        timeout: 30_000,
      },
    )
    .toMatch(text)
}

test('html: sibling stylesheet, script and SVG/WebP pictures reach the scripts preview', async ({
  page,
}) => {
  const problems = await watch(page)
  await serveFixture(page, PAGE_PATH, encode(PAGE), 'text/html')
  await serveAssets(page)
  const frame = await openModule(page, 'html', {
    open: PAGE_PATH,
    lang: 'en',
    assets: JSON.stringify(ASSETS),
  })
  await ready(page, frame, /Assets page/)
  const preview = () => previewFrame(page)!
  // the stylesheet applies and the (deferred) script ran
  await expect
    .poll(() => preview().evaluate(() => getComputedStyle(document.getElementById('h')!).color))
    .toBe('rgb(1, 2, 3)')
  await expect
    .poll(() => preview().evaluate(() => document.getElementById('out')?.textContent))
    .toBe('script ran')
  // the pictures are data: URIs that decode
  await expect
    .poll(() =>
      preview().evaluate(() =>
        ['logo', 'photo'].map((id) => {
          const img = document.getElementById(id) as HTMLImageElement
          return img.complete && img.naturalWidth > 0 && img.src.startsWith('data:image/')
        }),
      ),
    )
    .toEqual([true, true])
  // the page's own markup is unchanged in the source (the copy is what the preview gets)
  await frame.getByRole('tab', { name: /^Source$/ }).click()
  await expect(frame.locator('.cm-content')).toContainText('href="style.css"')
  await expect(frame.locator('.cm-content')).toContainText('src="app.js"')
  await page.screenshot({ path: screenshotPath('html', 'siblings-light-en') })

  const csp = await cspViolations(page, frame)
  expect({ csp, ...problems }).toEqual({ csp: [], console: [], page: [], http: [], external: [] })
})

test('html: Export HTML downloads the page from the ribbon, pictures inlined', async ({ page }) => {
  await serveFixture(page, PAGE_PATH, encode(PAGE), 'text/html')
  await serveAssets(page)
  const frame = await openModule(page, 'html', {
    open: PAGE_PATH,
    lang: 'en',
    assets: JSON.stringify(ASSETS),
  })
  await ready(page, frame, /Assets page/)
  const button = frame.getByRole('button', { name: 'Export HTML' })
  await expect(button).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  expect(download.suggestedFilename()).toBe('Assets.html')
  const html = readFileSync((await download.path())!, 'utf8')
  expect(html).toContain('<h1 id="h">Assets page</h1>')
  expect(html).toContain('src="data:image/svg+xml;base64,')
  expect(html).toContain('data:image/webp;base64,')
})

test('html: view only still exports', async ({ page }) => {
  await serveFixture(page, PAGE_PATH, encode(PAGE), 'text/html')
  await serveAssets(page)
  const frame = await openModule(page, 'html', { open: PAGE_PATH, lang: 'en', readonly: '1' })
  await ready(page, frame, /Assets page/)
  const button = frame.getByRole('button', { name: 'Export HTML' })
  await expect(button).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  expect(download.suggestedFilename()).toBe('Assets.html')
})

test.describe('web preview limits note', () => {
  const NOTE = '.preview-limit-note'

  test('a page that fetches data gets one note with Open in app; app.open goes to the host once', async ({
    page,
  }) => {
    await serveFixture(page, FETCHING_PATH, encode(FETCHING), 'text/html')
    const frame = await openModule(page, 'html', {
      open: FETCHING_PATH,
      lang: 'en',
      desktopOpen: '1',
    })
    await ready(page, frame, /Fetching page/)
    const note = frame.locator(NOTE)
    await expect(note).toHaveCount(1)
    await expect(note).toContainText('Open in the UniWork Office app to use this feature')
    // the note is chrome: outside the document the preview shows
    expect(
      (await previewFrame(page)!.evaluate(() => document.body.innerText)).includes(
        'Open in the UniWork',
      ),
    ).toBe(false)
    await page.screenshot({ path: screenshotPath('html', 'preview-note-light-en') })
    await note.getByRole('button', { name: 'Open in app' }).click()
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { __host: { appOpens(): Array<{ feature: string }> } }
          ).__host.appOpens(),
        ),
      )
      .toEqual([{ feature: 'html.preview' }])
  })

  test('without the desktopOpen grant the note is text only; in Vietnamese it reads the agreed sentence', async ({
    page,
  }) => {
    await serveFixture(page, FETCHING_PATH, encode(FETCHING), 'text/html')
    const frame = await openModule(page, 'html', { open: FETCHING_PATH, lang: 'vi', theme: 'dark' })
    await ready(page, frame, /Fetching page/)
    const note = frame.locator(NOTE)
    await expect(note).toContainText('Mở trong ứng dụng UniWork Office để dùng tính năng này')
    await expect(note.getByRole('button')).toHaveCount(0)
    await page.screenshot({ path: screenshotPath('html', 'preview-note-dark-vi') })
  })

  test('a page that needs nothing from the network has no note', async ({ page }) => {
    await serveFixture(page, PLAIN_PATH, encode(PLAIN), 'text/html')
    const frame = await openModule(page, 'html', { open: PLAIN_PATH, lang: 'en' })
    await ready(page, frame, /Plain page/)
    await expect(frame.locator(NOTE)).toHaveCount(0)
  })
})
