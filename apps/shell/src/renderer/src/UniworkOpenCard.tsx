import { useState } from 'react'
import { useI18n } from './locale'
import { useAccount } from './account-model'
import { UniworkOpenDialog } from './UniworkOpenDialog'
import { openCardOf } from './uniwork-docs-model'

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
 */
export function UniworkOpenCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n()
  const account = useAccount()
  const [open, setOpen] = useState(false)
  const card = openCardOf(account.view)

  const handleClick = () => {
    if (card.action === 'picker') setOpen(true)
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
        aria-haspopup={card.action === 'picker' ? 'dialog' : undefined}
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
