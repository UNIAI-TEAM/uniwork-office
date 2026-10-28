// A cell picture reaches the saved workbook through the frame's save planner. save-plan.ts calls the
// gateway's planCellEditsToXlsx with positional arguments, so a request field nobody mapped is
// silently dropped from the web save (the picture is lost without an error).
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { WorkbookSaveRequest } from '../../../../apps/sheets/src/shared/desktop-api'
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

  it('forwards redactionStates (including previousFill) and writes the redaction part and mirror', async () => {
    const source = new Uint8Array(await buildEditFixture())
    const { engine } = memoryEngine(source)
    const states = [
      {
        sheetName: 'Data',
        marks: [
          {
            startRow: 1,
            endRow: 1,
            startColumn: 1,
            endColumn: 1,
            label: 'client phone',
            previousFill: '#FF0000',
          },
        ],
      },
    ]
    const save = resolveSaveRequest(
      new Map([['sheet-1', 'Data']]),
      request({ redactionStates: states }),
    )
    expect(save.args.redactionStates).toEqual(states)
    expect(
      resolveSaveRequest(new Map([['sheet-1', 'Data']]), request({})).args.redactionStates,
    ).toBeNull()

    const { data, plan } = await saveWorkbookBytes({
      engine,
      sourcePath: '/work/Edit.xlsx',
      sourceBytes: source,
      workDir: '/tmp/save',
      save,
    })
    expect([...plan.added.keys()]).toContain('xl/gxRedactions.json')
    const saved = await JSZip.loadAsync(data)
    const part = JSON.parse(await saved.file('xl/gxRedactions.json')!.async('text'))
    expect(part.sheets[0].marks[0]).toMatchObject({
      label: 'client phone',
      previousFill: '#FF0000',
    })
    const workbookXml = await saved.file('xl/workbook.xml')!.async('text')
    expect(workbookXml).toContain('_gxRedaction_1')
  })
})
