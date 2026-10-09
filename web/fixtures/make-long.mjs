// Generates web/fixtures/long.docx (~50 pages A4): headings + paragraphs + a few tables.
// Run: node web/fixtures/make-long.mjs
import JSZip from 'jszip'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const p = (t, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`
const filler =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.'
const table = (n) =>
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${[1, 2, 3, 4]
    .map(
      (r) =>
        `<w:tr>${[1, 2, 3].map((c) => `<w:tc>${p(`T${n} R${r}C${c}`)}</w:tc>`).join('')}</w:tr>`,
    )
    .join('')}</w:tbl>`
let body = ''
const CHAPTERS = 50
for (let i = 1; i <= CHAPTERS; i++) {
  body += p(`Chapter ${i}`, 'Heading1')
  for (let k = 1; k <= 8; k++) body += p(`${filler} (c${i}.p${k})`)
  if (i % 10 === 0) body += table(i / 10) + p('')
}
const sect =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'

// reuse styles/rels/content-types from the generated simple.docx so the engine sees familiar parts
const base = await JSZip.loadAsync(
  (await import('node:fs')).readFileSync(resolve(here, '../../fixtures/generated/simple.docx')),
)
const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}${sect}</w:body></w:document>`
base.file('word/document.xml', doc)
const buf = await base.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
writeFileSync(resolve(here, 'long.docx'), buf)
console.log(
  `long.docx ${buf.length} bytes, ${CHAPTERS} chapters x 8 paras, ${Math.floor(CHAPTERS / 10)} tables`,
)
