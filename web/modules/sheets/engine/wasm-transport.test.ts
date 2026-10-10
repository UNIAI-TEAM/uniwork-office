// UNI-1016: the WASM engine transport. Two layers:
//  - with a mocked channel (no wasm): protocol mapping, the size gate, crash recovery;
//  - with the real xlsx-sidecar wasm reactor in Node on @bjorn3/browser_wasi_shim (the same
//    EngineHost the frame Worker runs): open -> read -> edit + formula -> save -> reopen, .xls,
//    the incremental index, session close. Skipped when the module is not built
//    (node apps/sheets/native/xlsx-engine/wasm/build-wasm.mjs).
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { WorkbookSaveRequest } from '../../../../apps/sheets/src/shared/desktop-api'
import { buildEditFixture } from '../../../../apps/sheets/tests/fixture-builder'
import { planRefresh, refreshFormulaValues } from './cached-values'
import { createDirectChannel, type EngineChannel, type EngineResponse } from './channel'
import { EngineHost } from './host'
import {
  MAX_WORKSHEET_XML_BYTES,
  SheetsTooLargeError,
  createWasmTransport,
  worksheetXmlBytes,
  type EngineRecovery,
} from './wasm-transport'

const repoRoot = resolve(__dirname, '../../../..')
const WASM = resolve(repoRoot, 'apps/sheets/native/xlsx-engine/wasm/dist/xlsx-sidecar.wasm')
const XLS = resolve(repoRoot, 'web/fixtures/legacy-xls.xls')
const hasWasm = existsSync(WASM)

const toArrayBuffer = (b: Uint8Array) =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

function saveRequest(
  sessionId: string,
  edits: Array<{
    sheetId: string
    row: number
    column: number
    value: string | number
    formula?: string
  }>,
): WorkbookSaveRequest {
  return {
    sessionId,
    mode: 'save',
    edits: edits.map((e) => ({ writeValue: true, ...e })),
    structuralOps: [],
    chartEdits: [],
    visualEdits: [],
    visualAdditions: [],
    tableAdditions: [],
    pivotAdditions: [],
    sheetOps: [],
    sheetOrder: [],
    filterStates: [],
    hyperlinkEdits: [],
    cfStates: [],
    dvStates: [],
    pageSetupStates: [],
    noteStates: [],
    pivotCacheRefreshPaths: [],
    pivotRefreshUpdates: [],
    sheetProtections: [],
    sparklineAdditions: [],
    formulaValues: [],
    definedNamesState: null,
    themeState: null,
    workbookProtectionState: null,
    protectedRangeStates: [],
  } as unknown as WorkbookSaveRequest
}

/** synthetic sheet: rows x 4 numbers + a formula column, like the GO-D3 probe generator */
async function syntheticWorkbook(rows: number): Promise<Uint8Array> {
  const cells: string[] = []
  for (let r = 1; r <= rows; r += 1) {
    cells.push(
      `<row r="${r}"><c r="A${r}"><v>${r}</v></c><c r="B${r}"><v>${r * 2}</v></c><c r="C${r}"><v>3</v></c>` +
        `<c r="D${r}"><v>4</v></c><c r="E${r}"><f>A${r}+B${r}</f><v>${r * 3}</v></c></row>`,
    )
  }
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  )
  zip.file(
    'xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E${rows}"/><sheetData>${cells.join('')}</sheetData></worksheet>`,
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

/** a two-sheet workbook whose formulas carry a cached value computed from A1 = 1 */
async function chainWorkbook(): Promise<Uint8Array> {
  const zip = new JSZip()
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Report" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  )
  zip.file(
    'xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  )
  // A1 = 1; B1 = A1*2 (2); D1 = A1+100 (101); E1 = TEXT-free constant-independent formula (7)
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>A1*2</f><v>2</v></c><c r="D1"><f>A1+100</f><v>101</v></c><c r="E1"><f>3+4</f><v>7</v></c></row></sheetData></worksheet>`,
  )
  // Report!C1 = Data!B1 + 1 (3): depends on A1 through another formula on another sheet
  zip.file(
    'xl/worksheets/sheet2.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetData><row r="1"><c r="C1"><f>Data!B1+1</f><v>3</v></c><c r="D1" t="str"><f>"x"&amp;Data!B1</f><v>x2</v></c></row></sheetData></worksheet>`,
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('refresh plan (SH3, A2)', () => {
  const names = new Map([
    ['sheet-1', 'Data'],
    ['sheet-2', 'Report'],
  ])
  const fileFormulas = new Map([
    ['Data', [{ row: 0, column: 1 }]],
    ['Report', [{ row: 0, column: 2 }]],
  ])
  const edit = (over: Record<string, unknown>) => ({
    sheetId: 'sheet-1',
    row: 0,
    column: 0,
    writeValue: true,
    value: 1,
    ...over,
  })
  const request = (edits: unknown[], over: Record<string, unknown> = {}) =>
    ({
      ...saveRequest('s', []),
      edits,
      ...over,
    }) as unknown as WorkbookSaveRequest

  it('sends every pending edit as input and reads every formula cell of the file plus the typed ones', () => {
    const plan = planRefresh(
      request([
        edit({ row: 1, column: 1, value: 0, formula: '=SUM(A1:A3)' }),
        edit({ row: 2, column: 0, value: '=not a formula' }),
        edit({ row: 3, column: 0, writeValue: false, value: null }),
        edit({ row: 4, column: 0, value: true }),
      ]),
      names,
      1000,
      fileFormulas,
    )
    expect(plan?.edits).toEqual([
      { sheet: 'Data', row: 1, column: 1, input: '=SUM(A1:A3)' },
      { sheet: 'Data', row: 2, column: 0, input: "'=not a formula" },
      { sheet: 'Data', row: 4, column: 0, input: 'TRUE' },
    ])
    expect(plan?.targets).toEqual([
      { sheet: 'Data', row: 1, column: 1 },
      { sheet: 'Data', row: 0, column: 1 },
      { sheet: 'Report', row: 0, column: 2 },
    ])
    expect(plan?.edited).toEqual(new Set(['Data\u00001:1']))
  })

  it('a value edit alone still reads the dependents (nothing typed, formulas elsewhere)', () => {
    const plan = planRefresh(request([edit({})]), names, 10, fileFormulas)
    expect(plan?.targets).toHaveLength(2)
  })

  it('splits the reads into engine calls of at most 20 000 cells', () => {
    const many = new Map([
      ['Data', Array.from({ length: 45_000 }, (_, row) => ({ row, column: 1 }))],
    ])
    const plan = planRefresh(request([edit({})]), names, 10, many)
    expect(plan?.batches.map((batch) => batch.length)).toEqual([20_000, 20_000, 5_000])
  })

  it('returns null where the engine cannot answer for the saved file', () => {
    const none = new Map<string, { row: number; column: number }[]>()
    expect(
      planRefresh(
        request([edit({})], { structuralOps: [{ kind: 'insert-rows' }] }),
        names,
        10,
        none,
      ),
    ).toBeNull()
    expect(
      planRefresh(request([edit({})], { sheetOps: [{ kind: 'add-sheet' }] }), names, 10, none),
    ).toBeNull()
    // a sheet added this session has no file part
    expect(planRefresh(request([edit({ sheetId: 'new' })]), names, 10, none)).toBeNull()
    // too big for a cold IronCalc import
    expect(planRefresh(request([edit({})]), names, 65 * 1024 * 1024, none)).toBeNull()
    // more edits than one recalc takes
    expect(
      planRefresh(
        request(Array.from({ length: 10_001 }, (_, row) => edit({ row }))),
        names,
        10,
        none,
      ),
    ).toBeNull()
    // bulk fills and pivots are not replayed by the engine
    expect(
      planRefresh(request([edit({})], { bulkConstantFills: [{}] }), names, 10, none),
    ).toBeNull()
    expect(planRefresh(request([edit({})], { definedNamesState: {} }), names, 10, none)).toBeNull()
    // more formulas than one save refreshes
    const huge = new Map([
      ['Data', Array.from({ length: 200_001 }, (_, row) => ({ row, column: 1 }))],
    ])
    expect(planRefresh(request([edit({})]), names, 10, huge)).toBeNull()
  })

  it('maps results to formula values; an untrusted error or a missing answer drops the cache', () => {
    const cell = (over: Record<string, unknown>) => ({
      sheet: 'Data',
      row: 0,
      column: 0,
      formatted: '',
      isFormula: true,
      ...over,
    })
    const plan = {
      edited: new Set(['Data\u00001:0']),
      targets: [0, 1, 2, 3, 4, 5, 6].map((row) => ({ sheet: 'Data', row, column: 0 })),
    }
    expect(
      refreshFormulaValues(
        plan,
        [
          cell({ formatted: '55', number: 55 }),
          cell({ row: 1, formatted: '#DIV/0!', isError: true }),
          cell({ row: 2, formatted: '#NAME?', isError: true }),
          cell({ row: 3, formatted: '#ERROR!', isError: true }),
          cell({ row: 4, formatted: 'abc' }),
          cell({ row: 5, formatted: '7', number: 7, isFormula: false }),
          // row 6: no answer at all
        ],
        names,
      ),
    ).toEqual([
      { sheetId: 'sheet-1', row: 0, column: 0, value: 55 },
      // typed by the user: its error is real
      { sheetId: 'sheet-1', row: 1, column: 0, value: { error: '#DIV/0!' } },
      // untouched formula: IronCalc's error is not trusted (no cached value, Excel recomputes)
      { sheetId: 'sheet-1', row: 2, column: 0, value: null },
      { sheetId: 'sheet-1', row: 3, column: 0, value: null },
      { sheetId: 'sheet-1', row: 4, column: 0, value: 'abc' },
      { sheetId: 'sheet-1', row: 5, column: 0, value: null },
      { sheetId: 'sheet-1', row: 6, column: 0, value: null },
    ])
  })
})

describe('size gate', () => {
  it('sums only the uncompressed worksheet parts', () => {
    expect(
      worksheetXmlBytes([
        { name: 'xl/worksheets/sheet1.xml', uncompressedSize: 10, compressedSize: 1, crc32: 0 },
        { name: 'xl/worksheets/sheet2.xml', uncompressedSize: 5, compressedSize: 1, crc32: 0 },
        {
          name: 'xl/worksheets/_rels/sheet1.xml.rels',
          uncompressedSize: 99,
          compressedSize: 1,
          crc32: 0,
        },
        { name: 'xl/sharedStrings.xml', uncompressedSize: 99, compressedSize: 1, crc32: 0 },
      ]),
    ).toBe(15)
    expect(MAX_WORKSHEET_XML_BYTES).toBe(80 * 1024 * 1024)
  })
})

describe('with a mocked engine channel', () => {
  function mockChannel(
    answers: Record<string, (payload: Record<string, unknown>) => EngineResponse>,
  ) {
    const calls: Array<{ command: string; payload: Record<string, unknown> }> = []
    const files = new Map<string, ArrayBuffer>()
    const channel: EngineChannel = {
      async request(line) {
        const { command, version: _v, requestId: _r, ...payload } = JSON.parse(line)
        calls.push({ command, payload })
        const answer = answers[command]
        if (!answer) throw new Error(`unexpected ${command}`)
        return answer(payload)
      },
      writeFile: async (path, data) => void files.set(path, data),
      readFile: async (path) => files.get(path) ?? new ArrayBuffer(0),
      remove: async (path) => void files.delete(path),
      stats: async () => ({ memoryBytes: 0, stderr: [] }),
      dispose: () => {},
    }
    return { channel, calls, files }
  }

  it('refuses a workbook above the worksheet XML gate with too_large, before opening it', async () => {
    const m = mockChannel({
      archive_manifest: () => ({
        ok: true,
        result: {
          entries: [
            {
              name: 'xl/worksheets/sheet1.xml',
              uncompressedSize: 81 * 1024 * 1024,
              compressedSize: 1,
              crc32: 0,
            },
          ],
        },
      }),
    })
    const transport = createWasmTransport({ connect: () => m.channel })
    const err = await transport
      .open({ name: 'Big.xlsx', data: new ArrayBuffer(8), locale: 'en' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SheetsTooLargeError)
    expect((err as SheetsTooLargeError).code).toBe('too_large')
    expect((err as SheetsTooLargeError).worksheetXmlBytes).toBe(81 * 1024 * 1024)
    expect((err as SheetsTooLargeError).limitBytes).toBe(80 * 1024 * 1024)
    expect(m.calls.map((c) => c.command)).toEqual(['archive_manifest'])
    // the staged bytes are cleaned up
    expect(m.files.size).toBe(0)
  })

  it('an engine crash drops every session and reconnects on the next call', async () => {
    let connects = 0
    const crashing: EngineChannel = {
      request: async () => {
        throw Object.assign(new Error('engine_crashed: unreachable'), { code: 'engine_crashed' })
      },
      writeFile: async () => {},
      readFile: async () => new ArrayBuffer(0),
      remove: async () => {},
      stats: async () => ({ memoryBytes: 0, stderr: [] }),
      dispose: () => {},
    }
    const transport = createWasmTransport({
      connect: () => {
        connects += 1
        return crashing
      },
    })
    await expect(
      transport.open({ name: 'a.xlsx', data: new ArrayBuffer(4), locale: 'en' }),
    ).rejects.toThrow(/engine_crashed/)
    await expect(
      transport.open({ name: 'a.xlsx', data: new ArrayBuffer(4), locale: 'en' }),
    ).rejects.toThrow()
    expect(connects).toBe(2)
  })

  it('features: .xls and pivot on, recalc fallback off (C11)', () => {
    const transport = createWasmTransport({ connect: () => mockChannel({}).channel })
    expect(transport.kind).toBe('wasm')
    expect(transport.features).toEqual({
      xlsImport: true,
      pivotRefresh: true,
      recalcFallback: false,
    })
  })
})

// The real engine tests build and recalculate 20k-row workbooks (about 2.4 s alone, over the 5 s
// default once the machine is busy: a suite run next to other jobs), so they get a generous timeout.
describe.skipIf(!hasWasm)(
  'with the real wasm engine (Node + browser WASI shim)',
  { timeout: 60_000 },
  () => {
    const module = hasWasm ? new WebAssembly.Module(readFileSync(WASM)) : (null as never)
    async function engine() {
      const host = await EngineHost.create(module)
      const transport = createWasmTransport({ connect: () => createDirectChannel(host) })
      return { host, transport }
    }

    it('a save with nothing to write (restored draft write-back, Save As) still writes the workbook', async () => {
      const { transport } = await engine()
      const source = new Uint8Array(await buildEditFixture())
      const wb = await transport.open({
        name: 'Edit.xlsx',
        data: toArrayBuffer(source),
        locale: 'en',
      })
      // the draft: what a save with an edit would write
      const draft = await transport.serialize(
        saveRequest(wb.sessionId, [
          { sheetId: wb.sheets[0]!.id, row: 0, column: 0, value: 'Mark' },
        ]),
      )
      const restored = await transport.open({ name: 'Edit.xlsx', data: draft.data, locale: 'en' })
      const request = { ...saveRequest(restored.sessionId, []), restoreWriteBack: true }
      const saved = await transport.serialize(request as WorkbookSaveRequest)
      const xml = await (
        await JSZip.loadAsync(saved.data)
      )
        .file('xl/worksheets/sheet1.xml')!
        .async('text')
      expect(xml).toContain('Mark')
    })

    it('open -> read -> edit a value and a formula -> save -> the reopened bytes carry both', async () => {
      const { transport } = await engine()
      const source = new Uint8Array(await buildEditFixture())
      const wb = await transport.open({
        name: 'Edit.xlsx',
        data: toArrayBuffer(source),
        locale: 'en',
      })
      expect(wb.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(wb.fileBytes).toBe(source.byteLength)
      const sheet = wb.sheets[0]!
      const first = await transport.readRange({
        sessionId: wb.sessionId,
        sheetId: sheet.id,
        range: {
          startRow: 0,
          endRow: sheet.rowCount - 1,
          startColumn: 0,
          endColumn: sheet.columnCount - 1,
        },
      })
      expect(first.cells.length).toBeGreaterThan(0)
      const formulas = await transport.readFormulaCells({
        sessionId: wb.sessionId,
        sheetId: sheet.id,
      })
      expect(formulas.cells.length).toBeGreaterThan(0)

      const saved = await transport.serialize(
        saveRequest(wb.sessionId, [
          { sheetId: sheet.id, row: 0, column: 2, value: 4242 },
          { sheetId: sheet.id, row: 2, column: 1, value: 0, formula: '=C1*2' },
        ]),
      )
      expect(saved.touchedEntries).toContain('xl/worksheets/sheet1.xml')
      const xml = await (
        await JSZip.loadAsync(saved.data)
      )
        .file('xl/worksheets/sheet1.xml')!
        .async('text')
      expect(xml).toContain('<v>4242</v>')
      expect(xml).toMatch(/<f>C1\*2<\/f>/)
      // untouched parts are carried over byte-for-byte
      const marker = await (
        await JSZip.loadAsync(saved.data)
      )
        .file('customXml/item1.xml')!
        .async('text')
      expect(marker).toContain('must-survive')

      const swapped = await transport.replaceSession({
        sessionId: wb.sessionId,
        name: 'Edit.xlsx',
        data: saved.data.slice(0),
        locale: 'en',
      })
      expect(swapped.sessionId).not.toBe(wb.sessionId)
      const reread = await transport.readRange({
        sessionId: swapped.sessionId,
        sheetId: sheet.id,
        range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 },
      })
      expect(reread.cells.find((c) => c.row === 0 && c.column === 2)?.value).toBe(4242)
      expect(reread.cells.find((c) => c.row === 2 && c.column === 1)?.formula).toBe('=C1*2')
      // the old session is gone, the new one closes cleanly (shim directory-removal fix)
      await expect(
        transport.readRange({
          sessionId: wb.sessionId,
          sheetId: sheet.id,
          range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
        }),
      ).rejects.toThrow(/Unknown workbook session/)
      await expect(transport.close(swapped.sessionId)).resolves.toBeUndefined()
    })

    it.skipIf(!existsSync(XLS))(
      'opens a legacy .xls through convert_workbook (needs Save As)',
      async () => {
        const { transport } = await engine()
        const wb = await transport.open({
          name: 'Simple.xls',
          data: toArrayBuffer(readFileSync(XLS)),
          locale: 'en',
        })
        expect(wb.needsSaveAs).toBe(true)
        const range = await transport.readRange({
          sessionId: wb.sessionId,
          sheetId: wb.sheets[0]!.id,
          range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
        })
        expect(range.cells[0]?.value).toBe('replaceMe')
      },
    )

    it('the first viewport needs only its own chunk; background passes finish the index', async () => {
      const { host, transport } = await engine()
      const rows = 20_000
      const wb = await transport.open({
        name: 'Big.xlsx',
        data: toArrayBuffer(await syntheticWorkbook(rows)),
        locale: 'en',
      })
      const sheetId = wb.sheets[0]!.id
      const first = await transport.readRange({
        sessionId: wb.sessionId,
        sheetId,
        range: { startRow: 0, endRow: 99, startColumn: 0, endColumn: 4 },
      })
      expect(first.cells).toHaveLength(500)
      expect(first.indexingComplete).toBe(false)
      expect(first.indexedThroughRow).toBeLessThan(rows - 1)
      let passes = 0
      while (host.indexStep()) passes += 1
      expect(passes).toBeGreaterThan(0)
      const last = await transport.readRange({
        sessionId: wb.sessionId,
        sheetId,
        range: { startRow: rows - 10, endRow: rows - 1, startColumn: 0, endColumn: 4 },
      })
      expect(last.indexingComplete).toBe(true)
      expect(last.cells).toHaveLength(50)
      const formulas = await transport.readFormulaCells({ sessionId: wb.sessionId, sheetId })
      // every formula exactly once (resumed passes skip the chunks they already flushed)
      expect(formulas.cells).toHaveLength(rows)
      expect(new Set(formulas.cells.map((c) => c.row)).size).toBe(rows)
    })

    it('a read far down the sheet indexes through it without the background steps', async () => {
      const { transport } = await engine()
      const rows = 6_000
      const wb = await transport.open({
        name: 'Mid.xlsx',
        data: toArrayBuffer(await syntheticWorkbook(rows)),
        locale: 'en',
      })
      const range = await transport.readRange({
        sessionId: wb.sessionId,
        sheetId: wb.sheets[0]!.id,
        range: { startRow: 5_000, endRow: 5_009, startColumn: 0, endColumn: 0 },
      })
      expect(range.cells.map((c) => c.value)).toEqual(
        Array.from({ length: 10 }, (_, i) => 5_001 + i),
      )
    })

    it('SH3: a formula typed far down a 20k-row workbook is saved with its cached value', async () => {
      const { transport } = await engine()
      const rows = 20_000
      const wb = await transport.open({
        name: 'Big.xlsx',
        data: toArrayBuffer(await syntheticWorkbook(rows)),
        locale: 'en',
      })
      const sheetId = wb.sheets[0]!.id
      const saved = await transport.serialize(
        saveRequest(wb.sessionId, [
          // A1:A10 = 1..10, then the typed formula far below (column G)
          { sheetId, row: 19_989, column: 6, value: 0, formula: '=SUM(A1:A10)' },
          // a pending value edit the formula depends on goes in with it
          { sheetId, row: 0, column: 0, value: 101 },
          { sheetId, row: 19_990, column: 6, value: 0, formula: '=A1+1' },
        ]),
      )
      const xml = await (
        await JSZip.loadAsync(saved.data)
      )
        .file('xl/worksheets/sheet1.xml')!
        .async('text')
      // A1 = 101 now: 101 + 2..10 = 155
      expect(xml).toMatch(/<c r="G19990"[^>]*><f>SUM\(A1:A10\)<\/f><v>155<\/v>/)
      expect(xml).toMatch(/<c r="G19991"[^>]*><f>A1\+1<\/f><v>102<\/v>/)

      const reopened = await transport.replaceSession({
        sessionId: wb.sessionId,
        name: 'Big.xlsx',
        data: saved.data.slice(0),
        locale: 'en',
      })
      const read = await transport.readRange({
        sessionId: reopened.sessionId,
        sheetId,
        range: { startRow: 19_989, endRow: 19_990, startColumn: 6, endColumn: 6 },
      })
      expect(read.cells.map((c) => [c.row, c.value, c.formula])).toEqual([
        [19_989, 155, '=SUM(A1:A10)'],
        [19_990, 102, '=A1+1'],
      ])
    })

    describe('no stale cached values on save (A2)', () => {
      async function openChain() {
        const { transport } = await engine()
        const wb = await transport.open({
          name: 'Chain.xlsx',
          data: toArrayBuffer(await chainWorkbook()),
          locale: 'en',
        })
        const data = wb.sheets.find((sheet) => sheet.name === 'Data')!.id
        const report = wb.sheets.find((sheet) => sheet.name === 'Report')!.id
        return { transport, wb, data, report }
      }
      const sheetParts = async (bytes: ArrayBuffer) => {
        const zip = await JSZip.loadAsync(bytes)
        return {
          data: await zip.file('xl/worksheets/sheet1.xml')!.async('text'),
          report: await zip.file('xl/worksheets/sheet2.xml')!.async('text'),
          workbook: await zip.file('xl/workbook.xml')!.async('text'),
        }
      }
      /** every formula cell of the part: `<f>` still there, `<v>` gone */
      const noCachedValues = (xml: string) => {
        const cells = [...xml.matchAll(/<c\b[^>]*>(?:(?!<\/c>)[\s\S])*?<f[\s>][\s\S]*?<\/c>/g)]
        expect(cells.length).toBeGreaterThan(0)
        for (const cell of cells) expect(cell[0]).not.toMatch(/<v[\s>]/)
      }

      it('a dependency chain: A1 edited, B1 = A1*2, Report!C1 = Data!B1+1 are saved with the new results', async () => {
        const { transport, wb, data } = await openChain()
        const saved = await transport.serialize(
          saveRequest(wb.sessionId, [{ sheetId: data, row: 0, column: 0, value: 10 }]),
        )
        const parts = await sheetParts(saved.data)
        expect(parts.data).toMatch(/<c r="A1"[^>]*><v>10<\/v>/)
        expect(parts.data).toMatch(/<c r="B1"[^>]*><f>A1\*2<\/f><v>20<\/v>/)
        expect(parts.data).toMatch(/<c r="D1"[^>]*><f>A1\+100<\/f><v>110<\/v>/)
        // a formula that depends on nothing edited keeps its (recomputed) result
        expect(parts.data).toMatch(/<c r="E1"[^>]*><f>3\+4<\/f><v>7<\/v>/)
        // another sheet, two hops from the edit
        expect(parts.report).toMatch(/<c r="C1"[^>]*><f>Data!B1\+1<\/f><v>21<\/v>/)
        expect(parts.report).toMatch(/<c r="D1" t="str"[^>]*><f>[^<]*<\/f><v>x20<\/v>/)
        // Excel and the desktop recalculate on open as well
        expect(parts.workbook).toContain('fullCalcOnLoad="1"')
      })

      it('a save that cannot change a value leaves every cached value alone', async () => {
        const { transport, wb, data } = await openChain()
        const request = {
          ...saveRequest(wb.sessionId, []),
          sheetOps: [{ kind: 'set-sheet-tab-color', sheetId: data, color: '#ff0000' }],
        }
        const saved = await transport.serialize(request as unknown as WorkbookSaveRequest)
        const parts = await sheetParts(saved.data)
        expect(parts.data).toMatch(/<c r="B1"[^>]*><f>A1\*2<\/f><v>2<\/v>/)
        expect(parts.report).toMatch(/<c r="C1"[^>]*><f>Data!B1\+1<\/f><v>3<\/v>/)
      })

      it('a structural change pending: no formula keeps a cached value (the engine cannot replay it)', async () => {
        const { transport, wb, data } = await openChain()
        const request = {
          ...saveRequest(wb.sessionId, [{ sheetId: data, row: 0, column: 0, value: 10 }]),
          structuralOps: [{ sheetId: data, kind: 'insert-rows', index: 5, count: 1 }],
        }
        const saved = await transport.serialize(request as unknown as WorkbookSaveRequest)
        const parts = await sheetParts(saved.data)
        noCachedValues(parts.data)
        noCachedValues(parts.report)
        // the formulas themselves and the edited constant survive
        expect(parts.data).toContain('<f>A1*2</f>')
        expect(parts.report).toContain('<f>Data!B1+1</f>')
        expect(parts.data).toMatch(/<c r="A1"[^>]*><v>10<\/v>/)
      })

      it('a sheet added this session: no formula keeps a cached value', async () => {
        const { transport, wb, data } = await openChain()
        const request = {
          ...saveRequest(wb.sessionId, [{ sheetId: 'added-1', row: 0, column: 0, value: 5 }]),
          sheetOps: [{ kind: 'add-sheet', sheetId: 'added-1', name: 'Extra' }],
          sheetOrder: [...wb.sheets.map((sheet) => sheet.id), 'added-1'],
        }
        void data
        const saved = await transport.serialize(request as unknown as WorkbookSaveRequest)
        const parts = await sheetParts(saved.data)
        noCachedValues(parts.data)
        noCachedValues(parts.report)
      })

      it('more edits than one recalc takes (10 001): no formula keeps a cached value', async () => {
        const { transport, wb, data } = await openChain()
        const edits = Array.from({ length: 10_001 }, (_, i) => ({
          sheetId: data,
          row: 10 + i,
          column: 8,
          value: i,
        }))
        const saved = await transport.serialize(saveRequest(wb.sessionId, edits))
        const parts = await sheetParts(saved.data)
        noCachedValues(parts.data)
        noCachedValues(parts.report)
      })
    })

    describe('crash recovery (SH3, injected panics)', () => {
      /** a transport over fresh engines; `arm` makes the next matching command panic */
      async function faulty(opts: { crashOpenAfterFirstConnect?: boolean } = {}) {
        const hosts = await Promise.all([1, 2, 3].map(() => EngineHost.create(module)))
        let connects = 0
        let armed: string | null = null
        const seen: string[] = []
        const recoveries: EngineRecovery[] = []
        const transport = createWasmTransport({
          onRecovered: (r) => recoveries.push(r),
          connect: () => {
            const index = connects++
            const inner = createDirectChannel(hosts[index]!)
            return {
              ...inner,
              request: async (line, requestId) => {
                const command = JSON.parse(line).command as string
                seen.push(`${index}:${command}`)
                if (
                  armed === command ||
                  (opts.crashOpenAfterFirstConnect && index > 0 && command === 'open')
                ) {
                  armed = null
                  throw Object.assign(new Error('engine_crashed: injected panic'), {
                    code: 'engine_crashed',
                  })
                }
                return inner.request(line, requestId)
              },
            } satisfies EngineChannel
          },
        })
        return {
          transport,
          recoveries,
          seen,
          connects: () => connects,
          arm: (command: string) => {
            armed = command
          },
        }
      }

      it('a panic in a read reconnects, reopens the workbook from its saved bytes and repeats the read', async () => {
        const t = await faulty()
        const wb = await t.transport.open({
          name: 'Edit.xlsx',
          data: toArrayBuffer(new Uint8Array(await buildEditFixture())),
          locale: 'en',
        })
        const sheet = wb.sheets[0]!
        const range = { startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 }
        const before = await t.transport.readRange({
          sessionId: wb.sessionId,
          sheetId: sheet.id,
          range,
        })
        t.arm('read_range')
        const after = await t.transport.readRange({
          sessionId: wb.sessionId,
          sheetId: sheet.id,
          range,
        })
        expect(after.cells).toEqual(before.cells)
        expect(t.connects()).toBe(2)
        expect(t.recoveries).toEqual([
          { type: 'engine-recovered', command: 'read_range', sessions: 1, reopened: 1 },
        ])

        // the renderer keeps its session id and its unsaved edits: the save lands on the reopened session
        const saved = await t.transport.serialize(
          saveRequest(wb.sessionId, [{ sheetId: sheet.id, row: 0, column: 2, value: 4242 }]),
        )
        const xml = await (
          await JSZip.loadAsync(saved.data)
        )
          .file('xl/worksheets/sheet1.xml')!
          .async('text')
        expect(xml).toContain('<v>4242</v>')
        const swapped = await t.transport.replaceSession({
          sessionId: wb.sessionId,
          name: 'Edit.xlsx',
          data: saved.data.slice(0),
          locale: 'en',
        })
        await expect(t.transport.close(swapped.sessionId)).resolves.toBeUndefined()
      })

      it('a panic while saving: the session comes back, the failed save reports the crash, the next one works', async () => {
        const t = await faulty()
        const wb = await t.transport.open({
          name: 'Edit.xlsx',
          data: toArrayBuffer(new Uint8Array(await buildEditFixture())),
          locale: 'en',
        })
        const sheet = wb.sheets[0]!
        const request = saveRequest(wb.sessionId, [
          { sheetId: sheet.id, row: 0, column: 2, value: 7 },
        ])
        t.arm('save_archive')
        await expect(t.transport.serialize(request)).rejects.toThrow(/engine_crashed/)
        expect(t.recoveries).toHaveLength(1)
        expect(t.recoveries[0]).toMatchObject({ command: 'save_archive', sessions: 1, reopened: 1 })
        const saved = await t.transport.serialize(request)
        const xml = await (
          await JSZip.loadAsync(saved.data)
        )
          .file('xl/worksheets/sheet1.xml')!
          .async('text')
        expect(xml).toContain('<v>7</v>')
      })

      it('a panic in the cached-value recalc still saves the formulas, and that session never recalcs again', async () => {
        const t = await faulty()
        const wb = await t.transport.open({
          name: 'Edit.xlsx',
          data: toArrayBuffer(new Uint8Array(await buildEditFixture())),
          locale: 'en',
        })
        const sheet = wb.sheets[0]!
        const request = saveRequest(wb.sessionId, [
          { sheetId: sheet.id, row: 2, column: 1, value: 0, formula: '=C1*2' },
        ])
        t.arm('recalc_cells')
        const saved = await t.transport.serialize(request)
        const xml = await (
          await JSZip.loadAsync(saved.data)
        )
          .file('xl/worksheets/sheet1.xml')!
          .async('text')
        expect(xml).toMatch(/<f>C1\*2<\/f>/)
        expect(t.recoveries).toHaveLength(1)
        expect(t.recoveries[0]).toMatchObject({ command: 'recalc_cells', reopened: 1 })
        await t.transport.serialize(request)
        expect(t.seen.filter((c) => c.endsWith(':recalc_cells'))).toHaveLength(1)
      })

      it('A2: a panic in the recalc (strict importer) leaves no stale cached value in the saved file', async () => {
        const t = await faulty()
        const wb = await t.transport.open({
          name: 'Chain.xlsx',
          data: toArrayBuffer(await chainWorkbook()),
          locale: 'en',
        })
        const data = wb.sheets.find((sheet) => sheet.name === 'Data')!.id
        t.arm('recalc_cells')
        const saved = await t.transport.serialize(
          saveRequest(wb.sessionId, [{ sheetId: data, row: 0, column: 0, value: 10 }]),
        )
        const zip = await JSZip.loadAsync(saved.data)
        const sheet1 = await zip.file('xl/worksheets/sheet1.xml')!.async('text')
        const sheet2 = await zip.file('xl/worksheets/sheet2.xml')!.async('text')
        expect(sheet1).toContain('<f>A1*2</f>')
        expect(sheet2).toContain('<f>Data!B1+1</f>')
        expect(sheet1).not.toMatch(/<f>A1\*2<\/f><v>/)
        expect(sheet2).not.toMatch(/<f>Data!B1\+1<\/f><v>/)
      })

      it('a workbook that crashes the engine again on reopen is dropped (no loop)', async () => {
        const t = await faulty({ crashOpenAfterFirstConnect: true })
        const wb = await t.transport.open({
          name: 'Edit.xlsx',
          data: toArrayBuffer(new Uint8Array(await buildEditFixture())),
          locale: 'en',
        })
        t.arm('read_range')
        await expect(
          t.transport.readRange({
            sessionId: wb.sessionId,
            sheetId: wb.sheets[0]!.id,
            range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
          }),
        ).rejects.toThrow()
        expect(t.recoveries).toEqual([
          { type: 'engine-recovered', command: 'read_range', sessions: 1, reopened: 0 },
        ])
        await expect(
          t.transport.readRange({
            sessionId: wb.sessionId,
            sheetId: wb.sheets[0]!.id,
            range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
          }),
        ).rejects.toThrow(/Unknown workbook session/)
      })
    })
  },
)
