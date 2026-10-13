/**
 * Mounts the frame Discussion (S13) into a frame page (lane contract G8-11 §3.3): a slim document
 * bar with the `collabDiscussion` toggle above the editor, and the panel docked at the inline end.
 *
 * Only for a session the host bound to UniWork with a signed-in user: the host advertises
 * `comments` only then (contract-collab §10), so `commentsAccess(session).enabled` is the gate.
 * Without it nothing is added to the page and no comment request is sent.
 *
 * `comments.changed` -> reload; `comments.reveal` -> the kit's reveal, then the panel opens on the
 * post. The reveal comes through the frame's one reveal router (../comments/reveal-router, G8-12),
 * which asks this panel first and an editor's own comments panel next. An id that is not a
 * discussion post answers `revealed: false`; when no editor panel follows and `revealMissing` is
 * 'notice' (default: Markdown / HTML, where this panel is the page's only one) the panel opens on
 * the S15 line, otherwise it stays closed (the editor panel owns the other ids and the S15 line).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Lang } from '@genoffice/i18n'
import type { CollabLevel } from '@genoffice/ui/collab'
import '@genoffice/ui/collab.css'
import './discussion.css'
import browser, { webLanguage } from '../../../docs/bridge/browser'
import type { FramePort, PortSession } from '../../../docs/bridge/frame-port'
import {
  commentsAccess,
  type CommentsChangedPayload,
  type CommentsLevel,
  type CommentsRevealPayload,
  type CommentsRevealResult,
} from '../../../docs/protocol/types'
import { FrameDiscussion, type FrameDiscussionHandle } from './FrameDiscussion'
import { createEditorShield, type EditorShield } from './overlay'
import { createFrameDiscussionSource } from './source'
import { frameRevealRouter } from '../comments/reveal-router'
import { announceFrameSidePanel, onFrameSidePanel } from '../comments/side-panel'

/** what the mount needs from the frame client; the two comment hooks are absent on old ports and mocks */
export type DiscussionPort = Pick<FramePort, 'whenInitialized' | 'request'> & {
  onCommentsChanged?(listener: (payload: CommentsChangedPayload) => void): () => void
  handleCommentsReveal?(
    handler: (
      payload: CommentsRevealPayload,
      ctx: { signal: AbortSignal },
    ) => CommentsRevealResult | Promise<CommentsRevealResult>,
  ): () => void
}

export interface MountFrameDiscussionOptions {
  doc?: Document
  revealMissing?: 'notice' | 'silent'
}

/** the session fields the panel reads (the real client's FrameSession has them all) */
type DiscussionSession = PortSession & { commentsLevel?: CommentsLevel }

const OPEN_CLASS = 'uw-disc-open'
const BAR_CLASS = 'uw-disc-on'

function platformOf(): 'mac' | 'other' {
  const nav = globalThis.navigator as
    (Navigator & { userAgentData?: { platform?: string } }) | undefined
  const name = nav?.userAgentData?.platform ?? nav?.platform ?? ''
  return /mac|iphone|ipad/i.test(name) ? 'mac' : 'other'
}

function useWebLanguage(): Lang {
  const [lang, setLang] = useState<Lang>(() => webLanguage())
  useEffect(() => browser.onLanguageChanged(() => setLang(webLanguage())), [])
  return lang
}

interface RootProps {
  port: DiscussionPort
  session: DiscussionSession
  revealMissing: 'notice' | 'silent'
  doc: Document
}

function DiscussionRoot({ port, session, revealMissing, doc }: RootProps) {
  const lang = useWebLanguage()
  const source = useMemo(() => createFrameDiscussionSource(port), [port])
  const access = commentsAccess({
    capabilities: session.capabilities ?? {},
    commentsLevel: session.commentsLevel,
    user: session.user,
  })
  const handle = useRef<FrameDiscussionHandle>(null)
  const shield = useRef<EditorShield | null>(null)
  useEffect(() => {
    const s = createEditorShield(doc)
    shield.current = s
    return () => {
      s.dispose()
      shield.current = null
    }
  }, [doc])

  useEffect(() => {
    const offChanged = port.onCommentsChanged?.(() => void handle.current?.controller().reload())
    const onFocus = () => void handle.current?.controller().reload()
    doc.defaultView?.addEventListener('focus', onFocus)
    const offReveal = frameRevealRouter(port).setDiscussion(async (commentId, { last }) => {
      const h = handle.current
      if (!h) return false
      const result = await h.controller().reveal(commentId)
      if (result.revealed || (last && revealMissing === 'notice')) h.open()
      else h.controller().dismissNotice()
      return result.revealed
    })
    // one side panel at a time: the editor's panel opening closes this one
    const offSide = onFrameSidePanel(
      'discussion',
      () => handle.current?.close(),
      doc.defaultView ?? undefined,
    )
    return () => {
      offChanged?.()
      offReveal()
      offSide()
      doc.defaultView?.removeEventListener('focus', onFocus)
    }
  }, [port, doc, revealMissing])
  const announced = useRef(false)

  return (
    <FrameDiscussion
      handle={handle}
      source={source}
      documentId={session.documentId}
      level={(access.level ?? undefined) as CollabLevel | undefined}
      myUserId={access.userId}
      lang={lang}
      platform={platformOf()}
      onOpenChange={(open) => {
        doc.documentElement.classList.toggle(OPEN_CLASS, open)
        shield.current?.setOpen(open)
        if (open !== announced.current) {
          announced.current = open
          announceFrameSidePanel('discussion', open, doc.defaultView ?? undefined)
        }
      }}
    />
  )
}

/** resolves with the disposer once the session is known; a no-op disposer when nothing was mounted */
export async function mountFrameDiscussion(
  port: DiscussionPort,
  opts: MountFrameDiscussionOptions = {},
): Promise<() => void> {
  const doc = opts.doc ?? document
  let session: DiscussionSession
  try {
    session = (await port.whenInitialized()) as DiscussionSession
  } catch {
    return () => {}
  }
  const access = commentsAccess({ capabilities: session.capabilities ?? {} })
  if (!access.enabled) return () => {}

  const container = doc.createElement('div')
  container.className = 'uw-disc-root'
  doc.body.prepend(container)
  doc.documentElement.classList.add(BAR_CLASS)
  const root = createRoot(container)
  root.render(
    <DiscussionRoot
      port={port}
      session={session}
      revealMissing={opts.revealMissing ?? 'notice'}
      doc={doc}
    />,
  )
  return () => {
    root.unmount()
    container.remove()
    doc.documentElement.classList.remove(BAR_CLASS, OPEN_CLASS)
  }
}
