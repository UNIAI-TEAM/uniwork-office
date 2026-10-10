import { describe, expect, it } from 'vitest'
import { isEncryptedPackage } from '../src/renderer/encrypted-package'

const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const utf16 = (s: string) => Array.from(s, (c) => [c.charCodeAt(0), 0]).flat()

function compound(streamNames: string[]): Uint8Array {
  const bytes = new Uint8Array(4096)
  bytes.set(CFB, 0)
  // directory entries: UTF-16LE names, 128 bytes each, after the header sector
  streamNames.forEach((name, i) => bytes.set(utf16(name), 1024 + i * 128))
  return bytes
}

describe('isEncryptedPackage', () => {
  it('matches a password-protected docx (compound file with an EncryptedPackage stream)', () => {
    expect(isEncryptedPackage(compound(['Root Entry', 'EncryptionInfo', 'EncryptedPackage']))).toBe(
      true,
    )
  })

  it('does not match a legacy binary .doc (compound file without that stream)', () => {
    expect(isEncryptedPackage(compound(['Root Entry', 'WordDocument', '1Table']))).toBe(false)
  })

  it('does not match a normal docx (zip) or tiny / empty input', () => {
    const zip = new Uint8Array(2048)
    zip.set([0x50, 0x4b, 0x03, 0x04], 0)
    zip.set(utf16('EncryptedPackage'), 600)
    expect(isEncryptedPackage(zip)).toBe(false)
    expect(isEncryptedPackage(new Uint8Array(0))).toBe(false)
    expect(isEncryptedPackage(new Uint8Array(CFB))).toBe(false)
  })
})
