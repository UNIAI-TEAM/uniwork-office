/**
 * Comments pane (right side).
 *
 * Local file (and a bound document without a signed-in UniWork session): the current page's comment
 * list + create/delete. The source of truth lives in the main process (the pptx comments part); this
 * only displays and sends back intents. The list is owned by App (refreshed after page switch/add/
 * delete), keeping the ribbon badge in sync.
 *
 * Bound UniWork document (G8-14, spine S12): `ServerCommentsPane` — the shared collab panel over the
 * server comments, anchored per slide; the file's own comments only show read-only in the
 * "Comments in the file" section and are never rewritten.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from '@genoffice/i18n'
import type { UniworkCommentsSeamApi } from '../comments-seam'
import {
  AnchorLabel,
  CollabComposer,
  CollabPanel,
  collabStrings,
  type AnchorLabelStrings,
  type CollabAnchorSlot,
} from '@genoffice/ui/collab'
import type { SlideComment } from '../../shared/ipc'
import { displayCommentAuthor } from '../comment-author'
import { useI18n } from '../i18n/locale'
import {
  isPptxAnchor,
  slidePositionOf,
  type SlideIdentity,
  type SlidesCommentsContext,
} from '../server-comments'
import { useServerComments, type ServerComments } from '../use-server-comments'
import { IconComment, IconSidebarCollapse } from './icons'

interface Props {
  slideIndex: number
  comments: SlideComment[]
  /** Focus the input when it changes (the "new comment" entry increments it per click) */
  focusNonce?: number
  onAdd: (text: string) => void
  onDelete: (c: SlideComment) => void
  onCollapse: () => void
}

/** dt (ISO) → local short time; returned as-is on parse failure. */
function fmtDt(dt: string, locale: string): string {
  const d = new Date(dt)
  if (Number.isNaN(d.getTime())) return dt
  return d.toLocaleString(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function CommentsPane({
  slideIndex,
  comments,
  focusNonce,
  onAdd,
  onDelete,
  onCollapse,
}: Props) {
  const { t, dateLocale } = useI18n()
  // G8-02: the neutral author ("User" in the file) shows in the UI language
  const authorLabel = (author: string) =>
    displayCommentAuthor(author, t('paneCommentsNeutralAuthor'))
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (focusNonce) inputRef.current?.focus()
  }, [focusNonce])

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    onAdd(text)
    setDraft('')
  }

  return (
    <aside className="comments-pane">
      <div className="ai-panel-header">
        <span className="ai-panel-title">{t('paneCommentsTitle', { n: slideIndex + 1 })}</span>
        <div className="ai-panel-header-actions">
          <button
            className="ai-header-btn"
            onClick={onCollapse}
            data-tip={t('paneCommentsCollapse')}
            aria-label={t('paneCommentsCollapse')}
          >
            <IconSidebarCollapse size={15} />
          </button>
        </div>
      </div>

      <div className="comments-list">
        {comments.length === 0 && (
          <div className="comments-empty">
            <IconComment size={22} />
            <p>{t('paneCommentsEmpty')}</p>
            <p className="comments-empty-sub">{t('paneCommentsEmptySub')}</p>
          </div>
        )}
        {comments.map((c) => (
          <div key={`${c.authorId}-${c.idx}`} className="comment-card">
            <div className="comment-head">
              <span className="comment-avatar">
                {(c.initials || authorLabel(c.author)).slice(0, 2)}
              </span>
              <span className="comment-meta">
                <span className="comment-author">{authorLabel(c.author)}</span>
                {c.dt && <span className="comment-time">{fmtDt(c.dt, dateLocale)}</span>}
              </span>
              <button
                className="comment-del"
                data-tip={t('paneCommentsDelete')}
                aria-label={t('paneCommentsDelete')}
                onClick={() => onDelete(c)}
              >
                ✕
              </button>
            </div>
            <div className="comment-text">{c.text}</div>
          </div>
        ))}
      </div>

      <div className="comment-new">
        <textarea
          ref={inputRef}
          rows={3}
          value={draft}
          placeholder={t('paneCommentsPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button className="btn-primary" disabled={!draft.trim()} onClick={submit}>
          {t('paneCommentsPost')}
        </button>
      </div>
    </aside>
  )
}

/** one comment stored in the pptx itself, with the slide it sits on */
export interface InFileComment {
  slideIndex: number
  comment: SlideComment
}

interface ServerProps {
  server: ServerComments
  /** the deck as shown: anchor labels follow a slide that moved */
  slides: readonly SlideIdentity[]
  inFile: readonly InFileComment[]
  onCollapse: () => void
}

/** S12 for a bound presentation: threads per slide through the shared collab panel. */
export function ServerCommentsPane({ server, slides, inFile, onCollapse }: ServerProps) {
  const { lang, t, dateLocale } = useI18n()
  const strings = useMemo(() => collabStrings(lang), [lang])
  const ctl = server.controller

  // the label names the slide where it is now (a reorder before Save keeps the server's old index)
  const renderAnchor = (slot: CollabAnchorSlot) => {
    const at = isPptxAnchor(slot.anchor) ? slidePositionOf(slides, slot.anchor) : -1
    const anchor = at >= 0 ? { ...slot.anchor, slide_index: at } : slot.anchor
    return (
      <AnchorLabel
        anchor={anchor}
        state={slot.anchorState}
        lang={lang}
        strings={strings as unknown as AnchorLabelStrings}
        labelId={slot.labelId}
        stateId={slot.stateId}
      />
    )
  }

  const inFileContent = (
    <ul role="list" className="collab-list comments-infile">
      {inFile.map(({ slideIndex, comment: c }) => {
        const author = displayCommentAuthor(c.author, t('paneCommentsNeutralAuthor'))
        return (
          <li key={`${slideIndex}-${c.authorId}-${c.idx}`} className="collab-thread">
            <div className="collab-cm">
              <div className="collab-cmh">
                <span className="collab-av" aria-hidden="true">
                  {(c.initials || author).slice(0, 2)}
                </span>
                <span className="collab-au">{author}</span>
                {c.dt && <span className="collab-dt">{fmtDt(c.dt, dateLocale)}</span>}
              </div>
              <p className="collab-cap">
                {format(strings.collabAnchorSlide ?? '', {
                  slide: new Intl.NumberFormat(dateLocale).format(slideIndex + 1),
                })}
              </p>
              <p className="collab-bd">{c.text}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="comments-pane comments-pane--server">
      <CollabPanel
        controller={ctl}
        strings={strings}
        onClose={onCollapse}
        renderAnchor={renderAnchor}
        renderComposer={(slot) => <CollabComposer {...slot} strings={strings} />}
        inFile={{ count: inFile.length, content: inFileContent }}
      />
      {!server.versionId && ctl.can.canWrite && ctl.state === 'ready' && (
        <p className="comments-server-hint">{t('paneCommentsSaveFirst')}</p>
      )}
    </div>
  )
}

/** what App calls on the mounted server comments (the ribbon's "New Comment") */
export interface ServerCommentsHandle {
  /** false: no thread could start (no slide identity, or the open version is unknown: save first) */
  startThread(slideIndex: number, objectId?: string): boolean
}

interface HostProps {
  bridge: UniworkCommentsSeamApi
  path: string
  context: SlidesCommentsContext
  slides: readonly SlideIdentity[]
  /** the pane slot App draws while the comments pane is shown; null: closed */
  slot: HTMLElement | null
  goTo(index: number, sourceId?: string): void
  onOpen(): void
  onCollapse(): void
  /** the file's own comments, per slide (read-only listing) */
  readFileComments(slideIndex: number): Promise<SlideComment[]>
  /** bumps when the file's comments may have changed (undo / reopen) */
  fileCommentsNonce: number
  handleRef: React.MutableRefObject<ServerCommentsHandle | null>
  /** open threads, for the ribbon badge */
  onOpenCount(n: number): void
  /** the status line: "save first" when a new thread is asked for while the open version is unknown */
  onStatus(text: string): void
}

/**
 * Stays mounted for the whole life of a bound document, so the post-save anchor round and a
 * launch-ticket reveal work while the pane is closed; the pane renders into App's slot.
 */
export function ServerCommentsHost(p: HostProps) {
  const { lang, t } = useI18n()
  const server = useServerComments({
    bridge: p.bridge,
    path: p.path,
    context: p.context,
    lang,
    slides: p.slides,
    open: p.slot !== null,
    goTo: p.goTo,
    onOpen: p.onOpen,
  })
  const onStatus = p.onStatus
  p.handleRef.current = {
    startThread: (index, objectId) => {
      const started = server.startThread(index, objectId)
      // a root thread needs base_version_id: unknown until the first Save receipt (same rule as Docs)
      if (!started && !server.versionId) onStatus(t('paneCommentsSaveFirst'))
      return started
    },
  }

  const openCount = server.controller.threads.length
  const onOpenCount = p.onOpenCount
  useEffect(() => onOpenCount(openCount), [openCount, onOpenCount])

  // the file's own comments of every slide, read while the pane is open (never written back)
  const [inFile, setInFile] = useState<InFileComment[]>([])
  const slideCount = p.slides.length
  const readFileComments = p.readFileComments
  const shown = p.slot !== null
  useEffect(() => {
    if (!shown) return
    let live = true
    void Promise.all(
      Array.from({ length: slideCount }, (_, i) =>
        readFileComments(i).then(
          (list) => list.map((comment) => ({ slideIndex: i, comment })),
          () => [] as InFileComment[],
        ),
      ),
    ).then((rows) => {
      if (live) setInFile(rows.flat())
    })
    return () => {
      live = false
    }
  }, [shown, slideCount, readFileComments, p.fileCommentsNonce])

  if (!p.slot) return null
  return createPortal(
    <ServerCommentsPane
      server={server}
      slides={p.slides}
      inFile={inFile}
      onCollapse={p.onCollapse}
    />,
    p.slot,
  )
}
