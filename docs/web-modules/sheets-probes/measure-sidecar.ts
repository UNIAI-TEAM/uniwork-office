// GO-D3 probe: times every xlsx-sidecar command the Sheets app issues, on real
// fixtures, through the app's own XlsxSidecarClient and save pipeline.
// One fresh sidecar process per fixture, so VmHWM (peak RSS) is per fixture.
// Usage: tsx measure-sidecar.ts <sidecar-binary> <out.json> <fixture>... [--edits N] [--xls <file.xls>]
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { XlsxSidecarClient } from '../../../apps/sheets/src/main/xlsx-sidecar-client'
import {
  readArchiveEntryText,
  saveWorkbookViaSidecar,
} from '../../../packages/xlsx-gateway/src/gateway/xlsx-package-io'

interface OpenedSheet {
  id: string
  name: string
  rowCount: number
  columnCount: number
}
interface Opened {
  sessionId: string
  sheets: OpenedSheet[]
  visuals: { id: string; kind: string }[]
  entryCount: number
}
interface RangeResult {
  cells: unknown[]
  indexingComplete?: boolean
  indexedThroughRow?: number | null
}

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value ?? null))
const round = (ms: number): number => Math.round(ms * 10) / 10

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now()
  const value = await fn()
  return { ms: round(performance.now() - started), value }
}

async function peakRssKb(pid: number | null): Promise<number | null> {
  if (pid === null) return null
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8')
    const match = /VmHWM:\s+(\d+) kB/.exec(status)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

async function measureFixture(binary: string, fixture: string, editCount: number) {
  const client = new XlsxSidecarClient(binary)
  const work = await mkdtemp(join(tmpdir(), 'go-d3-probe-'))
  // The app opens a snapshot copy, never the live file.
  const snapshot = join(work, basename(fixture))
  await copyFile(fixture, snapshot)
  const report: Record<string, unknown> = {
    fixture: basename(fixture),
    fileBytes: (await stat(fixture)).size,
  }
  try {
    const coldOpen = await timed(() => client.open(snapshot, 'en') as Promise<Opened>)
    const opened = coldOpen.value
    report.open = { coldMsInclSpawn: coldOpen.ms, resultBytes: bytes(opened) }
    report.sheets = opened.sheets.map((s) => ({
      name: s.name,
      rows: s.rowCount,
      cols: s.columnCount,
    }))
    report.visuals = opened.visuals.length

    const warm = await timed(() => client.open(snapshot, 'en') as Promise<Opened>)
    report.open = { ...(report.open as object), warmMs: warm.ms }
    await client.close(warm.value.sessionId)

    const largest = opened.sheets.reduce((a, b) =>
      b.rowCount * b.columnCount > a.rowCount * a.columnCount ? b : a,
    )
    const viewport = {
      startRow: 0,
      endRow: Math.min(99, largest.rowCount - 1),
      startColumn: 0,
      endColumn: Math.min(49, largest.columnCount - 1),
    }
    const first = await timed(
      () =>
        client.readRange({
          sessionId: opened.sessionId,
          sheetId: largest.id,
          range: viewport,
        }) as Promise<RangeResult>,
    )
    report.readRangeFirstViewport = {
      ms: first.ms,
      cells: first.value.cells.length,
      resultBytes: bytes(first.value),
    }

    // Full index: poll the bottom viewport like benchmark-large-xlsx.ts.
    const bottom = {
      ...viewport,
      startRow: Math.max(0, largest.rowCount - 100),
      endRow: largest.rowCount - 1,
    }
    const indexStarted = performance.now()
    let last: RangeResult = first.value
    for (let attempt = 0; attempt < 600; attempt += 1) {
      last = (await client.readRange({
        sessionId: opened.sessionId,
        sheetId: largest.id,
        range: bottom,
      })) as RangeResult
      if (last.indexingComplete || (last.indexedThroughRow ?? -1) >= bottom.endRow) break
      await new Promise((r) => setTimeout(r, 50))
    }
    report.fullIndex = { ms: round(performance.now() - indexStarted + first.ms) }

    // A 90k-cell batch read (the renderer's SIDECAR_READ_BATCH_CELLS).
    const batchCols = Math.min(largest.columnCount, 50)
    const batchRows = Math.min(largest.rowCount, Math.floor(90_000 / batchCols))
    const batch = await timed(
      () =>
        client.readRange({
          sessionId: opened.sessionId,
          sheetId: largest.id,
          range: { startRow: 0, endRow: batchRows - 1, startColumn: 0, endColumn: batchCols - 1 },
        }) as Promise<RangeResult>,
    )
    report.readRange90kBatch = {
      ms: batch.ms,
      cells: batch.value.cells.length,
      resultBytes: bytes(batch.value),
    }

    let formulaTotal = 0
    let formulaBytes = 0
    const formulaCells: { sheet: string; row: number; column: number }[] = []
    const formulas = await timed(async () => {
      for (const sheet of opened.sheets) {
        const result = (await client.readFormulaCells({
          sessionId: opened.sessionId,
          sheetId: sheet.id,
        })) as { cells?: { row: number; column: number }[] }
        formulaBytes += bytes(result)
        for (const cell of result.cells ?? []) {
          formulaTotal += 1
          formulaCells.push({ sheet: sheet.name, row: cell.row, column: cell.column })
        }
      }
    })
    report.readFormulaCells = { ms: formulas.ms, cells: formulaTotal, resultBytes: formulaBytes }

    const media = opened.visuals.find((v) => v.kind === 'image')
    if (media) {
      const read = await timed(() =>
        client.readMedia({ sessionId: opened.sessionId, visualId: media.id }),
      )
      report.readMedia = { ms: read.ms, resultBytes: bytes(read.value) }
    }

    const manifest = await timed(
      () => client.archiveManifest(snapshot) as Promise<{ entries: { name: string }[] }>,
    )
    report.archiveManifest = {
      ms: manifest.ms,
      entries: manifest.value.entries.length,
      resultBytes: bytes(manifest.value),
    }
    const pivot = manifest.value.entries.find((e) => e.name.startsWith('xl/pivotTables/'))
    if (pivot) {
      const read = await timed(() => readArchiveEntryText(client, snapshot, pivot.name))
      report.readPivotEntry = { ms: read.ms, textBytes: read.value.length }
    }

    // Recalc: one numeric edit, read back the formula cells' bounding box
    // (capped at the 20k read budget, like the renderer's RECALC_READ_BUDGET).
    if (formulaCells.length > 0) {
      const sheet = formulaCells[0]!.sheet
      const onSheet = formulaCells.filter((c) => c.sheet === sheet)
      // Loop, not Math.min(...): up to 100k formula cells per sheet.
      let minRow = Infinity
      let maxRowSeen = -1
      let minCol = Infinity
      let maxCol = -1
      for (const c of onSheet) {
        minRow = Math.min(minRow, c.row)
        maxRowSeen = Math.max(maxRowSeen, c.row)
        minCol = Math.min(minCol, c.column)
        maxCol = Math.max(maxCol, c.column)
      }
      const width = maxCol - minCol + 1
      const maxRow = Math.min(maxRowSeen, minRow + Math.floor(20_000 / width) - 1)
      const request = {
        path: snapshot,
        edits: [{ sheet, row: 0, column: 0, input: '42' }],
        reads: [
          {
            sheet,
            range: { startRow: minRow, endRow: maxRow, startColumn: minCol, endColumn: maxCol },
          },
        ],
      }
      try {
        const cold = await timed(() => client.recalcCells(request))
        const warmRecalc = await timed(() => client.recalcCells(request))
        report.recalcCells = {
          coldMs: cold.ms,
          warmMs: warmRecalc.ms,
          readCells: (maxRow - minRow + 1) * width,
          resultBytes: bytes(cold.value),
        }
      } catch (error) {
        report.recalcCells = { error: String(error) }
      }
    }

    // Save through the app's streaming pipeline (gateway planner + sidecar archive I/O).
    const target = join(work, `saved-${basename(fixture)}`)
    // Edits overwrite existing cells only, taken from the first viewport read
    // (row-appending edits trip a planner bug on the G0 fixtures, in the
    // pure-JS path too; see the doc).
    const sheetName = largest.name
    const existing = (first.value.cells as { row: number; column: number }[]).map((c) => ({
      row: c.row,
      column: c.column,
    }))
    const edits = Array.from({ length: editCount }, (_, i) => ({
      sheetName,
      row: existing[i % existing.length]!.row,
      column: existing[i % existing.length]!.column,
      writeValue: true,
      cell: { value: i * 3 + 0.5 },
    }))
    try {
      const save = await timed(() =>
        saveWorkbookViaSidecar({ client, sourcePath: snapshot, targetPath: target, edits }),
      )
      report.saveViaSidecar = {
        ms: save.ms,
        edits: editCount,
        requestBytes: bytes(edits),
        outputBytes: (await stat(target)).size,
        touchedEntries: save.value.touchedEntries.length,
      }
    } catch (error) {
      report.saveViaSidecar = { error: String(error) }
    }

    const closeTimed = await timed(() => client.close(opened.sessionId))
    report.closeMs = closeTimed.ms
    report.sidecarPeakRssKb = await peakRssKb(client.getProcessId())
  } finally {
    client.stop()
    await rm(work, { recursive: true, force: true })
  }
  return report
}

async function measureConvert(binary: string, xls: string) {
  const client = new XlsxSidecarClient(binary)
  const work = await mkdtemp(join(tmpdir(), 'go-d3-probe-'))
  try {
    const target = join(work, 'converted.xlsx')
    const run = await timed(() => client.convertWorkbook({ path: xls, targetPath: target }))
    return {
      fixture: basename(xls),
      fileBytes: (await stat(xls)).size,
      convertMsInclSpawn: run.ms,
      outputBytes: (await stat(target)).size,
      sidecarPeakRssKb: await peakRssKb(client.getProcessId()),
    }
  } finally {
    client.stop()
    await rm(work, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const binary = args.shift()
  const out = args.shift()
  if (!binary || !out) throw new Error('usage: measure-sidecar.ts <binary> <out.json> <fixture>...')
  let editCount = 10
  let xls: string | undefined
  const fixtures: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--edits') editCount = Number(args[++i])
    else if (args[i] === '--xls') xls = args[++i]
    else fixtures.push(args[i]!)
  }
  const results: unknown[] = []
  for (const fixture of fixtures) {
    try {
      results.push(await measureFixture(binary, fixture, editCount))
    } catch (error) {
      results.push({ fixture: basename(fixture), error: String(error) })
    }
    process.stderr.write(`measured ${basename(fixture)}\n`)
  }
  const convert = xls ? await measureConvert(binary, xls) : null
  const { writeFile } = await import('node:fs/promises')
  await writeFile(
    out,
    `${JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, results, convert }, null, 2)}\n`,
  )
}

void main()
