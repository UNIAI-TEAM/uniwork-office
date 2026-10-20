/**
 * Collab controller: loads and reloads one document's comments (or Discussion posts) through the host's
 * `CollabSource`, groups them into threads, applies the S12 level rules, maps errors to panel states and
 * the status line, and answers `comments.reveal`. Rendering lives in `CollabPanel` / `CollabThread`.
 *
 * Reload rules (spine S12, addendum §4.7): `unchanged` touches no state at all; a changed list replaces
 * the whole list and is announced once through the window's polite live region; nothing here moves
 * focus except a reveal, and drafts belong to the composer, never to this hook.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { announcePolite } from './live-region'
import {
  toCollabError,
  type CollabAnchor,
  type CollabAnchorAdapter,
  type CollabAnchorState,
  type CollabComment,
  type CollabError,
  type CollabHostState,
  type CollabKind,
  type CollabListResult,
  type CollabMention,
  type CollabRevision,
  type CollabSource,
} from './types'

/** a reveal that arrives before the first successful list is held at most this long, then `not_ready` */
export const COMMENTS_REVEAL_WAIT_MS = 10_000

/** translated panel strings keyed by logical key (`CollabPanelStrings` of `strings-collab-panel.ts`) */
export type CollabStrings = Readonly<Record<string, string>>

export type CollabLoadState = 'loading' | 'ready' | 'loadError' | 'noAccess'
/** the status line after data was loaded once (`viewOnly` is separate: it is not an error) */
export type CollabNetStatus = 'offline' | 'serverError' | 'signedOut'
/** the panel-level S15 message (a revealed comment that was deleted) */
export type CollabNotice = 'commentDeleted' | 'discussionDeleted'

export interface CollabThreadView {
  /** the root comment id */
  id: string
  root: CollabComment
  /** oldest first */
  replies: CollabComment[]
  resolved: boolean
  /** the root is a tombstone (or a write learned it was deleted) */
  deleted: boolean
  /** comment kind with an anchor only; `stale` only when the editor cannot locate the anchor */
  anchorState?: CollabAnchorState
}

/** the host opens version `versionNo` read-only; `opened: false` (or a throw) shows the unavailable line, `void` = fire and forget */
export type CollabViewVersion = (req: {
  commentId: string
  versionNo: number
}) => Promise<{ opened: boolean }> | { opened: boolean } | void

export interface CollabFocusRequest {
  /** null: focus the panel-level notice */
  threadId: string | null
  commentId?: string
  target: 'heading' | 'deleted' | 'notice'
  seq: number
}

/** a send that hit `conflict` + `comment_deleted`: the thread is marked deleted, the text stays copyable */
export interface CollabConflict {
  threadId: string
  body: string
}

export interface CollabNewThread {
  anchor: CollabAnchor
  base_version_id?: string
}

export interface CollabPermissions {
  /** composer, reply */
  canWrite: boolean
  canEdit(c: CollabComment): boolean
  canRemove(c: CollabComment): boolean
  canResolve(root: CollabComment): boolean
}

export interface CollabActions {
  /**
   * a new root (comment: with the anchor of `startThread`; discussion: no anchor). The write actions
   * resolve to the comment the server answered with (G8-18: it carries `mentions_without_access`).
   */
  create(
    body: string,
    p?: { anchor?: CollabAnchor; base_version_id?: string },
  ): Promise<CollabComment>
  reply(threadId: string, body: string): Promise<CollabComment>
  edit(commentId: string, body: string): Promise<CollabComment>
  remove(commentId: string): Promise<'tombstoned' | 'removed'>
  resolve(threadId: string): Promise<void>
  reopen(threadId: string): Promise<void>
  /** newest first */
  history(commentId: string): Promise<CollabRevision[]>
}

export interface CollabController {
  source: CollabSource
  host: CollabHostState
  adapter?: CollabAnchorAdapter
  /** the id of the version the editor shows (host input, passed through for the panel) */
  openVersionId?: string
  /** host input, passed through for the panel: absent = no "View in version N" action */
  onViewVersion?: CollabViewVersion
  state: CollabLoadState
  /** open threads, in anchor order (comment) or time order (discussion) */
  threads: CollabThreadView[]
  resolved: CollabThreadView[]
  mentions: CollabMention[]
  status: CollabNetStatus | null
  viewOnly: boolean
  notice: CollabNotice | null
  conflict: CollabConflict | null
  focus: CollabFocusRequest | null
  can: CollabPermissions
  isExpanded(thread: CollabThreadView): boolean
  toggleExpanded(threadId: string): void
  resolvedOpen: boolean
  setResolvedOpen(open: boolean): void
  newThread: CollabNewThread | null
  /** the editor's "Comment" command: open a root composer at the anchor's place in the list */
  startThread(p: CollabNewThread): void
  cancelThread(): void
  dismissNotice(): void
  reload(): Promise<void>
  /**
   * lists once more (`since_token`, joins a list already in flight) and resolves with the list as it is
   * afterwards: the changed list, or the last one when nothing changed or the list failed. Never rejects.
   * For a host that must act on the server's current rows even while the panel is closed (Save receipts).
   */
  freshComments(): Promise<readonly CollabComment[]>
  retry(): Promise<void>
  /** answers `comments.reveal`; rejects `{code: 'not_ready', retryable: true}` when the first list is late */
  reveal(commentId: string): Promise<{ revealed: boolean }>
  actions: CollabActions
}

export interface CollabControllerOptions {
  /** pass a stable object (useMemo): a new one each render recomputes the thread views and re-renders unchanged lists */
  adapter?: CollabAnchorAdapter
  /**
   * The id of the version the editor shows. A `lost` comment whose `anchor_version_id` equals it is located
   * by the adapter like any other (the anchor is valid in that version), so the thread can jump to it.
   */
  openVersionId?: string
  /** opens version N read-only for a lost comment; absent: the panel shows no "View in version N" action */
  onViewVersion?: CollabViewVersion
  /** read for `collabUpdatedAnnounce` only */
  strings?: CollabStrings
  /** default: the window's polite live region */
  announce?: (text: string) => void
  revealWaitMs?: number
}

/** S12 level table: view -> nothing; undefined -> own comments only; edit -> own edits + resolve; manage -> all */
export function collabPermissions(
  host: Pick<CollabHostState, 'level' | 'myUserId'>,
  writeForbidden = false,
): CollabPermissions {
  const canWrite = host.level !== 'view' && !writeForbidden
  const mine = (c: CollabComment) =>
    typeof host.myUserId === 'string' && host.myUserId !== '' && c.author_id === host.myUserId
  const live = (c: CollabComment) => !c.deleted_at
  return {
    canWrite,
    canEdit: (c) => canWrite && live(c) && (host.level === 'manage' || mine(c)),
    canRemove: (c) => canWrite && live(c) && (host.level === 'manage' || mine(c)),
    canResolve: (root) =>
      canWrite && (host.level === 'edit' || host.level === 'manage' || mine(root)),
  }
}

function byCreated(a: CollabComment, b: CollabComment): number {
  const x = a.created_at ?? ''
  const y = b.created_at ?? ''
  return x < y ? -1 : x > y ? 1 : 0
}

function compareKeys(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const x = String(a)
  const y = String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

function anchorStateOf(
  root: CollabComment,
  kind: CollabKind,
  adapter: CollabAnchorAdapter | undefined,
  openVersionId?: string,
): CollabAnchorState | undefined {
  if (kind !== 'comment' || !root.anchor) return undefined
  // a lost anchor is still valid in the version it was kept on: viewing that version locates it again
  if (
    root.anchor_state === 'lost' &&
    !(root.anchor_version_id && root.anchor_version_id === openVersionId)
  )
    return 'lost'
  if (adapter) return adapter.locate(root.anchor) ? 'exact' : 'stale'
  return root.anchor_state === 'stale' ? 'stale' : 'exact'
}

function rootIdOf(c: CollabComment, byId: Map<string, CollabComment>): string {
  let cur = c
  const seen = new Set<string>()
  while (cur.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
    seen.add(cur.id)
    cur = byId.get(cur.parent_id)!
  }
  return cur.id
}

/**
 * Pure grouping + ordering. `marked`: comments a write learned were deleted (id -> last copy); a marked
 * root missing from the list stays as a deleted ghost so the composer under it keeps its draft.
 */
export function buildCollabThreads(
  comments: readonly CollabComment[],
  kind: CollabKind,
  adapter: CollabAnchorAdapter | undefined,
  marked: ReadonlyMap<string, CollabComment> = new Map(),
  openVersionId?: string,
): { open: CollabThreadView[]; resolved: CollabThreadView[] } {
  const asDeleted = (c: CollabComment): CollabComment =>
    marked.has(c.id) && !c.deleted_at ? { ...c, deleted_at: c.updated_at ?? 'deleted' } : c
  const byId = new Map<string, CollabComment>()
  for (const c of comments) byId.set(c.id, c)
  const roots: CollabComment[] = []
  const replies = new Map<string, CollabComment[]>()
  for (const c of comments) {
    const rootId = rootIdOf(c, byId)
    if (rootId === c.id) roots.push(c)
    else {
      const list = replies.get(rootId) ?? []
      list.push(asDeleted(c))
      replies.set(rootId, list)
    }
  }
  for (const [id, last] of marked) {
    if (!byId.has(id) && !last.parent_id) roots.push(last)
  }
  const views = roots.map((raw): CollabThreadView => {
    const root = asDeleted(raw)
    return {
      id: root.id,
      root,
      replies: (replies.get(root.id) ?? []).sort(byCreated),
      resolved: !!root.resolved_at,
      deleted: !!root.deleted_at,
      anchorState: anchorStateOf(root, kind, adapter, openVersionId),
    }
  })
  const order = (t: CollabThreadView) =>
    adapter && t.root.anchor ? adapter.order(t.root.anchor) : undefined
  const sort = (list: CollabThreadView[]) => {
    if (kind !== 'comment') return list.sort((a, b) => byCreated(a.root, b.root))
    const keys = new Map(list.map((t) => [t.id, order(t)]))
    return list.sort((a, b) => {
      const lostA = a.anchorState === 'lost'
      const lostB = b.anchorState === 'lost'
      if (lostA !== lostB) return lostA ? 1 : -1
      if (!lostA) {
        const ka = keys.get(a.id)
        const kb = keys.get(b.id)
        if (ka !== undefined && kb !== undefined) {
          const d = compareKeys(ka, kb)
          if (d !== 0) return d
        } else if (ka !== undefined || kb !== undefined) return ka !== undefined ? -1 : 1
      }
      return byCreated(a.root, b.root)
    })
  }
  return {
    open: sort(views.filter((t) => !t.resolved)),
    resolved: sort(views.filter((t) => t.resolved)),
  }
}

/** where a new (unsent) root goes in the open list: before the first located thread that sorts after it */
export function collabInsertIndex(
  threads: readonly CollabThreadView[],
  anchor: CollabAnchor,
  adapter: CollabAnchorAdapter | undefined,
): number {
  if (!adapter) return threads.length
  const key = adapter.order(anchor)
  const at = threads.findIndex(
    (t) =>
      t.anchorState === 'lost' ||
      (t.root.anchor !== null &&
        t.root.anchor !== undefined &&
        compareKeys(adapter.order(t.root.anchor), key) > 0),
  )
  return at === -1 ? threads.length : at
}

/** what a reader can see change; a changed signature after a reload is announced once */
function visibleSignature(comments: readonly CollabComment[]): string {
  return JSON.stringify(
    comments
      .map((c) => [
        c.id,
        c.parent_id ?? '',
        c.body,
        c.revision ?? 0,
        c.resolved_at ?? '',
        c.deleted_at ?? '',
        c.anchor_state ?? '',
        c.display_name ?? '',
      ])
      .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)),
  )
}

function statusFor(code: string): CollabNetStatus {
  if (code === 'network') return 'offline'
  if (code === 'unauthorized') return 'signedOut'
  return 'serverError'
}

interface HeldReveal {
  commentId: string
  resolve(r: { revealed: boolean }): void
  reject(e: CollabError): void
  timer: ReturnType<typeof setTimeout>
}

interface ListData {
  comments: CollabComment[]
  mentions: CollabMention[]
}

const EMPTY: ListData = { comments: [], mentions: [] }

export function useCollabThreads(
  source: CollabSource,
  host: CollabHostState,
  opts: CollabControllerOptions = {},
): CollabController {
  const { adapter, openVersionId, onViewVersion } = opts
  const kind = host.kind
  const [state, setState] = useState<CollabLoadState>('loading')
  const [data, setData] = useState<ListData>(EMPTY)
  const [status, setStatusState] = useState<CollabNetStatus | null>(null)
  const [writeForbidden, setWriteForbidden] = useState(false)
  const [notice, setNotice] = useState<CollabNotice | null>(null)
  const [conflict, setConflict] = useState<CollabConflict | null>(null)
  const [focus, setFocus] = useState<CollabFocusRequest | null>(null)
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const [resolvedOpen, setResolvedOpen] = useState(false)
  const [newThread, setNewThread] = useState<CollabNewThread | null>(null)
  const [marked, setMarked] = useState<ReadonlyMap<string, CollabComment>>(new Map())

  // refs: async work reads the latest values without re-creating callbacks
  const optsRef = useRef(opts)
  optsRef.current = opts
  const sourceRef = useRef(source)
  sourceRef.current = source
  const dataRef = useRef<ListData>(EMPTY)
  const statusRef = useRef<CollabNetStatus | null>(null)
  const tokenRef = useRef<string | undefined>(undefined)
  const sigRef = useRef('')
  const loadedRef = useRef(false)
  const genRef = useRef(0)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const againRef = useRef(false)
  const heldRef = useRef<HeldReveal[]>([])
  const seqRef = useRef(0)
  const markedRef = useRef(marked)
  markedRef.current = marked

  const setStatus = useCallback((s: CollabNetStatus | null) => {
    if (statusRef.current === s) return
    statusRef.current = s
    setStatusState(s)
  }, [])

  const deletedNotice: CollabNotice = kind === 'discussion' ? 'discussionDeleted' : 'commentDeleted'

  const doReveal = useCallback(
    (commentId: string): { revealed: boolean } => {
      const comments = dataRef.current.comments
      const byId = new Map(comments.map((c) => [c.id, c]))
      const target = byId.get(commentId)
      const seq = ++seqRef.current
      if (!target) {
        setNotice(deletedNotice)
        setFocus({ threadId: null, target: 'notice', seq })
        return { revealed: false }
      }
      const rootId = rootIdOf(target, byId)
      const root = byId.get(rootId)!
      const deleted = !!target.deleted_at || markedRef.current.has(target.id)
      setNotice(deleted ? deletedNotice : null)
      setToggled((prev) => {
        const next = new Set(prev)
        // default: open threads expanded, resolved collapsed; `toggled` holds the exceptions
        if (root.resolved_at) next.add(rootId)
        else next.delete(rootId)
        return next
      })
      if (root.resolved_at) setResolvedOpen(true)
      const anchorState = anchorStateOf(
        root,
        kind,
        optsRef.current.adapter,
        optsRef.current.openVersionId,
      )
      // lost in another version (and an anchor the editor cannot locate) only opens the thread
      if (anchorState === 'exact' && root.anchor) optsRef.current.adapter?.goTo(root.anchor)
      setFocus({ threadId: rootId, commentId, target: deleted ? 'deleted' : 'heading', seq })
      return { revealed: true }
    },
    [kind, deletedNotice],
  )

  const runList = useCallback(async (): Promise<void> => {
    const gen = genRef.current
    const first = !loadedRef.current
    const token = first ? undefined : tokenRef.current
    let res: CollabListResult
    try {
      res = await sourceRef.current.list(token ? { kind, since_token: token } : { kind })
    } catch (e) {
      if (gen !== genRef.current) return
      const err = toCollabError(e)
      if (err.code === 'forbidden' || err.code === 'not_found') {
        setState('noAccess')
        setNewThread(null)
      } else if (first) setState('loadError')
      else setStatus(statusFor(err.code))
      return
    }
    if (gen !== genRef.current) return
    if (res.unchanged && !first) {
      setStatus(null)
      return
    }
    tokenRef.current = res.list_token
    const sig = visibleSignature(res.comments)
    const changed = !first && sig !== sigRef.current
    sigRef.current = sig
    const next = { comments: res.comments, mentions: res.mentions }
    dataRef.current = next
    loadedRef.current = true
    setData(next)
    setState('ready')
    setStatus(null)
    if (changed) {
      const text = optsRef.current.strings?.collabUpdatedAnnounce ?? ''
      ;(optsRef.current.announce ?? announcePolite)(text)
    }
    if (first && heldRef.current.length > 0) {
      const held = heldRef.current
      heldRef.current = []
      for (const h of held) {
        clearTimeout(h.timer)
        h.resolve(doReveal(h.commentId))
      }
    }
  }, [kind, setStatus, doReveal])

  const reload = useCallback((): Promise<void> => {
    if (inFlightRef.current) {
      againRef.current = true
      return inFlightRef.current
    }
    const loop = async (): Promise<void> => {
      try {
        do {
          againRef.current = false
          await runList()
        } while (againRef.current)
      } finally {
        // a document/kind change already replaced the slot: only the loop that owns it may clear it
        if (inFlightRef.current === p) inFlightRef.current = null
      }
    }
    const p = loop()
    inFlightRef.current = p
    return p
  }, [runList])

  const freshComments = useCallback(async (): Promise<readonly CollabComment[]> => {
    await reload().catch(() => undefined)
    // the ref, not React state: threads lag one render behind the list that just landed
    return dataRef.current.comments
  }, [reload])

  const retry = useCallback((): Promise<void> => {
    if (!loadedRef.current) setState('loading')
    return reload()
  }, [reload])

  // first load, and a full reset when the document or the list kind changes
  useEffect(() => {
    genRef.current++
    loadedRef.current = false
    tokenRef.current = undefined
    sigRef.current = ''
    dataRef.current = EMPTY
    inFlightRef.current = null
    againRef.current = false
    statusRef.current = null
    setState('loading')
    setData(EMPTY)
    setStatusState(null)
    setWriteForbidden(false)
    setNotice(null)
    setConflict(null)
    setFocus(null)
    setToggled(new Set())
    setResolvedOpen(false)
    setNewThread(null)
    setMarked(new Map())
    void reload()
    return () => {
      genRef.current++
      const held = heldRef.current
      heldRef.current = []
      for (const h of held) {
        clearTimeout(h.timer)
        h.reject({ code: 'not_ready', retryable: true })
      }
    }
  }, [source, host.documentId, kind, reload])

  const reveal = useCallback(
    (commentId: string): Promise<{ revealed: boolean }> => {
      if (loadedRef.current) return Promise.resolve(doReveal(commentId))
      return new Promise((resolve, reject) => {
        const entry: HeldReveal = {
          commentId,
          resolve,
          reject,
          timer: setTimeout(() => {
            heldRef.current = heldRef.current.filter((h) => h !== entry)
            reject({ code: 'not_ready', retryable: true })
          }, optsRef.current.revealWaitMs ?? COMMENTS_REVEAL_WAIT_MS),
        }
        heldRef.current.push(entry)
      })
    },
    [doReveal],
  )

  const threadIdOf = useCallback((commentId: string): string => {
    const byId = new Map(dataRef.current.comments.map((c) => [c.id, c]))
    const c = byId.get(commentId)
    return c ? rootIdOf(c, byId) : commentId
  }, [])

  const markDeleted = useCallback((commentId: string) => {
    const last = dataRef.current.comments.find((c) => c.id === commentId)
    if (!last) return
    setMarked((prev) => new Map(prev).set(commentId, last))
  }, [])

  /** every write: success -> reload; failure -> status / view-only / deleted mark, then rethrow */
  const write = useCallback(
    async <T>(
      target: { commentId?: string; threadId?: string; body?: string },
      call: () => Promise<T>,
    ): Promise<T> => {
      try {
        const out = await call()
        void reload()
        return out
      } catch (e) {
        const err = toCollabError(e)
        if (err.code === 'forbidden') setWriteForbidden(true)
        else if (err.code === 'network' || err.code === 'internal' || err.code === 'unauthorized') {
          setStatus(statusFor(err.code))
          // the connection may be back already: a good list clears the status and unlocks Send (the draft stays)
          void reload()
        } else if (err.code === 'conflict' && err.detailsCode === 'comment_deleted') {
          const id = target.commentId ?? target.threadId
          if (id) markDeleted(id)
          if (target.threadId && target.body !== undefined)
            setConflict({ threadId: target.threadId, body: target.body })
          void reload()
        }
        throw err
      }
    },
    [reload, setStatus, markDeleted],
  )

  const actions = useMemo<CollabActions>(
    () => ({
      create: async (body, p) => {
        const anchor = p?.anchor
        const out = await write({}, () =>
          sourceRef.current.create({
            kind,
            body,
            ...(anchor ? { anchor } : {}),
            ...(p?.base_version_id ? { base_version_id: p.base_version_id } : {}),
          }),
        )
        setNewThread(null)
        return out.comment
      },
      reply: async (threadId, body) => {
        const out = await write({ threadId, body }, () =>
          sourceRef.current.create({ kind, parent_id: threadId, body }),
        )
        return out.comment
      },
      edit: async (commentId, body) => {
        const out = await write({ commentId, threadId: threadIdOf(commentId), body }, () =>
          sourceRef.current.update({ comment_id: commentId, body }),
        )
        return out.comment
      },
      remove: async (commentId) => {
        const r = await write({ commentId }, () =>
          sourceRef.current.remove({ comment_id: commentId }),
        )
        return r.outcome
      },
      resolve: async (threadId) => {
        await write({ commentId: threadId }, () =>
          sourceRef.current.resolve({ comment_id: threadId }),
        )
      },
      reopen: async (threadId) => {
        await write({ commentId: threadId }, () =>
          sourceRef.current.reopen({ comment_id: threadId }),
        )
      },
      history: async (commentId) => {
        try {
          const r = await sourceRef.current.revisions({ comment_id: commentId })
          return [...r.revisions].sort((a, b) => b.revision - a.revision)
        } catch (e) {
          const err = toCollabError(e)
          if (err.code === 'conflict' && err.detailsCode === 'comment_deleted') {
            markDeleted(commentId)
            void reload()
          }
          throw err
        }
      },
    }),
    [kind, write, threadIdOf, markDeleted, reload],
  )

  const grouped = useMemo(
    () => buildCollabThreads(data.comments, kind, adapter, marked, openVersionId),
    [data, kind, adapter, marked, openVersionId],
  )

  const can = useMemo(
    () => collabPermissions({ level: host.level, myUserId: host.myUserId }, writeForbidden),
    [host.level, host.myUserId, writeForbidden],
  )

  const isExpanded = useCallback(
    (t: CollabThreadView) => (t.resolved ? toggled.has(t.id) : !toggled.has(t.id)),
    [toggled],
  )
  const toggleExpanded = useCallback((id: string) => {
    setToggled((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return {
    source,
    host,
    adapter,
    openVersionId,
    onViewVersion,
    state,
    threads: grouped.open,
    resolved: grouped.resolved,
    mentions: data.mentions,
    status,
    viewOnly: !can.canWrite,
    notice,
    conflict,
    focus,
    can,
    isExpanded,
    toggleExpanded,
    resolvedOpen,
    setResolvedOpen,
    newThread,
    startThread: setNewThread,
    cancelThread: useCallback(() => setNewThread(null), []),
    dismissNotice: useCallback(() => setNotice(null), []),
    reload,
    freshComments,
    retry,
    reveal,
    actions,
  }
}
