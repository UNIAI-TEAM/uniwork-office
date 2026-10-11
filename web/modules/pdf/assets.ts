/// <reference types="vite/client" />
/**
 * Same-origin build assets of the PDF save core (GO-B4): wasm binaries and the bundled fonts.
 * All are emitted as separate files by the web build (fonts under fonts/, never inlined) and
 * fetched on first use only.
 */
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'
// apps/pdf pins harfbuzzjs 0.10 (hb-subset.wasm at the package root); the root install is 1.x
import hbSubsetWasmUrl from '../../../apps/pdf/node_modules/harfbuzzjs/hb-subset.wasm?url'
// The Liberation faces are imported as `?url&ttf`: the save core reads their cmap and pdf-lib embeds
// the bytes, so they must stay real TTFs. A bare `.ttf?url` is rewritten to the WOFF2 twin by the web
// build (web/docs/build/fonts-woff2.ts), which the core cannot parse (Insert text refused every text).
import sansRegular from '../../../apps/docs/src/renderer/fonts/LiberationSans-Regular.ttf?url&ttf'
import sansBold from '../../../apps/docs/src/renderer/fonts/LiberationSans-Bold.ttf?url&ttf'
import sansItalic from '../../../apps/docs/src/renderer/fonts/LiberationSans-Italic.ttf?url&ttf'
import sansBoldItalic from '../../../apps/docs/src/renderer/fonts/LiberationSans-BoldItalic.ttf?url&ttf'
import serifRegular from '../../../apps/docs/src/renderer/fonts/LiberationSerif-Regular.ttf?url&ttf'
import serifBold from '../../../apps/docs/src/renderer/fonts/LiberationSerif-Bold.ttf?url&ttf'
import serifItalic from '../../../apps/docs/src/renderer/fonts/LiberationSerif-Italic.ttf?url&ttf'
import serifBoldItalic from '../../../apps/docs/src/renderer/fonts/LiberationSerif-BoldItalic.ttf?url&ttf'
import monoRegular from '../../../apps/docs/src/renderer/fonts/LiberationMono-Regular.ttf?url&ttf'
import monoBold from '../../../apps/docs/src/renderer/fonts/LiberationMono-Bold.ttf?url&ttf'
import monoItalic from '../../../apps/docs/src/renderer/fonts/LiberationMono-Italic.ttf?url&ttf'
import monoBoldItalic from '../../../apps/docs/src/renderer/fonts/LiberationMono-BoldItalic.ttf?url&ttf'

export { pdfiumWasmUrl, hbSubsetWasmUrl }

/** file name (as in text-edit.ts EDIT_FONT_PATHS) -> url */
export const fontUrls: Readonly<Record<string, string>> = {
  'LiberationSans-Regular.ttf': sansRegular,
  'LiberationSans-Bold.ttf': sansBold,
  'LiberationSans-Italic.ttf': sansItalic,
  'LiberationSans-BoldItalic.ttf': sansBoldItalic,
  'LiberationSerif-Regular.ttf': serifRegular,
  'LiberationSerif-Bold.ttf': serifBold,
  'LiberationSerif-Italic.ttf': serifItalic,
  'LiberationSerif-BoldItalic.ttf': serifBoldItalic,
  'LiberationMono-Regular.ttf': monoRegular,
  'LiberationMono-Bold.ttf': monoBold,
  'LiberationMono-Italic.ttf': monoItalic,
  'LiberationMono-BoldItalic.ttf': monoBoldItalic,
}
