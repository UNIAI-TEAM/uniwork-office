import { useEffect, useId, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  UniworkWorkResult,
  WorkNotificationDocument,
  WorkNotificationDocumentPage,
} from '../../shared/uniwork-work-api'
import { useI18n } from './locale'
import { openUniworkDocument } from './uniwork-open'
import { ActionModal } from './UniworkDocActions'
import { WorkbenchIcon } from './WorkbenchIcons'
import { WorkSkeleton, WorkStatePanel } from './WorkErrorState'

/** the server's page size for the list; the cursor, not the page length, says whether more follow */
const PAGE_LIMIT = 50

type PageResult = UniworkWorkResult<WorkNotificationDocumentPage> | null

/** a failed or throwing bridge call reads as no page */
const fetchPage = (id: string, cursor: string | null): Promise<PageResult> =>
  Promise.resolve()
    .then(() =>
      window.uniworkWork.notificationDocuments(
        id,
        cursor ? { cursor, limit: PAGE_LIMIT } : { limit: PAGE_LIMIT },
      ),
    )
    .catch(() => null)

const AlertGlyph = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4.5M12 15.8v.2" />
  </svg>
)

/**
 * The documents behind a several-document change notice: loads on every open (no cache), a page of
 * 50 at a time by the server's cursor. A normal row opens the document; one that was deleted or
 * moved to the trash is shown muted and is not a link.
 */
export function DocChangeDialog({
  notificationId,
  onClose,
  onLoaded,
  returnFocus,
}: {
  notificationId: string
  onClose: () => void
  /** the first page arrived: the notice may be marked read (a failed page leaves it unread) */
  onLoaded?: () => void
  /** where focus lands when the control that opened the list is gone (its row was marked read) */
  returnFocus?: () => HTMLElement | null
}): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [docs, setDocs] = useState<WorkNotificationDocument[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading')
  const [more, setMore] = useState<'idle' | 'busy' | 'error'>('idle')
  const [attempt, setAttempt] = useState(0)
  const live = useRef(true)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const returnFocusRef = useRef(returnFocus)
  returnFocusRef.current = returnFocus
  const onLoadedRef = useRef(onLoaded)
  onLoadedRef.current = onLoaded
  // the control that opened it, captured before anything inside moves focus
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null,
  )

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      // after the answer's re-render: the row that opened the list may be gone
      const back =
        opener?.isConnected && !opener.matches(':disabled')
          ? opener
          : (returnFocusRef.current?.() ?? null)
      back?.focus()
    }
  }, [opener])

  // the first page, again on every open and on Retry
  useEffect(() => {
    let current = true
    setPhase('loading')
    void fetchPage(notificationId, null).then((r) => {
      if (!current) return
      if (r?.ok) {
        setDocs(r.value.documents)
        setCursor(r.value.next_cursor)
        setPhase('ready')
        onLoadedRef.current?.()
      } else setPhase('error')
    })
    return () => {
      current = false
    }
  }, [notificationId, attempt])

  // a control that left the page (Retry, the last Load more) must not strand focus on <body>:
  // Escape and Tab are heard on the dialog only
  useEffect(() => {
    const box = closeRef.current?.closest('[role="dialog"]')
    if (box && !box.contains(document.activeElement)) closeRef.current?.focus()
  })

  const loadMore = () => {
    if (!cursor || more === 'busy') return
    setMore('busy')
    void fetchPage(notificationId, cursor).then((r) => {
      if (!live.current) return
      if (r?.ok) {
        const seen = new Set<string>()
        setDocs((list) =>
          [...list, ...r.value.documents].filter((d) => !seen.has(d.id) && !!seen.add(d.id)),
        )
        setCursor(r.value.next_cursor)
        setMore('idle')
      } else setMore('error')
    })
  }

  const open = (d: WorkNotificationDocument) => {
    onCloseRef.current()
    void openUniworkDocument({ documentId: d.id, title: d.title.trim() }, window.aiOffice)
  }

  const moreButton = cursor ? (
    <button
      type="button"
      className="wb-btn wb-btn-secondary wb-docchange-more"
      aria-disabled={more === 'busy'}
      aria-busy={more === 'busy'}
      onClick={loadMore}
    >
      {t(more === 'busy' ? 'wbDocChangeLoadingMore' : 'wbDocChangeLoadMore')}
    </button>
  ) : null

  const body = (): ReactElement => {
    if (phase === 'loading')
      return (
        <div className="wb-docchange-loading">
          <p className="wb-docchange-note" role="status">
            {t('wbDocChangeLoading')}
          </p>
          <WorkSkeleton rows={3} />
        </div>
      )
    if (phase === 'error')
      return (
        <WorkStatePanel
          tone="danger"
          icon={AlertGlyph}
          title={t('wbDocChangeErrorTitle')}
          body={t('wbDocChangeErrorDesc')}
          action={{ label: t('acctRetry'), onClick: () => setAttempt((n) => n + 1) }}
          role="alert"
          compact
        />
      )
    if (docs.length === 0 && !cursor)
      return (
        <WorkStatePanel
          tone="gray"
          icon={<WorkbenchIcon id="inbox" size={20} />}
          title={t('wbDocChangeEmptyTitle')}
          body={t('wbDocChangeEmptyDesc')}
          role="status"
          compact
        />
      )
    return (
      <>
        {docs.length > 0 ? (
          <ul className="wb-docchange-list">
            {docs.map((d) => {
              const title = d.title.trim()
              if (d.deleted || d.trashed)
                return (
                  <li key={d.id} className="wb-docchange-row is-gone">
                    <span className="wb-docchange-name">{title || t('wbDocChangeUntitled')}</span>
                    <span className="wb-docchange-tag">
                      {t(d.deleted ? 'wbDocChangeDeleted' : 'wbDocChangeInTrash')}
                    </span>
                  </li>
                )
              return (
                <li key={d.id}>
                  <button type="button" className="wb-docchange-row" onClick={() => open(d)}>
                    <span className="wb-docchange-name">{title || t('wbDocChangeUntitled')}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
        {more === 'error' ? (
          <p className="wb-docchange-note is-error" role="alert">
            {t('wbDocChangeErrorDesc')}
          </p>
        ) : null}
        {moreButton}
      </>
    )
  }

  return (
    <ActionModal
      labelledBy={titleId}
      className="wb-docchange"
      onCancel={() => onCloseRef.current()}
      restoreFocus={false}
    >
      <div className="wb-docchange-head">
        <h3 id={titleId}>{t('wbDocChangeTitle')}</h3>
        <button
          ref={closeRef}
          type="button"
          className="wb-btn wb-btn-ghost wb-btn-sm"
          onClick={() => onCloseRef.current()}
        >
          {t('uwClose')}
        </button>
      </div>
      {body()}
    </ActionModal>
  )
}
