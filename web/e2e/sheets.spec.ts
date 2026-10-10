// UNI-1016 (GO-B6, GO-D3 = C): the Sheets frame with its WASM engine, production build
// (`npm run build:web -- --module sheets`, served under its own CSP header) in the protocol test
// host. Covers: workbook fixtures and a 20k x 22 synthetic open in the engine Worker; scroll;
// edit a value + a formula; save (the bytes reach the host, the reopened session shows the edit);
// a save conflict; a legacy .xls; view-only without the save grant; the too_large size gate
// (the host gets a fatal too_large and the frame shows its state); screenshots light + dark,
// vi + en (docs/web-modules/screenshots/sheets/); 0 console errors, 0 CSP violations.
// Run: npx playwright test -c web/e2e sheets
import { test, expect, type Frame, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import {
  buildEditFixture,
  buildKitchenSinkFixture,
  buildStructureFixture,
} from '../../apps/sheets/tests/fixture-builder'

const repoRoot = resolve(__dirname, '../..')
const shots = resolve(repoRoot, 'docs/web-modules/screenshots/sheets')
const fixtures = resolve(repoRoot, 'web/e2e/.results/fixtures')

const built = (): boolean => {
  const root = resolve(repoRoot, 'dist-web', 'sheets')
  return (
    existsSync(root) && readdirSync(root).some((v) => existsSync(resolve(root, v, 'manifest.json')))
  )
}

/** rows x 20 numbers + a formula column + a text column (the GO-D3 probe's synthetic shape) */
async function synthetic(rows: number): Promise<Buffer> {
  const col = (i: number): string => {
    let s = ''
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s
    return s
  }
  const lines: string[] = []
  for (let r = 1; r <= rows; r += 1) {
    const cells: string[] = []
    for (let c = 0; c < 20; c += 1)
      cells.push(`<c r="${col(c)}${r}"><v>${(r * 31 + c * 7) % 10007}</v></c>`)
    cells.push(
      `<c r="U${r}"><f>A${r}+B${r}</f><v>${((r * 31) % 10007) + ((r * 31 + 7) % 10007)}</v></c>`,
    )
    cells.push(`<c r="V${r}" t="inlineStr"><is><t>row ${r}</t></is></c>`)
    lines.push(`<row r="${r}">${cells.join('')}</row>`)
  }
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
  )
  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><dimension ref="A1:V${rows}"/><sheetData>${lines.join('')}</sheetData></worksheet>`,
  )
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
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
  return [
    ...(await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    )),
    ...(await frame.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    )),
  ]
}

type ShownWorkbook = {
  sessionId: string
  name: string
  needsSaveAs: boolean
  sheets: Array<{ id: string; name: string }>
}

async function openFrame(page: Page, query: string): Promise<Frame> {
  await page.goto(`/test-host/?module=sheets&${query}`)
  await expect(page.locator('#status')).toHaveText(/^initialised/, { timeout: 30_000 })
  return (await (await page.waitForSelector('#frame')).contentFrame())!
}

/** waits until the renderer opened the workbook through the engine */
async function shown(frame: Frame): Promise<ShownWorkbook> {
  await expect
    .poll(
      () =>
        frame.evaluate(
          () =>
            (
              window as unknown as { __sheetsWebState: { workbook: () => unknown } }
            ).__sheetsWebState.workbook() !== null,
        ),
      { timeout: 60_000 },
    )
    .toBe(true)
  return frame.evaluate(() =>
    (
      window as unknown as { __sheetsWebState: { workbook: () => ShownWorkbook } }
    ).__sheetsWebState.workbook(),
  )
}

/** a range read through the frame's engine (the same call the renderer makes) */
function readRange(frame: Frame, wb: ShownWorkbook, range: Record<string, number>) {
  return frame.evaluate(
    ({ sessionId, sheetId, range }) =>
      (
        window as unknown as {
          desktopApi: {
            readWorkbookRange(r: unknown): Promise<{
              cells: Array<{ row: number; column: number; value: unknown; formula?: string }>
            }>
          }
        }
      ).desktopApi.readWorkbookRange({ sessionId, sheetId, range }),
    { sessionId: wb.sessionId, sheetId: wb.sheets[0]!.id, range },
  )
}

type HostEvent = { type: string; payload: Record<string, unknown> }
const hostEvents = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __host: { events: HostEvent[] } }).__host.events,
  ) as Promise<HostEvent[]>

const lastSaved = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __host: { lastSaved(): { bytes: number[]; versionId: string } | null }
      }
    ).__host.lastSaved(),
  )

async function savedSheetXml(page: Page): Promise<string> {
  const saved = await lastSaved(page)
  expect(saved).not.toBeNull()
  const zip = await JSZip.loadAsync(Uint8Array.from(saved!.bytes))
  return zip.file('xl/worksheets/sheet1.xml')!.async('text')
}

/** Univer's formula-bar Name Box (the defined-name selector): its input carries no accessible label */
const nameBoxOf = (frame: Frame) => frame.locator('[data-u-comp="defined-name"] input').first()

/** select each cell through the Name Box, then type its input and press Enter */
async function typeIntoGrid(
  page: Page,
  frame: Frame,
  entries: Array<{ cell: string; text: string }>,
) {
  for (const entry of entries) {
    const nameBox = nameBoxOf(frame)
    await nameBox.click()
    await nameBox.fill(entry.cell)
    await nameBox.press('Enter')
    // the jump leaves the grid focused: typing starts the in-cell editor (a long jump scrolls
    // first, so give the selection a moment to land before the keys arrive)
    await page.waitForTimeout(500)
    await page.keyboard.type(entry.text)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
  }
}

/** the host reopens the frame's saved bytes (api.open of the head version), like opening the file again */
async function reopenSaved(page: Page): Promise<void> {
  const res = await page.evaluate(async () => {
    const h = (
      window as unknown as {
        __host: {
          lastSaved: () => { fileId: string; bytes: number[] } | null
          files: () => Array<{ fileId: string; name: string; versionId: string; etag: string }>
          request: (t: string, p: unknown) => Promise<unknown>
        }
      }
    ).__host
    const saved = h.lastSaved()!
    const meta = h.files().find((f) => f.fileId === saved.fileId)!
    return h.request('open', {
      file: { fileId: meta.fileId, name: meta.name, versionId: meta.versionId, etag: meta.etag },
      source: { kind: 'bytes', data: new Uint8Array(saved.bytes).buffer },
    })
  })
  expect(res).toMatchObject({ opened: true })
}

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true })
  mkdirSync(fixtures, { recursive: true })
  writeFileSync(resolve(fixtures, 'Edit.xlsx'), await buildEditFixture())
  writeFileSync(resolve(fixtures, 'Kitchen-Sink.xlsx'), await buildKitchenSinkFixture())
  writeFileSync(resolve(fixtures, 'Structure.xlsx'), await buildStructureFixture())
  writeFileSync(resolve(fixtures, 'Synthetic-20k.xlsx'), await synthetic(20_000))
  // 120k x 22 is ~85 MB of worksheet XML: above the frame's 80 MB gate
  writeFileSync(resolve(fixtures, 'Too-Large.xlsx'), await synthetic(120_000))
  writeFileSync(resolve(fixtures, 'Synthetic-50k.xlsx'), await synthetic(50_000))
  writeFileSync(resolve(fixtures, 'Synthetic-100k.xlsx'), await synthetic(100_000))
})

test.describe.configure({ mode: 'serial' })

for (const name of ['Edit.xlsx', 'Kitchen-Sink.xlsx', 'Structure.xlsx']) {
  test(`fixture ${name} opens in the engine Worker`, async ({ page }) => {
    test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
    const problems = await watch(page)
    const frame = await openFrame(page, `lang=en&theme=light&open=/fixtures/${name}`)
    const wb = await shown(frame)
    expect(wb.name).toBe(name)
    const cells = await readRange(frame, wb, {
      startRow: 0,
      endRow: 0,
      startColumn: 0,
      endColumn: 0,
    })
    expect(Array.isArray(cells.cells)).toBe(true)
    await expect(frame.locator('canvas[id^="univer-sheet-main-canvas"]').first()).toBeVisible()
    expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
      csp: [],
      console: [],
      page: [],
      http: [],
    })
  })
}

test('20k x 22: open, scroll, edit a value + a formula, save, reopen shows the edit', async ({
  page,
}) => {
  test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
  const problems = await watch(page)
  const started = Date.now()
  const frame = await openFrame(page, 'lang=en&theme=light&open=/fixtures/Synthetic-20k.xlsx')
  const wb = await shown(frame)
  const openMs = Date.now() - started
  const first = await readRange(frame, wb, {
    startRow: 0,
    endRow: 1,
    startColumn: 0,
    endColumn: 21,
  })
  expect(first.cells.find((c) => c.row === 0 && c.column === 21)?.value).toBe('row 1')
  await page.waitForTimeout(1_000)
  await page.screenshot({ path: resolve(shots, 'synthetic-20k-en-light.png') })

  // scroll far down: the grid streams rows from the engine
  const grid = frame.locator('canvas[id^="univer-sheet-main-canvas"]').first()
  await grid.hover({ position: { x: 300, y: 300 } })
  for (let i = 0; i < 15; i += 1) await page.mouse.wheel(0, 4_000)
  await page.waitForTimeout(1_500)
  const deep = await readRange(frame, wb, {
    startRow: 15_000,
    endRow: 15_000,
    startColumn: 21,
    endColumn: 21,
  })
  expect(deep.cells[0]?.value).toBe('row 15001')
  await page.screenshot({ path: resolve(shots, 'synthetic-20k-scrolled-en-light.png') })

  // back to the top (the Name Box jump scrolls there), edit A1 and B1 (= a formula), save with
  // Ctrl+S (the bridge's accelerator)
  await typeIntoGrid(page, frame, [
    { cell: 'A1', text: '4242' },
    { cell: 'B1', text: '=A1*2' },
  ])
  await page.waitForTimeout(500)
  await page.keyboard.press('Control+s')
  await expect.poll(() => lastSaved(page), { timeout: 60_000 }).not.toBeNull()
  const xml = await savedSheetXml(page)
  expect(xml).toMatch(/<c r="A1"[^>]*><v>4242<\/v><\/c>/)
  expect(xml).toMatch(/<c r="B1"[^>]*><f>A1\*2<\/f>/)
  expect((await hostEvents(page)).some((e) => e.type === 'saved')).toBe(true)

  // the session swapped onto the saved bytes: reading through the engine shows the edit
  await expect
    .poll(async () => (await shown(frame)).sessionId, { timeout: 30_000 })
    .not.toBe(wb.sessionId)
  const reopened = await shown(frame)
  const top = await readRange(frame, reopened, {
    startRow: 0,
    endRow: 0,
    startColumn: 0,
    endColumn: 1,
  })
  expect(top.cells.find((c) => c.column === 0)?.value).toBe(4242)
  expect(top.cells.find((c) => c.column === 1)?.formula).toBe('=A1*2')
  await page.screenshot({ path: resolve(shots, 'synthetic-20k-saved-en-light.png') })

  test
    .info()
    .annotations.push({ type: 'timing', description: `open to first workbook: ${openMs} ms` })
  expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
    csp: [],
    console: [],
    page: [],
    http: [],
  })
})

test('20k x 22: a formula typed far down is saved with its cached value and shows after reopen (SH3)', async ({
  page,
}) => {
  test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
  const problems = await watch(page)
  const frame = await openFrame(page, 'lang=en&theme=light&open=/fixtures/Synthetic-20k.xlsx')
  const wb = await shown(frame)
  // A1:A10 = (r * 31) % 10007 -> 31, 62, ... 310: the sum is 1705
  await typeIntoGrid(page, frame, [{ cell: 'W15000', text: '=SUM(A1:A10)' }])
  await page.waitForTimeout(500)
  // an explicit save only: never an autosave (CONTRACT C10)
  await page.keyboard.press('Control+s')
  await expect.poll(() => lastSaved(page), { timeout: 60_000 }).not.toBeNull()
  const xml = await savedSheetXml(page)
  expect(xml).toMatch(/<c r="W15000"[^>]*><f>SUM\(A1:A10\)<\/f><v>1705<\/v>/)
  const saves = (await hostEvents(page)).filter((e) => e.type === 'saved')
  expect(saves.some((e) => (e.payload as { reason?: string }).reason === 'autosave')).toBe(false)

  // reopen the saved bytes: the engine serves the cached value, and the grid shows it
  await reopenSaved(page)
  await expect
    .poll(async () => (await shown(frame)).sessionId, { timeout: 60_000 })
    .not.toBe(wb.sessionId)
  const reopened = await shown(frame)
  const cell = await readRange(frame, reopened, {
    startRow: 14_999,
    endRow: 14_999,
    startColumn: 22,
    endColumn: 22,
  })
  expect(cell.cells[0]).toMatchObject({ value: 1705, formula: '=SUM(A1:A10)' })
  const nameBox = nameBoxOf(frame)
  await nameBox.click()
  await nameBox.fill('W15000')
  await nameBox.press('Enter')
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: resolve(shots, 'formula-cached-reopen-en-light.png') })
  expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
    csp: [],
    console: [],
    page: [],
    http: [],
  })
})

for (const rows of [20_000, 50_000, 100_000]) {
  test(`Chromium timing: ${rows / 1000}k x 22 open and first viewport`, async ({ page }) => {
    test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
    const name = rows === 20_000 ? 'Synthetic-20k.xlsx' : `Synthetic-${rows / 1000}k.xlsx`
    const t0 = Date.now()
    const frame = await openFrame(page, `lang=en&theme=light&open=/fixtures/${name}`)
    const tInit = Date.now()
    const wb = await shown(frame)
    const tOpen = Date.now()
    const top = await readRange(frame, wb, {
      startRow: 0,
      endRow: 99,
      startColumn: 0,
      endColumn: 21,
    })
    const tFirst = Date.now()
    expect(top.cells).toHaveLength(2200)
    const line = `CHROMIUM ${rows} rows: handshake ${tInit - t0} ms, engine open ${tOpen - tInit} ms, first viewport ${tFirst - tOpen} ms, total ${tFirst - t0} ms`
    console.log(line)
    test.info().annotations.push({ type: 'timing', description: line })
  })
}

test('save conflict: Overwrite saves over the newer version', async ({ page }) => {
  test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
  const problems = await watch(page)
  const frame = await openFrame(page, 'lang=en&theme=dark&open=/fixtures/Edit.xlsx')
  await shown(frame)
  // someone else saves a newer version
  await page.evaluate(() => {
    const host = (
      window as unknown as {
        __host: { files(): Array<{ fileId: string }>; bumpRemote(id: string): void }
      }
    ).__host
    host.bumpRemote(host.files()[0]!.fileId)
  })
  await typeIntoGrid(page, frame, [{ cell: 'A1', text: '7' }])
  await page.keyboard.press('Control+s')
  const dialog = frame.locator('[data-sheets-web="conflict"]')
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: resolve(shots, 'conflict-en-dark.png') })
  await dialog.locator('button[data-choice="overwrite"]').click()
  await expect.poll(() => lastSaved(page), { timeout: 60_000 }).not.toBeNull()
  expect(await savedSheetXml(page)).toMatch(/<c r="A1"[^>]*><v>7<\/v><\/c>/)
  expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
    csp: [],
    console: [],
    page: [],
    http: [],
  })
})

test('a legacy .xls opens through the engine (vi, dark)', async ({ page }) => {
  test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
  const problems = await watch(page)
  const frame = await openFrame(page, 'lang=vi&theme=dark&open=/fixtures/legacy-xls.xls')
  const wb = await shown(frame)
  expect(wb.needsSaveAs).toBe(true)
  const a1 = await readRange(frame, wb, { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 })
  expect(a1.cells[0]?.value).toBe('replaceMe')
  await page.waitForTimeout(1_000)
  await page.screenshot({ path: resolve(shots, 'legacy-xls-vi-dark.png') })
  expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
    csp: [],
    console: [],
    page: [],
    http: [],
  })
})

test('view-only without the save grant (vi, light)', async ({ page }) => {
  test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
  const problems = await watch(page)
  const frame = await openFrame(
    page,
    'lang=vi&theme=light&readonly=1&open=/fixtures/Synthetic-20k.xlsx',
  )
  await shown(frame)
  await expect(frame.locator('.qa-btn').first()).toBeVisible()
  // no Save / Save As in the quick-access bar; Ctrl+S saves nothing
  expect(await frame.locator('button.qa-btn[aria-label*="⌘S"]').count()).toBe(0)
  // the grid itself is locked (SH3): typing starts no editor and changes nothing, so the host never
  // hears of pending edits. The host banner is the one announcement of view-only: no red toast per
  // refused keystroke and no copy in the status bar (N3-05)
  await typeIntoGrid(page, frame, [{ cell: 'A1', text: '1' }])
  await page.waitForTimeout(500)
  await expect(frame.locator('.app-toast').filter({ hasText: /chỉ xem/i })).toHaveCount(0)
  await expect(frame.locator('.status-msg')).not.toContainText(/chỉ xem/i)
  await expect(frame.locator('.workbook-status')).toHaveCount(0)
  // the formula bar, F2 and a double click open an editor too: none of them may start one, so the
  // frame never turns dirty (no Save leave dialog for a workbook that can never be saved)
  const formulaBar = frame.locator(
    '[data-u-comp="formula-bar"] canvas[data-u-comp="render-canvas"]',
  )
  await formulaBar.click()
  await page.keyboard.type('x')
  await page.keyboard.press('F2')
  await page.keyboard.type('y')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  expect(
    (await hostEvents(page)).filter((e) => e.type === 'dirty' && e.payload.dirty === true),
  ).toEqual([])
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(1_500)
  expect(await lastSaved(page)).toBeNull()
  expect(
    (await hostEvents(page)).filter((e) => e.type === 'dirty' && e.payload.dirty === true),
  ).toEqual([])
  // loading still works behind the lock: scrolling far down streams rows from the engine
  const lockedGrid = frame.locator('canvas[id^="univer-sheet-main-canvas"]').first()
  await lockedGrid.hover({ position: { x: 300, y: 300 } })
  for (let i = 0; i < 15; i += 1) await page.mouse.wheel(0, 4_000)
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: resolve(shots, 'view-only-scrolled-vi-light.png') })
  await page.screenshot({ path: resolve(shots, 'view-only-vi-light.png') })
  expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
    csp: [],
    console: [],
    page: [],
    http: [],
  })
})

for (const [lang, theme] of [
  ['en', 'light'],
  ['vi', 'dark'],
] as const) {
  test(`too_large: the host gets a fatal too_large, the frame shows its state (${lang}, ${theme})`, async ({
    page,
  }) => {
    test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
    const problems = await watch(page)
    const frame = await openFrame(page, `lang=${lang}&theme=${theme}&open=/fixtures/Too-Large.xlsx`)
    await expect(frame.getByTestId('sheets-too-large')).toBeVisible({ timeout: 60_000 })
    const fatal = (await hostEvents(page)).filter(
      (e) => e.type === 'error' && (e.payload.error as { code?: string })?.code === 'too_large',
    )
    expect(fatal).toHaveLength(1)
    expect(fatal[0]!.payload.fatal).toBe(true)
    // the sizes the host needs for its one sentence (visual r2 S-07)
    const details = (fatal[0]!.payload.error as { details?: Record<string, number> }).details
    expect(details?.limitBytes).toBe(80 * 1024 * 1024)
    expect(details?.worksheetXmlBytes).toBeGreaterThan(80 * 1024 * 1024)
    await page.screenshot({ path: resolve(shots, `too-large-${lang}-${theme}.png`) })
    expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
      csp: [],
      console: [],
      page: [],
      http: [],
    })
  })
}

test('a blank new workbook opens and edits save (en, dark)', async ({ page }) => {
  test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
  const problems = await watch(page)
  // visual r2 S-09: Univer warned "Component UI_PLUGIN_SHEETS_MENU_ITEM_INPUT_COMPONENT already exists."
  const warnings: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text())
  })
  const frame = await openFrame(page, 'lang=en&theme=dark')
  await shown(frame)
  await page.waitForTimeout(1500) // the Enter wrapper installs by polling for the component
  expect(warnings.filter((w) => /already exists/.test(w))).toEqual([])
  await typeIntoGrid(page, frame, [{ cell: 'A1', text: 'hello' }])
  await page.keyboard.press('Control+s')
  await expect.poll(() => lastSaved(page), { timeout: 60_000 }).not.toBeNull()
  expect(await savedSheetXml(page)).toContain('hello')
  await page.screenshot({ path: resolve(shots, 'blank-en-dark.png') })
  expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
    csp: [],
    console: [],
    page: [],
    http: [],
  })
})

// UNI-1232 (item 6): at 390 px the grid keeps the width, the ribbon tabs scroll sideways with an
// edge fade as the cue and no header control is clipped by the frame edge
test('390 px: grid usable, ribbon tabs scroll with a cue, no clipped header controls', async ({
  page,
}) => {
  test.skip(!built(), 'no dist-web/sheets build: npm run build:web -- --module sheets')
  await page.setViewportSize({ width: 390, height: 844 })
  const problems = await watch(page)
  const frame = await openFrame(page, 'lang=en&theme=light')
  await shown(frame)
  const scroll = frame.locator('.ribbon-tab-scroll')
  await expect(scroll).toHaveAttribute('data-fade-end', /.*/)
  const m = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  expect(m.sw).toBeGreaterThan(m.cw)
  // the status message does not squeeze the tabs: at least two tab buttons' worth stays visible
  expect(m.cw).toBeGreaterThan(150)
  // the row scrolls: the last tab can be reached and the cue flips to the start edge
  await scroll.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  await expect(scroll).toHaveAttribute('data-fade-start', /.*/)
  await scroll.evaluate((el) => (el.scrollLeft = 0))
  // every quick-access control sits fully inside the frame
  const buttons = frame.locator('.ribbon-tabs > .qa-btn')
  for (let i = 0; i < (await buttons.count()); i += 1) {
    const box = (await buttons.nth(i).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  }
  // the grid keeps (nearly) the whole width and the page never scrolls sideways
  const grid = (await frame
    .locator('canvas[id^="univer-sheet-main-canvas"]')
    .first()
    .boundingBox())!
  expect(grid.width).toBeGreaterThan(300)
  expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'blank-390-en-light.png') })
  expect({ csp: await cspViolations(page, frame), ...problems }).toEqual({
    csp: [],
    console: [],
    page: [],
    http: [],
  })
})
