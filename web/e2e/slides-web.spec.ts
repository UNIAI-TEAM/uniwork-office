// GO-B5 (UNI-1015): the Slides web module on its production build, served under its exact CSP
// header (dist-web/slides/<v>/headers.json) inside the protocol test host. One session walks the
// acceptance flow: open the fixture deck -> edit the title on the canvas -> undo / redo -> save
// (the bytes reach the host) -> save conflict (Overwrite) -> export PNG zip + PDF -> present
// fullscreen -> print -> media playback from a blob: URL; with 0 console errors and 0 CSP
// violations. A second test takes the screenshots (light + dark, vi + en) into
// docs/web-modules/screenshots/slides/.
// Run: npm run build:web -- --module slides && npx playwright test -c web/e2e slides-web
import { test, expect, type Frame, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'

const repoRoot = resolve(__dirname, '../..')
const SHOTS = resolve(repoRoot, 'docs/web-modules/screenshots/slides')
const HOST = '/test-host/?module=slides&open=/fixtures/sample.pptx'

const built = (): boolean => {
  const root = resolve(repoRoot, 'dist-web/slides')
  return (
    existsSync(root) && readdirSync(root).some((v) => existsSync(resolve(root, v, 'manifest.json')))
  )
}

interface Problems {
  console: string[]
  page: string[]
  http: string[]
}

async function watch(page: Page): Promise<Problems> {
  const p: Problems = { console: [], page: [], http: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') p.console.push(`${m.text()} @ ${m.location().url}`)
  })
  page.on('pageerror', (e) => p.page.push(`${e.message}\n${e.stack ?? ''}`))
  page.on('response', (r) => {
    if (r.status() >= 400) p.http.push(`${r.status()} ${r.url()}`)
  })
  await page.addInitScript(() => {
    const list: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations = list
    document.addEventListener('securitypolicyviolation', (e) =>
      list.push(`${e.violatedDirective} blocked ${e.blockedURI} @ ${e.sourceFile}:${e.lineNumber}`),
    )
  })
  return p
}

async function cspViolations(page: Page, frame: Frame): Promise<string[]> {
  const read = (f: Page | Frame) =>
    f.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [])
  return [...(await read(page)), ...(await read(frame))]
}

async function openDeck(page: Page, query = '&lang=en'): Promise<Frame> {
  await page.goto(HOST + query)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
  await expect(frame.locator('.thumb')).toHaveCount(5, { timeout: 30_000 })
  return frame
}

/** text of the first text node of slide `i`, from the engine */
function titleText(frame: Frame, i = 0): Promise<string> {
  return frame.evaluate(async (idx) => {
    type Node = { text?: { lines: Array<{ runs: Array<{ text: string }> }> } }
    const slides = (await window.slidesApi.getRenderSlides()) as unknown as Array<{ nodes: Node[] }>
    const node = slides[idx]!.nodes.find((n) => n.text)!
    return node.text!.lines.map((l) => l.runs.map((r) => r.text).join('')).join('\n')
  }, i)
}

/** page coordinates of the centre of slide 0's title on the editing stage */
async function titlePoint(page: Page, frame: Frame): Promise<{ x: number; y: number }> {
  const p = await frame.evaluate(async () => {
    type Node = { text?: unknown; box: { x: number; y: number; w: number; h: number } }
    const slide = (
      (await window.slidesApi.getRenderSlides()) as unknown as Array<{
        widthPx: number
        nodes: Node[]
      }>
    )[0]!
    const node = slide.nodes.find((n) => n.text)!
    const box = document.querySelector('.stage-zoom-box')!.getBoundingClientRect()
    const k = box.width / slide.widthPx
    return {
      x: box.left + (node.box.x + node.box.w / 2) * k,
      y: box.top + (node.box.y + node.box.h / 2) * k,
    }
  })
  const f = (await page.locator('#frame').boundingBox())!
  return { x: f.x + p.x, y: f.y + p.y }
}

async function hostSaved(page: Page): Promise<{ versionId: string; bytes: number[] } | null> {
  return page.evaluate(() =>
    (
      window as unknown as {
        __host: { lastSaved(): { versionId: string; bytes: number[] } | null }
      }
    ).__host.lastSaved(),
  )
}

async function fileMenu(frame: Frame, item: RegExp): Promise<void> {
  await frame.getByText('File', { exact: true }).click()
  await frame.getByText(item).click()
}

/** a short valid WAV (PCM, 8 kHz, 0.25 s of a 440 Hz tone), base64 */
function wavBase64(): string {
  const rate = 8000
  const n = rate / 4
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVEfmt ', 8, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2)
  return buf.toString('base64')
}

test.describe('slides web module', () => {
  test.skip(!built(), 'no dist-web/slides build: npm run build:web -- --module slides')

  test('open -> edit -> undo -> save -> conflict -> export -> present -> print -> media', async ({
    page,
  }) => {
    const problems = await watch(page)
    const frame = await openDeck(page)

    const html = await page.request.get('/office-frame/slides/latest/index.html')
    const csp = html.headers()['content-security-policy']!
    expect(csp).toContain('media-src blob:')
    expect(csp).not.toContain('wasm-unsafe-eval')

    // edit the title on the canvas (the renderer's own text editor)
    const original = await titleText(frame)
    const p = await titlePoint(page, frame)
    await page.mouse.dblclick(p.x, p.y)
    await expect(frame.locator('[contenteditable=true]')).toBeVisible()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('Edited on the web')
    await page.keyboard.press('Escape')
    await expect.poll(() => titleText(frame)).toBe('Edited on the web')

    // undo / redo from the keyboard
    await page.mouse.click(p.x, p.y + 220)
    await page.keyboard.press('Control+Z')
    await expect.poll(() => titleText(frame)).toBe(original)
    await page.keyboard.press('Control+Y')
    await expect.poll(() => titleText(frame)).toBe('Edited on the web')

    // save: the bytes reach the host as the next version
    await page.keyboard.press('Control+S')
    await expect.poll(async () => (await hostSaved(page))?.versionId).toBe('v2')
    const zip = await JSZip.loadAsync(Uint8Array.from((await hostSaved(page))!.bytes))
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain('Edited on the web')
    await expect.poll(() => frame.evaluate(() => window.slidesApi.isDirty())).toBe(false)

    // someone else saves a newer version: the next save asks, Overwrite wins
    await page.evaluate(() =>
      (window as unknown as { __host: { bumpRemote(id: string): void } }).__host.bumpRemote('f1'),
    )
    await frame.evaluate(() =>
      window.slidesApi.setNotes({ slideIndex: 0, text: 'conflicting edit' }),
    )
    await page.keyboard.press('Control+S')
    const conflict = frame.locator('[data-slides-web="conflict"]')
    await expect(conflict).toBeVisible()
    await expect(conflict).toContainText('changed elsewhere')
    await conflict.getByRole('button', { name: 'Overwrite' }).click()
    await expect.poll(async () => (await hostSaved(page))?.versionId).toBe('v4')
    await expect(conflict).toHaveCount(0)

    // export: a zip of PNGs and an image-per-page PDF, both browser downloads
    const [images] = await Promise.all([
      page.waitForEvent('download'),
      fileMenu(frame, /^Export as Images/),
    ])
    expect(images.suggestedFilename()).toMatch(/\.zip$/)
    const imageZip = await JSZip.loadAsync(readFileSync((await images.path())!))
    expect(Object.keys(imageZip.files).filter((n) => n.endsWith('.png'))).toHaveLength(5)
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      fileMenu(frame, /^Export as PDF/),
    ])
    expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/)
    const pdf = readFileSync((await pdfDownload.path())!).toString('latin1')
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf).toContain('/Count 5')

    // present: the show takes the frame fullscreen; Escape leaves it
    await frame.getByRole('button', { name: 'Slide Show', exact: true }).click()
    await frame
      .getByRole('button', { name: /From Beginning/ })
      .first()
      .click()
    await expect.poll(() => frame.evaluate(() => !!document.fullscreenElement)).toBe(true)
    await page.waitForTimeout(500)
    await page.screenshot({ path: resolve(repoRoot, 'web/e2e/.results/slides-web-show.png') })
    await page.keyboard.press('Escape')
    await expect.poll(() => frame.evaluate(() => !!document.fullscreenElement)).toBe(false)

    // print: the renderer's print dialog -> the desktop print document in a srcdoc frame
    await frame.evaluate(() => {
      const w = window as unknown as { __printed: unknown[] }
      w.__printed = []
      const api = window.slidesApi
      const print = api.printSlides
      api.printSlides = async (op) => {
        const r = await print(op)
        w.__printed.push({ pages: op.pngsBase64.length, ok: r.ok })
        return r
      }
    })
    await fileMenu(frame, /^Print… /)
    await frame.locator('.print-dialog .modal-actions button.primary').click()
    await expect
      .poll(() => frame.evaluate(() => (window as unknown as { __printed: unknown[] }).__printed))
      .toEqual([{ pages: 5, ok: true }])

    // media: an embedded clip plays from a blob: URL under media-src blob:
    const media = await frame.evaluate(async (b64) => {
      const added = await window.slidesApi.addMediaBytes({
        slideIndex: 1,
        kind: 'audio',
        base64: b64,
        ext: 'wav',
        fitWidthPx: 1280,
      })
      const data = await window.slidesApi.getMediaData(1, added!.sourceId)
      const audio = new Audio()
      audio.muted = true
      const loaded = new Promise<string>((resolve) => {
        audio.addEventListener('loadedmetadata', () => resolve('loaded'), { once: true })
        audio.addEventListener('error', () => resolve('error'), { once: true })
      })
      audio.src = data!.dataUrl
      await audio.play().catch(() => {})
      return { url: data!.dataUrl, state: await loaded }
    }, wavBase64())
    expect(media.url.startsWith('blob:')).toBe(true)
    expect(media.state).toBe('loaded')

    await page.waitForTimeout(500)
    expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
      csp: [],
      console: [],
      page: [],
      http: [],
    })
  })

  test('web gating: no AI / AutoSave / Open / recents / font install / 3D UI, no save without a user action', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const problems = await watch(page)
    const frame = await openDeck(page)

    // hidden by capability (the test host grants save/saveAs/recents/print/exportPdf, not filePick)
    for (const sel of ['.autosave-toggle', '.ai-entry', '.ai-dock', '.ai-rail', '.stage-ai-bar'])
      await expect(frame.locator(sel), sel).toHaveCount(0)
    await frame.getByText('File', { exact: true }).click()
    await expect(frame.locator('.file-menu')).toBeVisible()
    await expect(frame.locator('.file-menu')).not.toContainText('Ctrl+O')
    await expect(frame.locator('.file-menu')).toContainText('Ctrl+S')
    await frame.getByText('File', { exact: true }).click()
    await frame.getByRole('button', { name: 'Insert', exact: true }).click()
    await expect(frame.getByText('3D Models', { exact: true })).toHaveCount(0)
    await frame.getByRole('button', { name: 'Home', exact: true }).click()
    await frame.locator('.rb-font-btn').first().click()
    await expect(frame.locator('.rb-font-install-local')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await frame.getByRole('button', { name: 'Review', exact: true }).click()
    await expect(frame.locator('.ai-feature-icon')).toHaveCount(0)

    // edits, then 65 s idle with a window blur in between: nothing is saved without the user
    const saves = () =>
      page.evaluate(
        () =>
          (
            window as unknown as { __host: { events: Array<{ type: string }> } }
          ).__host.events.filter((e) => e.type === 'saved').length,
      )
    const before = await saves()
    const p = await titlePoint(page, frame)
    await page.mouse.dblclick(p.x, p.y)
    await page.keyboard.press('Control+A')
    await page.keyboard.type('Idle edit')
    await page.keyboard.press('Escape')
    await frame.evaluate(() => window.slidesApi.setNotes({ slideIndex: 1, text: 'idle notes' }))
    await expect.poll(() => frame.evaluate(() => window.slidesApi.isDirty())).toBe(true)
    await frame.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForTimeout(65_000)
    await frame.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForTimeout(1_000)
    expect(await saves()).toBe(before)
    expect(await hostSaved(page)).toBeNull()
    expect(await frame.evaluate(() => window.slidesApi.isDirty())).toBe(true)

    expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
      csp: [],
      console: [],
      page: [],
      http: [],
    })
  })

  // visual test S-01: text typed in the on-canvas editor is dirty before the box commits, so the
  // host's header chip and its leave check (doc.closeCheck) see it
  test('typing on the canvas marks the document dirty before the box is committed', async ({
    page,
  }) => {
    const problems = await watch(page)
    const frame = await openDeck(page)
    const dirtyNow = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __host: { events: Array<{ type: string; payload: { dirty: boolean } }> }
            }
          ).__host.events
            .filter((e) => e.type === 'dirty')
            .at(-1)?.payload.dirty ?? false,
      )
    const closeCheck = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            __host: { request(t: string, p: unknown): Promise<{ dirty: boolean }> }
          }
        ).__host.request('doc.closeCheck', {}),
      )
    expect(await dirtyNow()).toBe(false)
    expect((await closeCheck()).dirty).toBe(false)

    const p = await titlePoint(page, frame)
    await page.mouse.dblclick(p.x, p.y)
    await expect(frame.locator('[contenteditable=true]')).toBeVisible()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('Typed, not committed')
    // still in the editor (nothing committed to the deck yet) and already dirty for the host
    await expect(frame.locator('[contenteditable=true]')).toBeVisible()
    await expect.poll(dirtyNow).toBe(true)
    expect((await closeCheck()).dirty).toBe(true)

    // Escape commits the text: still dirty, now through the deck
    await page.keyboard.press('Escape')
    await expect.poll(() => titleText(frame)).toBe('Typed, not committed')
    await page.waitForTimeout(800)
    expect(await dirtyNow()).toBe(true)
    expect((await closeCheck()).dirty).toBe(true)

    // the notes pane: typing counts at once, on a fresh deck as well
    const notes = frame.locator('.notes-pane textarea')
    await notes.click()
    await page.keyboard.type(' plus a note')
    expect((await closeCheck()).dirty).toBe(true)

    expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
      csp: [],
      console: [],
      page: [],
      http: [],
    })
  })

  // visual test S-02: a deck whose speaker note sits in a plain "Notes Placeholder" shape (no
  // <p:ph>) shows the note in the editor's notes pane and in the Presenter View
  test('speaker notes load in the notes pane and the presenter view', async ({ page }) => {
    const problems = await watch(page)
    await page.goto('/test-host/?module=slides&open=/fixtures/notes-plain-shape.pptx&lang=en')
    await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
    const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
    await expect(frame.locator('.thumb').first()).toBeVisible({ timeout: 30_000 })
    const note = 'Ghi chú trình bày cho buổi họp tuần.'
    await expect(frame.locator('.notes-pane textarea')).toHaveValue(note)

    await frame.getByRole('button', { name: 'Slide Show', exact: true }).click()
    await frame.getByRole('button', { name: 'Presenter View' }).first().click()
    await expect(frame.locator('.presenter')).toBeVisible()
    await expect(frame.locator('.presenter .pv-notes')).toHaveText(note)
    await page.keyboard.press('Escape')

    expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
      csp: [],
      console: [],
      page: [],
      http: [],
    })
  })

  // visual r2 N-02: a frame without the save grant (token can_edit false) is read-only: Reading
  // view, no text editor on a double click or typing, never dirty, nothing to save
  test('view-only frame refuses typing: no editor, never dirty', async ({ page }) => {
    const problems = await watch(page)
    await page.goto(HOST + '&readonly=1&lang=en')
    await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
    const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
    await expect(frame.locator('.reading-view')).toBeVisible({ timeout: 30_000 })
    await expect(frame.locator('.stage-zoom-box')).toHaveCount(0)
    const box = (await frame.locator('.reading-slide').boundingBox())!
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.type('must not land')
    await page.keyboard.press('Control+S')
    await page.waitForTimeout(600)
    await expect(frame.locator('.slide-text-editor, [contenteditable=true]')).toHaveCount(0)
    expect(await frame.evaluate(() => window.slidesApi.isDirty())).toBe(false)
    expect(await titleText(frame)).not.toContain('must not land')
    expect(await hostSaved(page)).toBeNull()
    expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
      csp: [],
      console: [],
      page: [],
      http: [],
    })
  })

  // UNI-1232 (item 5): print-quality PDF is not a web feature: the File menu entry says so (en + vi)
  // instead of failing; the test host grants no desktopOpen, so the message stands alone
  for (const [lang, message] of [
    ['en', 'Open in the UniWork Office app to use this feature'],
    ['vi', 'Mở trong ứng dụng UniWork Office để dùng tính năng này'],
  ] as const) {
    test(`print-quality PDF: the use-the-app message, no Open button without the capability (${lang})`, async ({
      page,
    }) => {
      const frame = await openDeck(page, `&lang=${lang}`)
      await frame.getByText(lang === 'en' ? 'File' : 'Tệp', { exact: true }).click()
      await frame.locator('[data-use-app="print-pdf"]').click()
      const dialog = frame.locator('[data-use-app="dialog"]')
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(message)
      await expect(dialog.locator('button.primary')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    })
  }

  // visual r2 N-03: at 390 px the slide takes the width (was 14 %), the thumbnail column starts
  // hidden and the ribbon tabs scroll sideways with an edge fade as the cue
  test('390 px: the slide fits the width, tabs scroll with a cue', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(HOST + '&lang=en')
    await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
    const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
    await expect(frame.locator('.stage-zoom-box')).toBeVisible({ timeout: 30_000 })
    await expect(frame.locator('.slide-list')).toHaveCount(0)
    const stage = (await frame.locator('.stage-zoom-box').boundingBox())!
    expect(stage.width).toBeGreaterThan(390 * 0.8)
    const scroll = frame.locator('.ribbon-tab-scroll')
    await expect(scroll).toHaveAttribute('data-fade-end', /.*/)
    const m = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(m.sw).toBeGreaterThan(m.cw)
    // the fade is joined by a chevron on the hidden edge, and the tabs are touch-sized (N3-06)
    await expect(frame.locator('.ribbon-tab-cue[data-edge="end"]')).toBeVisible()
    const tab = (await frame.locator('.ribbon-tab-scroll .ribbon-tab').first().boundingBox())!
    expect(tab.height).toBeGreaterThanOrEqual(44)
    // the page itself never scrolls sideways
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
  })

  // visual r2 S-07: Presenter View chrome is readable (>= 14 px controls, 44 px round tools)
  test('presenter view chrome: readable sizes', async ({ page }) => {
    const frame = await openDeck(page)
    await frame.getByRole('button', { name: 'Slide Show', exact: true }).click()
    await frame.getByRole('button', { name: 'Presenter View' }).first().click()
    await expect(frame.locator('.presenter')).toBeVisible()
    const sizes = await frame.evaluate(() => {
      const px = (s: string, prop: 'fontSize' | 'width' | 'height') =>
        parseFloat(getComputedStyle(document.querySelector(s)!)[prop])
      return {
        topBtn: px('.pv-top-btn', 'fontSize'),
        hint: px('.pv-top-hint', 'fontSize'),
        label: px('.pv-nav-label', 'fontSize'),
        section: px('.pv-section-label', 'fontSize'),
        toolW: px('.pv-tool-btn', 'width'),
        toolH: px('.pv-tool-btn', 'height'),
        roundW: px('.pv-round', 'width'),
      }
    })
    expect(sizes.topBtn).toBeGreaterThanOrEqual(14)
    expect(sizes.hint).toBeGreaterThanOrEqual(14)
    expect(sizes.label).toBeGreaterThanOrEqual(14)
    expect(sizes.section).toBeGreaterThanOrEqual(14)
    expect(Math.min(sizes.toolW, sizes.toolH, sizes.roundW)).toBeGreaterThanOrEqual(44)
    await page.keyboard.press('Escape')
  })

  test('screenshots: light + dark, vi + en', async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true })
    const problems = await watch(page)
    for (const lang of ['en', 'vi']) {
      for (const theme of ['light', 'dark']) {
        const frame = await openDeck(page, `&lang=${lang}&theme=${theme}`)
        await expect
          .poll(() => frame.evaluate(() => document.documentElement.lang))
          .toMatch(new RegExp(`^${lang}`))
        await page.waitForTimeout(1500)
        await page.screenshot({ path: resolve(SHOTS, `editor-${lang}-${theme}.png`) })
        if (lang === 'en' && theme === 'light') {
          // the bridge's own dialog (conflict) in the renderer's modal style
          await page.evaluate(() =>
            (window as unknown as { __host: { bumpRemote(id: string): void } }).__host.bumpRemote(
              'f1',
            ),
          )
          await frame.evaluate(() => window.slidesApi.setNotes({ slideIndex: 0, text: 'x' }))
          void frame.evaluate(() => window.slidesApi.save())
          await expect(frame.locator('[data-slides-web="conflict"]')).toBeVisible()
          await page.screenshot({ path: resolve(SHOTS, 'conflict-en-light.png') })
          await frame
            .locator('[data-slides-web="conflict"]')
            .getByRole('button', { name: 'Cancel' })
            .click()
        }
        if (lang === 'vi' && theme === 'dark') {
          await page.evaluate(() =>
            (window as unknown as { __host: { bumpRemote(id: string): void } }).__host.bumpRemote(
              'f1',
            ),
          )
          await frame.evaluate(() => window.slidesApi.setNotes({ slideIndex: 0, text: 'x' }))
          void frame.evaluate(() => window.slidesApi.save())
          await expect(frame.locator('[data-slides-web="conflict"]')).toBeVisible()
          await page.screenshot({ path: resolve(SHOTS, 'conflict-vi-dark.png') })
          await frame.locator('[data-slides-web="conflict"] [data-choice="cancel"]').click()
        }
      }
    }
    expect(problems).toEqual({ console: [], page: [], http: [] })
  })
})
