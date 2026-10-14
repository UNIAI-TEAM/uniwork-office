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
import { useI18n } from './locale'
import type { TFunc } from './locale'
import { exportWorkbenchBackupUi, importWorkbenchBackupUi } from './workbench-store-client'

/** a restore replaces this device's Workbench data, so it is asked before the file picker opens */
type RestoreKind = 'zip' | 'json'

export function BackupStoragePane({
  loggedIn,
  onLogin,
}: {
  loggedIn: boolean
  onLogin: () => void
}): ReactElement {
  const { lang, t, dateLocale } = useI18n()
  const [ent, setEnt] = useState<AddonEntitlements>(() => readEntitlements())
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<RestoreKind | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const isDev = Boolean(import.meta.env?.DEV)
  const quotaGb = useMemo(() => totalQuotaGb(ent), [ent])
  const usedMb = ent.usedBytes / (1024 * 1024)

  const say = (text: string) => {
    setErr(null)
    setMsg(text)
  }
  const fail = (text: string) => {
    setMsg(null)
    setErr(text)
  }

  const buy = (sku: AddonSkuId) => {
    if (!loggedIn) {
      fail(t('bkBuySignIn'))
      return
    }
    // Real checkout is server-hosted; open pricing until billing API ships.
    window.open(addonPricingUrl(sku), '_blank', 'noopener,noreferrer')
    say(t('bkBuyOpened'))
  }

  const doExport = () => {
    const snap = exportLocalBackup()
    downloadSnapshot(snap)
    say(t('bkExportedJson', { n: Object.keys(snap.keys).length }))
  }

  const doExportZip = async () => {
    setErr(null)
    setMsg(null)
    const r = await exportWorkbenchBackupUi()
    if (r.ok) {
      say(t('bkExportedZip', { path: r.path }))
      return
    }
    // the main process answers with codes, not sentences
    if (!r.canceled) fail(t('bkExportFailed'))
  }

  const doImportZip = async () => {
    setErr(null)
    setMsg(null)
    const r = await importWorkbenchBackupUi()
    if (r.ok) {
      setEnt(readEntitlements())
      say(t('bkRestored', { n: r.keyCount }))
      return
    }
    if (!r.canceled) fail(t('bkImportFailed'))
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
        fail(t('bkInvalidFile'))
        return
      }
      setEnt(readEntitlements())
      say(t('bkRestored', { n: r.count }))
    } catch {
      fail(t('bkUnreadableFile'))
    }
  }

  const runRestore = () => {
    const kind = confirmRestore
    setConfirmRestore(null)
    if (kind === 'zip') void doImportZip()
    else if (kind === 'json') {
      // the same file picked twice must still fire onChange
      if (fileRef.current) fileRef.current.value = ''
      fileRef.current?.click()
    }
  }

  const cloudBackup = () => {
    if (!hasCloudBackup(ent)) {
      fail(t('bkCloudNeedsPlanMsg'))
      return
    }
    if (!loggedIn) {
      fail(t('bkCloudSignIn'))
      return
    }
    // Until API exists: simulate success in DEV; otherwise show pending message.
    if (isDev) {
      setEnt(simulateCloudBackupNow())
      say(t('bkCloudSimulated'))
      return
    }
    say(t('bkCloudPending'))
  }

  const feedback = (
    <>
      {msg ? (
        <p className="set-backup-msg" role="status">
          {msg}
        </p>
      ) : null}
      {err ? (
        <p className="set-backup-err" role="alert">
          {err}
        </p>
      ) : null}
    </>
  )

  return (
    <div className="set-backup">
      <h3 className="set-pane-title">{t('setSecBackup')}</h3>
      <p className="set-backup-lead">{t('bkLead')}</p>

      <div className="set-backup-status">
        <div>
          <span>{t('bkPlanLabel')}</span>
          <strong>
            {ent.backupPlanId
              ? BACKUP_PLANS.find((p) => p.id === ent.backupPlanId)?.[
                  lang === 'vi' ? 'labelVi' : 'labelEn'
                ]
              : t('bkPlanNone')}
          </strong>
        </div>
        <div>
          <span>{t('bkQuotaLabel')}</span>
          <strong>
            {quotaGb > 0 ? `${usedMb.toFixed(1)} MB / ${quotaGb} GB` : t('bkQuotaLocal')}
          </strong>
        </div>
        <div>
          <span>{t('bkLastLabel')}</span>
          <strong>
            {ent.lastCloudBackupAt
              ? new Date(ent.lastCloudBackupAt).toLocaleString(dateLocale)
              : '—'}
          </strong>
        </div>
        {ent.simulated ? <p className="set-backup-sim">{t('bkSimulated')}</p> : null}
      </div>

      {!loggedIn && (
        <div className="set-backup-login">
          <p>{t('bkSignInPrompt')}</p>
          <button type="button" className="set-btn primary" onClick={onLogin}>
            {t('bkSignIn')}
          </button>
        </div>
      )}

      <h4 className="set-pane-subtitle">{t('bkFreeHeading')}</h4>
      <div className="set-field">
        <div className="set-field-text">
          <div className="set-field-label">{t('bkExportHeading')}</div>
        </div>
        <div className="set-btn-row">
          <button type="button" className="set-btn" onClick={() => void doExportZip()}>
            {t('bkExportZip')}
          </button>
          <button type="button" className="set-btn" onClick={doExport}>
            {t('bkExportJson')}
          </button>
        </div>
      </div>
      <div className="set-field">
        <div className="set-field-text">
          <div className="set-field-label">{t('bkRestoreHeading')}</div>
        </div>
        <div className="set-btn-row">
          <button
            type="button"
            className="set-btn"
            aria-expanded={confirmRestore === 'zip'}
            onClick={() => setConfirmRestore('zip')}
          >
            {t('bkImportZip')}
          </button>
          <button
            type="button"
            className="set-btn"
            aria-expanded={confirmRestore === 'json'}
            onClick={() => setConfirmRestore('json')}
          >
            {t('bkImportJson')}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void onPickImport(e.target.files?.[0] ?? null)}
        />
      </div>
      {confirmRestore && (
        <div className="set-intg-confirm" role="alertdialog" aria-describedby="set-bk-restore">
          <div className="set-field-desc" id="set-bk-restore">
            {t('bkRestoreConfirm')}
          </div>
          <div className="set-intg-actions">
            <button type="button" className="set-btn" onClick={() => setConfirmRestore(null)}>
              {t('cancel')}
            </button>
            <button type="button" className="set-btn danger" onClick={runRestore}>
              {t('bkRestoreChoose')}
            </button>
          </div>
        </div>
      )}
      <div className="set-field">
        <div className="set-field-text">
          <div className="set-field-stack">
            <div className="set-field-label">{t('bkCloudHeading')}</div>
            {!hasCloudBackup(ent) && <div className="set-field-desc">{t('bkCloudNeedsPlan')}</div>}
          </div>
        </div>
        <button
          type="button"
          className="set-btn primary"
          disabled={!hasCloudBackup(ent)}
          onClick={cloudBackup}
        >
          {t('bkCloudBackup')}
        </button>
      </div>
      {feedback}

      <h4 className="set-pane-subtitle">{t('bkPlansHeading')}</h4>
      <div className="set-backup-grid">
        {BACKUP_PLANS.map((sku) => (
          <SkuCard
            key={sku.id}
            sku={sku}
            lang={lang}
            t={t}
            active={ent.backupPlanId === sku.id}
            onBuy={() => buy(sku.id)}
            onSimulate={
              isDev
                ? () => {
                    setEnt(simulatePurchase(sku.id))
                    say(t('bkSimActivated'))
                  }
                : undefined
            }
          />
        ))}
      </div>

      <h4 className="set-pane-subtitle">{t('bkPacksHeading')}</h4>
      <div className="set-backup-grid">
        {STORAGE_PACKS.map((sku) => (
          <SkuCard
            key={sku.id}
            sku={sku}
            lang={lang}
            t={t}
            active={(ent.storagePackIds as readonly AddonSkuId[]).includes(sku.id)}
            onBuy={() => buy(sku.id)}
            onSimulate={
              isDev
                ? () => {
                    setEnt(simulatePurchase(sku.id))
                    say(t('bkSimPack'))
                  }
                : undefined
            }
          />
        ))}
      </div>

      {isDev && (
        <div className="set-backup-actions">
          <button
            type="button"
            className="set-btn"
            onClick={() => {
              setEnt(clearSimulatedEntitlements())
              say(t('bkSimCleared'))
            }}
          >
            {t('bkClearSimulated')}
          </button>
        </div>
      )}
    </div>
  )
}

/** the SKU catalog carries its own vi/en product copy (prices differ per currency) */
function SkuCard({
  sku,
  lang,
  t,
  active,
  onBuy,
  onSimulate,
}: {
  sku: AddonSku
  lang: Lang
  t: TFunc
  active: boolean
  onBuy: () => void
  onSimulate?: () => void
}): ReactElement {
  const vi = lang === 'vi'
  return (
    <article className={`set-backup-card${active ? ' is-active' : ''}`}>
      <header>
        <h5>{vi ? sku.labelVi : sku.labelEn}</h5>
        {active ? <span className="set-backup-badge">{t('bkActive')}</span> : null}
      </header>
      <p>{vi ? sku.descVi : sku.descEn}</p>
      <dl className="set-backup-facts">
        <dt>{t('bkPrice')}</dt>
        <dd>{vi ? sku.priceVi : sku.priceEn}</dd>
        <dt>{t('bkQuota')}</dt>
        <dd>{sku.quotaGb} GB</dd>
        {sku.kind === 'backup' ? (
          <>
            <dt>{t('bkCadence')}</dt>
            <dd>
              {vi ? sku.cadenceVi : sku.cadenceEn} ·{' '}
              {t('bkRetentionDays', { n: sku.retentionDays })}
            </dd>
          </>
        ) : null}
      </dl>
      <div className="set-backup-card-actions">
        <button type="button" className={`set-btn${active ? '' : ' primary'}`} onClick={onBuy}>
          {active ? t('bkManage') : t('bkBuy')}
        </button>
        {onSimulate ? (
          <button type="button" className="set-btn" onClick={onSimulate}>
            {t('bkSimulate')}
          </button>
        ) : null}
      </div>
    </article>
  )
}
