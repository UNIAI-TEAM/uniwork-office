/**
 * The PDF save core as the web frame uses it (GO-B4 / UNI-1014): the bytes-in/bytes-out functions
 * of apps/pdf/src/main, loaded on first use (pdf-lib, pdfium and harfbuzz are not part of the
 * initial bundle). The platform seams must be installed first (./core-env-web.ts).
 */
import type * as SavePdf from '../../../apps/pdf/src/main/save-pdf'
import type * as TextEdit from '../../../apps/pdf/src/main/text-edit'
import type * as ImageEdit from '../../../apps/pdf/src/main/image-edit'
import type * as BlankPdf from '../../../apps/pdf/src/main/blank-pdf'

export interface PdfCore {
  applyAndVerifySaveRequest: typeof SavePdf.applyAndVerifySaveRequest
  readStaticFormFills: typeof SavePdf.readStaticFormFills
  extractPagesBytes: typeof SavePdf.extractPagesBytes
  insertPdfBytes: typeof SavePdf.insertPdfBytes
  insertBlankPageBytes: typeof SavePdf.insertBlankPageBytes
  splitPdfBytes: typeof SavePdf.splitPdfBytes
  mergePdfBytes: typeof SavePdf.mergePdfBytes
  mergePagesBytes: typeof SavePdf.mergePagesBytes
  replacePagesBytes: typeof SavePdf.replacePagesBytes
  setPageSizeBytes: typeof SavePdf.setPageSizeBytes
  splitPagesBytes: typeof SavePdf.splitPagesBytes
  cropPagesBytes: typeof SavePdf.cropPagesBytes
  validateTextEdits: typeof TextEdit.validateTextEdits
  listEditFonts: typeof TextEdit.listEditFonts
  canDrawText: typeof TextEdit.canDrawText
  listPageImages: typeof ImageEdit.listPageImages
  renderImagePng: typeof ImageEdit.renderImagePng
  renderPagePreviewPng: typeof ImageEdit.renderPagePreviewPng
  blankPdfBuffer: typeof BlankPdf.blankPdfBuffer
}

let core: Promise<PdfCore> | null = null

export function loadPdfCore(): Promise<PdfCore> {
  core ??= Promise.all([
    import('../../../apps/pdf/src/main/save-pdf'),
    import('../../../apps/pdf/src/main/text-edit'),
    import('../../../apps/pdf/src/main/image-edit'),
    import('../../../apps/pdf/src/main/blank-pdf'),
  ]).then(
    ([save, text, image, blank]) => ({
      applyAndVerifySaveRequest: save.applyAndVerifySaveRequest,
      readStaticFormFills: save.readStaticFormFills,
      extractPagesBytes: save.extractPagesBytes,
      insertPdfBytes: save.insertPdfBytes,
      insertBlankPageBytes: save.insertBlankPageBytes,
      splitPdfBytes: save.splitPdfBytes,
      mergePdfBytes: save.mergePdfBytes,
      mergePagesBytes: save.mergePagesBytes,
      replacePagesBytes: save.replacePagesBytes,
      setPageSizeBytes: save.setPageSizeBytes,
      splitPagesBytes: save.splitPagesBytes,
      cropPagesBytes: save.cropPagesBytes,
      validateTextEdits: text.validateTextEdits,
      listEditFonts: text.listEditFonts,
      canDrawText: text.canDrawText,
      listPageImages: image.listPageImages,
      renderImagePng: image.renderImagePng,
      renderPagePreviewPng: image.renderPagePreviewPng,
      blankPdfBuffer: blank.blankPdfBuffer,
    }),
    (err: unknown) => {
      core = null
      throw err
    },
  )
  return core
}
