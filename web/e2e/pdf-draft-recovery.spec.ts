// Web draft recovery of the PDF frame (UNI-1232 A6), production build of the PDF module in the protocol
// test host (`?recovery=1`: the host sends `init.recovery` with a non-extractable AES-GCM key it persists
// in IndexedDB "keys", as the real host does; draft-recovery.spec.ts covers Docs, Markdown and Sheets).
// The point of this spec is the OPEN editor box: a comment typed into the margin card and not yet
// confirmed with OK is part of the draft copy, so
//   (a floating text-edit box is covered the same way)
//   type (no OK) -> the frame reports the document as unsaved -> 30 s -> an encrypted record (nothing saved)
//   -> reload the frame -> Restore -> the comment is back, the document is dirty -> save writes it
//   -> the record is gone;
//   Discard -> the server version, no comment, record gone.
// Build: npm run build:web -- --module pdf
// Run: npx playwright test -c web/e2e pdf-draft-recovery
import { test, expect, type Frame, type Page } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib'

const repoRoot = resolve(__dirname, '../..')
const PROMPT = '[data-office-web="draft-recovery"]'
const TICK_MS = 31_000

const built = (): boolean => {
  const root = resolve(repoRoot, 'dist-web/pdf')
  return (
    existsSync(root) && readdirSync(root).some((v) => existsSync(resolve(root, v, 'manifest.json')))
  )
}

interface Problems {
  console: string[]
  page: string[]
}

async function watch(page: Page): Promise<Problems> {
  const p: Problems = { console: [], page: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') p.console.push(`${m.text()} @ ${m.location().url}`)
  })
  page.on('pageerror', (e) => p.page.push(`${e.message}\n${e.stack ?? ''}`))
  return p
}

type HostEvent = { type: string; payload: Record<string, unknown> }

const hostEvents = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __host: { events: HostEvent[] } }).__host.events,
  ) as Promise<HostEvent[]>

const lastDirty = async (page: Page) =>
  (await hostEvents(page)).filter((e) => e.type === 'dirty').at(-1)?.payload.dirty

const lastSaved = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __host: { lastSaved(): { bytes: number[]; versionId: string } | null }
      }
    ).__host.lastSaved(),
  )

/** the draft records of this origin: key + whether the ciphertext still shows `plain` */
function drafts(frame: Frame, plain: string) {
  return frame.evaluate(
    (plain) =>
      new Promise<Array<{ key: string; module: string; leaks: boolean }>>((resolve, reject) => {
        const open = indexedDB.open('uniwork-office-frame-drafts')
        open.onerror = () => reject(open.error)
        open.onupgradeneeded = () => open.result.createObjectStore('drafts')
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('drafts', 'readonly')
          const store = tx.objectStore('drafts')
          const keys = store.getAllKeys()
          const values = store.getAll()
          tx.oncomplete = () => {
            db.close()
            const needle = new TextEncoder().encode(plain)
            resolve(
              keys.result.map((k, i) => {
                const v = values.result[i] as { module: string; ciphertext: ArrayBuffer }
                const hay = new Uint8Array(v.ciphertext)
                let leaks = false
                outer: for (let a = 0; a + needle.length <= hay.length; a += 1) {
                  for (let b = 0; b < needle.length; b += 1)
                    if (hay[a + b] !== needle[b]) continue outer
                  leaks = true
                  break
                }
                return { key: String(k), module: v.module, leaks }
              }),
            )
          }
        }
      }),
    plain,
  )
}

const readyCount = async (page: Page) =>
  (await hostEvents(page)).filter((e) => e.type === 'ready').length

/** reload only the frame (crash / closed tab stand-in): the host re-runs init with the same key */
async function reloadFrame(page: Page): Promise<Frame> {
  const before = await readyCount(page)
  await page.evaluate(() => {
    ;(document.getElementById('frame') as HTMLIFrameElement).contentWindow!.location.reload()
  })
  await expect.poll(() => readyCount(page), { timeout: 30_000 }).toBeGreaterThan(before)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  return (await (await page.waitForSelector('#frame')).contentFrame())!
}

async function openHost(page: Page, lang = 'en'): Promise<Frame> {
  await page.goto(
    `/test-host/?${new URLSearchParams({
      recovery: '1',
      module: 'pdf',
      open: '/fixtures/sample.pdf',
      lang,
    })}`,
  )
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
  await shown(frame)
  return frame
}

async function shown(frame: Frame): Promise<void> {
  await frame.waitForSelector('.pdf-page canvas', { timeout: 30_000 })
  await frame.waitForFunction(() => {
    const c = document.querySelector('.pdf-page canvas') as HTMLCanvasElement | null
    return !!c && c.width > 0
  })
}

/** the ribbon's zoom label ("103%"); several ribbon layouts carry one, the first is enough */
const zoomLabel = async (frame: Frame): Promise<string> =>
  (await frame.locator('.tb-zoom').first().textContent())?.trim() ?? ''

/** the writer's 30 s tick (the frame's interval timers run on the page clock) */
async function tick(page: Page): Promise<void> {
  await page.clock.fastForward(TICK_MS)
  await page.waitForTimeout(2_000)
}

const LABELS = {
  en: { tab: 'Annotate', note: 'Note' },
  vi: { tab: 'Chú thích', note: 'Ghi chú' },
} as const

/** Annotate > Note, click the page, type into the margin card and leave it OPEN (no OK) */
async function typeIntoOpenNoteBox(
  page: Page,
  frame: Frame,
  text: string,
  lang: keyof typeof LABELS = 'en',
): Promise<void> {
  await frame.locator('.ribbon-tab', { hasText: LABELS[lang].tab }).first().click()
  await frame.locator('.ribbon-body button', { hasText: LABELS[lang].note }).first().click()
  const off = (await page.locator('#frame').boundingBox())!
  const box = (await frame.locator('.pdf-page').first().boundingBox())!
  await page.mouse.click(off.x + box.x + box.width * 0.6, off.y + box.y + 300)
  await frame.locator('.pdf-note-draft-box textarea').fill(text)
}

/** the saved bytes carry a comment whose /Contents is `marker` (any page) */
async function savedHasMarker(bytes: number[], marker: string): Promise<boolean> {
  const doc = await PDFDocument.load(Uint8Array.from(bytes))
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    for (let i = 0; i < annots.size(); i += 1) {
      const contents = annots
        .lookup(i, PDFDict)
        .lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)
      if (contents?.decodeText().includes(marker)) return true
    }
  }
  return false
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  // the frame's interval timers (the 30 s draft writer) on a test clock
  await page.clock.install()
})

test.describe('pdf draft recovery: an open comment box', () => {
  test.skip(!built(), 'no dist-web/pdf build: npm run build:web -- --module pdf')

  test('type (no OK) -> unsaved -> 30 s -> reload -> Restore brings it back -> save writes it', async ({
    page,
  }) => {
    const problems = await watch(page)
    const marker = 'PdfOpenBoxMark'
    let frame = await openHost(page)
    const openZoom = await zoomLabel(frame)
    await typeIntoOpenNoteBox(page, frame, marker)
    // the box is not confirmed, yet the document counts as unsaved
    await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
    await tick(page)
    await expect.poll(async () => (await drafts(frame, marker)).length, { timeout: 15_000 }).toBe(1)
    const [record] = await drafts(frame, marker)
    expect(record.module).toBe('pdf')
    expect(record.key).toMatch(/^test-user:f1:"f1-v1":[0-9a-f]{16}$/)
    expect(record.leaks).toBe(false)
    // a draft is never a save
    expect(await lastSaved(page)).toBeNull()

    frame = await reloadFrame(page)
    const prompt = frame.locator(PROMPT)
    await expect(prompt).toBeVisible({ timeout: 30_000 })
    await expect(prompt.locator('[data-choice]')).toHaveText(['Restore', 'Discard'])
    await prompt.locator('[data-choice="restore"]').click()
    await expect(prompt).toBeHidden()
    await shown(frame)
    // the comment is back as a real comment (not an empty box) and the document is unsaved
    await expect(frame.locator('.pdf-note-comment-body', { hasText: marker })).toBeVisible({
      timeout: 30_000,
    })
    // fit-width keeps the comments margin inside the slot, so a copy that has a comment fits
    // smaller than the bare document (the 50 % of the visual report); the restored view is exactly
    // what opening that copy normally gives, checked below after the save
    await expect(frame.locator('.pdf-note-margin').first()).toBeAttached()
    const restoredZoom = await zoomLabel(frame)
    await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
    expect(await lastSaved(page)).toBeNull()

    // save through the quick-access Save button
    await frame.locator('.qa-btn').first().click()
    await expect.poll(() => lastSaved(page), { timeout: 60_000 }).not.toBeNull()
    expect(await savedHasMarker((await lastSaved(page))!.bytes, marker)).toBe(true)
    await expect.poll(async () => (await drafts(frame, marker)).length, { timeout: 15_000 }).toBe(0)
    // a normal open of the saved copy lands on the zoom the restored view had
    frame = await reloadFrame(page)
    await shown(frame)
    await expect(frame.locator('.pdf-note-comment-body', { hasText: marker })).toBeVisible({
      timeout: 30_000,
    })
    await expect.poll(() => zoomLabel(frame), { timeout: 15_000 }).toBe(restoredZoom)
    expect(restoredZoom).not.toBe('')
    expect(openZoom).not.toBe('')
    expect(problems).toEqual({ console: [], page: [] })
  })

  test('an open text-edit box (Edit text, typed, not committed) is in the draft too', async ({
    page,
  }) => {
    const problems = await watch(page)
    const marker = 'PdfTextBoxMark'
    let frame = await openHost(page)
    await frame.locator('.rb-big', { hasText: 'Edit text' }).first().click()
    await frame.locator('.textLayer span', { hasText: 'UniWork PDF web fixture' }).first().click()
    await frame.locator('textarea.pdf-textedit-input').fill(marker)
    // the floating editor is still open (nothing committed), yet the document counts as unsaved
    await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
    await tick(page)
    await expect.poll(async () => (await drafts(frame, marker)).length, { timeout: 15_000 }).toBe(1)
    expect(await lastSaved(page)).toBeNull()

    frame = await reloadFrame(page)
    const prompt = frame.locator(PROMPT)
    await expect(prompt).toBeVisible({ timeout: 30_000 })
    await prompt.locator('[data-choice="restore"]').click()
    await expect(prompt).toBeHidden()
    await shown(frame)
    // the restored copy is open and still unsaved (the fixture's font cannot redraw a replacement, so
    // the page text is not asserted: the draft logic is what this test covers)
    await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
    expect(await lastSaved(page)).toBeNull()
    expect(problems).toEqual({ console: [], page: [] })
  })

  test('Discard opens the server version without the comment and deletes the draft', async ({
    page,
  }) => {
    const problems = await watch(page)
    const marker = 'PdfDiscardMark'
    let frame = await openHost(page, 'vi')
    const openZoom = await zoomLabel(frame)
    await typeIntoOpenNoteBox(page, frame, marker, 'vi')
    await expect.poll(() => lastDirty(page), { timeout: 15_000 }).toBe(true)
    await tick(page)
    await expect.poll(async () => (await drafts(frame, marker)).length, { timeout: 15_000 }).toBe(1)

    frame = await reloadFrame(page)
    const prompt = frame.locator(PROMPT)
    await expect(prompt).toBeVisible({ timeout: 30_000 })
    await expect(prompt.locator('[data-choice]')).toHaveText(['Khôi phục', 'Bỏ'])
    await prompt.locator('[data-choice="discard"]').click()
    await expect(prompt).toBeHidden()
    await shown(frame)
    await page.waitForTimeout(1_000)
    await expect(frame.locator('.pdf-note-comment-body', { hasText: marker })).toHaveCount(0)
    // Discard is the plain server version: the zoom of a normal open
    await expect.poll(() => zoomLabel(frame), { timeout: 15_000 }).toBe(openZoom)
    expect(await drafts(frame, marker)).toEqual([])
    expect(problems).toEqual({ console: [], page: [] })
  })

  test('an empty box is not a change: no unsaved state, no draft record', async ({ page }) => {
    const frame = await openHost(page)
    await typeIntoOpenNoteBox(page, frame, '   ')
    await tick(page)
    expect(await lastDirty(page)).not.toBe(true)
    expect(await drafts(frame, 'x')).toEqual([])
  })
})
