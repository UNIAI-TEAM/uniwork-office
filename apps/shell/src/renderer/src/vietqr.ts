/**
 * VietQR / NAPAS 247 EMVCo payload builder (account transfer — QRIBFTTA).
 * Spec: docs/pricing/VIETQR_PAYMENT.md
 */

function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0')
  return `${id}${len}${value}`
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — Napas field 63. */
export function crc16CcittFalse(input: string): string {
  let crc = 0xffff
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export interface VietQrInput {
  /** 6-digit Napas BIN */
  bankBin: string
  accountNumber: string
  /** VND integer amount; omit for static QR */
  amountVnd?: number
  /** Transfer description / bill content (field 62.08) */
  description?: string
  /** Merchant / account display name (field 59) */
  accountName?: string
}

/**
 * Build a VietQR EMV string scannable by VN banking apps.
 */
export function buildVietQrPayload(input: VietQrInput): string {
  const bin = input.bankBin.replace(/\D/g, '').slice(0, 6)
  const account = input.accountNumber.replace(/\s+/g, '')
  if (bin.length !== 6) throw new Error('vietqr_bad_bin')
  if (!account || account.length > 19) throw new Error('vietqr_bad_account')

  const consumer = tlv('00', bin) + tlv('01', account)
  const merchantAccount =
    tlv('00', 'A000000727') + tlv('01', consumer) + tlv('02', 'QRIBFTTA')

  const dynamic = Boolean(input.amountVnd && input.amountVnd > 0)
  let payload =
    tlv('00', '01') +
    tlv('01', dynamic ? '12' : '11') +
    tlv('38', merchantAccount) +
    tlv('53', '704')

  if (dynamic) {
    payload += tlv('54', String(Math.round(input.amountVnd!)))
  }

  payload += tlv('58', 'VN')

  const name = (input.accountName || 'UNIWORK').replace(/[^\x20-\x7E]/g, '').slice(0, 25)
  if (name) payload += tlv('59', name)

  const desc = (input.description || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .slice(0, 25)
  if (desc) {
    payload += tlv('62', tlv('08', desc))
  }

  payload += '6304'
  return payload + crc16CcittFalse(payload)
}
