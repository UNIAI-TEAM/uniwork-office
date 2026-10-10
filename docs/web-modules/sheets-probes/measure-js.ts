// GO-D3 probe, pure-JS side: what the browser could do without the sidecar,
// using only @genoffice/xlsx-gateway (JSZip, no Node-only APIs on this path).
//  - readBasicWorkbook: whole-file parse into a cell snapshot (browser "open")
//  - applyCellEditsToXlsx: in-memory save (gateway planner + JSZip assemble)
// Run one fixture per process so maxRSS is per fixture.
// Usage: tsx measure-js.ts <fixture.xlsx> <edits>
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import {
  applyCellEditsToXlsx,
  readBasicWorkbook,
} from '../../../packages/xlsx-gateway/src/gateway/xlsx-gateway'

const round = (ms: number): number => Math.round(ms * 10) / 10

async function main(): Promise<void> {
  const [fixture, editsArg] = process.argv.slice(2)
  if (!fixture) throw new Error('usage: measure-js.ts <fixture.xlsx> <edits>')
  const editCount = Number(editsArg ?? 10)
  const buffer = await readFile(fixture)
  const report: Record<string, unknown> = { fixture: basename(fixture), fileBytes: buffer.length }

  let started = performance.now()
  const imported = await readBasicWorkbook(buffer)
  report.jsOpenMs = round(performance.now() - started)
  report.jsOpenCells = imported.snapshot.sheets.reduce(
    (sum, sheet) => sum + Object.keys(sheet.cells ?? {}).length,
    0,
  )
  report.rssAfterOpenKb = Math.round(process.memoryUsage().rss / 1024)

  // Same edit shape as measure-sidecar.ts: existing cells only, the first
  // `editCount` addresses (no row appends).
  const first = imported.snapshot.sheets[0]!
  const sheetName = first.name
  const existing: { row: number; column: number }[] = []
  for (const address of Object.keys(first.cells)) {
    if (existing.length >= editCount) break
    const letters = /^[A-Z]+/.exec(address)?.[0] ?? 'A'
    let column = 0
    for (const ch of letters) column = column * 26 + ch.charCodeAt(0) - 64
    existing.push({ row: Number(/\d+$/.exec(address)?.[0] ?? 1) - 1, column: column - 1 })
  }
  const edits = Array.from({ length: editCount }, (_, i) => ({
    sheetName,
    row: existing[i % existing.length]!.row,
    column: existing[i % existing.length]!.column,
    writeValue: true,
    cell: { value: i * 3 + 0.5 },
  }))
  started = performance.now()
  try {
    const mutation = await applyCellEditsToXlsx(buffer, edits)
    report.jsSaveMs = round(performance.now() - started)
    report.jsSaveOutputBytes = mutation.buffer.length
  } catch (error) {
    report.jsSaveError = String(error)
  }
  report.maxRssKb = process.resourceUsage().maxRSS
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

void main()
