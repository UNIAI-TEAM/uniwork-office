// UNI-1232 A1 + A5 (Markdown): relative pictures of an existing document resolve through the open
// answer's `assets` (PNG, WebP, SVG; a URL the host refuses shows the missing-picture placeholder
// with its explanation), pasted PNG/JPEG/GIF/WebP pictures upload through api.images.upload and the
// document references `assets/<name>` (a pasted SVG stays a data: URI), and the ribbon's Export Word
// downloads a .docx. The test host fills `assets` (?assets=), grants `images` (?images=1) and keeps
// the uploads; the picture routes are page.route fakes (/e2e-assets/...).
// Run: npx playwright test -c web/e2e markdown-assets-web   (needs npm run build:web -- --module markdown)
import { test, expect, type Frame, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  built,
  cspViolations,
  encode,
  hostState,
  openModule,
  screenshotPath,
  serveFixture,
  watch,
} from './text-modules'

test.skip(!built('markdown'), 'no dist-web/markdown build: npm run build:web -- --module markdown')

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#08f"/></svg>'

const DOC = [
  '# Pictures',
  '',
  '![png](assets/a.png)',
  '',
  '![webp](./assets/b.webp)',
  '',
  '![vector](c.svg)',
  '',
  '![gone](assets/gone.png)',
  '',
  'Tail paragraph.',
  '',
].join('\n')
const DOC_PATH = '/e2e-fixtures/Pictures.md'
const ASSETS = {
  'assets/a.png': '/e2e-assets/a.png',
  './assets/b.webp': '/e2e-assets/b.webp',
  'c.svg': '/e2e-assets/c.svg',
  'assets/gone.png': '/e2e-assets/gone.png',
}

/** fake asset routes: GET and HEAD alike; the revoked picture answers 403, as a refused signature does */
async function serveAssets(page: Page) {
  await page.route('**/e2e-assets/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!
    // a picture the page just uploaded: the host stores it under the generated name; the bytes are
    // known per extension (answering by name keeps the route free of any race with the upload)
    if (/^image-.*\.png$/.test(name))
      return route.fulfill({ status: 200, body: PNG, headers: { 'content-type': 'image/png' } })
    if (/^image-.*\.webp$/.test(name))
      return route.fulfill({ status: 200, body: WEBP, headers: { 'content-type': 'image/webp' } })
    const table: Record<string, { type: string; body: Buffer | string }> = {
      'a.png': { type: 'image/png', body: PNG },
      'b.webp': { type: 'image/webp', body: WEBP },
      'c.svg': { type: 'image/svg+xml', body: SVG },
    }
    const found = table[name]
    if (!found) return route.fulfill({ status: 403, body: 'revoked' })
    return route.fulfill({ status: 200, body: found.body, headers: { 'content-type': found.type } })
  })
}

async function shown(frame: Frame) {
  await expect(frame.locator('.doc-editor')).toContainText('Tail paragraph', { timeout: 30_000 })
}

/** the picture element finished loading with real pixels */
async function loaded(frame: Frame, alt: string): Promise<boolean> {
  return frame
    .locator(`.doc-editor img[alt="${alt}"]`)
    .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)
}

/** paste a picture file into the editor the way a clipboard paste does */
async function paste(frame: Frame, name: string, type: string, bytes: number[]) {
  await frame.locator('.doc-editor p', { hasText: 'Tail paragraph' }).click()
  await frame.evaluate(
    ({ name, type, bytes }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(bytes)], name, { type }))
      const target = document.querySelector('.doc-editor') as HTMLElement
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      )
    },
    { name, type, bytes },
  )
}

test('markdown: relative PNG, WebP and SVG pictures display; a refused URL shows the placeholder', async ({
  page,
}) => {
  const problems = await watch(page)
  await serveFixture(page, DOC_PATH, encode(DOC), 'text/markdown')
  await serveAssets(page)
  const frame = await openModule(page, 'markdown', {
    open: DOC_PATH,
    lang: 'en',
    assets: JSON.stringify(ASSETS),
  })
  await shown(frame)
  await expect.poll(() => loaded(frame, 'png')).toBe(true)
  await expect.poll(() => loaded(frame, 'webp')).toBe(true)
  await expect.poll(() => loaded(frame, 'vector')).toBe(true)

  // the revoked one: a placeholder with the localised explanation, never a broken icon
  const gone = frame.locator('.doc-editor img[alt="gone"]')
  await expect(gone).toHaveAttribute('src', /^data:image\/svg\+xml/)
  await expect(gone).toHaveAttribute('aria-label', /Image not available: gone/)
  expect(await loaded(frame, 'gone')).toBe(true)
  await page.screenshot({ path: screenshotPath('markdown', 'pictures-light-en') })

  // the document text is untouched by any of this
  await frame.locator('.doc-editor p', { hasText: 'Tail paragraph' }).click()
  await page.keyboard.press('Control+s')
  const saved = (await hostState(page)).lastSaved
  if (saved) expect(new TextDecoder().decode(new Uint8Array(saved.bytes))).toBe(DOC)

  const csp = await cspViolations(page, frame)
  // the revoked picture's HEAD probe is the one expected 403
  const unexpected = (list: string[]) =>
    list.filter((m) => !/\/e2e-assets\/gone\.png/.test(m) && !/403/.test(m))
  expect({
    csp,
    console: unexpected(problems.console),
    page: problems.page,
    http: unexpected(problems.http),
    external: problems.external,
  }).toEqual({ csp: [], console: [], page: [], http: [], external: [] })
})

test('markdown: pasted PNG and WebP upload as document assets, an SVG stays a data: URI', async ({
  page,
}) => {
  await serveFixture(page, DOC_PATH, encode('# Pictures\n\nTail paragraph.\n'), 'text/markdown')
  await serveAssets(page)
  const frame = await openModule(page, 'markdown', {
    open: DOC_PATH,
    lang: 'en',
    images: '1',
  })
  await shown(frame)

  await paste(frame, 'shot.png', 'image/png', [...PNG])
  await expect.poll(async () => (await uploads(page)).length).toBe(1)
  const [png] = await uploads(page)
  expect(png).toMatchObject({ mimeType: 'image/png' })
  expect(png!.name).toMatch(/^image-\d{8}-\d{6}-[a-z0-9]+\.png$/)
  expect(png!.bytes).toEqual([...PNG])

  await paste(frame, 'shot.webp', 'image/webp', [...WEBP])
  await expect.poll(async () => (await uploads(page)).length).toBe(2)
  const webp = (await uploads(page))[1]!
  expect(webp.mimeType).toBe('image/webp')
  expect(webp.name).toMatch(/\.webp$/)

  await paste(frame, 'logo.svg', 'image/svg+xml', [...encode(SVG)])
  await expect(frame.locator('.doc-editor img:not(.ProseMirror-separator)')).toHaveCount(3)
  // SVG: nothing uploaded
  expect(await uploads(page)).toHaveLength(2)

  // the pictures show (the host serves the returned URLs)
  await expect
    .poll(() =>
      frame
        .locator('.doc-editor img:not(.ProseMirror-separator)')
        .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth > 0)),
    )
    .toEqual([true, true, true])

  // save: the document references assets/<name> for the raster pictures and embeds the SVG
  await frame.locator('.doc-editor p', { hasText: 'Tail paragraph' }).click()
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v2')
  const text = new TextDecoder().decode(new Uint8Array((await hostState(page)).lastSaved!.bytes))
  expect(text).toContain(`](assets/${png!.name})`)
  expect(text).toContain(`](assets/${webp.name})`)
  expect(text).toContain('](data:image/svg+xml;base64,')
  expect(text).not.toMatch(/data:image\/(png|webp)/)
})

test('markdown: without the images grant a paste embeds the picture (nothing is uploaded)', async ({
  page,
}) => {
  await serveFixture(page, DOC_PATH, encode('# Pictures\n\nTail paragraph.\n'), 'text/markdown')
  await serveAssets(page)
  const frame = await openModule(page, 'markdown', { open: DOC_PATH, lang: 'en' })
  await shown(frame)
  await paste(frame, 'shot.png', 'image/png', [...PNG])
  await expect(frame.locator('.doc-editor img:not(.ProseMirror-separator)')).toHaveCount(1)
  expect(await uploads(page)).toHaveLength(0)
})

test('markdown: Export Word downloads a .docx from the ribbon', async ({ page }) => {
  await serveFixture(page, DOC_PATH, encode(DOC), 'text/markdown')
  await serveAssets(page)
  const frame = await openModule(page, 'markdown', {
    open: DOC_PATH,
    lang: 'en',
    assets: JSON.stringify(ASSETS),
  })
  await shown(frame)
  const button = frame.getByRole('button', { name: 'Export Word' })
  await expect(button).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  expect(download.suggestedFilename()).toBe('Pictures.docx')
  const file = readFileSync((await download.path())!)
  // a .docx is a zip with the document part
  expect(file.subarray(0, 2).toString()).toBe('PK')
  expect(file.includes(Buffer.from('word/document.xml'))).toBe(true)
})

test('markdown: view only still exports', async ({ page }) => {
  await serveFixture(page, DOC_PATH, encode(DOC), 'text/markdown')
  await serveAssets(page)
  const frame = await openModule(page, 'markdown', { open: DOC_PATH, lang: 'en', readonly: '1' })
  await shown(frame)
  const button = frame.getByRole('button', { name: 'Export Word' })
  await expect(button).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  expect(download.suggestedFilename()).toBe('Pictures.docx')
})

async function resolves(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __host: { resolves(): Array<{ fileId: string; paths: string[] }> }
      }
    ).__host.resolves(),
  )
}

/** the dirty events the frame has sent (a picture refresh must not make the document dirty) */
async function dirtyEvents(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __host: { events: Array<{ type: string }> } }).__host.events.filter(
        (e) => e.type === 'dirty',
      ).length,
  )
}

const FRESH_DOC = '# Pictures\n\n![ok](assets/a.png)\n\nTail paragraph.\n'

test('markdown: a URL the host refuses by the time the picture loads is re-resolved once and the picture reloads (A1b)', async ({
  page,
}) => {
  await serveFixture(page, DOC_PATH, encode(FRESH_DOC), 'text/markdown')
  await serveAssets(page)
  // the open answer's URL: served to the open-time probe (HEAD), refused afterwards, as a signature
  // that expires between the open and the moment the picture is drawn does
  let probed = false
  await page.route(/\/e2e-assets\/a\.png\?exp=1/, (route) => {
    if (route.request().method() === 'HEAD' && !probed) {
      probed = true
      return route.fulfill({ status: 200 })
    }
    return route.fulfill({ status: 403, body: 'expired' })
  })
  const frame = await openModule(page, 'markdown', {
    open: DOC_PATH,
    lang: 'en',
    resolve: '1',
    assets: JSON.stringify({ 'assets/a.png': '/e2e-assets/a.png?exp=1' }),
  })
  await shown(frame)
  await expect
    .poll(async () => (await resolves(page)).map((r) => r.paths))
    .toEqual([['assets/a.png']])
  await expect(frame.locator('.doc-editor img[alt="ok"]')).toHaveAttribute('src', /a\.png\?r=1$/)
  await expect.poll(() => loaded(frame, 'ok')).toBe(true)
  // asked exactly once, and the document is exactly what it was
  expect(await resolves(page)).toHaveLength(1)
  expect(await dirtyEvents(page)).toBe(0)
  await frame.locator('.doc-editor p', { hasText: 'Tail paragraph' }).click()
  await page.keyboard.press('Control+s')
  const saved = (await hostState(page)).lastSaved
  if (saved) expect(new TextDecoder().decode(new Uint8Array(saved.bytes))).toBe(FRESH_DOC)
  await page.screenshot({ path: screenshotPath('markdown', 'pictures-refreshed-light-en') })
})

test('markdown: a picture typed after the open gets its URL from the host (A1b); an old host leaves a placeholder', async ({
  page,
}) => {
  await serveFixture(page, DOC_PATH, encode(FRESH_DOC), 'text/markdown')
  await serveAssets(page)
  await page.route(/\/e2e-assets\/newpic\.png/, (route) =>
    route.fulfill({
      status: 200,
      body: PNG,
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
    }),
  )
  const frame = await openModule(page, 'markdown', {
    open: DOC_PATH,
    lang: 'en',
    resolve: '1',
    assets: JSON.stringify({ 'assets/a.png': '/e2e-assets/a.png' }),
  })
  await shown(frame)
  await frame.locator('.doc-editor p', { hasText: 'Tail paragraph' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' ![typed](./newpic.png) ')
  await expect
    .poll(async () => (await resolves(page)).flatMap((r) => r.paths))
    .toEqual(['./newpic.png'])
  await expect(frame.locator('.doc-editor img[alt="typed"]')).toHaveAttribute(
    'src',
    /newpic\.png\?r=1$/,
  )
  await expect.poll(() => loaded(frame, 'typed')).toBe(true)
  // the authored spelling is what the document keeps
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await hostState(page)).lastSaved?.versionId).toBe('v2')
  const text = new TextDecoder().decode(new Uint8Array((await hostState(page)).lastSaved!.bytes))
  expect(text).toContain('![typed](./newpic.png)')
  expect(text).not.toContain('sig=')

  // an old host (no api.assets.resolve): the typed picture stays a placeholder, nothing breaks
  const old = await page.context().newPage()
  await serveFixture(old, DOC_PATH, encode(FRESH_DOC), 'text/markdown')
  await serveAssets(old)
  const oldFrame = await openModule(old, 'markdown', { open: DOC_PATH, lang: 'en' })
  await shown(oldFrame)
  await oldFrame.locator('.doc-editor p', { hasText: 'Tail paragraph' }).click()
  await old.keyboard.press('End')
  await old.keyboard.type(' ![typed](./newpic.png) ')
  await old.waitForTimeout(1500)
  await expect(oldFrame.locator('.doc-editor img[alt="typed"]')).toHaveAttribute(
    'src',
    /^data:image\/svg\+xml/,
  )
  await old.close()
})

async function uploads(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __host: {
          uploads(): Array<{ name: string; mimeType: string; bytes: number[]; fileId: string }>
        }
      }
    ).__host.uploads(),
  )
}
