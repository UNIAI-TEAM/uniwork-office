/**
 * UniWork Office license entitlements (account-bound, device-limited).
 * Server: GET /api/license/entitlements — until live, local cache + DEV simulate.
 * Spec: docs/pricing/LICENSE_ENTITLEMENTS.md
 */

export type LicensePlanId = 'free' | 'personal' | 'pro' | 'team'
export type LicenseStatus = 'active' | 'grace' | 'expired' | 'none'

export interface LicenseDevice {
  deviceId: string
  label: string
  platform: string
  lastSeenAt: string
  createdAt: string
}

export interface LicenseEntitlement {
  version: 1
  planId: LicensePlanId
  status: LicenseStatus
  expiresAt: string | null
  graceUntil: string | null
  maxDevices: number
  bridge: boolean
  tokensMonth: number
  devices: LicenseDevice[]
  refreshedAt: string
  source: 'local' | 'server'
  /** True when activated via DEV simulate */
  simulated?: boolean
}

export interface LicensePlanDef {
  id: LicensePlanId
  labelVi: string
  labelEn: string
  maxDevices: number
  bridge: boolean
  tokensMonth: number
  priceVi: string
  priceEn: string
}

/** Keep aligned with docs/pricing/UNIWORK_PLANS.md / apps/uniai-pwa/plans.js */
export const LICENSE_PLANS: readonly LicensePlanDef[] = [
  {
    id: 'free',
    labelVi: 'Free',
    labelEn: 'Free',
    maxDevices: 1,
    bridge: false,
    tokensMonth: 10_000,
    priceVi: '0đ',
    priceEn: '$0',
  },
  {
    id: 'personal',
    labelVi: 'Personal',
    labelEn: 'Personal',
    maxDevices: 2,
    bridge: true,
    tokensMonth: 50_000,
    priceVi: '249.000đ/tháng',
    priceEn: '$9.99/mo',
  },
  {
    id: 'pro',
    labelVi: 'Pro',
    labelEn: 'Pro',
    maxDevices: 3,
    bridge: true,
    tokensMonth: 200_000,
    priceVi: '499.000đ/tháng',
    priceEn: '$19.99/mo',
  },
  {
    id: 'team',
    labelVi: 'Team',
    labelEn: 'Team',
    maxDevices: 2,
    bridge: true,
    tokensMonth: 50_000,
    priceVi: '299.000đ/seat/tháng',
    priceEn: '$12/seat/mo',
  },
] as const

const DEVICE_KEY = 'uniwork.license.deviceId'
const ENTITLEMENT_KEY = 'uniwork.license.entitlement'
/** Offline grace after paid expiry (ms). */
export const LICENSE_GRACE_MS = 7 * 24 * 60 * 60 * 1000

export function getLicensePlan(id: LicensePlanId): LicensePlanDef {
  return LICENSE_PLANS.find((p) => p.id === id) ?? LICENSE_PLANS[0]!
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** Stable install id for this browser profile / renderer store. */
export function ensureDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing && existing.length >= 8) return existing
    const id = newId('dev')
    localStorage.setItem(DEVICE_KEY, id)
    return id
  } catch {
    return newId('dev')
  }
}

function guessDeviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Mac/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows PC'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'This device'
}

function platformName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Mac/i.test(ua)) return 'darwin'
  if (/Windows/i.test(ua)) return 'win32'
  if (/Linux/i.test(ua)) return 'linux'
  return 'unknown'
}

export function defaultLicenseEntitlement(): LicenseEntitlement {
  const plan = getLicensePlan('free')
  const now = new Date().toISOString()
  const deviceId = ensureDeviceId()
  return {
    version: 1,
    planId: 'free',
    status: 'active',
    expiresAt: null,
    graceUntil: null,
    maxDevices: plan.maxDevices,
    bridge: plan.bridge,
    tokensMonth: plan.tokensMonth,
    devices: [
      {
        deviceId,
        label: guessDeviceLabel(),
        platform: platformName(),
        lastSeenAt: now,
        createdAt: now,
      },
    ],
    refreshedAt: now,
    source: 'local',
  }
}

export function readLicenseEntitlement(): LicenseEntitlement {
  try {
    const raw = localStorage.getItem(ENTITLEMENT_KEY)
    if (!raw) return touchCurrentDevice(defaultLicenseEntitlement())
    const parsed = JSON.parse(raw) as LicenseEntitlement
    if (parsed?.version !== 1) return touchCurrentDevice(defaultLicenseEntitlement())
    return refreshStatus(touchCurrentDevice(parsed))
  } catch {
    return touchCurrentDevice(defaultLicenseEntitlement())
  }
}

export function writeLicenseEntitlement(next: LicenseEntitlement): void {
  try {
    localStorage.setItem(
      ENTITLEMENT_KEY,
      JSON.stringify({ ...next, refreshedAt: new Date().toISOString() }),
    )
  } catch {
    /* ignore */
  }
}

/** Recompute status from expires/grace clocks. */
export function refreshStatus(ent: LicenseEntitlement): LicenseEntitlement {
  if (ent.planId === 'free' || !ent.expiresAt) {
    return { ...ent, status: 'active' }
  }
  const now = Date.now()
  const exp = Date.parse(ent.expiresAt)
  if (!Number.isFinite(exp)) return { ...ent, status: 'active' }
  if (now <= exp) return { ...ent, status: 'active' }
  const grace = ent.graceUntil ? Date.parse(ent.graceUntil) : exp + LICENSE_GRACE_MS
  if (now <= grace) return { ...ent, status: 'grace', graceUntil: new Date(grace).toISOString() }
  return {
    ...ent,
    status: 'expired',
    planId: 'free',
    bridge: false,
    maxDevices: 1,
    tokensMonth: getLicensePlan('free').tokensMonth,
  }
}

/** Ensure this install is on the device list and bump lastSeen. */
export function touchCurrentDevice(ent: LicenseEntitlement): LicenseEntitlement {
  const deviceId = ensureDeviceId()
  const now = new Date().toISOString()
  const devices = [...ent.devices]
  const idx = devices.findIndex((d) => d.deviceId === deviceId)
  if (idx >= 0) {
    devices[idx] = { ...devices[idx]!, lastSeenAt: now }
  } else {
    if (devices.length >= ent.maxDevices) {
      // Over limit: still record intent; UI should prompt revoke. Keep list as-is.
    } else {
      devices.unshift({
        deviceId,
        label: guessDeviceLabel(),
        platform: platformName(),
        lastSeenAt: now,
        createdAt: now,
      })
    }
  }
  return { ...ent, devices }
}

export function currentDeviceId(): string {
  return ensureDeviceId()
}

export function revokeLicenseDevice(ent: LicenseEntitlement, deviceId: string): LicenseEntitlement {
  if (deviceId === ensureDeviceId()) return ent
  return {
    ...ent,
    devices: ent.devices.filter((d) => d.deviceId !== deviceId),
    refreshedAt: new Date().toISOString(),
  }
}

/** Bridge cloud allowed only while paid plan is fully active (not grace/expired). */
export function canUseOfficeBridge(ent: LicenseEntitlement): boolean {
  const live = refreshStatus(ent)
  return live.bridge && live.status === 'active' && live.planId !== 'free'
}

/** Local editing always allowed; exposed for UI copy. */
export function canEditLocalFiles(_ent: LicenseEntitlement): boolean {
  return true
}

export function isOverDeviceLimit(ent: LicenseEntitlement): boolean {
  return ent.devices.length > ent.maxDevices
}

/** DEV / UI preview: activate a commercial plan locally. */
export function simulateLicensePlan(planId: LicensePlanId): LicenseEntitlement {
  const plan = getLicensePlan(planId)
  const now = Date.now()
  const expiresAt =
    planId === 'free' ? null : new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString()
  const graceUntil =
    planId === 'free' ? null : new Date(now + 365 * 24 * 60 * 60 * 1000 + LICENSE_GRACE_MS).toISOString()
  const base = touchCurrentDevice(defaultLicenseEntitlement())
  const next: LicenseEntitlement = refreshStatus({
    ...base,
    planId,
    status: 'active',
    expiresAt,
    graceUntil,
    maxDevices: plan.maxDevices,
    bridge: plan.bridge,
    tokensMonth: plan.tokensMonth,
    devices: base.devices.slice(0, plan.maxDevices),
    source: 'local',
    simulated: planId !== 'free',
    refreshedAt: new Date().toISOString(),
  })
  writeLicenseEntitlement(next)
  return next
}

/** Placeholder for future GET /api/license/entitlements */
export async function fetchLicenseEntitlementsFromServer(_apiBase: string, _token: string): Promise<LicenseEntitlement | null> {
  return null
}
