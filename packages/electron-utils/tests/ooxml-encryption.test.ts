import { describe, expect, it } from 'vitest'
import {
  decryptOoxml,
  encryptOoxml,
  isCfbFile,
  isEncryptedOoxml,
  OoxmlDecryptError,
} from '../src/ooxml-encryption'

// Agile key derivation runs 100k hash rounds per call, so give each case room.
const SLOW = 60_000

// A tiny stand-in for an OOXML package: the helper only cares about the bytes.
const PLAIN = Buffer.concat([
  Buffer.from('PK\u0003\u0004'),
  Buffer.from('workbook-bytes '.repeat(40)),
])

describe('ooxml-encryption', () => {
  it(
    'round-trips a package through encrypt and decrypt',
    async () => {
      const encrypted = encryptOoxml(PLAIN, 'open sesame')
      expect(isCfbFile(encrypted)).toBe(true)
      expect(isEncryptedOoxml(encrypted)).toBe(true)
      expect(encrypted.equals(PLAIN)).toBe(false)

      const decrypted = await decryptOoxml(encrypted, 'open sesame')
      expect(decrypted.equals(PLAIN)).toBe(true)
    },
    SLOW,
  )

  it(
    'rejects a wrong password with a wrong-password reason',
    async () => {
      const encrypted = encryptOoxml(PLAIN, 'right')
      const failure = await decryptOoxml(encrypted, 'wrong').catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(OoxmlDecryptError)
      expect((failure as OoxmlDecryptError).reason).toBe('wrong-password')
    },
    SLOW,
  )

  it('does not treat a plain zip package as encrypted', () => {
    expect(isCfbFile(PLAIN)).toBe(false)
    expect(isEncryptedOoxml(PLAIN)).toBe(false)
  })

  it('reports unsupported input that is not an encrypted container', async () => {
    const failure = await decryptOoxml(Buffer.from('not an office file'), 'pw').catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(OoxmlDecryptError)
    expect((failure as OoxmlDecryptError).reason).toBe('unsupported')
  })
})
