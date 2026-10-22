import { useEffect, useId, useRef } from 'react'
import type { ReactElement } from 'react'
import { useI18n, type StringKey } from '../locale'
import type { AskUniCitation, AskUniCitationKind } from '../../../shared/askuni-api'
import './askuni-v2.css'

const KIND_KEYS: Record<AskUniCitationKind, StringKey> = {
  document: 'askUniKindDocument',
  task: 'askUniKindTask',
  meeting: 'askUniKindMeeting',
  chat: 'askUniKindChat',
  member: 'askUniKindMember',
  other: 'askUniKindOther',
}

const HOVER_DELAY_MS = 150

/** a kind this build has no row for (an older app against a newer server) shows as the generic row */
export function knownKind(kind: string): AskUniCitationKind {
  return Object.prototype.hasOwnProperty.call(KIND_KEYS, kind)
    ? (kind as AskUniCitationKind)
    : 'other'
}

/** the same icon set as the Ask UNI P1 sources list (kept local: that pane stays untouched) */
export function KindIcon({ kind }: { kind: AskUniCitationKind }): ReactElement {
  const paths: Record<AskUniCitationKind, ReactElement> = {
    document: (
      <>
        <path d="M4.5 2.5h4.8l2.7 2.7v8.3h-7.5z" />
        <path d="M9.3 2.5v2.7H12M6 8.5h4M6 11h4" />
      </>
    ),
    task: (
      <>
        <rect x="3" y="3" width="10" height="10" rx="2" />
        <path d="m5.8 8.2 1.6 1.6 3-3.2" />
      </>
    ),
    meeting: (
      <>
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
        <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
      </>
    ),
    chat: (
      <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11h-.5A.5.5 0 0 1 3 10.5z" />
    ),
    member: (
      <>
        <circle cx="8" cy="5.8" r="2.3" />
        <path d="M3.5 13c.5-2.3 2.2-3.4 4.5-3.4s4 1.1 4.5 3.4" />
      </>
    ),
    other: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M5.5 8h.01M8 8h.01M10.5 8h.01" />
      </>
    ),
  }
  return (
    <svg
      className="askuni-v2-kind-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[kind]}
    </svg>
  )
}

/**
 * The superscript marker of a cited source (`[S1]` in the answer). A button, not a link: it opens a
 * card with the source's title and quote on hover, keyboard focus and click, so touch and keyboard
 * users reach the quote too. `open` is owned by the answer so only one card shows at a time.
 */
export function CitationMarker({
  citation,
  n,
  open,
  onOpenChange,
  onOpen,
}: {
  citation: AskUniCitation
  n: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** open the source itself (main decides how) */
  onOpen: (c: AskUniCitation) => void
}): ReactElement {
  const { t } = useI18n()
  const cardId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // a card opened by the pointer closes when it leaves; one opened by focus or click stays until Escape/blur
  const byHover = useRef(false)
  const kind = knownKind(citation.kind)
  const title = citation.title || t(KIND_KEYS[kind])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const later = (next: boolean) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onOpenChange(next), HOVER_DELAY_MS)
  }
  const now = (next: boolean) => {
    if (timer.current) clearTimeout(timer.current)
    onOpenChange(next)
  }

  return (
    <sup
      className="askuni-v2-cite-wrap"
      onMouseEnter={() => {
        byHover.current = true
        later(true)
      }}
      onMouseLeave={() => {
        if (byHover.current) later(false)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) now(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          now(false)
          buttonRef.current?.focus()
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="askuni-v2-cite"
        aria-label={t('askUniV2CiteLabel', { n, title })}
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onFocus={() => {
          byHover.current = false
          now(true)
        }}
        onClick={() => {
          byHover.current = false
          now(true)
        }}
      >
        {n}
      </button>
      {open ? (
        <span
          id={cardId}
          role="dialog"
          aria-label={title}
          className="askuni-v2-card askuni-v2-cite-card"
        >
          <span className="askuni-v2-cite-head">
            <KindIcon kind={kind} />
            <span className="askuni-v2-card-title">{title}</span>
          </span>
          {citation.quote ? <span className="askuni-v2-cite-quote">{citation.quote}</span> : null}
          {citation.href !== '' ? (
            <button type="button" className="askuni-v2-cite-open" onClick={() => onOpen(citation)}>
              {t('askUniV2CiteOpen')}
            </button>
          ) : null}
        </span>
      ) : null}
    </sup>
  )
}

/** The chip row under an answer: one chip per cited source; a source with no server path is a plain chip. */
export function SourceChips({
  citations,
  onOpen,
}: {
  citations: AskUniCitation[]
  onOpen: (c: AskUniCitation) => void
}): ReactElement | null {
  const { t } = useI18n()
  if (citations.length === 0) return null
  return (
    <ul className="askuni-v2-chips" aria-label={t('askUniSources')}>
      {citations.map((c, i) => {
        const kind = knownKind(c.kind)
        const title = c.title || t(KIND_KEYS[kind])
        const body = (
          <>
            <KindIcon kind={kind} />
            <span className="askuni-v2-chip-id" aria-hidden="true">
              {c.sourceId.toUpperCase()}
            </span>
            <span className="askuni-v2-chip-title">{title}</span>
          </>
        )
        if (c.href === '') {
          return (
            <li key={`${c.sourceId}-${i}`}>
              <span className="askuni-v2-chip is-static" data-kind={kind}>
                {body}
              </span>
            </li>
          )
        }
        const action = kind === 'document' ? t('askUniOpenDocument') : t('askUniOpenBrowser')
        return (
          <li key={`${c.sourceId}-${i}`}>
            <button
              type="button"
              className="askuni-v2-chip"
              data-kind={kind}
              aria-label={t('askUniCitationLabel', { kind: t(KIND_KEYS[kind]), title, action })}
              onClick={() => onOpen(c)}
            >
              {body}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
