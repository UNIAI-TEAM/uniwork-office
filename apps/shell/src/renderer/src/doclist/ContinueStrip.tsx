import { useId } from 'react'
import { FileBadge } from '../FileBadge'
import { useI18n } from '../locale'
import { docExtension } from '../uniwork-docs-model'
import { isFolderEntry } from '../uniwork-folders/uniwork-folders-model'
import type { DocumentsHomeDoc } from '../uniwork-home/documents-home-model'
import { activityKey, formatListDate } from './format'

/** how many cards the strip holds (the recent-canvas row of four) */
export const CONTINUE_CARD_COUNT = 4

/** the types the card preview has a tint for; anything else reads as plain */
const PREVIEW_TYPES = ['docx', 'xlsx', 'pptx', 'pdf', 'md', 'html', 'txt'] as const

/** which tint a card's preview takes: UniNote pages have their own, an unknown extension none */
export function previewTypeOf(doc: DocumentsHomeDoc): string {
  if (doc.kind === 'page') return 'page'
  const ext = docExtension(doc)
  const known = (PREVIEW_TYPES as readonly string[]).includes(ext)
  return known ? ext : 'other'
}

/**
 * The documents the strip offers: the newest last touches, whatever the table is sorted by.
 * Folders and trashed rows are not something to pick up again, and a row without the server's
 * `last_activity` has no touch to rank by.
 */
export function continueDocsOf(docs: readonly DocumentsHomeDoc[]): DocumentsHomeDoc[] {
  const touchOf = (doc: DocumentsHomeDoc): number => {
    const at = doc.lastActivity ? Date.parse(doc.lastActivity.at) : Number.NaN
    return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at
  }
  return docs
    .filter(
      (doc) => !isFolderEntry(doc) && !doc.archived && touchOf(doc) > Number.NEGATIVE_INFINITY,
    )
    .sort((a, b) => touchOf(b) - touchOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, CONTINUE_CARD_COUNT)
}

/**
 * "Mở tiếp": cards for the last documents the person touched, above the Recent list (the
 * recent-canvas board). Each card is a button that opens the document; its preview is a
 * decorative sheet in the file type's tint.
 */
export function ContinueStrip({
  docs,
  openingId,
  onOpen,
}: {
  docs: readonly DocumentsHomeDoc[]
  openingId?: string | null
  onOpen: (doc: DocumentsHomeDoc) => void
}) {
  const { t, dateLocale } = useI18n()
  const headingId = useId()
  if (docs.length === 0) return null
  const now = new Date()
  return (
    <section className="dh-continue" aria-labelledby={headingId}>
      <h2 id={headingId} className="dh-continue-title">
        {t('dlContinueTitle')}
      </h2>
      <div className="dh-continue-grid">
        {docs.map((doc) => {
          const activity = doc.lastActivity
          const key = activity ? activityKey(activity.kind) : null
          const when = activity ? formatListDate(activity.at, now, dateLocale, t) : ''
          return (
            <button
              key={doc.id}
              type="button"
              className="dh-continue-card"
              data-continue-id={doc.id}
              aria-busy={openingId === doc.id || undefined}
              onClick={() => onOpen(doc)}
            >
              <span
                className="dh-continue-preview"
                data-type={previewTypeOf(doc)}
                aria-hidden="true"
              >
                <span className="dh-continue-sheet">
                  <span className="dh-continue-line accent" />
                  <span className="dh-continue-line" />
                  <span className="dh-continue-line short" />
                  <span className="dh-continue-line mid" />
                </span>
              </span>
              <span className="dh-continue-meta">
                <FileBadge ext={doc.kind === 'page' ? 'page' : docExtension(doc)} size={28} />
                <span className="dh-continue-text">
                  <span className="dh-continue-name" title={doc.title}>
                    {doc.title}
                  </span>
                  <span className="dh-continue-when">{key ? `${t(key)} · ${when}` : when}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
