import * as CFB from 'cfb'

interface BiffRecord {
  readonly type: number
  readonly data: Uint8Array
}

interface BiffSheet {
  readonly name: string
  readonly rows: Map<number, Map<number, string>>
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
const FORMULA = 0x0006
const STRING = 0x0207
const BOOLERR = 0x0205
const FILEPASS = 0x002f
const MAX_RECORDS = 500_000
const MAX_EMPTY_RUN = 8

/**
 * Extract readable text from a legacy Excel 97-2003 (.xls, BIFF8) workbook:
 * one `# SheetName` section per sheet, cells joined with ` | ` matching `xlsxToText`.
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
  const version = readU16(stream, 4)
  if (version !== 0x0600) {
    throw new Error(`Unsupported BIFF version 0x${version.toString(16)} (expected BIFF8 0x0600)`)
  }

  const bounds: { name: string; position: number }[] = []
  let sst: string[] = []
  const records: BiffRecord[] = []
  let at = 0
  let count = 0
  while (at + 4 <= stream.byteLength && count < MAX_RECORDS) {
    const type = readU16(stream, at)
    const length = readU16(stream, at + 2)
    if (at + 4 + length > stream.byteLength) {
      throw new Error('Invalid xls: a record runs past the workbook stream')
    }
    if (type === FILEPASS) {
      throw new Error('Unsupported xls: workbook is password-protected')
    }
    records.push({ type, data: stream.subarray(at + 4, at + 4 + length) })
    at += 4 + length
    count++
    if (type === 0 && length === 0) break
  }

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    if (record.type === BOUNDSHEET) {
      bounds.push(readBoundsheet(record.data))
    } else if (record.type === SST) {
      const parts = [record.data]
      let j = i + 1
      while (j < records.length && records[j]?.type === CONTINUE) {
        parts.push(records[j]!.data)
        j++
      }
      sst = readSst(parts)
    }
  }
  if (bounds.length === 0) {
    throw new Error('Invalid xls: no BOUNDSHEET records in the workbook stream')
  }
  if (bounds.length > 256) {
    throw new Error(`Invalid xls: ${bounds.length} sheets exceeds limit`)
  }

  return bounds.map((sheet) => {
    if (sheet.position + 4 > stream.byteLength) {
      throw new Error(`Invalid xls: sheet ${sheet.name} starts past the stream`)
    }
    if (readU16(stream, sheet.position) !== BOF) {
      throw new Error(`Invalid xls: sheet ${sheet.name} does not start with a BOF record`)
    }
    return { name: sheet.name, rows: readSheet(stream, sheet.position, sst) }
  })
}

function readSheet(
  stream: Uint8Array,
  start: number,
  sst: readonly string[],
): Map<number, Map<number, string>> {
  const rows = new Map<number, Map<number, string>>()
  const put = (row: number, col: number, text: string): void => {
    if (row < 0 || col < 0 || row > 1_048_575 || col > 16_383 || text === '') return
    let rowMap = rows.get(row)
    if (!rowMap) {
      rowMap = new Map()
      rows.set(row, rowMap)
    }
    rowMap.set(col, text)
  }

  let at = start
  let count = 0
  while (at + 4 <= stream.byteLength && count < MAX_RECORDS) {
    const type = readU16(stream, at)
    const length = readU16(stream, at + 2)
    if (at + 4 + length > stream.byteLength) break
    const data = stream.subarray(at + 4, at + 4 + length)
    at += 4 + length
    count++
    switch (type) {
      case LABELSST: {
        if (length < 10) break
        const index = readU32(data, 6)
        const text = sst[index]
        if (text === undefined) throw new Error(`Invalid xls: SST index ${index} out of range`)
        put(readU16(data, 0), readU16(data, 2), text)
        break
      }
      case LABEL: {
        if (length < 8) break
        put(readU16(data, 0), readU16(data, 2), readXLUnicodeString(data, 6))
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
      case BOOLERR: {
        if (length < 8 || data[7] !== 0) break
        put(readU16(data, 0), readU16(data, 2), data[6] !== 0 ? 'TRUE' : 'FALSE')
        break
      }
      case FORMULA: {
        if (length < 14) break
        const row = readU16(data, 0)
        const col = readU16(data, 2)
        if (data[12] === 0xff && data[13] === 0xff) {
          if (data[6] === 1) put(row, col, data[8] !== 0 ? 'TRUE' : 'FALSE')
          else if (data[6] === 0) {
            const next = readRecord(stream, at)
            if (next && next.type === STRING) {
              put(row, col, readXLUnicodeString(next.data, 0))
            }
          }
        } else {
          put(row, col, numberText(readDouble(data, 6)))
        }
        break
      }
      default:
        break
    }
    if (type === EOF) break
  }
  return rows
}

function readRecord(stream: Uint8Array, at: number): BiffRecord | null {
  if (at + 4 > stream.byteLength) return null
  const type = readU16(stream, at)
  const length = readU16(stream, at + 2)
  if (at + 4 + length > stream.byteLength) return null
  return { type, data: stream.subarray(at + 4, at + 4 + length) }
}

function readBoundsheet(data: Uint8Array): { name: string; position: number } {
  if (data.byteLength < 8) throw new Error('Invalid xls: truncated BOUNDSHEET record')
  const cch = data[6] ?? 0
  const grbit = data[7] ?? 0
  const bytes = grbit & 1 ? cch * 2 : cch
  if (data.byteLength < 8 + bytes) throw new Error('Invalid xls: BOUNDSHEET name runs past record')
  const name =
    grbit & 1
      ? new TextDecoder('utf-16le').decode(data.subarray(8, 8 + bytes))
      : latin1(data.subarray(8, 8 + bytes))
  return { name, position: readU32(data, 0) }
}

function readSst(parts: readonly Uint8Array[]): string[] {
  if (parts.length === 0 || parts[0]!.byteLength < 8) {
    throw new Error('Invalid xls: truncated SST record')
  }
  const total = readU32(parts[0]!, 0)
  const unique = readU32(parts[0]!, 4)
  if (unique > 1_000_000 || total < unique) {
    throw new Error(`Invalid xls: implausible SST counts ${total}/${unique}`)
  }
  const out: string[] = []
  let part = 0
  let at = 8
  const advance = (): boolean => {
    if (part + 1 >= parts.length) return false
    part++
    at = 0
    return true
  }
  const byte = (): number => {
    const value = parts[part]![at] ?? 0
    at++
    return value
  }
  const u16 = (): number => {
    let value = byte()
    value |= byte() << 8
    return value
  }
  const u32 = (): number => {
    let value = u16()
    value += u16() * 0x10000
    return value
  }
  for (let index = 0; index < unique; index++) {
    while (at >= parts[part]!.byteLength && advance()) {
      /* skip empty CONTINUE payloads */
    }
    if (at >= parts[part]!.byteLength) {
      throw new Error(`Invalid xls: SST ended at string ${index} of ${unique}`)
    }
    const cch = u16()
    const grbit = byte()
    const rich = (grbit & 0x08) !== 0
    const phonetic = (grbit & 0x04) !== 0
    const runs = rich ? u16() : 0
    const extension = phonetic ? u32() : 0
    let high = (grbit & 0x01) !== 0
    let text = ''
    let remaining = cch
    while (remaining > 0) {
      if (at >= parts[part]!.byteLength) {
        if (!advance()) throw new Error(`Invalid xls: SST string ${index} runs past chain`)
        if (parts[part]!.byteLength === 0) continue
        const grbitByte = byte()
        high = (grbitByte & 0x01) !== 0
        continue
      }
      const take = Math.min(
        remaining,
        Math.floor((parts[part]!.byteLength - at) / (high ? 2 : 1)),
      )
      if (take > 0) {
        const end = at + take * (high ? 2 : 1)
        text += high
          ? new TextDecoder('utf-16le').decode(parts[part]!.subarray(at, end))
          : latin1(parts[part]!.subarray(at, end))
        at = end
        remaining -= take
      } else if (!advance()) {
        throw new Error(`Invalid xls: SST string ${index} runs past chain`)
      }
    }
    let skip = runs * 4 + extension
    while (skip > 0) {
      const available = parts[part]!.byteLength - at
      if (available >= skip) {
        at += skip
        skip = 0
      } else {
        skip -= available
        if (!advance()) throw new Error(`Invalid xls: SST string ${index} extras run past chain`)
      }
    }
    out.push(text)
  }
  return out
}

function readXLUnicodeString(data: Uint8Array, at: number): string {
  if (at + 3 > data.byteLength) return ''
  const cch = readU16(data, at)
  const grbit = data[at + 2] ?? 0
  const start = at + 3
  const bytes = grbit & 1 ? cch * 2 : cch
  if (start + bytes > data.byteLength) return ''
  return grbit & 1
    ? new TextDecoder('utf-16le').decode(data.subarray(start, start + bytes))
    : latin1(data.subarray(start, start + bytes))
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
