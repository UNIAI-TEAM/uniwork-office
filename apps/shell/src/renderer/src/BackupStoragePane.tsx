import { useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  BACKUP_PLANS,
  STORAGE_PACKS,
  addonPricingUrl,
  clearSimulatedEntitlements,
  downloadSnapshot,
  exportLocalBackup,
  hasCloudBackup,
  importLocalBackup,
  readEntitlements,
  simulateCloudBackupNow,
  simulatePurchase,
  totalQuotaGb,
  type AddonEntitlements,
  type AddonSku,
  type AddonSkuId,
  type LocalBackupSnapshot,
} from './backup-addons'
import { exportWorkbenchBackupUi, importWorkbenchBackupUi } from './workbench-store-client'

function L(lang: Lang, vi: string, en: string): string {
  return lang === 'vi' ? vi : en
}

export function BackupStoragePane({
  lang,
  loggedIn,
  onLogin,
}: {
  lang: Lang
  loggedIn: boolean
  onLogin: () => void
}): ReactElement {
  const [ent, setEnt] = useState<AddonEntitlements>(() => readEntitlements())
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const isDev = Boolean(import.meta.env?.DEV)
  const quotaGb = useMemo(() => totalQuotaGb(ent), [ent])
  const usedMb = ent.usedBytes / (1024 * 1024)

  const buy = (sku: AddonSkuId) => {
    setErr(null)
    setMsg(null)
    if (!loggedIn) {
      setErr(
        L(lang, 'Đăng nhập UniWork để mua Addon cloud.', 'Sign in to UniWork to buy cloud addons.'),
      )
      return
    }
    // Real checkout is server-hosted; open pricing until billing API ships.
    window.open(addonPricingUrl(sku), '_blank', 'noopener,noreferrer')
    setMsg(
      L(
        lang,
        'Đã mở trang thanh toán Addon. Sau khi mua, quyền sẽ đồng bộ về máy.',
        'Opened addon checkout. After purchase, entitlements sync to this device.',
      ),
    )
  }

  const doExport = () => {
    setErr(null)
    const snap = exportLocalBackup()
    downloadSnapshot(snap)
    setMsg(
      L(
        lang,
        `Đã xuất bản sao cục bộ (${Object.keys(snap.keys).length} mục).`,
        `Exported local backup (${Object.keys(snap.keys).length} items).`,
      ),
    )
  }

  const doExportZip = async () => {
    setErr(null)
    setMsg(null)
    const r = await exportWorkbenchBackupUi()
    if (r.ok) {
      setMsg(L(lang, `Đã xuất backup SQLite: ${r.path}`, `Exported SQLite backup: ${r.path}`))
      return
    }
    if (r.canceled) return
    setErr(r.error || L(lang, 'Xuất backup thất bại.', 'Backup export failed.'))
  }

  const doImportZip = async () => {
    setErr(null)
    setMsg(null)
    const r = await importWorkbenchBackupUi()
    if (r.ok) {
      setEnt(readEntitlements())
      setMsg(
        L(
          lang,
          `Đã khôi phục ${r.keyCount} mục từ backup SQLite. Tải lại app nếu tab đang mở chưa cập nhật.`,
          `Restored ${r.keyCount} items from SQLite backup. Reload if open tabs look stale.`,
        ),
      )
      return
    }
    if (r.canceled) return
    setErr(r.error || L(lang, 'Nhập backup thất bại.', 'Backup import failed.'))
  }

  const onPickImport = async (file: File | null) => {
    if (!file) return
    setErr(null)
    setMsg(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as LocalBackupSnapshot
      const r = importLocalBackup(parsed)
      if (!r.ok) {
        setErr(L(lang, 'File backup không hợp lệ.', 'Invalid backup file.'))
        return
      }
      setEnt(readEntitlements())
      setMsg(L(lang, `Đã khôi phục ${r.count} mục.`, `Restored ${r.count} items.`))
    } catch {
      setErr(L(lang, 'Không đọc được file JSON.', 'Could not read JSON file.'))
    }
  }

  const cloudBackup = () => {
    setErr(null)
    if (!hasCloudBackup(ent)) {
      setErr(
        L(
          lang,
          'Cần gói Backup để đồng bộ lên UniWork Cloud.',
          'A Backup plan is required to sync to UniWork Cloud.',
        ),
      )
      return
    }
    if (!loggedIn) {
      setErr(L(lang, 'Đăng nhập để sao lưu cloud.', 'Sign in to run cloud backup.'))
      return
    }
    // Until API exists: simulate success in DEV; otherwise show pending message.
    if (isDev) {
      setEnt(simulateCloudBackupNow())
      setMsg(L(lang, 'Đã mô phỏng sao lưu cloud (DEV).', 'Simulated cloud backup (DEV).'))
      return
    }
    setMsg(
      L(
        lang,
        'Cloud backup sẽ chạy khi API UniWork sẵn sàng — entitlement đã sẵn trên máy.',
        'Cloud backup will run when the UniWork API is live — entitlement is ready on device.',
      ),
    )
  }

  return (
    <div className="set-backup">
      <h3 className="set-pane-title">{L(lang, 'Backup & Lưu trữ', 'Backup & Storage')}</h3>
      <p className="set-backup-lead">
        {L(
          lang,
          'Addon thu phí: sao lưu bàn làm việc lên UniWork Cloud và mua thêm dung lượng. Xuất/nhập file cục bộ luôn miễn phí.',
          'Paid addons: back up Workbench to UniWork Cloud and buy extra space. Local export/import stays free.',
        )}
      </p>

      <div className="set-backup-status">
        <div>
          <span>{L(lang, 'Gói Backup', 'Backup plan')}</span>
          <strong>
            {ent.backupPlanId
              ? BACKUP_PLANS.find((p) => p.id === ent.backupPlanId)?.[
                  lang === 'vi' ? 'labelVi' : 'labelEn'
                ]
              : L(lang, 'Chưa mua', 'None')}
          </strong>
        </div>
        <div>
          <span>{L(lang, 'Dung lượng cloud', 'Cloud quota')}</span>
          <strong>
            {quotaGb > 0
              ? `${usedMb.toFixed(1)} MB / ${quotaGb} GB`
              : L(lang, '0 (chỉ local)', '0 (local only)')}
          </strong>
        </div>
        <div>
          <span>{L(lang, 'Cloud backup gần nhất', 'Last cloud backup')}</span>
          <strong>
            {ent.lastCloudBackupAt
              ? new Date(ent.lastCloudBackupAt).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')
              : '—'}
          </strong>
        </div>
        {ent.simulated ? (
          <p className="set-backup-sim">
            {L(lang, 'Đang dùng entitlement mô phỏng (DEV).', 'Using simulated entitlement (DEV).')}
          </p>
        ) : null}
      </div>

      {!loggedIn && (
        <div className="set-backup-login">
          <p>
            {L(
              lang,
              'Đăng nhập tài khoản UniWork để mua Addon và đồng bộ cloud.',
              'Sign in to your UniWork account to buy addons and sync to the cloud.',
            )}
          </p>
          <button type="button" className="btn btn-primary" onClick={onLogin}>
            {L(lang, 'Đăng nhập', 'Sign in')}
          </button>
        </div>
      )}

      <h4 className="set-backup-h">{L(lang, 'Miễn phí trên máy', 'Free on this device')}</h4>
      <div className="set-backup-actions">
        <button type="button" className="btn btn-secondary" onClick={() => void doExportZip()}>
          {L(lang, 'Xuất backup ZIP (SQLite)', 'Export ZIP backup (SQLite)')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void doImportZip()}>
          {L(lang, 'Nhập backup ZIP', 'Import ZIP backup')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={doExport}>
          {L(lang, 'Xuất backup JSON', 'Export JSON backup')}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => fileRef.current?.click()}
        >
          {L(lang, 'Nhập backup JSON', 'Import JSON backup')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void onPickImport(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!hasCloudBackup(ent)}
          onClick={cloudBackup}
          title={
            hasCloudBackup(ent) ? undefined : L(lang, 'Cần gói Backup', 'Requires a Backup plan')
          }
        >
          {L(lang, 'Sao lưu lên Cloud', 'Backup to Cloud')}
        </button>
      </div>

      <h4 className="set-backup-h">{L(lang, 'Gói Backup (Addon)', 'Backup plans (Addon)')}</h4>
      <div className="set-backup-grid">
        {BACKUP_PLANS.map((sku) => (
          <SkuCard
            key={sku.id}
            sku={sku}
            lang={lang}
            active={ent.backupPlanId === sku.id}
            onBuy={() => buy(sku.id)}
            onSimulate={
              isDev
                ? () => {
                    setEnt(simulatePurchase(sku.id))
                    setMsg(L(lang, 'Đã kích hoạt mô phỏng.', 'Simulated purchase activated.'))
                  }
                : undefined
            }
          />
        ))}
      </div>

      <h4 className="set-backup-h">
        {L(lang, 'Gói lưu trữ thêm (Addon)', 'Extra storage packs (Addon)')}
      </h4>
      <div className="set-backup-grid">
        {STORAGE_PACKS.map((sku) => (
          <SkuCard
            key={sku.id}
            sku={sku}
            lang={lang}
            active={(ent.storagePackIds as readonly AddonSkuId[]).includes(sku.id)}
            onBuy={() => buy(sku.id)}
            onSimulate={
              isDev
                ? () => {
                    setEnt(simulatePurchase(sku.id))
                    setMsg(L(lang, 'Đã thêm gói lưu trữ (mô phỏng).', 'Storage pack simulated.'))
                  }
                : undefined
            }
          />
        ))}
      </div>

      {isDev && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setEnt(clearSimulatedEntitlements())
            setMsg(L(lang, 'Đã xoá entitlement mô phỏng.', 'Cleared simulated entitlements.'))
          }}
        >
          {L(lang, 'Xoá mô phỏng (DEV)', 'Clear simulate (DEV)')}
        </button>
      )}

      {msg ? <p className="set-backup-msg">{msg}</p> : null}
      {err ? <p className="set-backup-err">{err}</p> : null}
    </div>
  )
}

function SkuCard({
  sku,
  lang,
  active,
  onBuy,
  onSimulate,
}: {
  sku: AddonSku
  lang: Lang
  active: boolean
  onBuy: () => void
  onSimulate?: () => void
}): ReactElement {
  return (
    <article className={`set-backup-card${active ? ' is-active' : ''}`}>
      <header>
        <h5>{lang === 'vi' ? sku.labelVi : sku.labelEn}</h5>
        {active ? <span className="set-backup-badge">{L(lang, 'Đang dùng', 'Active')}</span> : null}
      </header>
      <p>{lang === 'vi' ? sku.descVi : sku.descEn}</p>
      <ul>
        <li>
          {L(lang, 'Giá', 'Price')}: {lang === 'vi' ? sku.priceVi : sku.priceEn}
        </li>
        <li>
          {L(lang, 'Dung lượng', 'Quota')}: {sku.quotaGb} GB
        </li>
        {sku.kind === 'backup' ? (
          <li>
            {L(lang, 'Chu kỳ', 'Cadence')}: {lang === 'vi' ? sku.cadenceVi : sku.cadenceEn} ·{' '}
            {sku.retentionDays}d
          </li>
        ) : null}
      </ul>
      <div className="set-backup-card-actions">
        <button type="button" className="btn btn-primary" onClick={onBuy}>
          {active ? L(lang, 'Quản lý', 'Manage') : L(lang, 'Mua Addon', 'Buy addon')}
        </button>
        {onSimulate ? (
          <button type="button" className="btn btn-secondary" onClick={onSimulate}>
            {L(lang, 'Mô phỏng', 'Simulate')}
          </button>
        ) : null}
      </div>
    </article>
  )
}
