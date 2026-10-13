/**
 * The web frame's Discussion (S13): the `collabDiscussion` toggle of the frame's document bar and
 * the shared collab panel (`@genoffice/ui/collab`, G8-20) for the document's discussion posts.
 *
 * The controller runs while the panel is closed too: the frame client answers `comments.reveal`
 * only after a `comments.list` succeeded (contract-collab §10), so the list is loaded up front.
 * Refresh = `comments.changed` and window focus. Closing (button or Esc) gives focus back to the
 * toggle (Accessibility Floor G8).
 */
import {
  CollabComposer,
  CollabPanel,
  collabStrings,
  useCollabThreads,
  type CollabController,
  type CollabHostState,
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
  close(): void
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
}

export function FrameDiscussion(p: FrameDiscussionProps) {
  const { source, documentId, level, myUserId, lang, platform, onOpenChange } = p
  const strings = collabStrings(lang)
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

  const close = useCallback(() => {
    setOpen(false)
    toggleRef.current?.focus()
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

  // Esc closes the panel unless something inside handled it (composer cancel, picker, dialog)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    const t = e.target as HTMLElement | null
    if (t?.closest('textarea, [role="dialog"], [role="listbox"]')) return
    e.preventDefault()
    close()
  }

  return (
    <>
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
          {strings.collabDiscussion}
        </button>
      </div>
      <div id={panelId} className="uw-disc" hidden={!open} onKeyDown={onKeyDown}>
        {open && (
          <CollabPanel
            controller={controller}
            strings={strings}
            onClose={close}
            renderComposer={(slot) => <CollabComposer {...slot} strings={strings} />}
          />
        )}
      </div>
    </>
  )
}
