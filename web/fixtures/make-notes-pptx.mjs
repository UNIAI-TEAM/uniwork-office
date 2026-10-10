// Generates web/fixtures/notes-plain-shape.pptx: sample.pptx with a Vietnamese speaker note on slide 1,
// held (like the UniWork visual-host deck "Deck Vietnamese Notes") in a plain shape named
// "Notes Placeholder" that has no <p:ph>. Run: node web/fixtures/make-notes-pptx.mjs
import JSZip from 'jszip'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const zip = await JSZip.loadAsync(readFileSync(resolve(here, 'sample.pptx')))

const relsPath = 'ppt/slides/_rels/slide1.xml.rels'
const rels = await zip.file(relsPath).async('string')
zip.file(
  relsPath,
  rels.replace(
    '</Relationships>',
    '<Relationship Id="rIdNotes1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
  ),
)
zip.file(
  'ppt/notesSlides/notesSlide1.xml',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/>' +
    '<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="vi-VN" sz="2400"/><a:t>Ghi chú trình bày cho buổi họp tuần.</a:t></a:r></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld></p:notes>',
)
const ct = await zip.file('[Content_Types].xml').async('string')
zip.file(
  '[Content_Types].xml',
  ct.replace(
    '</Types>',
    '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>',
  ),
)
writeFileSync(
  resolve(here, 'notes-plain-shape.pptx'),
  await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
)
