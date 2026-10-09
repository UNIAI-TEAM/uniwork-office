// GO-B4 / UNI-1014: the PDF module on the web, production build (`npm run build:web -- --module pdf`)
// served under its own CSP header in the protocol test host (/test-host/?module=pdf).
//   1. edit round trip: highlight + note + ink -> fill form -> save (bytes reach the host, %PDF-,
//      /Annots, etag advances) -> stale-etag conflict dialog -> overwrite -> reopen shows the
//      annotations -> rotate + delete page -> import pages (file.pick) -> Save As -> print
//   2. view-only (readonly=1: no save grant): edit UI disabled, no save path, print works
//   3. fixtures render with zero CSP violations: text, scanned (JPEG + ICC), embedded fonts,
//      form, encrypted (password prompt)
//   4. screenshots of the main states, light + dark, vi + en -> docs/web-modules/screenshots/pdf/
// Every test fails on a console error, page error or securitypolicyviolation in any frame.
// Run: npx playwright test -c web/e2e pdf-web
import { test, expect, type Frame, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'

const repoRoot = resolve(__dirname, '../..')
const SHOTS = resolve(repoRoot, 'docs/web-modules/screenshots/pdf')

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
  await page.addInitScript(() => {
    const list: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations = list
    document.addEventListener('securitypolicyviolation', (e) =>
      list.push(`${e.violatedDirective} blocked ${e.blockedURI} @ ${e.sourceFile}:${e.lineNumber}`),
    )
  })
  return p
}

async function noProblems(page: Page, frame: Frame, p: Problems): Promise<void> {
  const csp = [
    ...(await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    )),
    ...(await frame.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    )),
  ]
  expect(csp, 'CSP violations').toEqual([])
  expect(p.page, 'page errors').toEqual([])
  expect(p.console, 'console errors').toEqual([])
}

interface OpenOptions {
  fixture?: string
  lang?: string
  theme?: 'light' | 'dark'
  readonly?: boolean
  pick?: boolean
}

async function openPdf(page: Page, o: OpenOptions = {}): Promise<Frame> {
  const q = new URLSearchParams({
    module: 'pdf',
    open: `/fixtures/${o.fixture ?? 'pdf-form.pdf'}`,
    lang: o.lang ?? 'en',
    theme: o.theme ?? 'light',
    ...(o.readonly ? { readonly: '1' } : {}),
    ...(o.pick ? { pick: '1' } : {}),
  })
  await page.goto(`/test-host/?${q}`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
  // the bridge answers the print dialog: no system dialog in headless runs, count instead
  await frame.waitForFunction(() => document.querySelector('.ribbon-tab, .pdf-pwd-dialog') !== null)
  await frame.evaluate(() => {
    const w = window as unknown as { __printed: number }
    w.__printed = 0
    window.print = () => {
      w.__printed++
      window.dispatchEvent(new Event('afterprint'))
    }
  })
  return frame
}

async function waitRendered(frame: Frame): Promise<void> {
  await frame.waitForSelector('.pdf-page canvas', { timeout: 30_000 })
  await frame.waitForFunction(() => {
    const c = document.querySelector('.pdf-page canvas') as HTMLCanvasElement | null
    return !!c && c.width > 0
  })
}

const host = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([name, a]) =>
      (window as unknown as { __host: Record<string, (...x: unknown[]) => unknown> }).__host[
        name as string
      ](...(a as unknown[])),
    [fn, args] as const,
  ) as Promise<T>

interface Saved {
  fileId: string
  name: string
  versionId: string
  etag: string
  bytes: number[]
}

const lastSaved = (page: Page) => host<Saved | null>(page, 'lastSaved')
const files = (page: Page) =>
  host<Array<{ fileId: string; name: string; versionId: string; etag: string; size: number }>>(
    page,
    'files',
  )

async function savedPdf(page: Page): Promise<{ saved: Saved; doc: PDFDocument; text: string }> {
  const saved = (await lastSaved(page))!
  const bytes = Uint8Array.from(saved.bytes)
  return {
    saved,
    doc: await PDFDocument.load(bytes),
    text: Buffer.from(bytes).toString('latin1'),
  }
}

function annotSubtypes(doc: PDFDocument, pageIndex: number): string[] {
  const annots = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) return []
  return annots
    .asArray()
    .map((_, i) => annots.lookup(i, PDFDict).lookup(PDFName.of('Subtype'), PDFName).decodeText())
}

const tab = (frame: Frame, label: string) =>
  frame.locator('.ribbon-tab', { hasText: label }).first().click()
const ribbonButton = (frame: Frame, label: string) =>
  frame.locator('.ribbon-body button', { hasText: label }).first()

/** select a text-layer run (the renderer reads window.getSelection), then mark it */
async function selectText(frame: Frame, text: string): Promise<void> {
  // one poll does find + select: the text layer is rebuilt after every save / reload
  await frame.waitForFunction((t) => {
    const span = [...document.querySelectorAll('.textLayer span')].find((s) =>
      s.textContent?.includes(t),
    )
    if (!span) return false
    const range = document.createRange()
    range.selectNodeContents(span)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return true
  }, text)
}

async function pageBox(frame: Frame, index = 0) {
  const box = await frame.locator('.pdf-page').nth(index).boundingBox()
  expect(box).not.toBeNull()
  return box!
}

/** frame coordinates -> page coordinates (the frame sits below the host status line) */
async function frameOffset(page: Page) {
  return (await page.locator('#frame').boundingBox())!
}

async function clickSave(frame: Frame): Promise<void> {
  // the first quick-access button is Save in every UI language
  await frame.locator('.qa-btn').first().click()
}

async function waitVersion(page: Page, versionId: string): Promise<void> {
  await expect
    .poll(async () => (await lastSaved(page))?.versionId, { timeout: 30_000 })
    .toBe(versionId)
}

test.describe('pdf module on the web', () => {
  test.skip(!built(), 'no dist-web/pdf build: npm run build:web -- --module pdf')

  test('edit round trip: annotate, fill, save, conflict, reopen, page ops, Save As, print', async ({
    page,
  }) => {
    const problems = await watch(page)
    const frame = await openPdf(page, { pick: true })
    await waitRendered(frame)
    const fileId = (await files(page))[0]!.fileId
    expect((await files(page))[0]!.versionId).toBe('v1')

    // highlight
    await selectText(frame, 'Highlight this sentence')
    await frame.locator('button.rb-highlight-main').click()

    // note: Annotate > Note, click the page, type, OK
    await tab(frame, 'Annotate')
    await ribbonButton(frame, 'Note').click()
    const off = await frameOffset(page)
    const pb = await pageBox(frame)
    await page.mouse.click(off.x + pb.x + pb.width * 0.7, off.y + pb.y + 420)
    await frame.locator('.pdf-note-draft-box textarea').fill('Web note from the frame')
    await frame.locator('.pdf-note-draft-actions .primary').click()

    // ink: Annotate > Draw, drag over the page
    await ribbonButton(frame, 'Draw').click()
    const x0 = off.x + pb.x + pb.width * 0.2
    // inside the viewport: at fit-width zoom the page is taller than the window
    const y0 = off.y + pb.y + 560
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + i * 15, y0 + (i % 2 ? 20 : -20))
    await page.mouse.up()
    await ribbonButton(frame, 'Draw').click() // tool off

    // fill the form
    await frame.locator('input.pdf-form-input[title="name"]').fill('Nguyễn Văn Web')
    await frame.locator('input.pdf-form-checkbox[title="agree"]').check()

    // dirty reaches the host
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as { __host: { events: Array<{ type: string; payload: unknown }> } }
            ).__host.events
              .filter((e) => e.type === 'dirty')
              .at(-1)?.payload,
        ),
      )
      .toEqual({ dirty: true })

    // save -> bytes reach the host, etag advances
    await clickSave(frame)
    await waitVersion(page, 'v2')
    {
      const { saved, doc, text } = await savedPdf(page)
      expect(saved.fileId).toBe(fileId)
      expect(saved.etag).toBe(`"${fileId}-v2"`)
      expect(text.startsWith('%PDF-')).toBe(true)
      expect(text).toContain('/Annots')
      const subtypes = annotSubtypes(doc, 0)
      expect(subtypes).toEqual(expect.arrayContaining(['Highlight', 'Text', 'Ink']))
      expect(doc.getForm().getTextField('name').getText()).toBe('Nguyễn Văn Web')
      expect(doc.getForm().getCheckBox('agree').isChecked()).toBe(true)
    }
    await expect(frame.locator('.tb-save-pending')).toHaveCount(0)

    // stale etag: someone else saved meanwhile -> conflict dialog -> Overwrite
    await host(page, 'bumpRemote', fileId) // v3 on the "server"
    await tab(frame, 'Home') // focusing a form field switched to Fill Form
    await selectText(frame, 'quick brown fox')
    await frame.locator('.ribbon-body button', { hasText: 'Underline' }).first().click()
    await clickSave(frame)
    const conflict = frame.locator('[data-pdf-web="conflict"]')
    await expect(conflict).toBeVisible()
    await expect(conflict).toContainText('changed elsewhere')
    await conflict.locator('[data-choice="overwrite"]').click()
    await waitVersion(page, 'v4')
    expect(annotSubtypes((await savedPdf(page)).doc, 0)).toContain('Underline')
    expect(
      await page.evaluate(() =>
        (
          window as unknown as {
            __host: { events: Array<{ type: string; payload: { error?: { code?: string } } }> }
          }
        ).__host.events
          .filter((e) => e.type === 'error')
          .map((e) => e.payload.error?.code),
      ),
    ).toContain('conflict')

    // reopen the saved head version (host `open`): the annotations come back from the file
    await reopenHead(page, fileId)
    await expect(
      frame.locator('.pdf-note-card', { hasText: 'Web note from the frame' }),
    ).toBeVisible({
      timeout: 30_000,
    })
    await expect(frame.locator('input.pdf-form-input[title="name"]')).toHaveValue('Nguyễn Văn Web')

    // rotate page 1, delete page 3 (Pages tab), save
    await tab(frame, 'Pages')
    await ribbonButton(frame, 'Rotate right').click()
    await frame.locator('.pdf-thumb').nth(2).click()
    await ribbonButton(frame, 'Delete page').click()
    await clickSave(frame)
    await waitVersion(page, 'v5')
    {
      const { doc } = await savedPdf(page)
      expect(doc.getPageCount()).toBe(2)
      expect(doc.getPage(0).getRotation().angle % 360).not.toBe(0)
    }

    // import pages: the host picker (file.pick purpose insert) hands over another PDF
    const extra = await host<{ fileId: string }>(page, 'addFile', '/fixtures/sample.pdf')
    await host(page, 'queuePick', extra.fileId)
    await ribbonButton(frame, 'Import pages').click()
    await expect
      .poll(
        async () =>
          (await lastSaved(page))?.fileId === fileId && (await lastSaved(page))?.versionId,
        {
          timeout: 30_000,
        },
      )
      .toBe('v6')
    expect((await savedPdf(page)).doc.getPageCount()).toBe(3)
    // Save As (host request): a new file, the original untouched and still open
    const before = (await files(page)).find((f) => f.fileId === fileId)!
    const asResult = await host<{ ok: boolean; file?: { name: string; fileId: string } }>(
      page,
      'request',
      'saveAs',
      { name: 'Form copy' },
    )
    expect(asResult).toMatchObject({ ok: true, file: { name: 'Form copy.pdf' } })
    const after = (await files(page)).find((f) => f.fileId === fileId)!
    expect(after.versionId).toBe(before.versionId)
    expect((await files(page)).some((f) => f.name === 'Form copy.pdf')).toBe(true)

    // print (host request): the viewer's print dialog -> window.print in the frame
    expect(await host(page, 'request', 'print', { mode: 'dialog' })).toEqual({ printed: true })
    await frame.locator('.pdf-modal-actions .primary', { hasText: 'Print' }).click()
    await expect
      .poll(() => frame.evaluate(() => (window as unknown as { __printed: number }).__printed), {
        timeout: 30_000,
      })
      .toBe(1)

    await noProblems(page, frame, problems)
  })

  test('view-only (no save grant): edit UI disabled, nothing can be saved, print works', async ({
    page,
  }) => {
    const problems = await watch(page)
    const frame = await openPdf(page, { readonly: true })
    await waitRendered(frame)
    await expect(frame.locator('.tb-readonly')).toHaveText('View only')
    await expect(frame.locator('button.rb-highlight-main')).toBeDisabled()
    await expect(frame.locator('.ribbon-tab', { hasText: 'Fill Form' })).toHaveCount(0)
    await expect(frame.locator('input.pdf-form-input[title="name"]')).toBeDisabled()
    await tab(frame, 'Pages')
    await expect(ribbonButton(frame, 'Delete page')).toBeDisabled()
    await frame.locator('.pdf-page').first().click()
    await page.keyboard.press('Control+s')
    // the host's own save request is refused as well
    const res = await host<{ ok: boolean }>(page, 'request', 'save', { reason: 'user' })
    expect(res.ok).toBe(false)
    expect(await lastSaved(page)).toBeNull()
    expect(await host(page, 'request', 'print', { mode: 'dialog' })).toEqual({ printed: true })
    await frame.locator('.pdf-modal-actions .primary', { hasText: 'Print' }).click()
    await expect
      .poll(() => frame.evaluate(() => (window as unknown as { __printed: number }).__printed))
      .toBe(1)
    await noProblems(page, frame, problems)
  })

  for (const fixture of ['sample.pdf', 'pdf-scanned.pdf', 'pdf-fonts.pdf', 'pdf-form.pdf']) {
    test(`renders ${fixture} with zero CSP violations`, async ({ page }) => {
      const problems = await watch(page)
      const frame = await openPdf(page, { fixture })
      await waitRendered(frame)
      // give pdf.js time to fetch fonts / CMaps / wasm codecs for every visible page
      await frame.waitForTimeout(1500)
      await noProblems(page, frame, problems)
    })
  }

  test('encrypted PDF: password prompt, then it renders (read-only)', async ({ page }) => {
    const problems = await watch(page)
    const frame = await openPdf(page, { fixture: 'pdf-encrypted.pdf' })
    const dialog = frame.locator('.pdf-pwd-dialog')
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await dialog.locator('input').fill('wrong')
    await dialog.locator('.primary').click()
    await expect(frame.locator('.pdf-pwd-error')).toBeVisible()
    await dialog.locator('input').fill('secret')
    await dialog.locator('.primary').click()
    await waitRendered(frame)
    // pdf-lib cannot write encrypted files: the desktop's encrypted read-only mode applies
    await expect(frame.locator('.tb-readonly')).toBeVisible()
    await noProblems(page, frame, problems)
  })

  test('screenshots: light + dark, vi + en', async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true })
    const problems = await watch(page)
    for (const lang of ['en', 'vi']) {
      for (const theme of ['light', 'dark'] as const) {
        const tag = `${lang}-${theme}`
        let frame = await openPdf(page, { lang, theme, pick: true })
        await waitRendered(frame)
        await frame.waitForTimeout(500)
        await page.screenshot({ path: resolve(SHOTS, `main-${tag}.png`) })

        // conflict dialog
        const fileId = (await files(page))[0]!.fileId
        await host(page, 'bumpRemote', fileId)
        await frame.locator('input.pdf-form-input[title="name"]').fill('Web')
        await clickSave(frame)
        await expect(frame.locator('[data-pdf-web="conflict"]')).toBeVisible()
        await page.screenshot({ path: resolve(SHOTS, `conflict-${tag}.png`) })
        await frame.locator('[data-choice="cancel"]').click()

        // view-only
        frame = await openPdf(page, { lang, theme, readonly: true })
        await waitRendered(frame)
        await frame.waitForTimeout(500)
        await page.screenshot({ path: resolve(SHOTS, `view-only-${tag}.png`) })

        // password prompt
        frame = await openPdf(page, { lang, theme, fixture: 'pdf-encrypted.pdf' })
        await expect(frame.locator('.pdf-pwd-dialog')).toBeVisible({ timeout: 30_000 })
        await page.screenshot({ path: resolve(SHOTS, `password-${tag}.png`) })
        await noProblems(page, frame, problems)
      }
    }
  })
})

/** host `open` with the head version from the host store */
async function reopenHead(page: Page, fileId: string): Promise<void> {
  const res = await page.evaluate(async (id) => {
    const h = (
      window as unknown as {
        __host: {
          lastSaved: () => { fileId: string; bytes: number[] } | null
          files: () => Array<{ fileId: string; name: string; versionId: string; etag: string }>
          request: (t: string, p: unknown) => Promise<unknown>
        }
      }
    ).__host
    const meta = h.files().find((f) => f.fileId === id)!
    const saved = h.lastSaved()!
    return h.request('open', {
      file: { fileId: meta.fileId, name: meta.name, versionId: meta.versionId, etag: meta.etag },
      source: { kind: 'bytes', data: new Uint8Array(saved.bytes).buffer },
    })
  }, fileId)
  expect(res).toMatchObject({ opened: true })
}
