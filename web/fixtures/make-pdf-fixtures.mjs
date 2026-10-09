// Generates the PDF fixtures of the PDF web module e2e (GO-B4 / UNI-1014):
//   pdf-form.pdf       3 pages of text + an AcroForm (text field, checkbox, dropdown)   pdf-lib
//   pdf-scanned.pdf    one page that is a JPEG scan (DCTDecode, ICCBased colour space)  ghostscript + pdf-lib
//   pdf-fonts.pdf      text in embedded fonts (Type 1/CFF and TrueType subsets)         ghostscript
//   pdf-encrypted.pdf  AES-encrypted, user password "secret"                            ghostscript
// Run: node web/fixtures/make-pdf-fixtures.mjs   (ghostscript `gs` 10.x on PATH; the outputs are committed)
// No JPX / JBIG2 fixture: neither encoder exists in this toolchain (ghostscript cannot write them).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib'

const here = dirname(fileURLToPath(import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'pdf-fixtures-'))
const gs = (...args) => execFileSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', ...args])
// fixed dates so regenerating gives the same files
const FIXED = new Date('2026-10-09T00:00:00Z')

function stamp(doc, title) {
  doc.setTitle(title)
  doc.setProducer('UniWork fixture')
  doc.setCreator('make-pdf-fixtures.mjs')
  doc.setCreationDate(FIXED)
  doc.setModificationDate(FIXED)
}

async function form() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const n of [1, 2, 3]) {
    const page = doc.addPage([595, 842])
    page.drawText(`Form fixture, page ${n}`, { x: 60, y: 760, size: 22, font })
    page.drawText('The quick brown fox jumps over the lazy dog.', { x: 60, y: 720, size: 14, font })
    page.drawText('Highlight this sentence on the web.', { x: 60, y: 690, size: 14, font })
    page.drawRectangle({ x: 60, y: 300, width: 200, height: 120, color: rgb(0.85, 0.9, 1) })
  }
  const first = doc.getPage(0)
  first.drawText('Name:', { x: 60, y: 612, size: 12, font })
  first.drawText('I agree', { x: 84, y: 572, size: 12, font })
  first.drawText('Country:', { x: 60, y: 532, size: 12, font })
  const f = doc.getForm()
  f.createTextField('name').addToPage(first, { x: 130, y: 600, width: 220, height: 22 })
  f.createCheckBox('agree').addToPage(first, { x: 60, y: 568, width: 16, height: 16 })
  const dd = f.createDropdown('country')
  dd.addOptions(['Viet Nam', 'Singapore', 'Japan'])
  dd.addToPage(first, { x: 130, y: 524, width: 160, height: 22 })
  stamp(doc, 'Form fixture')
  return doc.save({ useObjectStreams: false })
}

async function scanned() {
  // a "scan": a text page rasterised to JPEG by ghostscript, placed as the only page content
  const ps = join(tmp, 'scan.ps')
  writeFileSync(
    ps,
    [
      '%!PS',
      '<< /PageSize [595 842] >> setpagedevice',
      '/Times-Roman findfont 26 scalefont setfont 60 760 moveto (Scanned page fixture) show',
      '/Times-Roman findfont 14 scalefont setfont 60 720 moveto (No text layer: the words are pixels.) show',
      '0.8 0.2 0.2 setrgbcolor 60 400 300 200 rectfill',
      'showpage',
    ].join('\n'),
  )
  const jpg = join(tmp, 'scan.jpg')
  gs('-sDEVICE=jpeg', '-r60', '-dJPEGQ=70', `-sOutputFile=${jpg}`, ps)
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const img = await doc.embedJpg(readFileSync(jpg))
  page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 })
  // ICC-tagged like a real scanner output: pdf.js converts it through its colour code
  const gsShare = '/usr/share/ghostscript'
  const version = readdirSync(gsShare).find((d) => /^\d/.test(d))
  const icc = readFileSync(join(gsShare, version, 'iccprofiles', 'default_rgb.icc'))
  const profile = doc.context.flateStream(icc, { N: 3, Alternate: 'DeviceRGB' })
  const ref = doc.context.register(profile)
  await doc.flush() // pdf-lib writes the image stream on flush
  const xobj = doc.context.lookup(img.ref)
  xobj.dict.set(PDFName.of('ColorSpace'), doc.context.obj([PDFName.of('ICCBased'), ref]))
  stamp(doc, 'Scanned fixture')
  return doc.save({ useObjectStreams: false })
}

function fonts() {
  const ps = join(tmp, 'fonts.ps')
  const line = (font, size, y, text) =>
    `/${font} findfont ${size} scalefont setfont 60 ${y} moveto (${text}) show`
  writeFileSync(
    ps,
    [
      '%!PS',
      '<< /PageSize [595 842] >> setpagedevice',
      line('Times-Roman', 24, 760, 'Embedded fonts fixture'),
      line('Helvetica-Bold', 16, 720, 'Helvetica Bold (embedded URW subset)'),
      line('Courier', 14, 690, 'Courier: monospace 0123456789'),
      line('Palatino-Italic', 14, 660, 'Palatino Italic'),
      line('LiberationSans', 14, 630, 'Liberation Sans (TrueType via fontconfig)'),
      'showpage',
    ].join('\n'),
  )
  const out = join(tmp, 'fonts.pdf')
  gs('-sDEVICE=pdfwrite', '-dEmbedAllFonts=true', '-dSubsetFonts=true', `-sOutputFile=${out}`, ps)
  return readFileSync(out)
}

function encrypted(src) {
  const inp = join(tmp, 'plain.pdf')
  writeFileSync(inp, src)
  const out = join(tmp, 'enc.pdf')
  gs(
    '-sDEVICE=pdfwrite',
    '-sOwnerPassword=owner',
    '-sUserPassword=secret',
    '-dEncryptionR=3',
    '-dKeyLength=128',
    `-sOutputFile=${out}`,
    inp,
  )
  return readFileSync(out)
}

try {
  const formBytes = await form()
  writeFileSync(resolve(here, 'pdf-form.pdf'), formBytes)
  writeFileSync(resolve(here, 'pdf-scanned.pdf'), await scanned())
  writeFileSync(resolve(here, 'pdf-fonts.pdf'), fonts())
  writeFileSync(resolve(here, 'pdf-encrypted.pdf'), encrypted(formBytes))
  console.log('wrote pdf-form.pdf, pdf-scanned.pdf, pdf-fonts.pdf, pdf-encrypted.pdf')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
