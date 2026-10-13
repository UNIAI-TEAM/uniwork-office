/**
 * "A new version is on UniWork" for the web frame (G5-03w, EXPERIENCE.md › Thanh phiên bản mới S6).
 *
 * One controller per frame, driven by the host's `doc.remoteVersion` event (the host already drops
 * echoes and revisions at or below the open one; revisions are only ever compared as BigInt here):
 *   - clean frame, no AI turn running -> reload through `api.open` asking for the event's version
 *     (OQ-P3); what the frame shows and saves on is the reply's head and its `file.revision`
 *     (`openReplyRevision`), never the event's number;
 *   - dirty frame, or an AI turn running -> the warn bar, nothing is replaced; "Reload latest…"
 *     opens the Reload confirm of the conflict dialog (after stopping the AI turn when one runs),
 *     "Later" hides the bar until a newer revision arrives;
 *   - an AI turn that ends (`aiRun` idle) while its bar shows loads like the clean case;
 *   - a load that meets a dirty edit or a new AI turn is dropped; one that fails keeps the open
 *     content and shows the error bar with Retry;
 *   - revoke / delete (a 403 or 410 from a reload or a save): the frame is locked (inert editor,
 *     every save refused) behind the error bar; the organisation reasons of a 403 and a 401 only
 *     show their bar, because the server keeps refusing the saves by itself;
 *   - the host's `doc.blocked` (G5-03w: it saw the revoke / delete itself) locks at once, before
 *     any save: the reason's bar (revoke, delete, or the organisation sentence; a reason this frame
 *     does not know reads as revoked), the editor inert with its content (dirty edits included)
 *     kept, every save refused. Once per reason; another document lifts it (`reset`).
 * A module supplies the bits that are its own (what is open, dirty, how a head replaces the
 * document); the rest is shared by Docs, PDF, Markdown, HTML, Slides and Sheets.
 */
import type { Lang } from '@genoffice/i18n'
import {
  isDecimalRevision,
  openReplyRevision,
  toProtocolError,
  type DocBlockedPayload,
  type OpenPayload,
  type ProtocolErrorShape,
  type RemoteVersionPayload,
} from '../../docs/protocol/types'
import { webLanguage } from '../../docs/bridge/browser'
import { TIMEOUTS, type FramePort } from '../../docs/bridge/frame-port'
import { frameAiRun, type AiRunTracker } from './ai-run'
import { runConflictDialog, type ConflictIo } from './conflict-dialog'
import { frameAsk } from './frame-dialog'
import { webText, type WebStringKey } from './i18n/strings-web'
import { createRemoteBar, type BarAction, type RemoteBar } from './remote-bar'

export type LockKind = 'revoked' | 'deleted'

export interface RemoteVersionHost {
  port: Pick<FramePort, 'onRemoteVersion' | 'onBlocked' | 'request'>
  /** the open document; `revision` is the open copy's (decimal), null when the host sent none */
  current(): { fileId: string; revision: string | null } | null
  /** the editor holds edits that are not saved */
  isDirty(): boolean
  /** the editor may edit (frame token + file), for the Reload confirm's download choice */
  canEdit(): boolean
  /** replace the document the editor shows with this head; rejects when it could not be loaded */
  apply(reply: OpenPayload): Promise<void>
  /** the Reload confirm's "download my version" IO (only with the `download` capability) */
  download?(): ConflictIo['download']
  /** where the module's dialogs live (marker attribute, backdrop class, modal tracking) */
  frame?: Pick<ConflictIo, 'markerAttr' | 'maskClass' | 'onChange'>
  /** the module locked (revoke / delete): e.g. to tell the host */
  onLock?(kind: LockKind): void
  /** test seams */
  bar?: RemoteBar
  aiRun?: AiRunTracker
  dialog?: typeof runConflictDialog
  confirmStop?: () => Promise<boolean>
  root?: () => HTMLElement | null
}

export interface SaveFailure {
  code: string
  status?: number
  details?: ProtocolErrorShape['details']
}

export interface RemoteVersion {
  /** the editor's dirty state changed (the bar follows: dirty <-> "undone all changes") */
  dirtyChanged(dirty: boolean): void
  /** a save (or an Overwrite) failed: 401 / 403 / 410 get their bar */
  saveFailed(error: SaveFailure): void
  /** revoke / delete: the frame refuses every save */
  locked(): LockKind | null
  /** the sentence a refused save answers with */
  lockText(): string
  /** another document was opened: forget the pending version and the bar */
  reset(): void
  dispose(): void
}

const ORG_BLOCKED: Record<string, WebStringKey> = {
  organization_suspended: 'uwReasonSuspended',
  member_deactivated: 'uwReasonDeactivated',
  document_archived: 'uwReasonArchived',
}

type Newer = 'dirty' | 'ai' | 'nowClean'

function big(rev: string | null | undefined): bigint | null {
  if (!isDecimalRevision(rev)) return null
  return BigInt(rev)
}

export function createRemoteVersion(host: RemoteVersionHost): RemoteVersion {
  const bar = host.bar ?? createRemoteBar()
  const ai = host.aiRun ?? frameAiRun
  const dialog = host.dialog ?? runConflictDialog
  const rootEl = host.root ?? (() => document.getElementById('root'))
  const lang = (): Lang => webLanguage()
  const t = (key: WebStringKey, params?: Record<string, string>): string =>
    webText(lang(), key, params)

  /** the newest version the host told about and this frame has not loaded */
  let latest: RemoteVersionPayload | null = null
  /** "Later": the bar stays away until a newer revision arrives */
  let dismissed: bigint | null = null
  /** which warn bar shows now (the bar follows dirty / AI changes) */
  let shown: Newer | null = null
  let loading = false
  let reevaluate = false
  let token = 0
  let lock: LockKind | null = null
  let lockSentence = ''
  let inertBefore: boolean | null = null

  // ------------------------------------------------------------ bars

  function barAction(id: string, label: string, onClick: () => void): BarAction {
    return { id, label, onClick }
  }

  function showNewer(kind: Newer): void {
    if (!latest) return
    const n = latest.revision
    if (kind !== 'nowClean' && dismissed !== null && BigInt(n) <= dismissed) {
      bar.hide()
      shown = kind
      return
    }
    shown = kind
    if (kind === 'nowClean') {
      bar.show({
        tone: 'info',
        region: 'remote',
        text: t('uwRemoteNowClean', { n }),
        actions: [barAction('reload-now', t('uwConflictReloadGo'), () => void reloadNow())],
      })
      return
    }
    bar.show({
      tone: 'warn',
      region: 'remote',
      text: t(kind === 'dirty' ? 'uwRemoteNewerDirty' : 'uwRemoteNewerAi', { n }),
      actions: [
        barAction('reload', t('uwRemoteReload'), () => void reloadFlow()),
        barAction('later', t('uwRemoteLater'), later),
      ],
    })
  }

  function later(): void {
    if (latest) dismissed = BigInt(latest.revision)
    bar.hide()
  }

  function showUpdated(reply: OpenPayload, event: RemoteVersionPayload | null): void {
    const rev = openReplyRevision(reply)
    // the author and the time are the event's only when it is the version that was loaded
    const sameVersion = event !== null && reply.file.versionId === event.version_id
    const author = (sameVersion ? event.author_name : undefined) ?? t('uwAuthorFallback')
    const savedAt = reply.file.modifiedAt ?? (sameVersion ? Date.parse(event.saved_at) : Number.NaN)
    const time = Number.isFinite(savedAt)
      ? new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(savedAt)
      : null
    shown = null
    bar.show({
      tone: 'info',
      region: 'remote',
      text:
        rev !== null && time !== null
          ? t('uwRemoteUpdated', { n: rev, author, time })
          : t('uwRemoteUpdatedNoRev'),
      actions: [barAction('close', t('uwRemoteClose'), () => bar.hide())],
      autoHideMs: 8000,
    })
  }

  function showReloadFailed(n: string): void {
    shown = null
    bar.show({
      tone: 'error',
      region: 'lock',
      text: t('uwRemoteReloadFailed', { n }),
      actions: [barAction('retry', t('uwActRetry'), () => void retry())],
    })
  }

  // ------------------------------------------------------------ lock (revoke / delete)

  function lockFrame(kind: LockKind, sentence?: string): void {
    const text = sentence ?? t(kind === 'revoked' ? 'uwRemoteRevokedWeb' : 'uwRemoteDeleted')
    if (lock === kind && lockSentence === text) return
    // a deleted document stays deleted: a later revoke of it changes nothing
    if (lock === 'deleted' && kind === 'revoked') return
    lock = kind
    latest = null
    lockSentence = text
    shown = null
    bar.show({ tone: 'error', region: 'lock', text: lockSentence })
    // the editor stays on screen but nothing can be typed, saved, exported or printed
    const root = rootEl()
    if (root && inertBefore === null) {
      inertBefore = root.hasAttribute('inert')
      root.setAttribute('inert', '')
    }
    host.onLock?.(kind)
  }

  function unlockFrame(): void {
    lock = null
    lockSentence = ''
    const root = rootEl()
    if (root && inertBefore === false) root.removeAttribute('inert')
    inertBefore = null
  }

  // ------------------------------------------------------------ loading

  interface LoadResult {
    kind: 'applied' | 'dropped' | 'failed' | 'locked'
  }

  function openError(err: unknown): 'revoked' | 'deleted' | null {
    const e = toProtocolError(err)
    if (e.code === 'forbidden') return 'revoked'
    if (e.status === 410) return 'deleted'
    return null
  }

  /**
   * Ask for the version and put the head in the editor. `force` (the user chose Reload in the
   * confirm) skips the dirty / AI guards; otherwise a dirty edit or an AI turn that appeared while
   * the request ran drops the result and keeps the content.
   */
  async function load(event: RemoteVersionPayload, force: boolean): Promise<LoadResult> {
    const my = ++token
    loading = true
    try {
      let reply: OpenPayload
      try {
        reply = await host.port.request(
          'api.open',
          { fileId: event.document_id, versionId: event.version_id },
          { timeoutMs: TIMEOUTS.transfer },
        )
      } catch (err) {
        const lost = openError(err)
        if (lost) {
          lockFrame(lost)
          return { kind: 'locked' }
        }
        // a version that is gone (purged): the head is what the user wants to see
        if (toProtocolError(err).code !== 'not_found') throw err
        try {
          reply = await host.port.request(
            'api.open',
            { fileId: event.document_id },
            { timeoutMs: TIMEOUTS.transfer },
          )
        } catch (headErr) {
          // the head itself is not found: the document is gone, not just the version
          if (toProtocolError(headErr).code !== 'not_found') throw headErr
          lockFrame('deleted')
          return { kind: 'locked' }
        }
      }
      if (my !== token || lock) return { kind: 'dropped' }
      const cur = host.current()
      if (!cur || cur.fileId !== event.document_id) return { kind: 'dropped' }
      if (!force && host.isDirty()) {
        showNewer('dirty')
        return { kind: 'dropped' }
      }
      if (!force && ai.running()) {
        showNewer('ai')
        return { kind: 'dropped' }
      }
      const got = big(openReplyRevision(reply))
      const open = big(cur.revision)
      if (got !== null && open !== null && got <= open) {
        // the host answered an older (or the same) head than the open copy: nothing to replace
        console.warn('[office-web] api.open answered a revision not newer than the open copy')
        latest = null
        bar.hide()
        return { kind: 'dropped' }
      }
      await host.apply(reply)
      if (my !== token || lock) return { kind: 'applied' }
      latest = null
      dismissed = null
      showUpdated(reply, event)
      return { kind: 'applied' }
    } catch (err) {
      const lost = openError(err)
      if (lost) {
        lockFrame(lost)
        return { kind: 'locked' }
      }
      console.warn('[office-web] loading the new version failed:', err)
      if (my === token && !lock) showReloadFailed(event.revision)
      return { kind: 'failed' }
    } finally {
      loading = false
      if (reevaluate) {
        reevaluate = false
        evaluate()
      }
    }
  }

  function evaluate(): void {
    if (lock || !latest) return
    const cur = host.current()
    if (!cur) return
    const known = big(cur.revision)
    if (known !== null && BigInt(latest.revision) <= known) {
      latest = null
      return
    }
    if (loading) {
      reevaluate = true
      return
    }
    if (host.isDirty()) return showNewer('dirty')
    if (ai.running()) return showNewer('ai')
    void load(latest, false)
  }

  async function retry(): Promise<void> {
    if (latest) await load(latest, false)
  }

  /** "Reload" of the "you undid your changes" bar: the user asked, no confirmation needed */
  async function reloadNow(): Promise<void> {
    if (!latest || host.isDirty()) return
    await load(latest, false)
  }

  async function confirmStop(): Promise<boolean> {
    if (host.confirmStop) return host.confirmStop()
    const choice = await frameAsk<'go' | 'cancel'>({
      title: t('uwConflictReloadTitle'),
      body: t('uwRemoteStopAiConfirm'),
      choices: [
        { id: 'go', label: t('uwConflictReloadGo'), danger: true },
        { id: 'cancel', label: t('webCancel') },
      ],
      cancelId: 'cancel',
      marker: 'stop-ai',
      ...(host.frame?.markerAttr ? { markerAttr: host.frame.markerAttr } : {}),
      ...(host.frame?.maskClass ? { maskClass: host.frame.maskClass } : {}),
      ...(host.frame?.onChange ? { onChange: host.frame.onChange } : {}),
    })
    return choice === 'go'
  }

  /** "Reload latest…": stop a running AI turn first, then the Reload confirm of the conflict dialog */
  async function reloadFlow(): Promise<void> {
    const event = latest
    if (!event || lock) return
    if (ai.running()) {
      if (!(await confirmStop())) return
      await ai.stop()
    }
    // cancelled (Back, Esc, X): the bar stays as it was; reloaded: `load` already showed the result
    await dialog({
      start: 'reload',
      // the Reload confirm brings its own title and sentence; the step-1 fields are never shown
      title: '',
      body: '',
      reloadLabel: t('uwRemoteReload'),
      overwriteLabel: '',
      cancelLabel: t('webCancel'),
      baseRevision: host.current()?.revision ?? null,
      readHead: async () => null,
      overwrite: async () => ({
        ok: false,
        error: { code: 'internal', message: 'no overwrite from the new-version bar' },
      }),
      reload: async () => (await load(event, true)).kind === 'applied',
      canEdit: () => host.canEdit(),
      ...(host.download ? { download: host.download() } : {}),
      ...(host.frame ?? {}),
    })
  }

  // ------------------------------------------------------------ events

  const offRemote = host.port.onRemoteVersion?.((p) => {
    if (lock || !isDecimalRevision(p.revision)) return
    const cur = host.current()
    if (!cur || cur.fileId !== p.document_id) return
    const rev = BigInt(p.revision)
    const open = big(cur.revision)
    if (open !== null && rev <= open) return
    if (latest && rev <= BigInt(latest.revision)) return
    latest = p
    evaluate()
  })

  /** The organisation-blocked bar: shared by the pushed `doc.blocked` and the refused Save */
  function showOrgBlocked(key: WebStringKey): void {
    if (lock) return
    shown = null
    bar.show({
      tone: 'error',
      region: 'lock',
      text: t('uwRemoteOrgBlockedWeb', { reason: t(key) }),
    })
  }

  /** `doc.blocked`: the host saw the revoke / delete itself; the reason picks the bar */
  function blocked(p: DocBlockedPayload): void {
    const cur = host.current()
    if (cur && cur.fileId !== p.document_id) return
    if (p.reason === 'document_deleted') return lockFrame('deleted')
    const org = ORG_BLOCKED[p.reason]
    // the organisation reasons are transient (the organisation can be reopened): the bar only, the
    // editor stays usable, exactly like the same reason arriving as a Save 403
    if (org) return showOrgBlocked(org)
    lockFrame('revoked')
  }

  const offBlocked = host.port.onBlocked?.(blocked)

  const offAi = ai.onChange((running) => {
    // the AI bar waits for the turn: idle on a still clean document loads the version
    if (!running && latest && shown === 'ai') evaluate()
  })

  return {
    dirtyChanged(dirty) {
      if (lock || !latest || loading) return
      if (dirty && (shown === 'ai' || shown === 'nowClean')) showNewer('dirty')
      else if (!dirty && shown === 'dirty') showNewer('nowClean')
    },
    saveFailed(error) {
      const status = error.status
      if (error.code === 'unauthorized') {
        shown = null
        bar.show({
          tone: 'error',
          region: 'lock',
          text: t('webSaveUnauthorized'),
          actions: [barAction('close', t('uwRemoteClose'), () => bar.hide())],
        })
        return
      }
      if (error.code === 'forbidden') {
        const apiCode = error.details?.apiCode
        const reason = typeof apiCode === 'string' ? ORG_BLOCKED[apiCode] : undefined
        if (!reason) return lockFrame('revoked')
        showOrgBlocked(reason)
        return
      }
      if (error.code === 'not_found' || status === 410) lockFrame('deleted')
    },
    locked: () => lock,
    lockText: () => lockSentence,
    reset() {
      token++
      latest = null
      dismissed = null
      shown = null
      loading = false
      reevaluate = false
      unlockFrame()
      bar.hide()
    },
    dispose() {
      offRemote?.()
      offBlocked?.()
      offAi()
      token++
      unlockFrame()
      bar.hide()
    },
  }
}
