/**
 * G8-13 (UNI-1408): the Sheets comment panel in server mode (spine S12), built from the G8-20 kit.
 *
 * Mounted for the whole time a workbook is in server mode (not only while the panel shows): it owns
 * the kit controller, so the cell markers, the post-Save anchor map and `comments.reveal` keep
 * working with the panel closed. Threads come from `comments.*` (`kind = comment`) through
 * `window.uniworkComments`; a new root carries the selection's `{sheet, range}` + `base_version_id`.
 * The workbook's own threaded comments are listed read-only in the kit's "in the file" slot (lane
 * decision D4) and never rewritten: server comments live in the anchor store, never in the thread
 * store or the note snapshot (D3). Sheets has no comment AI tool, so nothing here is AI-reachable.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Lang } from '@genoffice/i18n'
import {
  COMMENTS_REVEAL_WAIT_MS,
  CollabComposer,
  CollabPanel,
  collabStrings,
  formatCollabTime,
  useCollabThreads,
  type CollabController,
  type CollabHostState,
  type CollabThreadView,
} from '@genoffice/ui/collab'
import '@genoffice/ui/collab.css'
import { createCommentsPoll } from '@genoffice/electron-utils/comments-poll'
import { formatAddress } from '@genoffice/xlsx-gateway/domain/cell-address'

import { displayCommentAuthor } from '../comment-author'
import type { CellThread } from '../threaded-comments'
import { createSheetsAnchorAdapter, type SheetsEditorView } from './adapter'
import { buildAnchorUpdates, syncAnchorsAfterSave } from './anchor-sync'
import {
  encodeXlsxAnchor,
  serverAnchorStore,
  type ServerAnchorStore,
  type TrackedRoot,
} from './anchor-store'
import type { ServerMode } from './mode'
import { createUniworkCommentsSource } from './seam'

/** what the ribbon / context menu reach while the host is mounted */
export interface SheetsServerCommentsHandle {
  /** Review ▸ New Comment in server mode: open a root composer for the selection */
  startThread(): void
}

/** the live handle; null while the workbook is in local mode */
export const serverComments: { handle: SheetsServerCommentsHandle | null } = { handle: null }

/** one of the workbook's own threaded comments, for the read-only "in the file" list */
export interface InFileThread {
  readonly sheetName: string
  readonly thread: CellThread
}

export interface SheetsServerCommentsProps {
  mode: ServerMode
  view: SheetsEditorView
  lang: Lang
  /** the panel is shown (the kit panel renders only then; the controller lives on) */
  panelOpen: boolean
  onOpenPanel(): void
  onClosePanel(): void
  /** one-line status for "save first" */
  onStatus(text: string): void
  /** the translated "save first" line: no new root while the open version is unknown */
  saveFirstMessage: string
  inFile: readonly InFileThread[]
  /** the UI-language label of the neutral stored author "User" */
  neutralAuthor: string
  store?: ServerAnchorStore
}

function rootsOf(ctl: CollabController): TrackedRoot[] {
  return [...ctl.threads, ...ctl.resolved].map((t) => ({
    id: t.id,
    anchor: t.root.anchor,
    anchor_state: t.root.anchor_state,
    deleted: t.deleted,
  }))
}

function threadOf(ctl: CollabController, id: string): CollabThreadView | undefined {
  return [...ctl.threads, ...ctl.resolved].find(
    (t) => t.id === id || t.replies.some((r) => r.id === id),
  )
}

function stamp(dT: string, lang: Lang): string {
  return formatCollabTime(/[zZ]|[+-]\d\d:\d\d$/.test(dT) ? dT : `${dT}Z`, lang)
}

function InFileList(p: {
  threads: readonly InFileThread[]
  activeSheet: string | undefined
  neutralAuthor: string
  lang: Lang
  resolvedLabel: string
}) {
  const row = (
    key: string,
    author: string,
    dT: string,
    text: string,
    reply: boolean,
    done = false,
  ) => (
    <div key={key} className={reply ? 'collab-cm collab-cm--reply' : 'collab-cm'}>
      <div className="collab-cmh">
        <span className="collab-au">{displayCommentAuthor(author, p.neutralAuthor)}</span>
        {done && <span className="collab-badge">{p.resolvedLabel}</span>}
        <span className="collab-dt">{stamp(dT, p.lang)}</span>
      </div>
      <div className="collab-bd">{text}</div>
    </div>
  )
  return (
    <ul role="list" className="collab-list">
      {p.threads.map(({ sheetName, thread }) => {
        const cell = formatAddress(thread.row, thread.column)
        // Excel syntax, as the kit's cell label: the open sheet gets the bare address
        const label =
          sheetName === p.activeSheet ? cell : `'${sheetName.replace(/'/g, "''")}'!${cell}`
        return (
          <li key={`${sheetName}:${thread.id}`} role="listitem" className="collab-thread">
            <div className="collab-th">
              <span className="collab-al">{label}</span>
            </div>
            {row(thread.id, thread.author, thread.dT, thread.text, false, thread.done)}
            {thread.replies.map((r) => row(r.id, r.author, r.dT, r.text, true))}
          </li>
        )
      })}
    </ul>
  )
}

export function SheetsServerComments(p: SheetsServerCommentsProps) {
  const { mode, view, lang, panelOpen } = p
  const store = p.store ?? serverAnchorStore
  const source = useMemo(
    () => createUniworkCommentsSource(mode.api, mode.path, 'comment'),
    [mode.api, mode.path],
  )
  const platform = useMemo<CollabHostState['platform']>(
    () => (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? 'mac' : 'other'),
    [],
  )
  const host = useMemo<CollabHostState>(
    () => ({
      documentId: mode.documentId,
      kind: 'comment',
      level: mode.level,
      myUserId: mode.myUserId,
      lang,
      platform,
    }),
    [mode.documentId, mode.level, mode.myUserId, lang, platform],
  )
  const strings = useMemo(() => collabStrings(lang), [lang])

  const viewRef = useRef(view)
  viewRef.current = view
  // a new adapter object only when a location moved or a listed anchor changed (kit: stable adapter)
  const storeVersion = useSyncExternalStore(store.subscribe, store.getVersion)
  const adapter = useMemo(
    () =>
      createSheetsAnchorAdapter(store, {
        sheets: () => viewRef.current.sheets(),
        activeSheetId: () => viewRef.current.activeSheetId(),
        selection: () => viewRef.current.selection(),
        select: (sheetId, range) => viewRef.current.select(sheetId, range),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, storeVersion],
  )

  const ctl = useCollabThreads(source, host, { adapter, strings })
  const ctlRef = useRef(ctl)
  ctlRef.current = ctl

  // the latest server roots feed the store (new ids located once; known ids keep their live place)
  useEffect(() => {
    store.track(rootsOf(ctl), viewRef.current.sheets())
  }, [store, ctl.threads, ctl.resolved]) // eslint-disable-line react-hooks/exhaustive-deps

  // base_version_id of a new root: the version open at load, then the last Save receipt
  const versionRef = useRef<string | null>(mode.versionId)
  useEffect(() => {
    versionRef.current = mode.versionId
  }, [mode.versionId])

  // after each Save receipt: one anchor map for every located (or lost) root
  useEffect(() => {
    return mode.api.onSaved((payload) => {
      if (payload.path && mode.path && payload.path !== mode.path) return
      versionRef.current = payload.versionId
      const updates = buildAnchorUpdates(store, rootsOf(ctlRef.current), viewRef.current.sheets())
      void syncAnchorsAfterSave(source, payload.versionId, updates, () => {
        void ctlRef.current.reload()
      }).catch(() => {
        // a failed map is rebuilt from the live locations at the next Save receipt
      })
    })
  }, [mode.api, mode.path, source, store])

  // desktop reload rule (addendum §4.7): focus + every 30 s while the panel is open and the tab visible
  const pollRef = useRef<ReturnType<typeof createCommentsPoll> | null>(null)
  useEffect(() => {
    const poll = createCommentsPoll({
      fetch: async () => {
        await ctlRef.current.reload()
        return { unchanged: true, listToken: '' }
      },
      onChanged: () => undefined,
    })
    pollRef.current = poll
    poll.setVisible(document.visibilityState === 'visible')
    const onFocus = () => poll.reload()
    const onVisibility = () => poll.setVisible(document.visibilityState === 'visible')
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      poll.dispose()
      pollRef.current = null
    }
  }, [])
  useEffect(() => {
    pollRef.current?.setPanelOpen(panelOpen)
  }, [panelOpen])

  // reveal: wait for the first list, then answer only for ids this panel owns
  const waitersRef = useRef<Array<(ok: boolean) => void>>([])
  useEffect(() => {
    if (ctl.state === 'loading') return
    const ok = ctl.state === 'ready'
    const waiters = waitersRef.current
    waitersRef.current = []
    for (const w of waiters) w(ok)
  }, [ctl.state])
  const loaded = useCallback((): Promise<boolean> => {
    const state = ctlRef.current.state
    if (state !== 'loading') return Promise.resolve(state === 'ready')
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waitersRef.current = waitersRef.current.filter((w) => w !== done)
        resolve(false)
      }, COMMENTS_REVEAL_WAIT_MS)
      const done = (ok: boolean) => {
        clearTimeout(timer)
        resolve(ok)
      }
      waitersRef.current.push(done)
    })
  }, [])
  const openRef = useRef(p.onOpenPanel)
  openRef.current = p.onOpenPanel
  useEffect(() => {
    return mode.api.onReveal(async ({ path, commentId }) => {
      if (path && mode.path && path !== mode.path) return false
      if (!(await loaded())) throw { code: 'not_ready', retryable: true }
      if (!threadOf(ctlRef.current, commentId)) return false
      openRef.current()
      // located: the kit selects the cell / range (adapter.goTo); lost: the thread only
      const r = await ctlRef.current.reveal(commentId)
      return r.revealed
    })
  }, [mode.api, mode.path, loaded])

  const statusRef = useRef(p.onStatus)
  statusRef.current = p.onStatus
  const saveFirstRef = useRef(p.saveFirstMessage)
  saveFirstRef.current = p.saveFirstMessage

  useEffect(() => {
    const handle: SheetsServerCommentsHandle = {
      startThread: () => {
        // a root comment needs base_version_id (OQ-C2): unknown until the first Save receipt
        if (!versionRef.current) {
          statusRef.current(saveFirstRef.current)
          openRef.current()
          return
        }
        const at = viewRef.current.selection()
        const sheet = at && viewRef.current.sheets().find((s) => s.id === at.sheetId)
        if (!at || !sheet) return
        ctlRef.current.startThread({
          anchor: encodeXlsxAnchor(sheet, at.range),
          base_version_id: versionRef.current,
        })
        openRef.current()
      },
    }
    serverComments.handle = handle
    return () => {
      if (serverComments.handle === handle) serverComments.handle = null
    }
  }, [])

  if (!panelOpen) return null

  const activeSheet = adapter.activeSheet?.()
  return (
    <CollabPanel
      className="sheets-server-comments"
      controller={ctl}
      strings={strings}
      onClose={p.onClosePanel}
      renderComposer={(slot) => <CollabComposer {...slot} strings={strings} />}
      inFile={
        p.inFile.length > 0
          ? {
              count: p.inFile.length,
              content: (
                <InFileList
                  threads={p.inFile}
                  activeSheet={activeSheet}
                  neutralAuthor={p.neutralAuthor}
                  lang={lang}
                  resolvedLabel={strings.collabResolved ?? ''}
                />
              ),
            }
          : undefined
      }
    />
  )
}
