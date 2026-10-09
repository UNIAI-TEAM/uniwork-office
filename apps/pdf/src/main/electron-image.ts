import { nativeImage } from 'electron'
import type { PdfImageCodec } from './core-env'

/** The desktop image codec of the save core (core-env.ts): Electron nativeImage */
export const electronImageCodec: PdfImageCodec = {
  async decode(b64) {
    const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'))
    if (img.isEmpty()) throw new Error('could not decode the image data')
    const { width, height } = img.getSize()
    // toBitmap() hands back premultiplied BGRA; un-premultiply so translucent pixels
    // keep their color once pdfium separates them into image + SMask
    const bgra = Buffer.from(img.toBitmap())
    for (let i = 0; i < bgra.length; i += 4) {
      const a = bgra[i + 3]!
      if (a > 0 && a < 255) {
        bgra[i] = Math.min(255, Math.round((bgra[i]! * 255) / a))
        bgra[i + 1] = Math.min(255, Math.round((bgra[i + 1]! * 255) / a))
        bgra[i + 2] = Math.min(255, Math.round((bgra[i + 2]! * 255) / a))
      }
    }
    return { width, height, bgra }
  },
  async encodePng(bgra, width, height) {
    return nativeImage
      .createFromBitmap(Buffer.from(bgra.buffer, bgra.byteOffset, bgra.byteLength), {
        width,
        height,
      })
      .toPNG()
      .toString('base64')
  },
}
