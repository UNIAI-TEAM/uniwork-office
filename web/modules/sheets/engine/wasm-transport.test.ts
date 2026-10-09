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
import { createDirectChannel, type EngineChannel, type EngineResponse } from './channel'
import { EngineHost } from './host'
import {
  MAX_WORKSHEET_XML_BYTES,
  SheetsTooLargeError,
  createWasmTransport,
  worksheetXmlBytes,
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
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
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
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E${rows}"/><sheetData>${cells.join('')}</sheetData></worksheet>`,
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

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

describe.skipIf(!hasWasm)('with the real wasm engine (Node + browser WASI shim)', () => {
  const module = hasWasm ? new WebAssembly.Module(readFileSync(WASM)) : (null as never)
  async function engine() {
    const host = await EngineHost.create(module)
    const transport = createWasmTransport({ connect: () => createDirectChannel(host) })
    return { host, transport }
  }

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
    expect(range.cells.map((c) => c.value)).toEqual(Array.from({ length: 10 }, (_, i) => 5_001 + i))
  })
})
