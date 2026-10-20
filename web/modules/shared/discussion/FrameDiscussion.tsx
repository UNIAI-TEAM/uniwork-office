/**
 * The web frame's Discussion (S13): the `collabDiscussion` toggle of the frame's document bar and
 * the shared collab panel (`@genoffice/ui/collab`, G8-20) for the document's discussion posts.
 *
 * The controller runs while the panel is closed too: the frame client answers `comments.reveal`
 * only after a `comments.list` succeeded (contract-collab §10), so the list is loaded up front.
 * Refresh = `comments.changed` and window focus. Closing (button or Esc) gives focus back to the
 * toggle (Accessibility Floor G8); another panel opening closes it without touching focus.
 */
import {
  AvatarSourceProvider,
  CollabComposer,
  CollabPanel,
  collabStrings,
  useCollabThreads,
  useFrameAvatarSource,
  type CollabController,
  type CollabHostState,
  type FrameAvatars,
  type CollabLevel,
  type CollabSource,
} from '@genoffice/ui/collab'
import type { Lang } from '@genoffice/i18n'
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react'

export interface FrameDiscussionHandle {
  /** open the panel (focus stays where the reveal puts it) */
  open(): void
  /** the user's own close returns focus to the toggle; `{ focus: false }` (another panel took over) never moves it */
  close(opts?: { focus?: boolean }): void
  controller(): CollabController
}

export interface FrameDiscussionProps {
  source: CollabSource
  documentId: string
  level: CollabLevel | undefined
  myUserId?: string
  lang: Lang
  platform: 'mac' | 'other'
  /** the panel opened / closed (the mount narrows the editor while it is open) */
  onOpenChange?(open: boolean): void
  handle?: Ref<FrameDiscussionHandle>
  /** where this frame's avatar photos come from; unset = `window.uniworkAvatars` (none: plain `<img src>`, as on desktop) */
  avatars?: FrameAvatars
}

export function FrameDiscussion(p: FrameDiscussionProps) {
  const { source, documentId, level, myUserId, lang, platform, onOpenChange } = p
  const strings = collabStrings(lang)
  const avatarSource = useFrameAvatarSource(p.avatars)
  const host = useMemo<CollabHostState>(
    () => ({
      documentId,
      kind: 'discussion',
      level,
      lang,
      platform,
      ...(myUserId ? { myUserId } : {}),
    }),
    [documentId, level, lang, platform, myUserId],
  )
  const controller = useCollabThreads(source, host, { strings })
  const ctlRef = useRef(controller)
  ctlRef.current = controller
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelId = `${useId()}disc`

  const openRef = useRef(open)
  openRef.current = open
  const close = useCallback((opts?: { focus?: boolean }) => {
    // already closed: nothing to close, and the focus is wherever the user (or another panel) put it
    if (!openRef.current) return
    setOpen(false)
    if (opts?.focus !== false) toggleRef.current?.focus()
  }, [])
  useImperativeHandle(
    p.handle,
    () => ({ open: () => setOpen(true), close, controller: () => ctlRef.current }),
    [close],
  )

  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  useEffect(() => {
    onOpenChangeRef.current?.(open)
  }, [open])

  // Same rule as the desktop shell panel: the kit consumes Esc for its picker, composer, menus and
  // dialogs (defaultPrevented); what is left closes the panel and focus returns to the toggle
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    e.preventDefault()
    close()
  }

  return (
    <AvatarSourceProvider value={avatarSource}>
      <div className="uw-disc-bar">
        <button
          ref={toggleRef}
          type="button"
          className="uw-disc-toggle"
          data-discussion-toggle=""
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span className="uw-disc-toggle-label">{strings.collabDiscussion}</span>
        </button>
      </div>
      <div id={panelId} className="uw-disc" hidden={!open} onKeyDown={onKeyDown}>
        {open && (
          <CollabPanel
            controller={controller}
            strings={strings}
            onClose={() => close()}
            renderComposer={(slot) => <CollabComposer {...slot} strings={strings} />}
          />
        )}
      </div>
    </AvatarSourceProvider>
  )
}
