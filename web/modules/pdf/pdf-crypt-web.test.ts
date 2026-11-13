import { describe, expect, it } from 'vitest'
import * as real from '../../../apps/pdf/src/main/pdf-crypt'
import * as web from './pdf-crypt-web'
import { WEB_MODULES } from '../../docs/build/modules'

describe('pdf-crypt web stand-in (UNI-2527)', () => {
  it('is aliased for the pdf web build and covers every runtime import of save-pdf', () => {
    expect(WEB_MODULES.pdf.aliases?.['./pdf-crypt']).toBe('web/modules/pdf/pdf-crypt-web.ts')
    for (const name of [
      'decryptDocument',
      'encryptDocument',
      'encryptDocumentWithOriginalProtection',
    ] as const) {
      expect(typeof web[name]).toBe(typeof real[name])
    }
  })

  it('fails with an explicit error instead of returning unprotected or protected-looking bytes', async () => {
    await expect(web.decryptDocument(new Uint8Array(), 'x')).rejects.toThrow(
      /not available in the web/,
    )
    expect(() => web.encryptDocument({} as never, {} as never)).toThrow(/not available in the web/)
    expect(() => web.encryptDocumentWithOriginalProtection({} as never, {} as never)).toThrow(
      /not available in the web/,
    )
  })
})
