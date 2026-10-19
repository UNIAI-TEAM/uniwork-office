// UNI-1923 (G712-A1, user decision "(B) Save is the confirm"): for a UniWork-bound document in the
// web frame, an AI write lands in the editor but nothing reaches UniWork — no api.save, no save-as,
// no upload — until the person presses Save. The protocol test host (web/server/test-host) counts
// api.save calls via __host.saveCalls(); a turn abort and a frame kill mid-stream use the fake AI's
// hold gate (web/server/fake-ai.mjs `hold`). Sheets and Docs, production dist-web builds.
// Run: npx playwright test -c web/e2e ai-save-confirm
import { test, expect, type APIRequestContext, type Frame, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { buildEditFixture } from '../../apps/sheets/tests/fixture-builder'
import { built, repoRoot, watch } from './text-modules'

const REPLY = 'Hello from the UniWork AI proxy.'
const OPENAI_KEY = [{ provider: 'openai', api_key: 'sk-test-openai-abcd' }]
const MARKER = 'AICONFIRM719'
const DOCS_EDITOR = '.ProseMirror[contenteditable="true"]'

async function fake(request: APIRequestContext, control?: Record<string, unknown>) {
  if (!control) {
    expect((await request.post('/__fake-ai/reset')).ok()).toBe(true)
    return
  }
  expect((await request.post('/__fake-ai/control', { data: control })).ok()).toBe(true)
}

const panel = (frame: Frame) => frame.locator('.ai-panel-header')

async function ask(frame: Frame, text: string) {
  const box = frame.locator('.ai-input-box textarea').first()
  await expect(box).toBeVisible({ timeout: 30_000 })
  await expect(box).toBeEnabled()
  await expect(frame.locator('.ai-msg-streaming')).toHaveCount(0, { timeout: 30_000 })
  await box.fill(text)
  await box.press('Enter')
}

/** the test-host seam this spec reads: the api.save counter and the last saved bytes */
interface HostApi {
  saveCalls(): number
  uploads(): unknown[]
  lastSaved(): { bytes: number[] } | null
}
type HostMethod = keyof HostApi

function hostCall<T>(page: Page, name: HostMethod): Promise<T> {
  return page.evaluate((n) => {
    const host = (window as unknown as { __host: HostApi }).__host
    return (host[n] as () => unknown)()
  }, name) as Promise<T>
}

/** how many api.save requests reached the host (the "reached UniWork" counter) */
const saveCalls = (page: Page): Promise<number> => hostCall<number>(page, 'saveCalls')

/** the api.images.upload requests the host recorded (an image upload is also a write to UniWork) */
const uploads = (page: Page): Promise<unknown[]> => hostCall<unknown[]>(page, 'uploads')

const lastSaved = (page: Page): Promise<{ bytes: number[] } | null> => hostCall(page, 'lastSaved')

/** a settle window in which any queued save would have landed */
async function settleThenStillUnsaved(page: Page) {
  await page.waitForTimeout(3_000)
  expect(await saveCalls(page)).toBe(0)
  expect(await lastSaved(page)).toBeNull()
  expect(await uploads(page)).toEqual([])
}

/** kill the document frame: host close without a save, or the port/renderer going away */
async function killFrame(page: Page) {
  await page.evaluate(() => {
    const f = document.getElementById('frame')
    ;(f as HTMLIFrameElement).src = 'about:blank'
    f?.remove()
  })
}

/** with `hold` already armed, wait until one chunk is streaming, run `duringHold`, then release */
async function duringHeldStream<T>(
  request: APIRequestContext,
  frame: Frame,
  duringHold: () => Promise<T>,
): Promise<T> {
  try {
    await expect(frame.locator('.ai-msg-streaming')).toHaveCount(1, { timeout: 30_000 })
    await expect(frame.locator('.ai-msg-streaming').first()).not.toHaveText('', { timeout: 30_000 })
    return await duringHold()
  } finally {
    await fake(request, { hold: false })
  }
}

test.beforeAll(() => {
  const dir = resolve(repoRoot, 'web/e2e/.results/fixtures')
  mkdirSync(dir, { recursive: true })
  return buildEditFixture().then((bytes) => writeFileSync(resolve(dir, 'Edit.xlsx'), bytes))
})

test.describe('sheets: an AI write reaches UniWork only on the explicit Save (UNI-1923, (B))', () => {
  test.skip(!built('sheets'), 'no dist-web/sheets build: npm run build:web -- --module sheets')

  type ShownWorkbook = {
    sessionId: string
    sheets: Array<{ id: string }>
  }
  interface SheetsWebState {
    workbook(): ShownWorkbook | null
  }

  async function openSheets(page: Page): Promise<{ frame: Frame; wb: ShownWorkbook }> {
    const qs = new URLSearchParams({
      module: 'sheets',
      open: '/fixtures/Edit.xlsx',
      lang: 'en',
      ai: '1',
    })
    await page.goto(`/test-host/?${qs}`)
    await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
    const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
    const state = () =>
      frame.evaluate(() =>
        (window as unknown as { __sheetsWebState: SheetsWebState }).__sheetsWebState.workbook(),
      )
    await expect.poll(async () => (await state()) !== null, { timeout: 60_000 }).toBe(true)
    await expect(frame.locator('canvas[id^="univer-sheet-main-canvas"]').first()).toBeVisible()
    await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
    return { frame, wb: (await state())! }
  }

  const setC2 = (sheetId: string) => ({
    toolCalls: [
      {
        name: 'propose_operations',
        input: {
          summary: 'Put 7 in C2',
          operations: [{ op: 'set_cell', sheetId, address: 'C2', value: 7 }],
        },
      },
    ],
  })

  /** a scripted C2=7 turn that completed its follow-up answer and landed in the grid: the panel's
   * auto-applied chip carries the C2 footprint — readWorkbookRange only sees the engine session
   * (i.e. saved state), so the live grid is proven by the apply UI and the dirty event */
  async function appliedTurn(request: APIRequestContext, frame: Frame, wb: ShownWorkbook) {
    await fake(request, setC2(wb.sheets[0]!.id))
    await ask(frame, 'Put 7 in C2')
    await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
      timeout: 60_000,
    })
    await expect(frame.locator('.ai-auto-applied').first()).toBeVisible({ timeout: 30_000 })
    await expect(frame.locator('.ai-apply-footprint').first()).toContainText('C2')
    // the run's SSE must be fully consumed before a later `hold` is armed: the fake
    // parks between chunks, and a hold set while this turn still streams wedges it
    // (streaming stays set, the next ask times out waiting for it to clear)
    await expect(frame.locator('.ai-msg-streaming')).toHaveCount(0, { timeout: 30_000 })
  }

  test('(a) the write lands in the grid; no save goes to the host after a settle wait', async ({
    page,
    request,
  }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    await watch(page)
    const { frame, wb } = await openSheets(page)
    expect(await saveCalls(page)).toBe(0)
    await appliedTurn(request, frame, wb)
    await settleThenStillUnsaved(page)
  })

  test('(b) closing the frame without saving sends nothing', async ({ page, request }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    await watch(page)
    const { frame, wb } = await openSheets(page)
    await appliedTurn(request, frame, wb)
    // a save after the frame is gone cannot arrive (the host checks e.source === frame.contentWindow);
    // (a)'s settle covers the apply-to-kill window
    await killFrame(page)
    await page.waitForTimeout(2_000)
    expect(await saveCalls(page)).toBe(0)
    expect(await lastSaved(page)).toBeNull()
    expect(await uploads(page)).toEqual([])
  })

  test('(c) stopping the turn mid-stream sends nothing', async ({ page, request }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    await watch(page)
    const { frame, wb } = await openSheets(page)
    // one write already landed and stayed local; the second turn is cut while streaming
    await appliedTurn(request, frame, wb)
    await fake(request, { hold: true })
    await ask(frame, 'Summarize the sheet')
    await duringHeldStream(request, frame, async () => {
      await frame.locator('.ai-stop-btn').click()
      await expect(frame.locator('.ai-msg-streaming')).toHaveCount(0, { timeout: 30_000 })
    })
    await settleThenStillUnsaved(page)
  })

  test('(d) the frame / port going away mid-stream sends nothing', async ({ page, request }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    await watch(page)
    const { frame, wb } = await openSheets(page)
    await appliedTurn(request, frame, wb)
    await fake(request, { hold: true })
    await ask(frame, 'Summarize the sheet')
    await duringHeldStream(request, frame, () => killFrame(page))
    await page.waitForTimeout(1_000)
    expect(await saveCalls(page)).toBe(0)
    expect(await lastSaved(page)).toBeNull()
    expect(await uploads(page)).toEqual([])
  })

  test('(e) the explicit Save sends exactly one save that carries the AI edit', async ({
    page,
    request,
  }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    await watch(page)
    const { frame, wb } = await openSheets(page)
    await appliedTurn(request, frame, wb)
    expect(await saveCalls(page)).toBe(0)
    await frame
      .locator('canvas[id^="univer-sheet-main-canvas"]')
      .first()
      .click({ position: { x: 300, y: 300 } })
    await page.keyboard.press('Control+s')
    await expect.poll(() => saveCalls(page), { timeout: 60_000 }).toBe(1)
    const saved = await lastSaved(page)
    const zip = await JSZip.loadAsync(Uint8Array.from(saved!.bytes))
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('text')
    expect(xml).toMatch(/<c r="C2"[^>]*><v>7<\/v><\/c>/)
    // nothing repeats the write: the count stays at one
    await page.waitForTimeout(2_000)
    expect(await saveCalls(page)).toBe(1)
  })
})

test.describe('docs: an AI write reaches UniWork only on the explicit Save (UNI-1923, (B))', () => {
  test.skip(!built('docs'), 'no dist-web/docs build: npm run build:web')

  async function openDocs(page: Page): Promise<Frame> {
    const qs = new URLSearchParams({ open: '/fixtures/simple.docx', lang: 'en', ai: '1' })
    await page.goto(`/test-host/?${qs}`)
    await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
    const frame = (await (await page.waitForSelector('#frame')).contentFrame())!
    await expect(frame.locator(DOCS_EDITOR).first()).toBeVisible({ timeout: 60_000 })
    await expect(panel(frame)).toBeVisible({ timeout: 30_000 })
    return frame
  }

  const markerInsert = {
    toolCalls: [
      {
        name: 'insert_content',
        input: { html: `<p>${MARKER}</p>`, afterBlockIndex: 0 },
      },
    ],
  }

  /** a scripted insert_content turn that completed its follow-up answer and landed in the editor */
  async function appliedTurn(request: APIRequestContext, frame: Frame) {
    await fake(request, markerInsert)
    await ask(frame, `Insert the marker ${MARKER}`)
    await expect(frame.locator('.ai-msg-assistant').last()).toContainText(REPLY, {
      timeout: 60_000,
    })
    await expect(frame.locator(DOCS_EDITOR)).toContainText(MARKER, { timeout: 30_000 })
    // same hold race as the sheets block: only arm `hold` once the stream is done
    await expect(frame.locator('.ai-msg-streaming')).toHaveCount(0, { timeout: 30_000 })
  }

  test('(a) the write lands in the document; no save goes to the host after a settle wait', async ({
    page,
    request,
  }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    await watch(page)
    const frame = await openDocs(page)
    expect(await saveCalls(page)).toBe(0)
    await appliedTurn(request, frame)
    await settleThenStillUnsaved(page)
  })

  test('(b) closing the frame without saving sends nothing', async ({ page, request }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    await watch(page)
    const frame = await openDocs(page)
    await appliedTurn(request, frame)
    // a save after the frame is gone cannot arrive (the host checks e.source === frame.contentWindow);
    // (a)'s settle covers the apply-to-kill window
    await killFrame(page)
    await page.waitForTimeout(2_000)
    expect(await saveCalls(page)).toBe(0)
    expect(await lastSaved(page)).toBeNull()
    expect(await uploads(page)).toEqual([])
  })

  test('(c) stopping the turn mid-stream sends nothing', async ({ page, request }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    await watch(page)
    const frame = await openDocs(page)
    await appliedTurn(request, frame)
    await fake(request, { hold: true })
    await ask(frame, 'Summarize the document')
    await duringHeldStream(request, frame, async () => {
      await frame.locator('.ai-stop-btn').click()
      await expect(frame.locator('.ai-msg-streaming')).toHaveCount(0, { timeout: 30_000 })
    })
    await settleThenStillUnsaved(page)
  })

  test('(d) the frame / port going away mid-stream sends nothing', async ({ page, request }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    await watch(page)
    const frame = await openDocs(page)
    await appliedTurn(request, frame)
    await fake(request, { hold: true })
    await ask(frame, 'Summarize the document')
    await duringHeldStream(request, frame, () => killFrame(page))
    await page.waitForTimeout(1_000)
    expect(await saveCalls(page)).toBe(0)
    expect(await lastSaved(page)).toBeNull()
    expect(await uploads(page)).toEqual([])
  })

  test('(e) the explicit Save sends exactly one save that carries the AI edit', async ({
    page,
    request,
  }) => {
    await fake(request)
    await fake(request, { credentials: OPENAI_KEY })
    await watch(page)
    const frame = await openDocs(page)
    await appliedTurn(request, frame)
    expect(await saveCalls(page)).toBe(0)
    await frame
      .locator(DOCS_EDITOR)
      .first()
      .click({ position: { x: 5, y: 5 }, force: true })
      .catch(() => {})
    await page.keyboard.press('Control+s')
    await expect.poll(() => saveCalls(page), { timeout: 60_000 }).toBe(1)
    const saved = await lastSaved(page)
    const zip = await JSZip.loadAsync(Buffer.from(saved!.bytes))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml, 'marker reached the saved version').toContain(MARKER)
    await page.waitForTimeout(2_000)
    expect(await saveCalls(page)).toBe(1)
  })
})
