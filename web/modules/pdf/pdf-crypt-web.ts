/**
 * Web stand-in for apps/pdf/src/main/pdf-crypt.ts (UNI-2527).
 *
 * pdf-crypt is AES/RC4/MD5 over node:crypto (createCipheriv / createDecipheriv). save-pdf.ts
 * imports it statically, so the web pdf build aliases the './pdf-crypt' specifier here (see
 * `aliases` in web/docs/build/modules.ts) and the node-only module stays out of the bundle.
 *
 * Nothing on the web reaches these functions: an encrypted PDF opens read-only (webapi.decryptPdf
 * answers not-available, so the renderer never holds a session password), and the Protection
 * entry is hidden with the `certSign` capability, so a save request never carries `decryption`
 * or `encryption`. A call that gets here anyway fails with an explicit error; it never returns
 * bytes that look protected or unprotected when they are not.
 */
import type * as PdfCrypt from '../../../apps/pdf/src/main/pdf-crypt'

const UNSUPPORTED = 'PDF password protection is not available in the web build'

export const decryptDocument: typeof PdfCrypt.decryptDocument = async () => {
  throw new Error(UNSUPPORTED)
}

export const encryptDocument: typeof PdfCrypt.encryptDocument = () => {
  throw new Error(UNSUPPORTED)
}

export const encryptDocumentWithOriginalProtection: typeof PdfCrypt.encryptDocumentWithOriginalProtection =
  () => {
    throw new Error(UNSUPPORTED)
  }
