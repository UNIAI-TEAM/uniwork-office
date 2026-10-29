// A cell picture reaches the saved workbook through the frame's save planner. save-plan.ts calls the
// gateway's planCellEditsToXlsx with positional arguments, so a request field nobody mapped is
// silently dropped from the web save (the picture is lost without an error).
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { WorkbookSaveRequest } from '../../../../apps/sheets/src/shared/desktop-api'
import { tableFilterState } from '../../../../apps/sheets/src/renderer/table-filter-state'
import { buildEditFixture } from '../../../../apps/sheets/tests/fixture-builder'
import type { ArchiveEntry } from '../../../../packages/xlsx-gateway/src/gateway/xlsx-package-io'
import { resolveSaveRequest, saveWorkbookBytes, type ArchiveEngine } from './save-plan'

/// 1x1 PNG; the save copies the bytes, so the payload only has to decode.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const request = (over: Record<string, unknown>): WorkbookSaveRequest =>
  ({
    sessionId: 'session-1',
    mode: 'save',
    edits: [],
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
    ...over,
  }) as unknown as WorkbookSaveRequest

/** the engine's archive operations over memory: only what saveWorkbookBytes asks for */
function memoryEngine(source: Uint8Array): {
  engine: ArchiveEngine
  files: Map<string, Uint8Array>
} {
  const files = new Map<string, Uint8Array>()
  let before: ArchiveEntry[] = []
  const engine: ArchiveEngine = {
    manifest: async () => {
      const zip = await JSZip.loadAsync(source)
      before = Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map((entry) => ({ name: entry.name, crc32: 1, compressedSize: 1, uncompressedSize: 1 }))
      return before
    },
    writeFile: async (path, data) => void files.set(path, data),
    readFile: async (path) => files.get(path) ?? new Uint8Array(),
    remove: async (path) => void files.delete(path),
    saveArchive: async ({ replacements, removals, additions }) => {
      const zip = await JSZip.loadAsync(source)
      for (const { name, contentPath } of [...replacements, ...additions]) {
        // Uint8Array.from: the encoder's arrays come from another realm than jsdom's, which JSZip rejects
        zip.file(name, Uint8Array.from(files.get(contentPath) ?? []))
      }
      for (const name of removals) zip.remove(name)
      files.set('/tmp/save/saved.xlsx', await zip.generateAsync({ type: 'uint8array' }))
      const after = Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map((entry) => {
          const kept = before.find((candidate) => candidate.name === entry.name)
          return kept ?? { name: entry.name, crc32: 2, compressedSize: 2, uncompressedSize: 2 }
        })
      return { beforeEntries: before, afterEntries: after }
    },
  }
  return { engine, files }
}

describe('save-plan: cell pictures', () => {
  it('maps cellImageAdditions to the sheet name the gateway expects', () => {
    const save = resolveSaveRequest(
      new Map([['sheet-1', 'Data']]),
      request({
        cellImageAdditions: [
          { sheetId: 'sheet-1', row: 1, column: 1, mediaType: 'image/png', base64: PNG_BASE64 },
        ],
      }),
    )
    expect(save.args.cellImageAdditions).toEqual([
      { sheetName: 'Data', row: 1, column: 1, mediaType: 'image/png', base64: PNG_BASE64 },
    ])
    // the field is optional on the wire (older renderers do not send it)
    expect(
      resolveSaveRequest(new Map([['sheet-1', 'Data']]), request({})).args.cellImageAdditions,
    ).toEqual([])
  })

  it('writes the media and the rich-value parts of a picture placed in a cell', async () => {
    const source = new Uint8Array(await buildEditFixture())
    const { engine, files } = memoryEngine(source)
    const { data, plan } = await saveWorkbookBytes({
      engine,
      sourcePath: '/work/Edit.xlsx',
      sourceBytes: source,
      workDir: '/tmp/save',
      save: resolveSaveRequest(
        new Map([['sheet-1', 'Data']]),
        request({
          cellImageAdditions: [
            { sheetId: 'sheet-1', row: 1, column: 1, mediaType: 'image/png', base64: PNG_BASE64 },
          ],
        }),
      ),
    })
    expect(files.size).toBe(0) // scratch files are cleaned up

    expect([...plan.addedBinary.keys()]).toEqual(['xl/media/image1.png'])
    for (const part of [
      'xl/metadata.xml',
      'xl/richData/rdrichvalue.xml',
      'xl/richData/rdrichvaluestructure.xml',
      'xl/richData/richValueRel.xml',
      'xl/richData/_rels/richValueRel.xml.rels',
    ]) {
      expect([...plan.added.keys()], part).toContain(part)
    }

    const saved = await JSZip.loadAsync(data)
    const media = await saved.file('xl/media/image1.png')!.async('uint8array')
    expect([...media]).toEqual([...Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0))])
    expect(await saved.file('xl/richData/_rels/richValueRel.xml.rels')!.async('text')).toContain(
      'Target="../media/image1.png"',
    )
    const sheet = await saved.file('xl/worksheets/sheet1.xml')!.async('text')
    expect(sheet).toMatch(/<c r="B2"[^>]* vm="1"/)
  })

  it('a request without a cell picture writes no rich-value parts', async () => {
    const source = new Uint8Array(await buildEditFixture())
    const { engine } = memoryEngine(source)
    const { plan } = await saveWorkbookBytes({
      engine,
      sourcePath: '/work/Edit.xlsx',
      sourceBytes: source,
      workDir: '/tmp/save',
      save: resolveSaveRequest(new Map([['sheet-1', 'Data']]), request({})),
    })
    expect([...plan.added.keys()].some((name) => name.startsWith('xl/richData/'))).toBe(false)
    expect(plan.addedBinary.size).toBe(0)
  })
})

/// A one-sheet workbook with an Excel table over A1:C4, the shape a ListObject filter is saved into.
async function tableFixture(): Promise<Uint8Array> {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}">` +
      `<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}" xmlns:r="${rel}"><sheetData>` +
      [1, 2, 3, 4]
        .map(
          (r) =>
            `<row r="${r}"><c r="A${r}"><v>${r}</v></c><c r="B${r}"><v>${r * 10}</v></c></row>`,
        )
        .join('') +
      `</sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`,
  )
  zip.file(
    'xl/worksheets/_rels/sheet1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${rel}/table" Target="../tables/table1.xml"/></Relationships>`,
  )
  zip.file(
    'xl/tables/table1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="${ns}" id="1" name="Table1" displayName="Table1" ref="A1:B4">` +
      `<autoFilter ref="A1:B4"/><tableColumns count="2"><tableColumn id="1" name="Key"/><tableColumn id="2" name="Value"/></tableColumns>` +
      `<tableStyleInfo name="TableStyleMedium2" showRowStripes="1"/></table>`,
  )
  return zip.generateAsync({ type: 'uint8array' })
}

describe('save-plan: table filters and x14 data validation', () => {
  it('a table filter and a cross-sheet list validation survive the web save', async () => {
    const source = await tableFixture()
    const { engine } = memoryEngine(source)
    const { data } = await saveWorkbookBytes({
      engine,
      sourcePath: '/work/Table.xlsx',
      sourceBytes: source,
      workDir: '/tmp/save',
      save: resolveSaveRequest(
        new Map([['sheet-1', 'Data']]),
        request({
          filterStates: [
            {
              sheetId: 'sheet-1',
              filter: {
                range: { startRow: 0, startColumn: 0, endRow: 3, endColumn: 1 },
                columns: [{ colId: 1, values: ['20'] }],
              },
              hiddenRows: [2, 3],
              visibilityRange: { startRow: 0, startColumn: 0, endRow: 3, endColumn: 1 },
            },
          ],
          dvStates: [
            {
              sheetId: 'sheet-1',
              rules: [
                {
                  ranges: [{ startRow: 0, endRow: 3, startColumn: 3, endColumn: 3 }],
                  rule: { type: 'list', formula1: '=Lists!$A$1:$A$5', showDropDown: true },
                },
              ],
            },
          ],
        }),
      ),
    })
    const saved = await JSZip.loadAsync(data)

    // The table part carries the filter; the worksheet keeps only row visibility.
    const table = await saved.file('xl/tables/table1.xml')!.async('text')
    expect(table).toContain(
      '<autoFilter ref="A1:B4"><filterColumn colId="1"><filters><filter val="20"/></filters></filterColumn></autoFilter>',
    )
    const sheet = await saved.file('xl/worksheets/sheet1.xml')!.async('text')
    expect(sheet).not.toContain('<autoFilter')
    expect(sheet).toContain('<row r="3" hidden="1"')

    // The cross-sheet list sits in Excel's x14 data-validation extension, not the legacy block.
    expect(sheet).toContain('<ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}"')
    expect(sheet).toContain('<x14:formula1><xm:f>Lists!$A$1:$A$5</xm:f></x14:formula1>')
    expect(sheet).toContain('<xm:sqref>D1:D4</xm:sqref>')
    expect(sheet).not.toContain('<dataValidations count=')
  })
})

describe('save-plan: a table filter edited from the header dropdown (SH-W4-V1)', () => {
  it('the snapshot the renderer builds from the table plugin lands in the table part', async () => {
    const source = await tableFixture()
    const { engine } = memoryEngine(source)
    // What collectFilterStates emits after Value >= 15 AND Value <= 35 on A1:B4.
    const filterState = tableFilterState('sheet-1', {
      id: 'file-table-sheet-1-0',
      range: { startRow: 0, startColumn: 0, endRow: 3, endColumn: 1 },
      columnFilters: [
        undefined,
        {
          filterType: 'condition',
          filterInfo: { conditionType: 'number', compareType: 'between', expectedValue: [15, 35] },
        } as never,
      ],
      filteredOutRows: [3],
    })
    const { data } = await saveWorkbookBytes({
      engine,
      sourcePath: '/work/Table.xlsx',
      sourceBytes: source,
      workDir: '/tmp/save',
      save: resolveSaveRequest(
        new Map([['sheet-1', 'Data']]),
        request({ filterStates: [filterState] }),
      ),
    })
    const saved = await JSZip.loadAsync(data)
    const table = await saved.file('xl/tables/table1.xml')!.async('text')
    expect(table).toContain(
      '<autoFilter ref="A1:B4"><filterColumn colId="1"><customFilters and="1">' +
        '<customFilter operator="greaterThanOrEqual" val="15"/>' +
        '<customFilter operator="lessThanOrEqual" val="35"/></customFilters></filterColumn></autoFilter>',
    )
    const sheet = await saved.file('xl/worksheets/sheet1.xml')!.async('text')
    expect(sheet).not.toContain('<autoFilter')
    expect(sheet).toContain('<row r="4" hidden="1"')
    expect(sheet).not.toContain('<row r="2" hidden="1"')
  })

  it('writes the first data row as hidden when the filter hides it (SH-W4-V8)', async () => {
    const source = await tableFixture()
    const { engine } = memoryEngine(source)
    // Value >= 25 hides the first data row (R2, 0-based row 1) and keeps R3, R4.
    const filterState = tableFilterState('sheet-1', {
      id: 'file-table-sheet-1-0',
      range: { startRow: 0, startColumn: 0, endRow: 3, endColumn: 1 },
      columnFilters: [
        undefined,
        {
          filterType: 'condition',
          filterInfo: {
            conditionType: 'number',
            compareType: 'greaterThanOrEqual',
            expectedValue: 25,
          },
        } as never,
      ],
      filteredOutRows: [1],
    })
    const { data } = await saveWorkbookBytes({
      engine,
      sourcePath: '/work/Table.xlsx',
      sourceBytes: source,
      workDir: '/tmp/save',
      save: resolveSaveRequest(
        new Map([['sheet-1', 'Data']]),
        request({ filterStates: [filterState] }),
      ),
    })
    const sheet = await (
      await JSZip.loadAsync(data)
    )
      .file('xl/worksheets/sheet1.xml')!
      .async('text')
    expect(sheet).toContain('<row r="2" hidden="1"')
    expect(sheet).not.toContain('<row r="1" hidden="1"')
    expect(sheet).not.toContain('<row r="3" hidden="1"')
  })
})

describe('save-plan: pivot Show Values As base field / item', () => {
  const value = {
    fieldIndex: 1,
    agg: 'sum',
    showDataAs: 'difference',
    baseFieldIndex: 0,
    baseItemIndex: 2,
  }
  const pivot = {
    sheetId: 'sheet-2',
    sourceSheetId: 'sheet-1',
    name: 'PivotTable1',
    values: [value],
  }

  it('keeps baseFieldIndex / baseItemIndex on a new pivot value field', () => {
    const save = resolveSaveRequest(
      new Map([
        ['sheet-1', 'Data'],
        ['sheet-2', 'Summary'],
      ]),
      request({ pivotAdditions: [pivot] }),
    )
    expect(save.args.pivotAdditions?.[0]?.values).toEqual([value])
  })

  it('keeps them on a refreshed pivot relayout', () => {
    const save = resolveSaveRequest(
      new Map([
        ['sheet-1', 'Data'],
        ['sheet-2', 'Summary'],
      ]),
      request({
        pivotRefreshUpdates: [
          {
            cachePath: 'xl/pivotCache/pivotCacheDefinition1.xml',
            sheetId: 'sheet-2',
            newOutputRef: 'A1:C9',
            relayout: pivot,
          },
        ],
      }),
    )
    expect(save.args.pivotRefreshUpdates?.[0]?.relayout?.values).toEqual([value])
  })
})
