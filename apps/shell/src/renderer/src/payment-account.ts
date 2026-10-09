/**
 * UniWork merchant payment account + VietQR checkout orders (local until billing API).
 */

import type { LicensePlanId } from './license-entitlements'

export interface BankOption {
  bin: string
  code: string
  nameVi: string
  nameEn: string
}

/** Common Napas BINs for VietQR. */
export const VIETQR_BANKS: readonly BankOption[] = [
  { bin: '970436', code: 'VCB', nameVi: 'Vietcombank', nameEn: 'Vietcombank' },
  { bin: '970407', code: 'TCB', nameVi: 'Techcombank', nameEn: 'Techcombank' },
  { bin: '970422', code: 'MB', nameVi: 'MB Bank', nameEn: 'MB Bank' },
  { bin: '970416', code: 'ACB', nameVi: 'ACB', nameEn: 'ACB' },
  { bin: '970418', code: 'BIDV', nameVi: 'BIDV', nameEn: 'BIDV' },
  { bin: '970432', code: 'VPB', nameVi: 'VPBank', nameEn: 'VPBank' },
  { bin: '970423', code: 'TPB', nameVi: 'TPBank', nameEn: 'TPBank' },
  { bin: '970441', code: 'VIB', nameVi: 'VIB', nameEn: 'VIB' },
  { bin: '970426', code: 'MSB', nameVi: 'MSB', nameEn: 'MSB' },
  { bin: '970448', code: 'OCB', nameVi: 'OCB', nameEn: 'OCB' },
  { bin: '970415', code: 'VietinBank', nameVi: 'VietinBank', nameEn: 'VietinBank' },
  { bin: '970405', code: 'AGRIBANK', nameVi: 'Agribank', nameEn: 'Agribank' },
] as const

export interface PaymentAccount {
  version: 1
  bankBin: string
  accountNumber: string
  accountName: string
  /** Optional note shown under QR */
  noteVi?: string
  noteEn?: string
  updatedAt: string
}

export type BillingCycle = 'month' | 'year'

export type PaymentOrderStatus = 'pending' | 'submitted' | 'confirmed' | 'cancelled'

export interface PaymentOrder {
  id: string
  planId: LicensePlanId
  cycle: BillingCycle
  amountVnd: number
  /** Content shown on bank transfer / VietQR field 62 */
  transferContent: string
  status: PaymentOrderStatus
  createdAt: string
  submittedAt?: string
  confirmedAt?: string
}

const ACCOUNT_KEY = 'uniwork.payment.account'
const ORDERS_KEY = 'uniwork.payment.orders'

/** Placeholder merchant — replace with real UniWork receiving account before production. */
export function defaultPaymentAccount(): PaymentAccount {
  return {
    version: 1,
    bankBin: '970422',
    accountNumber: '',
    accountName: 'CONG TY UNIWORK',
    noteVi: 'Điền STK nhận tiền UniWork trước khi nhận thanh toán thật.',
    noteEn: 'Set the UniWork receiving account before accepting real payments.',
    updatedAt: new Date().toISOString(),
  }
}

export function readPaymentAccount(): PaymentAccount {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    if (!raw) return defaultPaymentAccount()
    const parsed = JSON.parse(raw) as PaymentAccount
    if (parsed?.version !== 1) return defaultPaymentAccount()
    return { ...defaultPaymentAccount(), ...parsed }
  } catch {
    return defaultPaymentAccount()
  }
}

export function writePaymentAccount(next: PaymentAccount): void {
  try {
    localStorage.setItem(
      ACCOUNT_KEY,
      JSON.stringify({ ...next, version: 1 as const, updatedAt: new Date().toISOString() }),
    )
  } catch {
    /* ignore */
  }
}

export function bankByBin(bin: string): BankOption | undefined {
  return VIETQR_BANKS.find((b) => b.bin === bin)
}

export function planPriceVnd(planId: LicensePlanId, cycle: BillingCycle): number {
  if (planId === 'free') return 0
  // Align with docs/pricing/UNIWORK_PLANS.md
  const table: Record<Exclude<LicensePlanId, 'free'>, { month: number; year: number }> = {
    personal: { month: 249_000, year: 1_990_000 },
    pro: { month: 499_000, year: 3_990_000 },
    team: { month: 299_000, year: 2_490_000 },
  }
  const row = table[planId]
  return cycle === 'year' ? row.year : row.month
}

function newOrderId(): string {
  return `UW${Date.now().toString(36).toUpperCase().slice(-8)}`
}

export function readPaymentOrders(): PaymentOrder[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PaymentOrder[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writePaymentOrders(items: PaymentOrder[]): void {
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(items.slice(0, 40)))
  } catch {
    /* ignore */
  }
}

export function createPaymentOrder(planId: LicensePlanId, cycle: BillingCycle): PaymentOrder {
  if (planId === 'free') throw new Error('free_no_payment')
  const id = newOrderId()
  const order: PaymentOrder = {
    id,
    planId,
    cycle,
    amountVnd: planPriceVnd(planId, cycle),
    transferContent: id,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  writePaymentOrders([order, ...readPaymentOrders()])
  return order
}

export function markOrderSubmitted(id: string): PaymentOrder | null {
  const items = readPaymentOrders()
  const idx = items.findIndex((o) => o.id === id)
  if (idx < 0) return null
  const next = {
    ...items[idx]!,
    status: 'submitted' as const,
    submittedAt: new Date().toISOString(),
  }
  items[idx] = next
  writePaymentOrders(items)
  return next
}

export function markOrderConfirmed(id: string): PaymentOrder | null {
  const items = readPaymentOrders()
  const idx = items.findIndex((o) => o.id === id)
  if (idx < 0) return null
  const next = {
    ...items[idx]!,
    status: 'confirmed' as const,
    confirmedAt: new Date().toISOString(),
  }
  items[idx] = next
  writePaymentOrders(items)
  return next
}

export function paymentAccountReady(account: PaymentAccount): boolean {
  return Boolean(account.bankBin?.length === 6 && account.accountNumber?.trim())
}
