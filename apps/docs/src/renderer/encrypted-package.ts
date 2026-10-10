/** OLE compound file header (CFB): what every ECMA-376 password-protected package starts with */
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** "EncryptedPackage" as UTF-16LE: the stream name inside the compound file's directory */
const ENCRYPTED_PACKAGE_STREAM = Array.from('EncryptedPackage', (c) => [c.charCodeAt(0), 0]).flat()

function matchesAt(bytes: Uint8Array, needle: readonly number[], at: number): boolean {
  for (let i = 0; i < needle.length; i += 1) if (bytes[at + i] !== needle[i]) return false
  return true
}

/**
 * A password-protected .docx (ECMA-376 agile/standard encryption) is not a zip: it is a compound
 * file holding an `EncryptedPackage` stream. The web build cannot decrypt it (main-process crypto
 * on the desktop), so the open flow shows the "use the app" message instead of a raw parse error.
 * A legacy binary .doc is also a compound file but has no such stream, so it is not matched.
 */
export function isEncryptedPackage(bytes: Uint8Array): boolean {
  if (bytes.length < 512 || !matchesAt(bytes, CFB_SIGNATURE, 0)) return false
  const last = bytes.length - ENCRYPTED_PACKAGE_STREAM.length
  const first = ENCRYPTED_PACKAGE_STREAM[0]!
  for (let at = 512; at <= last; at += 1) {
    if (bytes[at] === first && matchesAt(bytes, ENCRYPTED_PACKAGE_STREAM, at)) return true
  }
  return false
}
