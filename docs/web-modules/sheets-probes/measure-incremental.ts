// GO-D3 / SH2 probe: first-viewport latency of the wasm engine with the incremental index.
// Runs the frame's own engine code (web/modules/sheets/engine: EngineHost + the WASM transport)
// in Node on @bjorn3/browser_wasi_shim, i.e. the runtime of results/o7-node-shim.json (before).
// Usage: tsx measure-incremental.ts <xlsx-sidecar.wasm> <out.json> <fixture.xlsx>...
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

import { createDirectChannel } from '../../../web/modules/sheets/engine/channel'
import { EngineHost } from '../../../web/modules/sheets/engine/host'
import { createWasmTransport } from '../../../web/modules/sheets/engine/wasm-transport'

const round = (ms: number): number => Math.round(ms * 10) / 10

async function measure(module: WebAssembly.Module, fixture: string) {
  const host = await EngineHost.create(module)
  const transport = createWasmTransport({
    connect: () => createDirectChannel(host),
    maxWorksheetXmlBytes: Number.MAX_SAFE_INTEGER,
  })
  const bytes = readFileSync(fixture)
  let t = performance.now()
  const wb = await transport.open({
    name: basename(fixture),
    data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    locale: 'en',
  })
  const openMs = round(performance.now() - t)
  const sheet = wb.sheets[0]!
  const lastCol = Math.min(49, sheet.columnCount - 1)
  t = performance.now()
  const first = await transport.readRange({
    sessionId: wb.sessionId,
    sheetId: sheet.id,
    range: { startRow: 0, endRow: 99, startColumn: 0, endColumn: lastCol },
  })
  const firstViewportMs = round(performance.now() - t)
  // the Worker runs these between requests; here back to back
  t = performance.now()
  let passes = 0
  const passMs: number[] = []
  for (;;) {
    const p = performance.now()
    const more = host.indexStep()
    passMs.push(round(performance.now() - p))
    passes += 1
    if (!more) break
  }
  const backgroundIndexMs = round(performance.now() - t)
  t = performance.now()
  const bottom = await transport.readRange({
    sessionId: wb.sessionId,
    sheetId: sheet.id,
    range: {
      startRow: sheet.rowCount - 100,
      endRow: sheet.rowCount - 1,
      startColumn: 0,
      endColumn: lastCol,
    },
  })
  const bottomViewportMs = round(performance.now() - t)
  return {
    fixture: basename(fixture),
    fileBytes: bytes.byteLength,
    rows: sheet.rowCount,
    openMs,
    firstViewportMs,
    firstViewportCells: first.cells.length,
    firstViewportIndexedThroughRow: first.indexedThroughRow,
    backgroundIndexMs,
    passes,
    longestPassMs: Math.max(...passMs),
    bottomViewportMs,
    bottomComplete: bottom.indexingComplete,
    wasmMemoryBytes: host.memoryBytes,
  }
}

async function main(): Promise<void> {
  const [wasm, out, ...fixtures] = process.argv.slice(2)
  if (!wasm || !out) throw new Error('usage: measure-incremental.ts <wasm> <out.json> <fixture>...')
  const module = new WebAssembly.Module(readFileSync(wasm))
  const results = []
  for (const fixture of fixtures) {
    results.push(await measure(module, fixture))
    process.stderr.write(`measured ${basename(fixture)}\n`)
  }
  writeFileSync(
    out,
    `${JSON.stringify({ runtime: `node ${process.version} + browser_wasi_shim`, results }, null, 2)}\n`,
  )
}

void main()
