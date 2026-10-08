import { useState } from 'react'
import type { ReactElement } from 'react'
import {
  LICENSE_PLANS,
  canUseOfficeBridge,
  currentDeviceId,
  getLicensePlan,
  isOverDeviceLimit,
  readLicenseEntitlement,
  revokeLicenseDevice,
  simulateLicensePlan,
  writeLicenseEntitlement,
  type LicenseEntitlement,
  type LicensePlanId,
} from './license-entitlements'

function L(lang: string, vi: string, en: string): string {
  return lang === 'vi' || lang.startsWith('vi') ? vi : en
}

const isDev = Boolean(import.meta.env?.DEV)

export function LicenseDevicesPane({
  lang,
  loggedIn,
}: {
  lang: string
  loggedIn: boolean
}): ReactElement {
  const [ent, setEnt] = useState<LicenseEntitlement>(() => readLicenseEntitlement())
  const [msg, setMsg] = useState('')
  const thisId = currentDeviceId()
  const plan = getLicensePlan(ent.planId)
  const over = isOverDeviceLimit(ent)
  const bridgeOk = canUseOfficeBridge(ent)

  const persist = (next: LicenseEntitlement) => {
    writeLicenseEntitlement(next)
    setEnt(next)
  }

  const statusLabel = () => {
    switch (ent.status) {
      case 'active':
        return L(lang, 'Đang hiệu lực', 'Active')
      case 'grace':
        return L(lang, 'Gia hạn offline (grace)', 'Offline grace')
      case 'expired':
        return L(lang, 'Hết hạn → Free', 'Expired → Free')
      default:
        return L(lang, 'Chưa có', 'None')
    }
  }

  return (
    <div className="set-license">
      <h4 className="set-license-h">{L(lang, 'License UniWork Office', 'UniWork Office license')}</h4>
      <p className="set-field-desc">
        {L(
          lang,
          'License gắn tài khoản UniWork · giới hạn số máy · file local vẫn dùng được khi hết hạn (rơi về Free).',
          'License is account-bound · device limits · local files still work after expiry (falls back to Free).',
        )}
      </p>

      <div className="set-license-summary">
        <div>
          <span>{L(lang, 'Gói', 'Plan')}</span>
          <strong>
            {lang.startsWith('vi') ? plan.labelVi : plan.labelEn}
            {ent.simulated ? ' · DEV' : ''}
          </strong>
        </div>
        <div>
          <span>{L(lang, 'Trạng thái', 'Status')}</span>
          <strong>{statusLabel()}</strong>
        </div>
        <div>
          <span>{L(lang, 'Thiết bị', 'Devices')}</span>
          <strong>
            {ent.devices.length} / {ent.maxDevices}
          </strong>
        </div>
        <div>
          <span>Office Bridge</span>
          <strong>
            {bridgeOk
              ? L(lang, 'Được phép', 'Allowed')
              : L(lang, 'Chỉ local / cần Personal+', 'Local only / needs Personal+')}
          </strong>
        </div>
        <div>
          <span>AI token / {L(lang, 'tháng', 'month')}</span>
          <strong>{ent.tokensMonth.toLocaleString(lang.startsWith('vi') ? 'vi-VN' : 'en-US')}</strong>
        </div>
        {ent.expiresAt ? (
          <div>
            <span>{L(lang, 'Hết hạn', 'Expires')}</span>
            <strong>{new Date(ent.expiresAt).toLocaleDateString(lang.startsWith('vi') ? 'vi-VN' : 'en-US')}</strong>
          </div>
        ) : null}
      </div>

      {over ? (
        <p className="set-license-warn">
          {L(
            lang,
            'Vượt số máy cho phép — thu hồi một thiết bị bên dưới hoặc nâng gói.',
            'Over the device limit — revoke a device below or upgrade your plan.',
          )}
        </p>
      ) : null}

      {!loggedIn ? (
        <p className="set-field-desc">
          {L(
            lang,
            'Đăng nhập để đồng bộ license từ máy chủ. Hiện đang dùng entitlement trên máy này.',
            'Sign in to sync license from the server. Using on-device entitlement for now.',
          )}
        </p>
      ) : (
        <p className="set-field-desc">
          {L(
            lang,
            'Đã đăng nhập — khi API license lên, entitlement sẽ refresh từ UniWork.',
            'Signed in — when the license API is live, entitlements will refresh from UniWork.',
          )}
        </p>
      )}

      <h4 className="set-license-h">{L(lang, 'Thiết bị đã đăng nhập', 'Devices signed in')}</h4>
      <ul className="set-license-devices">
        {ent.devices.length === 0 ? (
          <li className="set-license-empty">{L(lang, 'Chưa có thiết bị.', 'No devices yet.')}</li>
        ) : (
          ent.devices.map((d) => {
            const mine = d.deviceId === thisId
            return (
              <li key={d.deviceId} className={`set-license-device${mine ? ' is-current' : ''}`}>
                <div>
                  <strong>
                    {d.label}
                    {mine ? ` · ${L(lang, 'Máy này', 'This device')}` : ''}
                  </strong>
                  <span>
                    {d.platform} · {L(lang, 'Hoạt động', 'Last seen')}{' '}
                    {new Date(d.lastSeenAt).toLocaleString(lang.startsWith('vi') ? 'vi-VN' : 'en-US')}
                  </span>
                  <code>{d.deviceId.slice(0, 18)}…</code>
                </div>
                {!mine ? (
                  <button
                    type="button"
                    className="set-btn"
                    onClick={() => {
                      const next = revokeLicenseDevice(ent, d.deviceId)
                      persist(next)
                      setMsg(L(lang, 'Đã thu hồi thiết bị.', 'Device revoked.'))
                    }}
                  >
                    {L(lang, 'Thu hồi', 'Revoke')}
                  </button>
                ) : (
                  <span className="set-license-pill">{L(lang, 'Hiện tại', 'Current')}</span>
                )}
              </li>
            )
          })
        )}
      </ul>

      {isDev ? (
        <>
          <h4 className="set-license-h">{L(lang, 'Mô phỏng gói (DEV)', 'Simulate plan (DEV)')}</h4>
          <div className="set-license-sim">
            {LICENSE_PLANS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`set-btn${ent.planId === p.id ? ' primary' : ''}`}
                onClick={() => {
                  const next = simulateLicensePlan(p.id as LicensePlanId)
                  setEnt(next)
                  setMsg(
                    L(lang, `Đã mô phỏng gói ${p.labelVi}.`, `Simulated ${p.labelEn} plan.`),
                  )
                }}
              >
                {lang.startsWith('vi') ? p.labelVi : p.labelEn}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {msg ? <p className="set-license-msg">{msg}</p> : null}
    </div>
  )
}
