// Generates a synthetic large workbook for the GO-D3 sidecar measurement:
// <rows> data rows x <cols> numeric columns plus one formula column
// (=A{r}+B{r}, cached <v> present) and one inline-string column.
// Usage: tsx gen-large.ts <out.xlsx> <rows> <cols>
import { writeFile } from 'node:fs/promises'

import JSZip from 'jszip'

function columnName(index: number): string {
  let name = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

async function main(): Promise<void> {
  const [out, rowsArg, colsArg] = process.argv.slice(2)
  if (!out) throw new Error('usage: gen-large.ts <out.xlsx> <rows> <cols>')
  const rows = Number(rowsArg ?? 100_000)
  const cols = Number(colsArg ?? 20)
  const formulaCol = columnName(cols)
  const textCol = columnName(cols + 1)
  const lines: string[] = []
  for (let r = 1; r <= rows; r += 1) {
    const cells: string[] = []
    for (let c = 0; c < cols; c += 1) {
      cells.push(`<c r="${columnName(c)}${r}"><v>${(r * 31 + c * 7) % 10007}</v></c>`)
    }
    const a = (r * 31) % 10007
    const b = (r * 31 + 7) % 10007
    cells.push(`<c r="${formulaCol}${r}"><f>A${r}+B${r}</f><v>${a + b}</v></c>`)
    cells.push(`<c r="${textCol}${r}" t="inlineStr"><is><t>row ${r} label</t></is></c>`)
    lines.push(`<row r="${r}">${cells.join('')}</row>`)
  }
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${textCol}${rows}"/><sheetData>${lines.join('')}</sheetData></worksheet>`
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  )
  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  )
  zip.file('xl/worksheets/sheet1.xml', sheet)
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  await writeFile(out, buffer)
  process.stdout.write(
    `${JSON.stringify({ out, rows, cols: cols + 2, cells: rows * (cols + 2), bytes: buffer.length, sheetXmlBytes: sheet.length })}\n`,
  )
}

void main()
