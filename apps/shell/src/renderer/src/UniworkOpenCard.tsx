import { useState } from 'react'
import { useI18n } from './locale'
import { useAccount } from './account-model'
import { UniworkOpenDialog } from './UniworkOpenDialog'
import { openCardOf } from './uniwork-docs-model'
import { openSyncCenter } from './offline-library-model'
import { useOfflineLibrary } from './use-offline-library'

function CloudIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M5.2 14.2a3.2 3.2 0 0 1-.4-6.37 4.4 4.4 0 0 1 8.5.9 2.75 2.75 0 0 1-.4 5.47H5.2z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * "Open from UniWork" quick card, always visible next to "Open local". Signed
 * in it opens the picker; signed out or expired it is the sign-in call to
 * action; when sign-in is unavailable here it leads to Settings → Account.
 * G5-05u (Q3): offline with documents in the offline library, it opens the sync
 * center on the "Dùng khi không có mạng" tab instead of a picker that cannot load.
 */
export function UniworkOpenCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n()
  const account = useAccount()
  const [open, setOpen] = useState(false)
  const card = openCardOf(account.view)
  const offline = useOfflineLibrary()
  const toLibrary =
    card.action === 'picker' &&
    account.view === 'server-unreachable' &&
    (offline?.rows.length ?? 0) > 0

  const handleClick = () => {
    if (toLibrary) openSyncCenter('offline')
    else if (card.action === 'picker') setOpen(true)
    else if (card.action === 'sign-in') account.signIn()
    else if (card.action === 'settings') onOpenSettings()
  }

  return (
    <>
      <button
        type="button"
        className="quick-card uw-open-card"
        data-state={account.view}
        disabled={card.action === 'none'}
        onClick={handleClick}
        aria-haspopup={card.action === 'picker' && !toLibrary ? 'dialog' : undefined}
      >
        <span className="quick-folder">
          <CloudIcon />
        </span>
        <span className="quick-text">
          <span className="quick-title-row">
            <span className="quick-title">{t('uwOpenCardTitle')}</span>
          </span>
          <span className={`quick-sub${card.attention ? ' attention' : ''}`} title={t(card.subKey)}>
            {t(card.subKey)}
          </span>
        </span>
      </button>
      {open && (
        <UniworkOpenDialog
          onClose={() => setOpen(false)}
          accountView={account.view}
          onSignIn={account.signIn}
        />
      )}
    </>
  )
}
