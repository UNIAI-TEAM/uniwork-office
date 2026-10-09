// GO-D3 O1/O7 probe (UNI-1016, SH1): one scripted conversation with the xlsx-sidecar, shared by
// every runtime we compare (Chromium Web Worker + browser WASI shim, Node + the same shim,
// Node `node:wasi`, native binary). The sidecar is single-threaded in the wasm build: it reads
// one request line, answers on stdout, then reads the next. So stdin can be a function that
// computes the next request from the previous answer (session ids, sheet ids, entry names)
// without any blocking primitive.

/**
 * The request script for one workbook at `path` (inside `root`, a writable directory).
 * Yields {label, req}; receives the parsed response of that request.
 */
export function* conversation(path, root, opts = {}) {
  let n = 0
  const R = (label, command, extra) => ({
    label,
    req: { version: 1, requestId: `${label}#${n++}`, command, ...extra },
  })
  let res = yield R('open', 'open', { path, locale: 'en' })
  if (!res?.ok) return
  const opened = res.result
  const sessionId = opened.sessionId
  const largest = opened.sheets.reduce((a, b) =>
    b.rowCount * b.columnCount > a.rowCount * a.columnCount ? b : a,
  )
  const lastCol = Math.min(49, largest.columnCount - 1)
  yield R('viewport', 'read_range', {
    sessionId,
    sheetId: largest.id,
    range: {
      startRow: 0,
      endRow: Math.min(99, largest.rowCount - 1),
      startColumn: 0,
      endColumn: lastCol,
    },
  })
  yield R('bottomViewport', 'read_range', {
    sessionId,
    sheetId: largest.id,
    range: {
      startRow: Math.max(0, largest.rowCount - 100),
      endRow: largest.rowCount - 1,
      startColumn: 0,
      endColumn: lastCol,
    },
  })
  const batchCols = Math.min(largest.columnCount, 50)
  const batchRows = Math.min(largest.rowCount, Math.floor(90_000 / batchCols))
  yield R('batch90k', 'read_range', {
    sessionId,
    sheetId: largest.id,
    range: { startRow: 0, endRow: batchRows - 1, startColumn: 0, endColumn: batchCols - 1 },
  })
  const formulaCells = []
  for (const sheet of opened.sheets) {
    res = yield R('formulas', 'read_formula_cells', { sessionId, sheetId: sheet.id })
    for (const c of res?.result?.cells ?? []) formulaCells.push({ sheet: sheet.name, ...c })
  }
  // the sidecar part of a save: manifest, extract the biggest worksheet, write the archive back
  res = yield R('manifest', 'archive_manifest', { path })
  const entries = res?.result?.entries ?? []
  const sheetEntry = entries
    .filter((e) => e.name.startsWith('xl/worksheets/') && e.name.endsWith('.xml'))
    .sort((a, b) => b.uncompressedSize - a.uncompressedSize)[0]
  if (sheetEntry) {
    res = yield R('readEntry', 'read_entries', {
      path,
      entries: [sheetEntry.name],
      outputDir: `${root}/extract`,
    })
    const extracted = res?.result?.entries?.[0]?.path
    if (extracted) {
      yield R('saveArchive', 'save_archive', {
        sourcePath: path,
        targetPath: `${root}/saved.xlsx`,
        replacements: [{ name: sheetEntry.name, contentPath: extracted }],
        removals: [],
        additions: [],
      })
    }
  }
  if (opts.recalc && formulaCells.length > 0) {
    const sheet = formulaCells[0].sheet
    let minRow = Infinity
    let maxRow = -1
    let minCol = Infinity
    let maxCol = -1
    for (const c of formulaCells) {
      if (c.sheet !== sheet) continue
      minRow = Math.min(minRow, c.row)
      maxRow = Math.max(maxRow, c.row)
      minCol = Math.min(minCol, c.column)
      maxCol = Math.max(maxCol, c.column)
    }
    const width = maxCol - minCol + 1
    const request = {
      path,
      edits: [{ sheet, row: 0, column: 0, input: '42' }],
      reads: [
        {
          sheet,
          range: {
            startRow: minRow,
            endRow: Math.min(maxRow, minRow + Math.floor(20_000 / width) - 1),
            startColumn: minCol,
            endColumn: maxCol,
          },
        },
      ],
    }
    yield R('recalcCold', 'recalc_cells', request)
    yield R('recalcWarm', 'recalc_cells', request)
  }
  yield R('close', 'close', { sessionId })
}

/**
 * Drives `conversation()` through a line-oriented transport.
 * `pull()` is called when the sidecar wants its next request line; `push(line)` with each stdout
 * line. Returns {pull, push, results} where results[label] = {ms, bytes, ok, error?}.
 */
export function createDriver(gen, now = () => performance.now()) {
  const results = {}
  let pending = null
  let lastResponse
  let started = false
  return {
    results,
    pull() {
      const step = started ? gen.next(lastResponse) : gen.next()
      started = true
      lastResponse = undefined
      if (step.done) return null
      pending = { label: step.value.label, id: step.value.req.requestId, t0: now() }
      return JSON.stringify(step.value.req)
    },
    push(line) {
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        return // library diagnostics on stdout (see xlsx-sidecar-client.ts handleLine)
      }
      if (!pending || msg.requestId !== pending.id) return
      const ms = Math.round((now() - pending.t0) * 10) / 10
      const prev = results[pending.label]
      const entry = { ms, bytes: line.length, ok: msg.ok, ...(msg.ok ? {} : { error: msg.error }) }
      // repeated labels (formulas per sheet) accumulate
      results[pending.label] = prev
        ? { ...entry, ms: Math.round((prev.ms + ms) * 10) / 10, bytes: prev.bytes + line.length }
        : entry
      lastResponse = msg
      pending = null
    },
  }
}

/**
 * Runs the wasm sidecar once over `fixtureBytes` with @bjorn3/browser_wasi_shim (works in a
 * browser Web Worker and in Node). `shim` = the shim module namespace.
 */
export async function runWithShim(shim, module, name, fixtureBytes, opts = {}) {
  patchGrowableFiles(shim)
  const { WASI, File, Directory, PreopenDirectory, ConsoleStdout, Fd } = shim
  const root = '/tmp/w'
  const gen = conversation(`${root}/${name}`, root, opts)
  const driver = createDriver(gen)
  const enc = new TextEncoder()
  class ScriptedStdin extends Fd {
    buf = new Uint8Array(0)
    fd_read(size) {
      if (this.buf.length === 0) {
        const line = driver.pull()
        if (line === null) return { ret: 0, data: new Uint8Array(0) } // EOF: the sidecar exits
        this.buf = enc.encode(`${line}\n`)
      }
      const out = this.buf.slice(0, size)
      this.buf = this.buf.slice(out.length)
      return { ret: 0, data: out }
    }
  }
  const stderr = []
  const tmp = new Directory(
    new Map([
      [
        'w',
        new Directory(
          new Map([
            [name, new File(fixtureBytes)],
            ['extract', new Directory(new Map())],
          ]),
        ),
      ],
    ]),
  )
  const fds = [
    new ScriptedStdin(),
    ConsoleStdout.lineBuffered((line) => driver.push(line)),
    ConsoleStdout.lineBuffered((line) => stderr.push(line)),
    new PreopenDirectory('/tmp', tmp.contents),
  ]
  const wasi = new WASI(['xlsx-sidecar'], ['TMPDIR=/tmp'], fds)
  const t0 = performance.now()
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  })
  const instantiateMs = performance.now() - t0
  let trap = null
  try {
    wasi.start(instance)
  } catch (err) {
    trap = { name: err?.name, message: String(err?.message ?? err) }
  }
  return {
    fixture: name,
    fileBytes: fixtureBytes.byteLength,
    instantiateMs: Math.round(instantiateMs * 10) / 10,
    wasmMemoryBytes: instance.exports.memory.buffer.byteLength,
    results: driver.results,
    trap,
    stderrTail: stderr.slice(-5),
  }
}

/**
 * The shim's in-memory File grows to exactly the new size on every write, which makes writing a
 * multi-MB xlsx quadratic. Grow geometrically instead: `file.data` stays a view of the logical
 * length over a larger buffer, so every other shim method (size, read, seek, truncate) is unchanged.
 */
function patchGrowableFiles(shim) {
  const proto = shim.OpenFile.prototype
  if (proto.__growable) return
  proto.__growable = true
  proto.fd_write = function fd_write(data) {
    if (this.file.readonly) return { ret: 8 /* ERRNO_BADF */, nwritten: 0 }
    const pos = Number(this.file_pos)
    const end = pos + data.byteLength
    const cur = this.file.data
    if (end > cur.byteLength) {
      if (cur.byteOffset === 0 && end <= cur.buffer.byteLength) {
        this.file.data = new Uint8Array(cur.buffer, 0, end)
      } else {
        const next = new Uint8Array(Math.max(end, cur.byteLength * 2, 1 << 16))
        next.set(cur)
        this.file.data = next.subarray(0, end)
      }
    }
    this.file.data.set(data, pos)
    this.file_pos += BigInt(data.byteLength)
    return { ret: 0, nwritten: data.byteLength }
  }
}
