import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import QRCode from 'qrcode'
import {
  VIETQR_BANKS,
  bankByBin,
  createPaymentOrder,
  markOrderConfirmed,
  markOrderSubmitted,
  paymentAccountReady,
  planPriceVnd,
  readPaymentAccount,
  readPaymentOrders,
  writePaymentAccount,
  type BillingCycle,
  type PaymentAccount,
  type PaymentOrder,
} from './payment-account'
import {
  getLicensePlan,
  simulateLicensePlan,
  type LicensePlanId,
} from './license-entitlements'
import { buildVietQrPayload } from './vietqr'

function L(lang: string, vi: string, en: string): string {
  return lang === 'vi' || lang.startsWith('vi') ? vi : en
}

const isDev = Boolean(import.meta.env?.DEV)
const PAID_PLANS: LicensePlanId[] = ['personal', 'pro', 'team']

export function BillingPaymentPane({
  lang,
  signedIn = false,
}: {
  lang: string
  /** signed in to the UniWork account: the account, not this device, carries the plan */
  signedIn?: boolean
}): ReactElement {
  const [account, setAccount] = useState<PaymentAccount>(() => readPaymentAccount())
  const [orders, setOrders] = useState<PaymentOrder[]>(() => readPaymentOrders())
  const [planId, setPlanId] = useState<LicensePlanId>('personal')
  const [cycle, setCycle] = useState<BillingCycle>('year')
  const [activeOrder, setActiveOrder] = useState<PaymentOrder | null>(null)
  const [qrUrl, setQrUrl] = useState('')
  const [qrError, setQrError] = useState('')
  const [msg, setMsg] = useState('')
  const [editingAccount, setEditingAccount] = useState(!paymentAccountReady(account))

  const amount = planPriceVnd(planId, cycle)
  const bank = bankByBin(account.bankBin)
  const ready = paymentAccountReady(account)

  const transferHint = useMemo(() => {
    if (!activeOrder) return ''
    return activeOrder.transferContent
  }, [activeOrder])

  useEffect(() => {
    let cancelled = false
    if (!activeOrder || !ready) {
      setQrUrl('')
      setQrError('')
      return
    }
    try {
      const payload = buildVietQrPayload({
        bankBin: account.bankBin,
        accountNumber: account.accountNumber.trim(),
        accountName: account.accountName.trim() || 'UNIWORK',
        amountVnd: activeOrder.amountVnd,
        description: activeOrder.transferContent,
      })
      void QRCode.toDataURL(payload, {
        width: 220,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#0f172a', light: '#ffffff' },
      }).then((url) => {
        if (!cancelled) {
          setQrUrl(url)
          setQrError('')
        }
      })
    } catch {
      if (!cancelled) {
        setQrUrl('')
        setQrError(L(lang, 'Không tạo được VietQR — kiểm tra STK / BIN.', 'Could not build VietQR — check account / BIN.'))
      }
    }
    return () => {
      cancelled = true
    }
  }, [activeOrder, account, ready, lang])

  const saveAccount = () => {
    writePaymentAccount(account)
    setEditingAccount(false)
    setMsg(L(lang, 'Đã lưu tài khoản nhận tiền.', 'Receiving account saved.'))
  }

  const startCheckout = () => {
    if (!ready) {
      setEditingAccount(true)
      setMsg(L(lang, 'Nhập tài khoản ngân hàng nhận tiền trước.', 'Set the receiving bank account first.'))
      return
    }
    try {
      const order = createPaymentOrder(planId, cycle)
      setOrders(readPaymentOrders())
      setActiveOrder(order)
      setMsg(
        L(
          lang,
          `Đơn ${order.id} — quét VietQR hoặc chuyển khoản đúng nội dung.`,
          `Order ${order.id} — scan VietQR or transfer with the exact content.`,
        ),
      )
    } catch {
      setMsg(L(lang, 'Không tạo được đơn.', 'Could not create order.'))
    }
  }

  const submitted = () => {
    if (!activeOrder) return
    const next = markOrderSubmitted(activeOrder.id)
    if (next) {
      setActiveOrder(next)
      setOrders(readPaymentOrders())
      setMsg(
        L(
          lang,
          'Đã ghi nhận chuyển khoản. UniWork sẽ kích hoạt sau khi đối soát (hoặc DEV xác nhận bên dưới).',
          'Transfer recorded. UniWork will activate after reconciliation (or DEV confirm below).',
        ),
      )
    }
  }

  const confirmDev = () => {
    if (!activeOrder) return
    const next = markOrderConfirmed(activeOrder.id)
    if (!next) return
    simulateLicensePlan(next.planId)
    setActiveOrder(next)
    setOrders(readPaymentOrders())
    setMsg(
      L(
        lang,
        `DEV: đã xác nhận thanh toán và kích hoạt gói ${getLicensePlan(next.planId).labelVi}.`,
        `DEV: payment confirmed and ${getLicensePlan(next.planId).labelEn} activated.`,
      ),
    )
  }

  return (
    <div className="set-billing">
      <h4 className="set-license-h">
        {L(lang, 'Thanh toán · VietQR', 'Billing · VietQR')}
      </h4>
      <p className="set-field-desc">
        {L(
          lang,
          'Khách chuyển khoản qua VietQR NAPAS vào tài khoản nhận tiền UniWork. Nội dung CK = mã đơn để đối soát.',
          'Customers pay via VietQR (NAPAS) to the UniWork receiving account. Transfer content = order id for reconciliation.',
        )}
      </p>

      <div className="set-billing-account">
        <div className="set-billing-account-head">
          <strong>{L(lang, 'Tài khoản nhận tiền', 'Receiving account')}</strong>
          <button
            type="button"
            className="set-btn"
            onClick={() => setEditingAccount((v) => !v)}
          >
            {editingAccount
              ? L(lang, 'Đóng', 'Close')
              : L(lang, 'Chỉnh sửa', 'Edit')}
          </button>
        </div>
        {!editingAccount ? (
          <div className="set-license-summary">
            <div>
              <span>{L(lang, 'Ngân hàng', 'Bank')}</span>
              <strong>
                {bank
                  ? lang.startsWith('vi')
                    ? bank.nameVi
                    : bank.nameEn
                  : account.bankBin || '—'}
              </strong>
            </div>
            <div>
              <span>{L(lang, 'Số tài khoản', 'Account no.')}</span>
              <strong>{account.accountNumber || '—'}</strong>
            </div>
            <div>
              <span>{L(lang, 'Chủ tài khoản', 'Account name')}</span>
              <strong>{account.accountName || '—'}</strong>
            </div>
          </div>
        ) : (
          <div className="set-billing-form">
            <label>
              <span>{L(lang, 'Ngân hàng', 'Bank')}</span>
              <select
                value={account.bankBin}
                onChange={(e) => setAccount({ ...account, bankBin: e.target.value })}
              >
                {VIETQR_BANKS.map((b) => (
                  <option key={b.bin} value={b.bin}>
                    {b.code} · {lang.startsWith('vi') ? b.nameVi : b.nameEn} ({b.bin})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{L(lang, 'Số tài khoản', 'Account number')}</span>
              <input
                value={account.accountNumber}
                onChange={(e) => setAccount({ ...account, accountNumber: e.target.value })}
                placeholder="0123456789"
                inputMode="numeric"
              />
            </label>
            <label>
              <span>{L(lang, 'Tên chủ tài khoản', 'Account name')}</span>
              <input
                value={account.accountName}
                onChange={(e) => setAccount({ ...account, accountName: e.target.value })}
                placeholder="CONG TY UNIWORK"
              />
            </label>
            <button type="button" className="set-btn primary" onClick={saveAccount}>
              {L(lang, 'Lưu tài khoản', 'Save account')}
            </button>
          </div>
        )}
        {!ready && !signedIn ? (
          <p className="set-license-warn">
            {L(
              lang,
              'Chưa có STK — cần cấu hình trước khi tạo VietQR.',
              'No account number — configure before generating VietQR.',
            )}
          </p>
        ) : null}
      </div>

      <div className="set-billing-checkout">
        <label>
          <span>{L(lang, 'Gói', 'Plan')}</span>
          <select
            value={planId}
            onChange={(e) => setPlanId(e.target.value as LicensePlanId)}
          >
            {PAID_PLANS.map((id) => {
              const p = getLicensePlan(id)
              return (
                <option key={id} value={id}>
                  {lang.startsWith('vi') ? p.labelVi : p.labelEn}
                </option>
              )
            })}
          </select>
        </label>
        <label>
          <span>{L(lang, 'Chu kỳ', 'Cycle')}</span>
          <select
            value={cycle}
            onChange={(e) => setCycle(e.target.value as BillingCycle)}
          >
            <option value="month">{L(lang, 'Theo tháng', 'Monthly')}</option>
            <option value="year">{L(lang, 'Theo năm (tiết kiệm)', 'Yearly (save)')}</option>
          </select>
        </label>
        <div className="set-billing-amount">
          <span>{L(lang, 'Số tiền', 'Amount')}</span>
          <strong>{amount.toLocaleString('vi-VN')}đ</strong>
        </div>
        <button type="button" className="set-btn primary" onClick={startCheckout}>
          {L(lang, 'Tạo VietQR thanh toán', 'Create VietQR payment')}
        </button>
      </div>

      {activeOrder ? (
        <div className="set-billing-qr-card">
          <div className="set-billing-qr-meta">
            <strong>
              {L(lang, 'Đơn', 'Order')} {activeOrder.id}
            </strong>
            <span>
              {getLicensePlan(activeOrder.planId).labelVi} ·{' '}
              {activeOrder.cycle === 'year'
                ? L(lang, 'Năm', 'Year')
                : L(lang, 'Tháng', 'Month')}{' '}
              · {activeOrder.amountVnd.toLocaleString('vi-VN')}đ
            </span>
            <span>
              {L(lang, 'Nội dung CK', 'Transfer content')}: <code>{transferHint}</code>
            </span>
            <span>
              {L(lang, 'Trạng thái', 'Status')}: {activeOrder.status}
            </span>
          </div>
          {qrUrl ? (
            <img
              className="set-billing-qr"
              src={qrUrl}
              width={200}
              height={200}
              alt="VietQR"
            />
          ) : (
            <div className="set-billing-qr set-billing-qr-ph">
              {qrError || L(lang, 'Đang tạo QR…', 'Generating QR…')}
            </div>
          )}
          <div className="set-billing-qr-actions">
            <button
              type="button"
              className="set-btn primary"
              disabled={activeOrder.status === 'confirmed'}
              onClick={submitted}
            >
              {L(lang, 'Tôi đã chuyển khoản', 'I have transferred')}
            </button>
            {isDev ? (
              <button
                type="button"
                className="set-btn"
                disabled={activeOrder.status === 'confirmed'}
                onClick={confirmDev}
              >
                {L(lang, 'DEV: Xác nhận & kích hoạt', 'DEV: Confirm & activate')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {orders.length > 0 ? (
        <>
          <h4 className="set-license-h">{L(lang, 'Đơn gần đây', 'Recent orders')}</h4>
          <ul className="set-billing-orders">
            {orders.slice(0, 8).map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="set-billing-order"
                  onClick={() => setActiveOrder(o)}
                >
                  <strong>{o.id}</strong>
                  <span>
                    {o.planId} · {o.amountVnd.toLocaleString('vi-VN')}đ · {o.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {msg ? <p className="set-license-msg">{msg}</p> : null}
    </div>
  )
}
