// §6.3 (b) evidence on the WEB formula engine (G6-12, UNI-1366 WS1c): does the xlsx-sidecar wasm
// reactor (IronCalc, the engine behind the web frame's recalc_cells) execute WEBSERVICE /
// FILTERXML, and can a formula open a network connection? The desktop twin is
// apps/sheets/tests/g6-12-webservice-engine.test.ts (Univer). Loads the real module the way
// engine/wasm-transport.test.ts does (Node + browser WASI shim, the same EngineHost the frame
// Worker runs), with every network entry point recorded. Skipped when the module is not built
// (node apps/sheets/native/xlsx-engine/wasm/build-wasm.mjs).
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EngineHost } from './engine/host'

const repoRoot = resolve(__dirname, '../../..')
const WASM = resolve(repoRoot, 'apps/sheets/native/xlsx-engine/wasm/dist/xlsx-sidecar.wasm')
const wasmAvailable = existsSync(WASM)

// 0-based rows on the "Data" sheet, below its one value
const FORMULAS: [row: number, formula: string, expected: string, isError: boolean][] = [
  [20, '=WEBSERVICE("https://example.invalid/rates?x=1")', '#NAME?', true],
  [21, '=FILTERXML("<r><v>42</v></r>","//v")', '#NAME?', true],
  [22, '=FILTERXML(WEBSERVICE("https://example.invalid/feed.xml"),"//v")', '#NAME?', true],
  [23, '=IFERROR(WEBSERVICE("https://example.invalid/y"),"no network")', 'no network', false],
  // control: the engine is live and evaluates ordinary formulas
  [24, '=SUM(1,2)&"-"&"ok"', '3-ok', false],
]

/** a one-sheet workbook IronCalc's strict importer accepts (every cell carries its r attribute) */
async function dataWorkbook(): Promise<Uint8Array> {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
  )
  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`,
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const network = {
  fetch: vi.fn(() => Promise.reject(new Error('network blocked by test'))),
  xhrOpen: vi.fn(),
  xhrSend: vi.fn(),
  webSocket: vi.fn(),
  beacon: vi.fn(() => false),
}

class RecordingXhr {
  open(...args: unknown[]): void {
    network.xhrOpen(...args)
  }
  send(...args: unknown[]): void {
    network.xhrSend(...args)
  }
  setRequestHeader(): void {}
  abort(): void {}
}

class RecordingWebSocket {
  constructor(...args: unknown[]) {
    network.webSocket(...args)
  }
  close(): void {}
}

interface RecalcCell {
  sheet: string
  row: number
  column: number
  formatted: string
  isError: boolean
  isFormula: boolean
}

describe.skipIf(!wasmAvailable)(
  'WEBSERVICE / FILTERXML on the web wasm engine (IronCalc recalc_cells)',
  { timeout: 60_000 },
  () => {
    const nodeNet = [
      vi.spyOn(http, 'request'),
      vi.spyOn(http, 'get'),
      vi.spyOn(https, 'request'),
      vi.spyOn(https, 'get'),
      vi.spyOn(net, 'connect'),
      vi.spyOn(net, 'createConnection'),
      vi.spyOn(tls, 'connect'),
    ]
    const module = wasmAvailable ? new WebAssembly.Module(readFileSync(WASM)) : (null as never)
    let cells: RecalcCell[] = []

    beforeAll(async () => {
      vi.stubGlobal('fetch', network.fetch)
      vi.stubGlobal('XMLHttpRequest', RecordingXhr)
      vi.stubGlobal('WebSocket', RecordingWebSocket)
      vi.stubGlobal('navigator', { ...globalThis.navigator, sendBeacon: network.beacon })
      const host = await EngineHost.create(module)
      const path = '/tmp/w/g6-12-webservice.xlsx'
      host.writeFile(path, await dataWorkbook())
      const response = JSON.parse(
        host.request(
          JSON.stringify({
            version: 1,
            requestId: 'ws1c',
            command: 'recalc_cells',
            path,
            edits: FORMULAS.map(([row, input]) => ({ sheet: 'Data', row, column: 0, input })),
            reads: [
              {
                sheet: 'Data',
                range: { startRow: 20, endRow: 24, startColumn: 0, endColumn: 0 },
              },
            ],
          }),
          'ws1c',
        ),
      ) as { ok: boolean; result?: { cells: RecalcCell[] }; error?: unknown }
      expect(response.error).toBeUndefined()
      expect(response.ok).toBe(true)
      cells = response.result!.cells
    })

    afterAll(() => {
      vi.unstubAllGlobals()
      for (const spy of nodeNet) spy.mockRestore()
    })

    it('the module imports nothing but WASI preview 1, with no socket calls', () => {
      const imports = WebAssembly.Module.imports(module)
      expect(new Set(imports.map((entry) => entry.module))).toEqual(
        new Set(['wasi_snapshot_preview1']),
      )
      expect(imports.filter((entry) => entry.name.startsWith('sock_'))).toEqual([])
    })

    it.each(FORMULAS)('row %i %s evaluates to %j', (row, _formula, expected, isError) => {
      const cell = cells.find((candidate) => candidate.row === row && candidate.column === 0)
      expect(cell).toBeDefined()
      expect(cell!.isFormula).toBe(true)
      expect(cell!.formatted).toBe(expected)
      expect(cell!.isError).toBe(isError)
    })

    it('never touches the network', () => {
      expect(network.fetch).not.toHaveBeenCalled()
      expect(network.xhrOpen).not.toHaveBeenCalled()
      expect(network.xhrSend).not.toHaveBeenCalled()
      expect(network.webSocket).not.toHaveBeenCalled()
      expect(network.beacon).not.toHaveBeenCalled()
      for (const spy of nodeNet) expect(spy).not.toHaveBeenCalled()
    })
  },
)
