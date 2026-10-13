import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * One record on disk: `UWS1` magic, the header JSON (schema and
 * min_store_level, plaintext and authenticated as GCM additional data), the
 * random 12-byte IV, the 16-byte auth tag, then the AES-256-GCM ciphertext.
 * The header is readable without the key, so the level gate refuses a record
 * written by a newer store before any decryption - and any tampering with it
 * breaks the tag.
 */

export interface RecordHeader {
  schema: number
  min_store_level: number
}

export interface RecordFrame {
  /** the parsed header JSON, before validation */
  header: unknown
  /** the bytes the header was authenticated from (magic + length + JSON) */
  aad: Buffer
  iv: Buffer
  tag: Buffer
  ciphertext: Buffer
}

const MAGIC = Buffer.from('UWS1', 'latin1')
const MAGIC_LENGTH = 4
const LENGTH_BYTES = 2
export const RECORD_IV_BYTES = 12
export const RECORD_TAG_BYTES = 16

/** magic + header length + header JSON, byte-stable for a given header */
function framePrefix(header: RecordHeader): Buffer {
  const head = Buffer.from(JSON.stringify(header), 'utf8')
  const length = Buffer.alloc(LENGTH_BYTES)
  length.writeUInt16LE(head.length)
  return Buffer.concat([MAGIC, length, head])
}

/** build a raw record; tests forge records with it, header and all, without a key */
export function encodeRecord(
  header: RecordHeader,
  iv: Uint8Array,
  tag: Uint8Array,
  ciphertext: Uint8Array,
): Buffer {
  return Buffer.concat([framePrefix(header), iv, tag, ciphertext])
}

/** the header a record declares; null when the shape is not a header at all */
export function recordHeaderOf(raw: unknown): RecordHeader | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const schema = r.schema
  const level = r.min_store_level
  if (typeof schema !== 'number' || !Number.isSafeInteger(schema) || schema < 1) return null
  if (typeof level !== 'number' || !Number.isSafeInteger(level)) return null
  return { schema, min_store_level: level }
}

/** parse a record without the key; null when the bytes are not one of our records */
export function readRecordFrame(bytes: Uint8Array): RecordFrame | null {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (buf.length < MAGIC_LENGTH + LENGTH_BYTES) return null
  if (!buf.subarray(0, MAGIC_LENGTH).equals(MAGIC)) return null
  const headLength = buf.readUInt16LE(MAGIC_LENGTH)
  const headEnd = MAGIC_LENGTH + LENGTH_BYTES + headLength
  if (headLength === 0 || buf.length < headEnd + RECORD_IV_BYTES + RECORD_TAG_BYTES) return null
  let header: unknown
  try {
    header = JSON.parse(buf.subarray(MAGIC_LENGTH + LENGTH_BYTES, headEnd).toString('utf8'))
  } catch {
    return null
  }
  return {
    header,
    aad: buf.subarray(0, headEnd),
    iv: buf.subarray(headEnd, headEnd + RECORD_IV_BYTES),
    tag: buf.subarray(headEnd + RECORD_IV_BYTES, headEnd + RECORD_IV_BYTES + RECORD_TAG_BYTES),
    ciphertext: buf.subarray(headEnd + RECORD_IV_BYTES + RECORD_TAG_BYTES),
  }
}

/** encrypt one record; the header bytes are bound to the ciphertext as additional data */
export function sealRecord(key: Buffer, header: RecordHeader, value: Uint8Array): Buffer {
  const iv = randomBytes(RECORD_IV_BYTES)
  const aad = framePrefix(header)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()])
  return Buffer.concat([aad, iv, cipher.getAuthTag(), ciphertext])
}

/** decrypt one record; null when the tag does not verify (tampered, or another key) */
export function openRecord(key: Buffer, frame: RecordFrame): Uint8Array | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, frame.iv)
    decipher.setAAD(frame.aad)
    decipher.setAuthTag(frame.tag)
    return new Uint8Array(Buffer.concat([decipher.update(frame.ciphertext), decipher.final()]))
  } catch {
    return null
  }
}
