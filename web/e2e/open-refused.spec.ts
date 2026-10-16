// SIZE-F1 (UNI-1861): Docs frame open_refused contract and no-blank-Untitled guard.
// Opens a small (< 1 MB compressed) generated .docx fixture whose uncompressed text exceeds
// HUGE_DOC_REFUSE_WEIGHT (230 000 weighted blocks / 25 300 000 characters), asserts that:
// 1. `open_refused` reaches `window.__host.events` once with reason `too_large_to_open` and measure.
// 2. The frame stays alive: no fatal `error` event.
// 3. The frame renders the read-only refusal notice (`[data-testid="docs-open-refused"]`) and never
//    falls back to an editable blank `Untitled.docx`.
// 4. Neither Ctrl+S nor a host `save` request triggers `api.save`.
// Run: npx playwright test -c web/e2e open-refused
import { test, expect, type Page } from '@playwright/test'
import JSZip from 'jszip'

type HostEvent = { type: string; payload: Record<string, unknown> }

async function buildDocx(paragraphs: number): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )
  const paraText = 'a'.repeat(10_500)
  const paraXml = `<w:p><w:r><w:t>${paraText}</w:t></w:r></w:p>`
  const body = Array.from({ length: paragraphs }, () => paraXml).join('')
  const docXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}</w:body></w:document>`
  zip.file('word/document.xml', docXml)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

const hostEvents = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __host: { events: HostEvent[] } }).__host.events,
  ) as Promise<HostEvent[]>

test('docs frame emits open_refused for an over-tier document, mounts no blank Untitled.docx, and sends no save request', async ({
  page,
}) => {
  const fixture = await buildDocx(2_500)
  expect(fixture.byteLength).toBeLessThan(1024 * 1024)

  const urlPath = '/fixtures/over-tier-refuse.docx'
  await page.context().route(`**${urlPath}`, (route) =>
    route.fulfill({
      status: 200,
      body: fixture,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'cache-control': 'no-store',
      },
    }),
  )

  await page.goto(`/test-host/?lang=en&theme=light&open=${encodeURIComponent(urlPath)}`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!

  await expect(frame.getByTestId('docs-open-refused')).toBeVisible({ timeout: 30_000 })
  await expect(frame.locator('.ProseMirror[contenteditable="true"]')).toHaveCount(0)

  const events = await hostEvents(page)
  const refused = events.filter((e) => e.type === 'open_refused')
  expect(refused).toEqual([
    {
      type: 'open_refused',
      payload: {
        reason: 'too_large_to_open',
        bytes: fixture.byteLength,
        measure: {
          kind: 'characters',
          value: 26_250_000,
          limit: 25_300_000,
        },
      },
    },
  ])

  const titles = events
    .filter((e) => e.type === 'title')
    .map((e) => (e.payload as { title?: string }).title)
  expect(titles).not.toContain('Untitled.docx')

  await page.keyboard.press('Control+s')
  await page.waitForTimeout(500)

  const hostSave = await page.evaluate(() =>
    (
      window as unknown as {
        __host: { request(type: string, payload: unknown): Promise<unknown> }
      }
    ).__host.request('save', { reason: 'user' }),
  )
  // still the refusal notice after the keystroke and the host save: no blank document appeared
  await expect(frame.getByTestId('docs-open-refused')).toBeVisible()
  await expect(frame.locator('.ProseMirror[contenteditable="true"]')).toHaveCount(0)

  expect(hostSave).toMatchObject({
    ok: false,
    error: { code: 'too_large' },
  })

  const saveStats = await page.evaluate(() => {
    const h = (
      window as unknown as {
        __host: { saveCalls(): number; lastSaved(): unknown }
      }
    ).__host
    return { saveCalls: h.saveCalls(), lastSaved: h.lastSaved() }
  })
  expect(saveStats).toEqual({ saveCalls: 0, lastSaved: null })
})

test('docs frame opens a Read Mode tier document without open_refused and keeps the editor mounted', async ({
  page,
}) => {
  // ~13.65 M characters: weighted 125 k, above the 115 k Read Mode tier and below the 230 k refusal
  const fixture = await buildDocx(1_300)
  expect(fixture.byteLength).toBeLessThan(1024 * 1024)

  const urlPath = '/fixtures/read-mode-tier.docx'
  await page.context().route(`**${urlPath}`, (route) =>
    route.fulfill({
      status: 200,
      body: fixture,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'cache-control': 'no-store',
      },
    }),
  )

  await page.goto(`/test-host/?lang=en&theme=light&open=${encodeURIComponent(urlPath)}`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!

  await expect(frame.locator('.ProseMirror')).toBeVisible({ timeout: 60_000 })
  await expect(frame.locator('.ProseMirror[contenteditable="true"]')).toHaveCount(0)
  await expect(frame.getByTestId('docs-open-refused')).toHaveCount(0)

  const events = await hostEvents(page)
  expect(events.filter((e) => e.type === 'open_refused')).toEqual([])
})
