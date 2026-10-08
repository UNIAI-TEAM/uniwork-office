/**
 * UniWork Backup & Cloud Storage Addons (monetization)
 * ----------------------------------------------------
 * Product model (client-visible):
 * 1) Free forever: local export / import of Workbench + settings snapshot (JSON).
 * 2) Backup Addon (subscription): encrypted sync of that snapshot to UniWork Cloud,
 *    schedule + retention by SKU.
 * 3) Storage Addon (quota packs): extra cloud file space for docs/projects beyond
 *    the Backup plan’s included quota.
 *
 * Server (future): checkout → entitlement webhook → GET /v1/addons/entitlements.
 * Client caches entitlements in localStorage; cloud APIs refuse sync without a
 * valid signed entitlement. Until the API exists, purchase buttons open the
 * pricing page and “Simulate” is available only in DEV for UI testing.
 */

import { wbStoreSetRaw } from './workbench-store-client'

export type BackupPlanId = 'backup-basic' | 'backup-plus'
export type StoragePackId = 'storage-50' | 'storage-200' | 'storage-1tb'
export type AddonSkuId = BackupPlanId | StoragePackId

export type AddonKind = 'backup' | 'storage'

export interface AddonSku {
  id: AddonSkuId
  kind: AddonKind
  labelVi: string
  labelEn: string
  descVi: string
  descEn: string
  /** Display price hint (checkout is server-side) */
  priceVi: string
  priceEn: string
  /** Included cloud quota in GB (backup plans include a base; storage packs add) */
  quotaGb: number
  /** Backup retention days; 0 for storage-only packs */
  retentionDays: number
  /** Approximate backup cadence label */
  cadenceVi: string
  cadenceEn: string
}

export const BACKUP_PLANS: readonly AddonSku[] = [
  {
    id: 'backup-basic',
    kind: 'backup',
    labelVi: 'Backup Cơ bản',
    labelEn: 'Backup Basic',
    descVi: 'Sao lưu bàn làm việc + cài đặt lên UniWork Cloud, giữ 30 ngày.',
    descEn: 'Back up Workbench + settings to UniWork Cloud, 30-day retention.',
    priceVi: '49.000đ / tháng',
    priceEn: '$1.99 / mo',
    quotaGb: 5,
    retentionDays: 30,
    cadenceVi: 'Mỗi ngày',
    cadenceEn: 'Daily',
  },
  {
    id: 'backup-plus',
    kind: 'backup',
    labelVi: 'Backup Plus',
    labelEn: 'Backup Plus',
    descVi: 'Sao lưu thường xuyên hơn, lịch sử phiên bản, giữ 90 ngày.',
    descEn: 'More frequent backups, version history, 90-day retention.',
    priceVi: '129.000đ / tháng',
    priceEn: '$4.99 / mo',
    quotaGb: 50,
    retentionDays: 90,
    cadenceVi: 'Mỗi giờ (khi đổi)',
    cadenceEn: 'Hourly (on change)',
  },
] as const

export const STORAGE_PACKS: readonly AddonSku[] = [
  {
    id: 'storage-50',
    kind: 'storage',
    labelVi: '+50 GB lưu trữ',
    labelEn: '+50 GB storage',
    descVi: 'Thêm dung lượng cloud cho tài liệu / gói dự án UniWork.',
    descEn: 'Extra UniWork cloud space for documents / project packs.',
    priceVi: '39.000đ / tháng',
    priceEn: '$1.49 / mo',
    quotaGb: 50,
    retentionDays: 0,
    cadenceVi: '—',
    cadenceEn: '—',
  },
  {
    id: 'storage-200',
    kind: 'storage',
    labelVi: '+200 GB lưu trữ',
    labelEn: '+200 GB storage',
    descVi: 'Gói mở rộng cho nhóm nhỏ hoặc thư viện tài liệu lớn.',
    descEn: 'Expanded pack for larger libraries.',
    priceVi: '99.000đ / tháng',
    priceEn: '$3.99 / mo',
    quotaGb: 200,
    retentionDays: 0,
    cadenceVi: '—',
    cadenceEn: '—',
  },
  {
    id: 'storage-1tb',
    kind: 'storage',
    labelVi: '+1 TB lưu trữ',
    labelEn: '+1 TB storage',
    descVi: 'Dung lượng lớn cho văn phòng / lưu trữ dài hạn.',
    descEn: 'Large quota for office / long-term archives.',
    priceVi: '299.000đ / tháng',
    priceEn: '$9.99 / mo',
    quotaGb: 1024,
    retentionDays: 0,
    cadenceVi: '—',
    cadenceEn: '—',
  },
] as const

export const ALL_ADDON_SKUS: readonly AddonSku[] = [...BACKUP_PLANS, ...STORAGE_PACKS]

export function getAddonSku(id: AddonSkuId): AddonSku | undefined {
  return ALL_ADDON_SKUS.find((s) => s.id === id)
}

/** Cached entitlements from UniWork (or local DEV simulate). */
export interface AddonEntitlements {
  version: 1
  /** Active backup plan, if any */
  backupPlanId: BackupPlanId | null
  /** Purchased storage packs (stackable) */
  storagePackIds: StoragePackId[]
  /** ISO time of last successful cloud backup */
  lastCloudBackupAt: string | null
  /** Bytes used on cloud (from server; 0 until sync) */
  usedBytes: number
  /** Updated locally when cache changes */
  updatedAt: string
  /** True when cache came from DEV simulate, not server */
  simulated?: boolean
}

const ENTITLEMENT_KEY = 'uniwork.addons.entitlements'
const PRICING_PATH = '/pricing/addons'

export function defaultEntitlements(): AddonEntitlements {
  return {
    version: 1,
    backupPlanId: null,
    storagePackIds: [],
    lastCloudBackupAt: null,
    usedBytes: 0,
    updatedAt: new Date().toISOString(),
  }
}

export function readEntitlements(): AddonEntitlements {
  try {
    const raw = localStorage.getItem(ENTITLEMENT_KEY)
    if (!raw) return defaultEntitlements()
    const parsed = JSON.parse(raw) as AddonEntitlements
    if (parsed?.version !== 1) return defaultEntitlements()
    return parsed
  } catch {
    return defaultEntitlements()
  }
}

export function writeEntitlements(next: AddonEntitlements): void {
  try {
    localStorage.setItem(
      ENTITLEMENT_KEY,
      JSON.stringify({ ...next, updatedAt: new Date().toISOString() }),
    )
  } catch {
    /* ignore */
  }
}

export function totalQuotaGb(ent: AddonEntitlements): number {
  let n = 0
  if (ent.backupPlanId) {
    n += getAddonSku(ent.backupPlanId)?.quotaGb ?? 0
  }
  for (const id of ent.storagePackIds) {
    n += getAddonSku(id)?.quotaGb ?? 0
  }
  return n
}

export function hasCloudBackup(ent: AddonEntitlements): boolean {
  return ent.backupPlanId != null
}

/** Keys that belong in a Workbench / personal-space backup snapshot. */
export function collectBackupKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    if (
      k.startsWith('uniwork.wb.') ||
      k.startsWith('uniwork.skill.') ||
      k.startsWith('uniwork.teacher') ||
      k.startsWith('uniwork.activePractice') ||
      k.startsWith('uniwork.my-ai.') ||
      k.startsWith('uniwork.ai.') ||
      k === 'uniwork.teacherUiLang' ||
      k === ENTITLEMENT_KEY
    ) {
      keys.push(k)
    }
  }
  return keys.sort()
}

export interface LocalBackupSnapshot {
  version: 1
  kind: 'uniwork-local-backup'
  createdAt: string
  app: 'shell'
  keys: Record<string, string>
}

export function exportLocalBackup(): LocalBackupSnapshot {
  const keys: Record<string, string> = {}
  for (const k of collectBackupKeys()) {
    const v = localStorage.getItem(k)
    if (v != null) keys[k] = v
  }
  return {
    version: 1,
    kind: 'uniwork-local-backup',
    createdAt: new Date().toISOString(),
    app: 'shell',
    keys,
  }
}

export function importLocalBackup(snapshot: LocalBackupSnapshot): { ok: true; count: number } | { ok: false; error: string } {
  if (!snapshot || snapshot.kind !== 'uniwork-local-backup' || snapshot.version !== 1) {
    return { ok: false, error: 'invalid-format' }
  }
  if (!snapshot.keys || typeof snapshot.keys !== 'object') {
    return { ok: false, error: 'invalid-keys' }
  }
  let count = 0
  for (const [k, v] of Object.entries(snapshot.keys)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue
    if (
      !(
        k.startsWith('uniwork.wb.') ||
        k.startsWith('uniwork.skill.') ||
        k.startsWith('uniwork.teacher') ||
        k.startsWith('uniwork.activePractice') ||
        k.startsWith('uniwork.my-ai.') ||
        k.startsWith('uniwork.ai.') ||
        k === 'uniwork.teacherUiLang' ||
        k === ENTITLEMENT_KEY
      )
    ) {
      continue
    }
    wbStoreSetRaw(k, v)
    count++
  }
  return { ok: true, count }
}

export function downloadSnapshot(snapshot: LocalBackupSnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `uniwork-backup-${snapshot.createdAt.slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Checkout / manage URL (server will own real billing). */
export function addonPricingUrl(sku?: AddonSkuId): string {
  const origin =
    (typeof window !== 'undefined' &&
      (window as unknown as { __UNIWOK_ORIGIN?: string }).__UNIWOK_ORIGIN) ||
    'https://uniwork.app'
  const q = sku ? `?sku=${encodeURIComponent(sku)}` : ''
  return `${origin}${PRICING_PATH}${q}`
}

/** DEV / UI preview: activate a plan locally without payment. */
export function simulatePurchase(skuId: AddonSkuId): AddonEntitlements {
  const cur = readEntitlements()
  const sku = getAddonSku(skuId)
  if (!sku) return cur
  let next: AddonEntitlements
  if (sku.kind === 'backup') {
    next = {
      ...cur,
      backupPlanId: skuId as BackupPlanId,
      simulated: true,
    }
  } else {
    const packs = cur.storagePackIds.includes(skuId as StoragePackId)
      ? cur.storagePackIds
      : [...cur.storagePackIds, skuId as StoragePackId]
    next = { ...cur, storagePackIds: packs, simulated: true }
  }
  writeEntitlements(next)
  return next
}

export function simulateCloudBackupNow(): AddonEntitlements {
  const cur = readEntitlements()
  if (!cur.backupPlanId) return cur
  const snap = exportLocalBackup()
  const usedBytes = new Blob([JSON.stringify(snap)]).size
  const next: AddonEntitlements = {
    ...cur,
    lastCloudBackupAt: new Date().toISOString(),
    usedBytes: Math.max(cur.usedBytes, usedBytes),
    simulated: true,
  }
  writeEntitlements(next)
  return next
}

export function clearSimulatedEntitlements(): AddonEntitlements {
  const next = defaultEntitlements()
  writeEntitlements(next)
  return next
}
