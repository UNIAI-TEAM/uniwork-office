import * as CFB from 'cfb'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { docToText, parseFileToText, pptToText, xlsToText } from '../src/index'
import { writeFixture } from './helpers/fixtures'

function legacyFixture(name: string): string {
  return fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))
}

function rec(id: number, payload: Uint8Array | readonly number[]): Uint8Array {
  const body = payload instanceof Uint8Array ? payload : Uint8Array.from(payload)
  const out = new Uint8Array(4 + body.byteLength)
  out[0] = id & 0xff
  out[1] = (id >> 8) & 0xff
  out[2] = body.byteLength & 0xff
  out[3] = (body.byteLength >> 8) & 0xff
  out.set(body, 4)
  return out
}

function u16(v: number): [number, number] {
  return [v & 0xff, (v >> 8) & 0xff]
}

function u32(v: number): [number, number, number, number] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, Math.floor(v / 0x1000000) & 0xff]
}

function f64(v: number): number[] {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setFloat64(0, v, true)
  return [...new Uint8Array(buf)]
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const c of chunks) total += c.byteLength
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

function bof(substreamKind: number): Uint8Array {
  return rec(0x0809, [...u16(0x0600), ...u16(substreamKind), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
}

function eof(): Uint8Array {
  return rec(0x000a, [])
}

function boundsheet(offset: number, name: string, sheetType = 0x00): Uint8Array {
  const nameBytes = [...Buffer.from(name, 'latin1')]
  return rec(0x0085, [...u32(offset), 0x00, sheetType & 0xff, nameBytes.length, 0x00, ...nameBytes])
}

function numberCell(row: number, col: number, value: number): Uint8Array {
  return rec(0x0203, [...u16(row), ...u16(col), 0, 0, ...f64(value)])
}

function labelSstCell(row: number, col: number, sstIndex: number): Uint8Array {
  return rec(0x00fd, [...u16(row), ...u16(col), 0, 0, ...u32(sstIndex)])
}

function formulaStringCell(row: number, col: number): Uint8Array {
  return rec(0x0006, [
    ...u16(row),
    ...u16(col),
    0,
    0,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
    0xff,
    0,
    0,
    0,
    0,
    0,
    0,
    ...u16(7),
    0x17,
    0x04,
    0x00,
    0x41,
    0x42,
    0x43,
    0x44,
  ])
}

function buildXlsBuffer(opts: {
  sheetNames: readonly string[]
  sheetTypes?: readonly number[]
  extraGlobals?: readonly Uint8Array[]
  sheetStreams: readonly Uint8Array[]
  overrideOffsets?: readonly number[]
}): Buffer {
  const extra = opts.extraGlobals ?? []
  const dummyBounds = opts.sheetNames.map((name, i) => boundsheet(0, name, opts.sheetTypes?.[i] ?? 0x00))
  const globalsHeaderLen =
    bof(0x0005).byteLength +
    dummyBounds.reduce((sum, b) => sum + b.byteLength, 0) +
    extra.reduce((sum, b) => sum + b.byteLength, 0) +
    eof().byteLength
  const sheetOffsets: number[] = []
  let cursor = globalsHeaderLen
  for (const s of opts.sheetStreams) {
    sheetOffsets.push(cursor)
    cursor += s.byteLength
  }
  const realBounds = opts.sheetNames.map((name, i) =>
    boundsheet(
      opts.overrideOffsets?.[i] ?? sheetOffsets[i] ?? globalsHeaderLen,
      name,
      opts.sheetTypes?.[i] ?? 0x00,
    ),
  )
  const stream = concatBytes([bof(0x0005), ...realBounds, ...extra, eof(), ...opts.sheetStreams])
  const cfb = CFB.utils.cfb_new()
  CFB.utils.cfb_add(cfb, '/Workbook', Buffer.from(stream))
  return CFB.write(cfb, { type: 'buffer' }) as Buffer
}
describe('parseFileToText: legacy .doc', () => {
  it('extracts body text from a Word 97-2003 document', async () => {
    const result = await parseFileToText(legacyFixture('legacy-sample.doc'))
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('text')
    expect(result.text).toContain('Legacy Report')
    expect(result.text).toContain('Legacy DOC body text')
    expect(result.text).toContain('Second paragraph from Word 97-2003.')
  })

  it('exposes the same text through docToText', async () => {
    const text = await docToText(await readFile(legacyFixture('legacy-sample.doc')))
    expect(text).toContain('Legacy Report')
    expect(text).toContain('Legacy DOC body text')
  })

  it('reads an uppercase .DOC extension through the same path', async () => {
    const path = writeFixture('upper.DOC', await readFile(legacyFixture('legacy-sample.doc')))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(true)
    expect(result.text).toContain('Legacy Report')
  })

  it('rejects a corrupt .doc with an error instead of throwing', async () => {
    const path = writeFixture('corrupt.doc', Buffer.from('not a legacy document'))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('text')
    expect(result.error).toBeTruthy()
  })

  it('rejects an empty .doc with an error instead of throwing', async () => {
    const path = writeFixture('empty.doc', Buffer.alloc(0))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('parseFileToText: legacy .ppt', () => {
  it('extracts one text section per slide from a PowerPoint 97-2003 presentation', async () => {
    const result = await parseFileToText(legacyFixture('legacy-sample.ppt'))
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('text')
    expect(result.text).toContain('## Slide 1')
    expect(result.text).toContain('Legacy PPT title')
    expect(result.text).toContain('First slide body')
    expect(result.text).toContain('## Slide 2')
    expect(result.text).toContain('Second legacy slide')
  })

  it('exposes the same text through pptToText', async () => {
    const text = await pptToText(await readFile(legacyFixture('legacy-sample.ppt')))
    expect(text).toContain('## Slide 1')
    expect(text).toContain('Legacy PPT title')
  })

  it('rejects a corrupt .ppt with an error instead of throwing', async () => {
    const path = writeFixture('corrupt.ppt', Buffer.from('not a legacy document'))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('text')
    expect(result.error).toBeTruthy()
  })

  it('rejects an empty .ppt with an error instead of throwing', async () => {
    const path = writeFixture('empty.ppt', Buffer.alloc(0))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('parseFileToText: legacy .xls', () => {
  it('extracts sheet headings and cell values (including Vietnamese SST strings and RK numbers) from an Excel 97-2003 workbook', async () => {
    const result = await parseFileToText(legacyFixture('vn-budget.xls'))
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('text')
    expect(result.text).toContain('# Data')
    expect(result.text).toContain('Hạng mục | Quý I | Quý II')
    expect(result.text).toContain('Doanh thu | 1250000000 | 780000000')
    expect(result.text).toContain('# Tổng hợp')
    expect(result.text).toContain('Miền Bắc (Hà Nội) | 120 | 150 | 270')
    expect(result.text).toContain('# Ghi chú')
    expect(result.text).toContain('Ghi chú kiểm thử tiếng Việt: ă â đ ê ô ơ ư | 990')
    expect(result.text).toContain('Phê duyệt bởi Phòng Tài chính Kế toán | 2026')
  })

  it('exposes the same text through xlsToText', async () => {
    const text = await xlsToText(await readFile(legacyFixture('vn-budget.xls')))
    expect(text).toContain('# Data')
    expect(text).toContain('# Tổng hợp')
    expect(text).toContain('Miền Bắc (Hà Nội) | 120 | 150 | 270')
  })

  it('reads an uppercase .XLS extension through the same path', async () => {
    const path = writeFixture('upper.XLS', await readFile(legacyFixture('vn-budget.xls')))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(true)
    expect(result.text).toContain('# Tổng hợp')
  })

  it('rejects a corrupt .xls with an error instead of throwing', async () => {
    const path = writeFixture('corrupt.xls', Buffer.from('not a legacy workbook'))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('text')
    expect(result.error).toBeTruthy()
  })

  it('rejects an empty .xls with an error instead of throwing', async () => {
    const path = writeFixture('empty.xls', Buffer.alloc(0))
    const result = await parseFileToText(path)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('R1-5: rejects duplicate/aliased BOUNDSHEET offsets and aggregate cell amplification while preserving valid multi-sheet workbooks', async () => {
    const sheetCells: Uint8Array[] = [bof(0x0010)]
    for (let r = 0; r < 4096; r++) {
      sheetCells.push(numberCell(r, 0, r + 1))
    }
    sheetCells.push(eof())
    const oneSheet = concatBytes(sheetCells)
    const aliasNames = Array.from({ length: 128 }, (_, i) => `S${i}`)
    const aliasedBuf = buildXlsBuffer({
      sheetNames: aliasNames,
      sheetStreams: [oneSheet],
    })
    const aliasedPath = writeFixture('r1-5-alias.xls', aliasedBuf)
    const aliasedResult = await parseFileToText(aliasedPath)
    expect(aliasedResult.ok).toBe(false)
    expect(aliasedResult.error).toMatch(/duplicate|offset/i)
    await expect(xlsToText(aliasedBuf)).rejects.toThrow(/duplicate|offset/i)
    // BOUNDSHEET pointing to a non-worksheet BOF (e.g. chart substream 0x0020) is rejected
    const nonWorksheetBuf = buildXlsBuffer({
      sheetNames: ['ChartSheet'],
      sheetStreams: [concatBytes([bof(0x0020), eof()])],
    })
    await expect(xlsToText(nonWorksheetBuf)).rejects.toThrow(/worksheet BOF/i)

    // Aggregate text retention cap across cells (e.g. 600 cells referencing an 8,000-char SST entry = 4.8M chars)
    const bigStr = 'X'.repeat(8000)
    const sstBig = rec(0x00fc, [
      ...u32(600),
      ...u32(1),
      ...u16(bigStr.length),
      0x00,
      ...Buffer.from(bigStr, 'latin1'),
    ])
    const repeatedCells: Uint8Array[] = [bof(0x0010)]
    for (let r = 0; r < 600; r++) {
      repeatedCells.push(labelSstCell(r, 0, 0))
    }
    repeatedCells.push(eof())
    const ampBuf = buildXlsBuffer({
      sheetNames: ['Amp'],
      extraGlobals: [sstBig],
      sheetStreams: [concatBytes(repeatedCells)],
    })
    await expect(xlsToText(ampBuf)).rejects.toThrow(/limit/i)

    // Valid multi-sheet workbook with distinct BOUNDSHEET offsets still extracts
    const validMultiBuf = buildXlsBuffer({
      sheetNames: ['First', 'Second'],
      sheetStreams: [
        concatBytes([bof(0x0010), numberCell(0, 0, 10), eof()]),
        concatBytes([bof(0x0010), numberCell(0, 0, 20), eof()]),
      ],
    })
    expect(await xlsToText(validMultiBuf)).toBe('# First\n10\n\n# Second\n20')
  })

  it('R1-6: decodes cached formula STRING values split across CONTINUE records and rejects malformed STRING chains', async () => {
    const continuedBuf = buildXlsBuffer({
      sheetNames: ['S0'],
      sheetStreams: [
        concatBytes([
          bof(0x0010),
          formulaStringCell(0, 0),
          rec(0x0207, [0x04, 0x00, 0x00, 0x41, 0x42]),
          rec(0x003c, [0x00, 0x43, 0x44]),
          eof(),
        ]),
      ],
    })
    const continuedPath = writeFixture('r1-6-string-continue.xls', continuedBuf)
    const continuedRes = await parseFileToText(continuedPath)
    expect(continuedRes.ok).toBe(true)
    expect(continuedRes.text).toBe('# S0\nABCD')
    // UTF-16 cached STRING split across CONTINUE (including surrogate pair)
    const utf16ContinuedBuf = buildXlsBuffer({
      sheetNames: ['S0'],
      sheetStreams: [
        concatBytes([
          bof(0x0010),
          formulaStringCell(0, 0),
          rec(0x0207, [0x03, 0x00, 0x01, 0x41, 0x00, 0x3d, 0xd8]),
          rec(0x003c, [0x01, 0x00, 0xde]),
          eof(),
        ]),
      ],
    })
    expect(await xlsToText(utf16ContinuedBuf)).toBe('# S0\nA😀')

    // Malformed STRING chain (claims 4 chars, only 2 present and no CONTINUE) must fail
    const truncatedBuf = buildXlsBuffer({
      sheetNames: ['S0'],
      sheetStreams: [
        concatBytes([
          bof(0x0010),
          formulaStringCell(0, 0),
          rec(0x0207, [0x04, 0x00, 0x00, 0x41, 0x42]),
          eof(),
        ]),
      ],
    })
    const truncatedRes = await parseFileToText(writeFixture('r1-6-truncated.xls', truncatedBuf))
    expect(truncatedRes.ok).toBe(false)
    expect(truncatedRes.error).toMatch(/STRING|chain|truncated/i)
  })

  it('R1-7: retains pending cached-string cell across ShrFmla/Array/Table metadata records and clears on unrelated records', async () => {
    const sharedFormulaBuf = buildXlsBuffer({
      sheetNames: ['S0'],
      sheetStreams: [
        concatBytes([
          bof(0x0010),
          // Row 0: FORMULA -> ShrFmla (0x04bc) -> STRING "SHARED"
          formulaStringCell(0, 0),
          rec(0x04bc, [0, 0, 0, 0, 0, 0, 0, 0]),
          rec(0x0207, [0x06, 0x00, 0x00, ...Buffer.from('SHARED', 'latin1')]),
          // Row 1: FORMULA -> Array (0x0221) -> STRING "ARRAY"
          formulaStringCell(1, 0),
          rec(0x0221, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
          rec(0x0207, [0x05, 0x00, 0x00, ...Buffer.from('ARRAY', 'latin1')]),
          // Row 2: FORMULA -> Table (0x0236) -> STRING "TABLE"
          formulaStringCell(2, 0),
          rec(0x0236, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
          rec(0x0207, [0x05, 0x00, 0x00, ...Buffer.from('TABLE', 'latin1')]),
          // Row 3: FORMULA followed by unrelated NUMBER record clears pending state before stray STRING
          formulaStringCell(3, 0),
          numberCell(3, 1, 99),
          rec(0x0207, [0x05, 0x00, 0x00, ...Buffer.from('STRAY', 'latin1')]),
          eof(),
        ]),
      ],
    })
    const res = await parseFileToText(writeFixture('r1-7-shrfmla.xls', sharedFormulaBuf))
    expect(res.ok).toBe(true)
    expect(res.text).toBe('# S0\nSHARED\nARRAY\nTABLE\n | 99')
  })

  it('R1-8: decodes UTF-16 surrogate pairs split at a code-unit boundary across SST and CONTINUE records', async () => {
    // SST counts 1/1, cch=2, fHighByte=1, first code unit 0xD83D; CONTINUE fHighByte=1, second code unit 0xDE00
    const sstRec = rec(0x00fc, [...u32(1), ...u32(1), ...u16(2), 0x01, 0x3d, 0xd8])
    const contRec = rec(0x003c, [0x01, 0x00, 0xde])
    const buf = buildXlsBuffer({
      sheetNames: ['S0'],
      extraGlobals: [sstRec, contRec],
      sheetStreams: [concatBytes([bof(0x0010), labelSstCell(0, 0, 0), eof()])],
    })
    const res = await parseFileToText(writeFixture('r1-8-surrogate.xls', buf))
    expect(res.ok).toBe(true)
    expect(res.text).toBe('# S0\n😀')
  })

  it('R1-9: rejects SST records with truncated fixed string header bytes', async () => {
    const sstShortHeader = rec(0x00fc, [...u32(1), ...u32(1), 0x00])
    const buf = buildXlsBuffer({
      sheetNames: ['S0'],
      extraGlobals: [sstShortHeader],
      sheetStreams: [concatBytes([bof(0x0010), eof()])],
    })
    const res = await parseFileToText(writeFixture('r1-9-short-sst.xls', buf))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/SST|truncated|header/i)
  })

  it('R1-10: throws an explicit limit error when MAX_RECORDS is reached instead of returning partial output', async () => {
    // 500,000 BLANK (0x0201) records of 6 bytes (10 bytes with header) followed by NUMBER A1=333 and EOF
    const blankCount = 500_000
    const sheetHeader = bof(0x0010)
    const tail = concatBytes([numberCell(0, 0, 333), eof()])
    const sheetStream = new Uint8Array(sheetHeader.byteLength + blankCount * 10 + tail.byteLength)
    sheetStream.set(sheetHeader, 0)
    let pos = sheetHeader.byteLength
    for (let i = 0; i < blankCount; i++) {
      sheetStream[pos] = 0x01
      sheetStream[pos + 1] = 0x02
      sheetStream[pos + 2] = 0x06
      sheetStream[pos + 3] = 0x00
      // row=0, col=0, xf=0
      pos += 10
    }
    sheetStream.set(tail, pos)
    const buf = buildXlsBuffer({
      sheetNames: ['S'],
      sheetStreams: [sheetStream],
    })
    const res = await parseFileToText(writeFixture('r1-10-max-records.xls', buf))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/limit|record/i)
  })

  it('R1-11: rejects a worksheet substream missing its EOF instead of reading into the next sheet', async () => {
    const sheetANoEof = concatBytes([bof(0x0010), numberCell(0, 0, 111)])
    const sheetBWithEof = concatBytes([bof(0x0010), numberCell(0, 0, 222), eof()])
    const buf = buildXlsBuffer({
      sheetNames: ['A', 'B'],
      sheetStreams: [sheetANoEof, sheetBWithEof],
    })
    const res = await parseFileToText(writeFixture('r1-11-missing-eof.xls', buf))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/EOF|substream/i)
  })

  it('R1-15: rejects BIFF8 column indexes > 0xFF before row padding while extracting valid column 255', async () => {
    const invalidColBuf = buildXlsBuffer({
      sheetNames: ['S0'],
      sheetStreams: [concatBytes([bof(0x0010), numberCell(0, 16383, 42), eof()])],
    })
    const invalidRes = await parseFileToText(writeFixture('r1-15-invalid-col.xls', invalidColBuf))
    expect(invalidRes.ok).toBe(false)
    expect(invalidRes.error).toMatch(/column|bounds|cell/i)

    const validCol255Buf = buildXlsBuffer({
      sheetNames: ['S0'],
      sheetStreams: [concatBytes([bof(0x0010), numberCell(0, 255, 42), eof()])],
    })
    const validRes = await parseFileToText(writeFixture('r1-15-valid-col255.xls', validCol255Buf))
    expect(validRes.ok).toBe(true)
    expect(validRes.text).toBe('# S0\n(255 empty) | 42')
  })

  it('R2-1: skips non-worksheet BOUNDSHEET types (chart dt=0x02, macro dt=0x01, VB dt=0x06) while bounding worksheet substreams and rejecting mismatched worksheet BOFs', async () => {
    // Worksheet + correctly typed chart sheet (dt 0x02, BOF kind 0x0020) -> worksheet text exact, chart sheet omitted
    const wsAndChartBuf = buildXlsBuffer({
      sheetNames: ['Data', 'Chart'],
      sheetTypes: [0x00, 0x02],
      sheetStreams: [
        concatBytes([bof(0x0010), numberCell(0, 0, 123), eof()]),
        concatBytes([bof(0x0020), eof()]),
      ],
    })
    const wsAndChartRes = await parseFileToText(writeFixture('r2-1-ws-and-chart.xls', wsAndChartBuf))
    expect(wsAndChartRes.ok).toBe(true)
    expect(wsAndChartRes.text).toBe('# Data\n123')

    // Chart-before-worksheet layout
    const chartBeforeWsBuf = buildXlsBuffer({
      sheetNames: ['ChartFirst', 'DataSecond'],
      sheetTypes: [0x02, 0x00],
      sheetStreams: [
        concatBytes([bof(0x0020), eof()]),
        concatBytes([bof(0x0010), numberCell(0, 0, 456), eof()]),
      ],
    })
    const chartBeforeWsRes = await parseFileToText(
      writeFixture('r2-1-chart-before-ws.xls', chartBeforeWsBuf),
    )
    expect(chartBeforeWsRes.ok).toBe(true)
    expect(chartBeforeWsRes.text).toBe('# DataSecond\n456')

    // Chart-between-worksheets layout (and macro sheet dt=0x01 / BOF 0x0040, VB module dt=0x06)
    const chartBetweenWsBuf = buildXlsBuffer({
      sheetNames: ['First', 'ChartMid', 'MacroMid', 'VbMid', 'Second'],
      sheetTypes: [0x00, 0x02, 0x01, 0x06, 0x00],
      sheetStreams: [
        concatBytes([bof(0x0010), numberCell(0, 0, 10), eof()]),
        concatBytes([bof(0x0020), eof()]),
        concatBytes([bof(0x0040), eof()]),
        concatBytes([bof(0x0006), eof()]),
        concatBytes([bof(0x0010), numberCell(0, 0, 20), eof()]),
      ],
    })
    const chartBetweenWsRes = await parseFileToText(
      writeFixture('r2-1-chart-between-ws.xls', chartBetweenWsBuf),
    )
    expect(chartBetweenWsRes.ok).toBe(true)
    expect(chartBetweenWsRes.text).toBe('# First\n10\n\n# Second\n20')

    // Skipped non-worksheet offsets still bound preceding worksheet readers (missing EOF before chart sheet fails)
    const missingEofBeforeChartBuf = buildXlsBuffer({
      sheetNames: ['DataNoEof', 'ChartAfter', 'TrailingWs'],
      sheetTypes: [0x00, 0x02, 0x00],
      sheetStreams: [
        concatBytes([bof(0x0010), numberCell(0, 0, 111)]),
        concatBytes([bof(0x0020), eof()]),
        concatBytes([bof(0x0010), numberCell(0, 0, 222), eof()]),
      ],
    })
    const missingEofBeforeChartRes = await parseFileToText(
      writeFixture('r2-1-missing-eof-before-chart.xls', missingEofBeforeChartBuf),
    )
    expect(missingEofBeforeChartRes.ok).toBe(false)
    expect(missingEofBeforeChartRes.error).toMatch(/EOF|substream/i)

    // Mismatched pair (dt 0x00 -> chart BOF 0x0020) is still rejected
    const mismatchedBuf = buildXlsBuffer({
      sheetNames: ['Mismatched'],
      sheetTypes: [0x00],
      sheetStreams: [concatBytes([bof(0x0020), eof()])],
    })
    const mismatchedRes = await parseFileToText(writeFixture('r2-1-mismatched.xls', mismatchedBuf))
    expect(mismatchedRes.ok).toBe(false)
    expect(mismatchedRes.error).toMatch(/worksheet BOF/i)
  })
})
