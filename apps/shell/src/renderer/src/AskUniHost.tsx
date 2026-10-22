import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import './askuni.css'
import { useI18n } from './locale'
import { AskUniPane } from './AskUniPane'
import { AskUniPanel } from './askuni-v2/AskUniPanel'
import { refreshAskUniFlags, useAskUniStreamFlag } from './askuni-entry'
import type { AskUniBridge, AskUniContext } from '../../shared/askuni-api'

type ContextState =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; ctx: AskUniContext }

function contextCall(): AskUniBridge['uniworkAskUniContext'] | undefined {
  const b = window.aiOffice as unknown as Partial<AskUniBridge>
  return typeof b.uniworkAskUniContext === 'function' ? b.uniworkAskUniContext.bind(b) : undefined
}

/**
 * The v2 side of the host: the same gate the P1 pane has (signed in, a workspace, a context that
 * loaded) in front of the panel, with the P1 states and wording. A sign-in done elsewhere is picked up
 * when the pane comes back into view.
 */
function AskUniV2Gate({ visible }: { visible: boolean }): ReactElement {
  const { t } = useI18n()
  const [context, setContext] = useState<ContextState>({ status: 'loading' })
  const [pickedWorkspace, setPickedWorkspace] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    const call = contextCall()
    if (!call) {
      setContext({ status: 'failed' })
      return
    }
    call().then(
      (ctx) => {
        if (alive) setContext({ status: 'ready', ctx })
      },
      () => {
        if (alive) setContext({ status: 'failed' })
      },
    )
    return () => {
      alive = false
    }
  }, [reloadKey])

  const reload = useCallback(() => {
    setContext({ status: 'loading' })
    setReloadKey((k) => k + 1)
  }, [])

  const ctx = context.status === 'ready' ? context.ctx : null
  const needsReloadRef = useRef(false)
  needsReloadRef.current = context.status === 'failed' || (ctx !== null && !ctx.signedIn)
  const wasVisibleRef = useRef(visible)
  useEffect(() => {
    if (visible && !wasVisibleRef.current && needsReloadRef.current) reload()
    wasVisibleRef.current = visible
  }, [visible, reload])

  // a new sign-in or workspace may switch the flag: read it again now, not in a minute
  const identity = ctx ? `${ctx.signedIn}:${ctx.currentWorkspaceId ?? ''}` : null
  const lastIdentity = useRef<string | null>(null)
  useEffect(() => {
    if (identity === null) return
    if (lastIdentity.current !== null && lastIdentity.current !== identity) {
      void refreshAskUniFlags({ force: true })
    }
    lastIdentity.current = identity
  }, [identity])

  const workspaces = ctx?.workspaces ?? []
  const workspaceId =
    workspaces.find((w) => w.id === pickedWorkspace)?.id ??
    workspaces.find((w) => w.id === ctx?.currentWorkspaceId)?.id ??
    workspaces[0]?.id ??
    null

  if (ctx && ctx.signedIn && workspaceId) {
    return (
      <AskUniPanel
        workspaceId={workspaceId}
        workspaces={workspaces}
        onWorkspaceChange={setPickedWorkspace}
        visible={visible}
      />
    )
  }
  let note: ReactElement
  if (context.status === 'loading') {
    note = <p className="askuni-note">{t('askUniLoading')}</p>
  } else if (context.status === 'failed') {
    note = (
      <div className="askuni-failed">
        <p className="askuni-note">{t('askUniErrDefault')}</p>
        <button type="button" className="new-chat-ghost-btn" onClick={reload}>
          {t('setRetry')}
        </button>
      </div>
    )
  } else if (!ctx?.signedIn) {
    note = <p className="askuni-note">{t('askUniSignedOut')}</p>
  } else {
    note = <p className="askuni-note">{t('askUniNoWorkspace')}</p>
  }
  return (
    <section className="askuni-pane" aria-label={t('askUniTitle')} hidden={!visible}>
      {note}
    </section>
  )
}

/**
 * What the My AI pane mounts in Ask UNI mode (contract D3): the v2 panel when the public
 * `ask_uni_stream` flag is on, the P1 pane exactly as before when it is off or the bridge has no
 * flags. While the first flag answer is on its way neither shows, so the pane never flashes.
 * `focusToken` changing puts the caret in the composer of whichever pane shows (Ctrl/Cmd+J).
 */
export function AskUniHost({
  visible = true,
  focusToken,
}: {
  visible?: boolean
  focusToken?: number
}): ReactElement {
  const { t } = useI18n()
  const flag = useAskUniStreamFlag()
  const rootRef = useRef<HTMLDivElement>(null)
  const seenToken = useRef(0)
  const wantFocus = useRef((focusToken ?? 0) > 0)

  useEffect(() => {
    if ((focusToken ?? 0) !== seenToken.current) {
      seenToken.current = focusToken ?? 0
      wantFocus.current = seenToken.current > 0
    }
  }, [focusToken])

  // the composer may only appear later (flag answer, then the context), inside a child that
  // re-renders on its own: so besides trying now, watch the subtree until the caret has landed
  useEffect(() => {
    const root = rootRef.current
    if (!root || !visible || !wantFocus.current) return
    const tryFocus = (): boolean => {
      const box = root.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')
      if (!box) return false
      box.focus()
      wantFocus.current = false
      return true
    }
    if (tryFocus()) return
    const observer = new MutationObserver(() => {
      if (tryFocus()) observer.disconnect()
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [focusToken, visible, flag.loaded, flag.enabled])

  let body: ReactElement
  if (!flag.loaded) {
    body = (
      <section className="askuni-pane" aria-label={t('askUniTitle')} hidden={!visible}>
        <p className="askuni-note">{t('askUniLoading')}</p>
      </section>
    )
  } else if (flag.enabled) {
    body = <AskUniV2Gate visible={visible} />
  } else {
    body = <AskUniPane visible={visible} />
  }
  return (
    <div ref={rootRef} style={{ display: 'contents' }}>
      {body}
    </div>
  )
}
