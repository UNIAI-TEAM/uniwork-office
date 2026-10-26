import * as CFB from 'cfb'

interface BiffRecord {
  readonly type: number
  readonly data: Uint8Array
}

interface BiffSheet {
  readonly name: string
  readonly rows: Map<number, Map<number, string>>
}

interface ExtractionBudget {
  records: number
  cells: number
  chars: number
}

const BOF = 0x0809
const EOF = 0x000a
const BOUNDSHEET = 0x0085
const SST = 0x00fc
const CONTINUE = 0x003c
const LABELSST = 0x00fd
const LABEL = 0x0204
const RK = 0x027e
const NUMBER = 0x0203
const MULRK = 0x00bd
const BLANK = 0x0201
const MULBLANK = 0x00be
const FORMULA = 0x0006
const STRING = 0x0207
const SHRFMLA = 0x04bc
const ARRAY = 0x0221
const TABLE = 0x0236
const BOOLERR = 0x0205
const FILEPASS = 0x002f
const BIFF8_VERSION = 0x0600
const SUBSTREAM_WORKBOOK_GLOBALS = 0x0005
const SUBSTREAM_WORKSHEET = 0x0010
const SHEET_TYPE_WORKSHEET = 0x00
const MAX_BIFF8_ROW = 0xffff
const MAX_BIFF8_COL = 0xff
const MAX_RECORDS = 500_000
const MAX_CELLS = 100_000
const MAX_TEXT_CHARS = 4_000_000
const MAX_EMPTY_RUN = 8

/**
 * Extract readable text from a legacy Excel 97-2003 (.xls, BIFF8) workbook:
 * one `# SheetName` section per sheet, cells joined with ` | ` matching `xlsxToText`.
 * Numeric date/time cells are emitted as raw Excel serial numbers (XF/FORMAT/DATEMODE formatting is not applied).
 * Non-worksheet sheets (such as chart sheets, macro sheets, and VB modules) are skipped.
 */
export async function xlsToText(bytes: Uint8Array): Promise<string> {
  const container = CFB.read(Buffer.from(bytes), { type: 'buffer' })
  const entry =
    CFB.find(container, 'Workbook') ??
    CFB.find(container, 'Book') ??
    CFB.find(container, '/Workbook') ??
    CFB.find(container, '/Book')
  if (!entry || !entry.content) {
    throw new Error('Invalid xls: missing Workbook/Book stream in OLE2 container')
  }
  const stream =
    entry.content instanceof Uint8Array ? entry.content : new Uint8Array(entry.content)
  const sheets = readBiff8Workbook(stream)
  return sheets
    .map((sheet) => {
      const lines: string[] = [`# ${sheet.name}`]
      const rowNums = [...sheet.rows.keys()].sort((a, b) => a - b)
      for (const r of rowNums) {
        const rowMap = sheet.rows.get(r)!
        const maxCol = Math.max(...rowMap.keys())
        const cells: string[] = []
        for (let c = 0; c <= maxCol; c++) {
          cells.push(rowMap.get(c) ?? '')
        }
        const joined = joinRowCells(cells)
        if (joined !== '') lines.push(joined)
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

function joinRowCells(cells: readonly string[]): string {
  const out: string[] = []
  let run = 0
  for (const cell of cells) {
    if (cell === '') {
      run += 1
      continue
    }
    if (run > MAX_EMPTY_RUN) out.push(`(${run} empty)`)
    else for (; run > 0; run -= 1) out.push('')
    run = 0
    out.push(cell)
  }
  return out.join(' | ')
}

function readBiff8Workbook(stream: Uint8Array): BiffSheet[] {
  if (stream.byteLength < 8 || readU16(stream, 0) !== BOF) {
    throw new Error('Invalid xls: workbook stream does not start with a BOF record')
  }
  const bofLength = readU16(stream, 2)
  if (bofLength < 4 || 4 + bofLength > stream.byteLength) {
    throw new Error('Invalid xls: truncated workbook BOF record')
  }
  const version = readU16(stream, 4)
  if (version !== BIFF8_VERSION) {
    throw new Error(`Unsupported BIFF version 0x${version.toString(16)} (expected BIFF8 0x0600)`)
  }
  const globalsKind = readU16(stream, 6)
  if (globalsKind !== SUBSTREAM_WORKBOOK_GLOBALS) {
    throw new Error(
      `Invalid xls: expected workbook globals BOF (0x0005), got 0x${globalsKind.toString(16)}`,
    )
  }

  const bounds: { name: string; position: number; sheetType: number }[] = []
  let sst: string[] = []
  const globalsRecords: BiffRecord[] = []
  const budget: ExtractionBudget = { records: 0, cells: 0, chars: 0 }
  let at = 0
  let globalsSawEof = false
  while (at < stream.byteLength) {
    if (at + 4 > stream.byteLength) {
      throw new Error('Invalid xls: truncated record header in workbook globals')
    }
    if (budget.records >= MAX_RECORDS) {
      throw new Error(`Invalid xls: workbook exceeds maximum record limit (${MAX_RECORDS})`)
    }
    const type = readU16(stream, at)
    const length = readU16(stream, at + 2)
    if (at + 4 + length > stream.byteLength) {
      throw new Error('Invalid xls: a record runs past the workbook stream')
    }
    if (type === FILEPASS) {
      throw new Error('Unsupported xls: workbook is password-protected')
    }
    globalsRecords.push({ type, data: stream.subarray(at + 4, at + 4 + length) })
    at += 4 + length
    budget.records += 1
    if (type === EOF) {
      globalsSawEof = true
      break
    }
  }
  if (!globalsSawEof) {
    throw new Error('Invalid xls: workbook globals substream missing EOF')
  }
  const globalsEnd = at

  let seenSst = false
  for (let i = 0; i < globalsRecords.length; i++) {
    const record = globalsRecords[i]
    if (!record) continue
    if (record.type === BOUNDSHEET) {
      bounds.push(readBoundsheet(record.data))
    } else if (record.type === SST) {
      if (seenSst) {
        throw new Error('Invalid xls: duplicate SST record in workbook globals')
      }
      seenSst = true
      const parts = [record.data]
      while (i + 1 < globalsRecords.length && globalsRecords[i + 1]?.type === CONTINUE) {
        i += 1
        parts.push(globalsRecords[i]!.data)
      }
      sst = readSst(parts, budget)
    }
  }
  if (bounds.length === 0) {
    throw new Error('Invalid xls: no BOUNDSHEET records in the workbook stream')
  }
  if (bounds.length > 256) {
    throw new Error(`Invalid xls: ${bounds.length} sheets exceeds limit`)
  }

  const seenOffsets = new Set<number>()
  for (const sheet of bounds) {
    if (seenOffsets.has(sheet.position)) {
      throw new Error(
        `Invalid xls: duplicate BOUNDSHEET offset ${sheet.position} for sheet ${sheet.name}`,
      )
    }
    seenOffsets.add(sheet.position)
    if (sheet.position < globalsEnd || sheet.position + 8 > stream.byteLength) {
      throw new Error(`Invalid xls: sheet ${sheet.name} offset ${sheet.position} is out of bounds`)
    }
    const sheetBofType = readU16(stream, sheet.position)
    const sheetBofLen = readU16(stream, sheet.position + 2)
    if (
      sheetBofType !== BOF ||
      sheetBofLen < 4 ||
      sheet.position + 4 + sheetBofLen > stream.byteLength
    ) {
      throw new Error(`Invalid xls: sheet ${sheet.name} does not start with a valid BOF record`)
    }
    const sheetVersion = readU16(stream, sheet.position + 4)
    const sheetKind = readU16(stream, sheet.position + 6)
    if (sheetVersion !== BIFF8_VERSION) {
      throw new Error(`Invalid xls: sheet ${sheet.name} does not start with a BIFF8 BOF`)
    }
    if (sheet.sheetType === SHEET_TYPE_WORKSHEET && sheetKind !== SUBSTREAM_WORKSHEET) {
      throw new Error(`Invalid xls: sheet ${sheet.name} does not start with a BIFF8 worksheet BOF`)
    }
  }

  const sortedOffsets = [...seenOffsets].sort((a, b) => a - b)
  const maxEndByOffset = new Map<number, number>()
  for (let i = 0; i < sortedOffsets.length; i++) {
    const start = sortedOffsets[i]!
    const nextStart = i + 1 < sortedOffsets.length ? sortedOffsets[i + 1]! : stream.byteLength
    maxEndByOffset.set(start, nextStart)
  }

  return bounds
    .filter((sheet) => sheet.sheetType === SHEET_TYPE_WORKSHEET)
    .map((sheet) => {
      const maxEnd = maxEndByOffset.get(sheet.position)!
      return {
        name: sheet.name,
        rows: readSheet(stream, sheet.position, maxEnd, sst, budget, sheet.name),
      }
    })
}

function validateCellCoords(row: number, col: number): void {
  if (row < 0 || row > MAX_BIFF8_ROW || col < 0 || col > MAX_BIFF8_COL) {
    throw new Error(`Invalid xls: cell coordinates (${row}, ${col}) exceed BIFF8 column/row bounds`)
  }
}

function readSheet(
  stream: Uint8Array,
  start: number,
  maxEnd: number,
  sst: readonly string[],
  budget: ExtractionBudget,
  sheetName: string,
): Map<number, Map<number, string>> {
  const rows = new Map<number, Map<number, string>>()
  const put = (row: number, col: number, text: string): void => {
    validateCellCoords(row, col)
    if (text === '') return
    budget.cells += 1
    budget.chars += text.length
    if (budget.cells > MAX_CELLS || budget.chars > MAX_TEXT_CHARS) {
      throw new Error('Invalid xls: workbook exceeds maximum extracted cell/text limit')
    }
    let rowMap = rows.get(row)
    if (!rowMap) {
      rowMap = new Map()
      rows.set(row, rowMap)
    }
    rowMap.set(col, text)
  }

  const initialBofLen = readU16(stream, start + 2)
  let at = start + 4 + initialBofLen
  budget.records += 1
  if (budget.records > MAX_RECORDS) {
    throw new Error(`Invalid xls: workbook exceeds maximum record limit (${MAX_RECORDS})`)
  }

  const collectContinueChain = (firstPayload: Uint8Array): Uint8Array[] => {
    const parts = [firstPayload]
    while (at + 4 <= maxEnd && readU16(stream, at) === CONTINUE) {
      if (budget.records >= MAX_RECORDS) {
        throw new Error(`Invalid xls: workbook exceeds maximum record limit (${MAX_RECORDS})`)
      }
      const contLen = readU16(stream, at + 2)
      if (at + 4 + contLen > maxEnd) {
        throw new Error('Invalid xls: CONTINUE record runs past worksheet substream')
      }
      parts.push(stream.subarray(at + 4, at + 4 + contLen))
      at += 4 + contLen
      budget.records += 1
    }
    return parts
  }

  let nestedDepth = 0
  let sawEof = false
  let pendingStringCell: { row: number; col: number } | null = null

  while (at < maxEnd) {
    if (at + 4 > maxEnd) {
      throw new Error(`Invalid xls: truncated record header in sheet ${sheetName}`)
    }
    if (budget.records >= MAX_RECORDS) {
      throw new Error(`Invalid xls: workbook exceeds maximum record limit (${MAX_RECORDS})`)
    }
    const type = readU16(stream, at)
    const length = readU16(stream, at + 2)
    if (at + 4 + length > maxEnd) {
      throw new Error(`Invalid xls: record runs past substream boundary in sheet ${sheetName}`)
    }
    const data = stream.subarray(at + 4, at + 4 + length)
    at += 4 + length
    budget.records += 1

    if (type === FILEPASS) {
      throw new Error('Unsupported xls: workbook is password-protected')
    }
    if (type === BOF) {
      if (length < 4) {
        throw new Error(`Invalid xls: truncated nested BOF record in sheet ${sheetName}`)
      }
      const nestedKind = readU16(data, 2)
      if (nestedKind === SUBSTREAM_WORKSHEET || nestedKind === SUBSTREAM_WORKBOOK_GLOBALS) {
        throw new Error(`Invalid xls: overlapping substream BOF inside sheet ${sheetName}`)
      }
      nestedDepth += 1
      pendingStringCell = null
      continue
    }
    if (type === EOF) {
      if (nestedDepth > 0) {
        nestedDepth -= 1
        continue
      }
      pendingStringCell = null
      sawEof = true
      break
    }
    if (nestedDepth > 0) {
      continue
    }

    if (type !== STRING && type !== SHRFMLA && type !== ARRAY && type !== TABLE) {
      pendingStringCell = null
    }

    switch (type) {
      case LABELSST: {
        if (length < 10) break
        const row = readU16(data, 0)
        const col = readU16(data, 2)
        validateCellCoords(row, col)
        const index = readU32(data, 6)
        const text = sst[index]
        if (text === undefined) throw new Error(`Invalid xls: SST index ${index} out of range`)
        put(row, col, text)
        break
      }
      case LABEL: {
        if (length < 9) throw new Error('Invalid xls: truncated LABEL record')
        const row = readU16(data, 0)
        const col = readU16(data, 2)
        validateCellCoords(row, col)
        const parts = collectContinueChain(data.subarray(6))
        put(row, col, readSingleString(parts, 'LABEL'))
        break
      }
      case RK: {
        if (length < 10) break
        put(readU16(data, 0), readU16(data, 2), numberText(decodeRk(readU32(data, 6))))
        break
      }
      case NUMBER: {
        if (length < 14) break
        put(readU16(data, 0), readU16(data, 2), numberText(readDouble(data, 6)))
        break
      }
      case MULRK: {
        if (length < 12) break
        const row = readU16(data, 0)
        const first = readU16(data, 2)
        const n = Math.floor((length - 6) / 6)
        for (let i = 0; i < n; i++) {
          put(row, first + i, numberText(decodeRk(readU32(data, 4 + i * 6 + 2))))
        }
        break
      }
      case BLANK: {
        if (length >= 4) validateCellCoords(readU16(data, 0), readU16(data, 2))
        break
      }
      case MULBLANK: {
        if (length >= 6) {
          const row = readU16(data, 0)
          validateCellCoords(row, readU16(data, 2))
          validateCellCoords(row, readU16(data, length - 2))
        }
        break
      }
      case BOOLERR: {
        if (length < 8) break
        const row = readU16(data, 0)
        const col = readU16(data, 2)
        validateCellCoords(row, col)
        if (data[7] !== 0) break
        put(row, col, data[6] !== 0 ? 'TRUE' : 'FALSE')
        break
      }
      case FORMULA: {
        if (length < 14) break
        const row = readU16(data, 0)
        const col = readU16(data, 2)
        validateCellCoords(row, col)
        if (data[12] === 0xff && data[13] === 0xff) {
          if (data[6] === 1) put(row, col, data[8] !== 0 ? 'TRUE' : 'FALSE')
          else if (data[6] === 0) pendingStringCell = { row, col }
        } else {
          put(row, col, numberText(readDouble(data, 6)))
        }
        break
      }
      case SHRFMLA:
      case ARRAY:
      case TABLE:
        break
      case STRING: {
        const parts = collectContinueChain(data)
        const text = readSingleString(parts, 'STRING')
        if (pendingStringCell !== null) {
          put(pendingStringCell.row, pendingStringCell.col, text)
          pendingStringCell = null
        }
        break
      }
      default:
        break
    }
  }
  if (!sawEof) {
    throw new Error(`Invalid xls: worksheet substream for ${sheetName} missing EOF`)
  }
  return rows
}


function readBoundsheet(data: Uint8Array): { name: string; position: number; sheetType: number } {
  if (data.byteLength < 8) throw new Error('Invalid xls: truncated BOUNDSHEET record')
  const sheetType = data[5] ?? 0
  const cch = data[6] ?? 0
  const grbit = data[7] ?? 0
  const bytes = grbit & 1 ? cch * 2 : cch
  if (data.byteLength < 8 + bytes) throw new Error('Invalid xls: BOUNDSHEET name runs past record')
  const name =
    grbit & 1
      ? new TextDecoder('utf-16le').decode(data.subarray(8, 8 + bytes))
      : latin1(data.subarray(8, 8 + bytes))
  return { name, position: readU32(data, 0), sheetType }
}

class BiffStringReader {
  private part = 0
  private at: number
  private readonly parts: readonly Uint8Array[]

  constructor(parts: readonly Uint8Array[], initialOffset = 0) {
    this.parts = parts
    this.at = initialOffset
  }

  private advance(): boolean {
    if (this.part + 1 >= this.parts.length) return false
    this.part += 1
    this.at = 0
    return true
  }

  readString(label: string): string {
    while (this.at >= this.parts[this.part]!.byteLength) {
      if (!this.advance()) {
        throw new Error(`Invalid xls: ${label} ended before string header`)
      }
    }
    const headerPart = this.parts[this.part]!
    if (this.at + 3 > headerPart.byteLength) {
      throw new Error(`Invalid xls: truncated ${label} string header`)
    }
    const cch = readU16(headerPart, this.at)
    const grbit = headerPart[this.at + 2]!
    if ((grbit & ~0x0d) !== 0) {
      throw new Error(`Invalid xls: invalid ${label} string flags 0x${grbit.toString(16)}`)
    }
    const rich = (grbit & 0x08) !== 0
    const phonetic = (grbit & 0x04) !== 0
    const fixedLen = 3 + (rich ? 2 : 0) + (phonetic ? 4 : 0)
    if (this.at + fixedLen > headerPart.byteLength) {
      throw new Error(`Invalid xls: truncated ${label} fixed string header`)
    }
    let pos = this.at + 3
    const runs = rich ? readU16(headerPart, pos) : 0
    if (rich) pos += 2
    const extension = phonetic ? readU32(headerPart, pos) : 0
    if (phonetic) pos += 4
    this.at = pos

    let high = (grbit & 0x01) !== 0
    let text = ''
    let remaining = cch
    while (remaining > 0) {
      const cur = this.parts[this.part]!
      if (this.at >= cur.byteLength) {
        if (!this.advance()) {
          throw new Error(`Invalid xls: ${label} string runs past CONTINUE chain`)
        }
        const nextPart = this.parts[this.part]!
        if (nextPart.byteLength < 1) {
          throw new Error(`Invalid xls: empty CONTINUE record in ${label}`)
        }
        const contGrbit = nextPart[0]!
        if ((contGrbit & ~0x01) !== 0) {
          throw new Error(
            `Invalid xls: invalid CONTINUE flags 0x${contGrbit.toString(16)} in ${label}`,
          )
        }
        high = (contGrbit & 0x01) !== 0
        this.at = 1
        if (this.at >= nextPart.byteLength) {
          throw new Error(`Invalid xls: CONTINUE record in ${label} has no character data`)
        }
        continue
      }
      const availBytes = cur.byteLength - this.at
      const step = high ? 2 : 1
      if (high && availBytes < 2) {
        throw new Error(`Invalid xls: odd byte boundary in UTF-16 ${label} string`)
      }
      const take = Math.min(remaining, Math.floor(availBytes / step))
      for (let i = 0; i < take; i++) {
        const code = high ? readU16(cur, this.at + i * 2) : cur[this.at + i]!
        text += String.fromCharCode(code)
      }
      this.at += take * step
      remaining -= take
    }

    let skip = runs * 4 + extension
    while (skip > 0) {
      const cur = this.parts[this.part]!
      const available = cur.byteLength - this.at
      if (available <= 0) {
        if (!this.advance()) {
          throw new Error(`Invalid xls: ${label} extras run past CONTINUE chain`)
        }
        if (this.parts[this.part]!.byteLength === 0) {
          throw new Error(`Invalid xls: empty CONTINUE record in ${label} extras`)
        }
        continue
      }
      const step = Math.min(skip, available)
      this.at += step
      skip -= step
    }
    return text
  }

  isFullyConsumed(): boolean {
    return this.part + 1 === this.parts.length && this.at === this.parts[this.part]!.byteLength
  }
}

function readSst(parts: readonly Uint8Array[], budget: ExtractionBudget): string[] {
  if (parts.length === 0 || parts[0]!.byteLength < 8) {
    throw new Error('Invalid xls: truncated SST record')
  }
  const total = readU32(parts[0]!, 0)
  const unique = readU32(parts[0]!, 4)
  if (unique > 1_000_000 || total < unique) {
    throw new Error(`Invalid xls: implausible SST counts ${total}/${unique}`)
  }
  const reader = new BiffStringReader(parts, 8)
  const out: string[] = []
  for (let index = 0; index < unique; index++) {
    const str = reader.readString(`SST[${index}]`)
    budget.chars += str.length
    if (budget.chars > MAX_TEXT_CHARS) {
      throw new Error('Invalid xls: workbook exceeds maximum extracted cell/text limit')
    }
    out.push(str)
  }
  return out
}

function readSingleString(parts: readonly Uint8Array[], label: string): string {
  if (parts.length === 0 || parts[0]!.byteLength < 3) {
    throw new Error(`Invalid xls: truncated ${label} record`)
  }
  const reader = new BiffStringReader(parts, 0)
  const text = reader.readString(label)
  if (!reader.isFullyConsumed()) {
    throw new Error(`Invalid xls: trailing bytes or unconsumed CONTINUE in ${label} chain`)
  }
  return text
}

/** MS-XLS 2.5.122 RkNumber: bit 0 = fX100 (/100), bit 1 = fInt (signed 30-bit integer). */
function decodeRk(rk: number): number {
  let value: number
  if (rk & 2) {
    value = rk >> 2
  } else {
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setUint32(0, rk & 0xfffffffc)
    value = view.getFloat64(0)
  }
  return rk & 1 ? value / 100 : value
}

function numberText(value: number): string {
  return Number.isFinite(value) ? String(value) : ''
}

function latin1(data: Uint8Array): string {
  let out = ''
  for (let i = 0; i < data.byteLength; i++) out += String.fromCharCode(data[i] ?? 0)
  return out
}

function readU16(data: Uint8Array, at: number): number {
  return (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8)
}

function readU32(data: Uint8Array, at: number): number {
  return (
    ((data[at] ?? 0) | ((data[at + 1] ?? 0) << 8) | ((data[at + 2] ?? 0) << 16)) +
    (data[at + 3] ?? 0) * 0x1000000
  )
}

function readDouble(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset + at, 8).getFloat64(0, true)
}
