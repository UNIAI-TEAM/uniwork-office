import { useState } from 'react'
import { useI18n } from './locale'
import type { AccountController } from './account-model'

/**
 * The server address field of Settings → Account: the first-run screen
 * ("Connect to UniWork") when no server is chosen, the way out when the saved
 * server cannot be reached, and a collapsed "Change server" elsewhere. The
 * address is validated and saved by the main process; this only types it.
 */
export function ServerConnect({
  account,
  startOpen,
  unreachableServer,
}: {
  account: AccountController
  startOpen: boolean
  /** the saved server that did not answer; named above the field */
  unreachableServer: string | null
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(startOpen)
  const [address, setAddress] = useState('')
  const connecting = account.busy === 'connecting'
  const failed = account.connectError
  const errorKey =
    failed === 'invalid_address' ? 'acctConnectInvalid' : failed ? 'acctConnectFailed' : null

  if (!open) {
    return (
      <div className="set-pane-footer acct-actions">
        <button type="button" className="set-btn" onClick={() => setOpen(true)}>
          {t('acctChangeServer')}
        </button>
      </div>
    )
  }
  return (
    <form
      className="acct-server-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (address.trim() && !connecting) account.connectServer(address)
      }}
    >
      {unreachableServer && (
        <div className="acct-notice-title">
          {t('acctConnectUnreachable', { server: unreachableServer })}
        </div>
      )}
      <label className="set-field-label" htmlFor="acct-server-address">
        {t('acctConnectField')}
      </label>
      <input
        id="acct-server-address"
        className="set-input"
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder={account.status?.serverUrl ?? ''}
        value={address}
        aria-invalid={errorKey ? true : undefined}
        onChange={(event) => setAddress(event.target.value)}
      />
      {errorKey && (
        <div className="acct-inline-error" role="alert">
          {t(errorKey)}
        </div>
      )}
      <div className="set-pane-footer acct-actions">
        <button type="submit" className="set-btn primary" disabled={connecting || !address.trim()}>
          {connecting ? t('acctConnecting') : t('acctConnectButton')}
        </button>
      </div>
    </form>
  )
}
