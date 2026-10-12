/**
 * The save conflict dialog of every web frame (Docs, Sheets, Slides, PDF, Markdown, HTML): one
 * dialog, in the frame, for every save that hits 409 — the frame's own save and the save the host
 * page sends (`save {reason}`). Each module only supplies its IO (`ConflictIo`) and maps the
 * outcome to its own save result; the host gets `conflictSaveResult()`.
 *
 * Step 1: the two-column table (your version / the version on UniWork, from both heads), then
 * Reload latest (primary), Overwrite… (danger, only with edit access), Cancel, the close X; first
 * focus Cancel. Overwrite… and Reload latest open their confirmation in the same card ("Back"
 * returns to step 1 and focuses the button that opened the step). Web Reload confirm: download my
 * version, then reload (only with the `download` capability and edit access) / discard changes and
 * reload / Back; after the host delivered the file the dialog asks the user to check it, never
 * reloading on its own.
 *
 * Answers (`save` contract): overwritten = ok with the new versionId; reloaded = ok without
 * versionId; Cancel / Escape / X = `cancelled`; Overwrite failed with 401 / 403 / 410 / 5xx and the
 * user closed = `unauthorized` / `forbidden` / `not_found` / `internal`. No new codes.
 */
import { format, type Lang } from '@genoffice/i18n'
import {
  isDecimalRevision,
  toProtocolError,
  type Capabilities,
  type FileMeta,
  type ProtocolErrorShape,
  type RemoteVersionPayload,
  type SaveResult,
} from '../../docs/protocol/types'
import { webLanguage } from '../../docs/bridge/browser'
import { TIMEOUTS, type FramePort } from '../../docs/bridge/frame-port'
import {
  FOCUS_TITLE,
  openFrameDialog,
  type FrameChoice,
  type FrameDialogHandle,
} from './frame-dialog'
import { webText, type WebStringKey } from './i18n/strings-web'

/** the version on UniWork as far as the frame knows it */
export interface ConflictHead {
  /** decimal document revision; absent from hosts that do not send one */
  revision?: string
  versionId?: string
  /** epoch ms */
  modifiedAt?: number
  /** display name; absent = "a member" */
  author?: string
}

/** what one Overwrite attempt answered */
export type OverwriteAttempt =
  { ok: true; versionId?: string; file?: FileMeta } | { ok: false; error: ProtocolErrorShape }

export interface ConflictIo {
  /** the module's own wording (already translated): title, body and the three step-1 labels */
  title: string
  body: string
  reloadLabel: string
  overwriteLabel: string
  cancelLabel: string
  /** the revision the open copy is based on (decimal), if known */
  baseRevision?: string | null
  /** the head as it is now (metadata only); null when it could not be read */
  readHead(): Promise<ConflictHead | null>
  /** save the open bytes over the current head (re-reads the head token first) */
  overwrite(): Promise<OverwriteAttempt>
  /** replace the open document with the head; false when it could not be loaded */
  reload(): Promise<boolean>
  /** the frame token still allows editing */
  canEdit(): boolean
  /** set only when the effective capabilities include `download` */
  download?: {
    /** the open bytes in the module's own format */
    bytes(): Promise<ArrayBuffer>
    /** `api.download {data}`: resolves when the host delivered the file, rejects otherwise */
    send(data: ArrayBuffer): Promise<void>
  }
  /** default: navigator.onLine */
  online?: () => boolean
  /** the dialog's marker attribute / backdrop class (module conventions) */
  markerAttr?: string
  maskClass?: string
  onChange?: () => void
}

export type ConflictOutcome =
  | { kind: 'overwritten'; versionId?: string; file?: FileMeta }
  | { kind: 'reloaded' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: 'unauthorized' | 'forbidden' | 'not_found' | 'internal' }

export const CONFLICT_MARKER = 'conflict'

// ------------------------------------------------------------ authors seen in doc.remoteVersion

/** the frame learns who saved a revision only from the host's `doc.remoteVersion` events */
const authors = new Map<string, string>()

export function rememberRemoteVersion(p: RemoteVersionPayload): void {
  if (!isDecimalRevision(p.revision) || !p.author_name) return
  authors.set(p.revision, p.author_name)
  if (authors.size > 32) authors.delete(authors.keys().next().value!)
}

/** the head from an `api.open` / `api.save` file: revision (decimal) or the decimal etag */
export function headFromFile(file: FileMeta | null | undefined): ConflictHead | null {
  if (!file) return null
  const revision = revisionOf(file)
  return {
    ...(revision ? { revision } : {}),
    ...(file.versionId ? { versionId: file.versionId } : {}),
    ...(file.modifiedAt !== undefined ? { modifiedAt: file.modifiedAt } : {}),
    ...(revision && authors.has(revision) ? { author: authors.get(revision)! } : {}),
  }
}

/**
 * The decimal revision of a file: `revision` (X-02), else an etag that is a bare decimal (the
 * UniWork host's etag is the document revision). Never a guess from anything else.
 */
export function revisionOf(file: FileMeta | null | undefined): string | null {
  if (!file) return null
  if (isDecimalRevision(file.revision)) return file.revision
  const etag = file.etag?.replace(/^"|"$/g, '')
  return isDecimalRevision(etag) ? etag : null
}

// ------------------------------------------------------------ IO over the frame port

type RequestPort = Pick<FramePort, 'request'>

/** the head's metadata through `api.open` (the bytes are not read); null when it cannot be read */
export async function readHeadFile(port: RequestPort, fileId: string): Promise<FileMeta | null> {
  try {
    const open = await port.request('api.open', { fileId }, { timeoutMs: TIMEOUTS.short })
    return open?.file?.fileId === fileId ? open.file : null
  } catch (err) {
    console.warn('[office-web] reading the head version failed:', err)
    return null
  }
}

/** detached copy: the transfer must not detach the caller's buffer */
function copyBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const out = new ArrayBuffer(src.byteLength)
  new Uint8Array(out).set(src)
  return out
}

/**
 * Overwrite: save `data` on top of the current head (its etag read just now). Never prompts: a
 * second 409 comes back as `conflict` and the dialog asks again with the new head.
 */
export async function overwriteHead(
  port: RequestPort,
  fileId: string,
  data: ArrayBuffer | Uint8Array,
): Promise<OverwriteAttempt> {
  const head = await readHeadFile(port, fileId)
  if (!head) return { ok: false, error: { code: 'network', message: 'the head could not be read' } }
  const payload = { fileId, data: copyBuffer(data), ...(head.etag ? { etag: head.etag } : {}) }
  try {
    const res = await port.request('api.save', payload, {
      timeoutMs: TIMEOUTS.transfer,
      transfer: [payload.data],
    })
    if (res?.ok === true && res.file) {
      return { ok: true, file: res.file, ...(res.versionId ? { versionId: res.versionId } : {}) }
    }
    if (res?.ok === false) return { ok: false, error: res.error }
    return { ok: false, error: { code: 'malformed', message: 'api.save: unexpected result' } }
  } catch (err) {
    return { ok: false, error: toProtocolError(err).toShape() }
  }
}

/**
 * The download choice's IO, only when the effective capabilities include `download` (host
 * advertised it and the frame claimed it). `api.download` carries the bytes only.
 */
export function downloadVia(
  port: RequestPort,
  caps: Capabilities | undefined,
  bytes: () => Promise<ArrayBuffer | Uint8Array> | ArrayBuffer | Uint8Array,
): ConflictIo['download'] {
  if (caps?.download !== true) return undefined
  return {
    bytes: async () => copyBuffer(await bytes()),
    async send(data) {
      const res = await port.request(
        'api.download',
        { data },
        {
          timeoutMs: TIMEOUTS.transfer,
          transfer: [data],
        },
      )
      if (res?.delivered !== true) throw toProtocolError(new Error('api.download: not delivered'))
    },
  }
}

// ------------------------------------------------------------ the dialog

type Step1 = 'reload' | 'overwrite' | 'cancel'
type Id = Step1 | 'go' | 'back' | 'download' | 'discard' | 'close'

const ORG_BLOCKED: Record<string, WebStringKey> = {
  organization_suspended: 'uwReasonSuspended',
  member_deactivated: 'uwReasonDeactivated',
  document_archived: 'uwReasonArchived',
}

function next(revision: string | undefined): string | undefined {
  if (!revision) return undefined
  try {
    return (BigInt(revision) + 1n).toString()
  } catch {
    return undefined
  }
}

/** the S5 dialog; resolves once the user has settled the conflict one way or another */
export async function runConflictDialog(io: ConflictIo): Promise<ConflictOutcome> {
  const lang: Lang = webLanguage()
  const t = (key: WebStringKey, params?: Record<string, string>) => webText(lang, key, params)
  const dash = '—'
  const online = io.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  const dialog: FrameDialogHandle<Id> = openFrameDialog<Id>({
    marker: CONFLICT_MARKER,
    closeLabel: t('uwConflictClose'),
    ...(io.markerAttr ? { markerAttr: io.markerAttr } : {}),
    ...(io.maskClass ? { maskClass: io.maskClass } : {}),
    ...(io.onChange ? { onChange: io.onChange } : {}),
  })

  let head: ConflictHead | null = null
  /** the table's box in step 1: refilled when the head arrives, without re-rendering the step */
  let tableBox: HTMLElement | null = null
  const headRead = io
    .readHead()
    .catch(() => null)
    .then((h) => {
      head = h ?? head
      tableBox?.replaceChildren(table())
    })
  /** the code the host hears when the user closes after a failed Overwrite */
  let failure: ConflictOutcome | null = null
  /** an Overwrite answered 413: the same limit blocks the download */
  let tooLarge = false
  let alert = ''
  let focus: Id | typeof FOCUS_TITLE = 'cancel'

  const authorOf = (h: ConflictHead | null) => h?.author ?? t('uwAuthorFallback')
  const timeOf = (h: ConflictHead | null) =>
    h?.modifiedAt !== undefined
      ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(
          h.modifiedAt,
        )
      : dash

  function table(): HTMLElement {
    const el = document.createElement('table')
    el.className = 'ow-dlg-compare'
    const mineCol = t('uwConflictColMine')
    const serverCol = t('uwConflictColServer')
    const thead = el.createTHead().insertRow()
    for (const label of ['', mineCol, serverCol]) {
      const th = document.createElement('th')
      th.scope = 'col'
      th.textContent = label
      thead.append(th)
    }
    const body = el.createTBody()
    const rows: [WebStringKey, string, string][] = [
      [
        'uwConflictRowVersion',
        io.baseRevision ? t('uwConflictBasedOn', { n: io.baseRevision }) : dash,
        head?.revision ?? dash,
      ],
      ['uwConflictRowTime', dash, timeOf(head)],
      ['uwConflictRowBy', t('uwConflictMineUnsaved'), authorOf(head)],
    ]
    for (const [key, mine, server] of rows) {
      const tr = body.insertRow()
      const th = document.createElement('th')
      th.scope = 'row'
      th.textContent = t(key)
      tr.append(th)
      for (const [col, value] of [
        [mineCol, mine],
        [serverCol, server],
      ] as const) {
        const td = tr.insertCell()
        td.dataset.col = col
        td.textContent = value
      }
    }
    return el
  }

  function step1(): Promise<Id> {
    const content = document.createElement('div')
    tableBox = document.createElement('div')
    tableBox.append(table())
    content.append(tableBox)
    const canEdit = io.canEdit()
    if (!canEdit) {
      const note = document.createElement('p')
      note.className = 'ow-dlg-note'
      note.textContent = t('uwConflictNoEdit')
      content.append(note)
    }
    const offline = !online()
    const offlineWhy = offline ? t('uwConflictOfflineWeb') : undefined
    const choices: FrameChoice<Id>[] = [
      {
        id: 'reload',
        label: io.reloadLabel,
        primary: true,
        ...(offline ? { disabled: true, reason: offlineWhy! } : {}),
      },
    ]
    if (canEdit) {
      choices.push({
        id: 'overwrite',
        label: io.overwriteLabel,
        danger: true,
        ...(offline ? { disabled: true, reason: offlineWhy! } : {}),
      })
    }
    choices.push({ id: 'cancel', label: io.cancelLabel })
    const shown = dialog.step({
      title: io.title,
      body: io.body,
      content,
      choices,
      cancelId: 'cancel',
      // Reload latest is the primary, yet a stray Enter must not discard the edits
      focusId: focus === FOCUS_TITLE || choices.some((c) => c.id === focus) ? focus : 'cancel',
      alert,
    })
    alert = ''
    return shown
  }

  function overwriteStep(): Promise<Id> {
    return dialog.step({
      title: t('uwConflictOverwriteTitle'),
      body: format(t('uwConflictOverwriteConfirm'), {
        next: next(head?.revision) ?? dash,
        server: head?.revision ?? dash,
        author: authorOf(head),
      }),
      choices: [
        { id: 'go', label: t('uwConflictOverwriteGo'), danger: true },
        { id: 'back', label: t('uwConflictBack') },
      ],
      cancelId: 'back',
      closeId: 'cancel',
      focusId: 'back',
    })
  }

  function reloadStep(stepAlert = '', focusId: Id = 'back'): Promise<Id> {
    const choices: FrameChoice<Id>[] = []
    if (io.download && io.canEdit()) {
      choices.push({
        id: 'download',
        label: t('uwConflictDownloadThenReload'),
        ...(tooLarge ? { disabled: true, reason: t('uwConflictTooLarge') } : {}),
      })
    }
    choices.push(
      { id: 'discard', label: t('uwConflictDiscardThenReload'), danger: true },
      { id: 'back', label: t('uwConflictBack') },
    )
    return dialog.step({
      title: t('uwConflictReloadTitle'),
      body: t('uwConflictReloadWebBody'),
      choices,
      cancelId: 'back',
      closeId: 'cancel',
      focusId,
      alert: stepAlert,
    })
  }

  function checkStep(): Promise<Id> {
    return dialog.step({
      title: t('uwConflictReloadTitle'),
      body: t('uwConflictDownloadCheck'),
      choices: [
        { id: 'go', label: t('uwConflictReloadGo'), primary: true },
        { id: 'back', label: t('uwConflictBack') },
      ],
      cancelId: 'back',
      closeId: 'cancel',
      // the variant changed in place: the new title takes the focus
      focusId: FOCUS_TITLE,
    })
  }

  /** a closing variant (revoked, deleted, organisation blocked): one sentence and Close */
  async function closing(body: string, code: 'forbidden' | 'not_found'): Promise<ConflictOutcome> {
    await dialog.step({
      title: io.title,
      body,
      choices: [{ id: 'close', label: t('uwConflictClose'), primary: true }],
      cancelId: 'close',
      focusId: FOCUS_TITLE,
    })
    return { kind: 'failed', code }
  }

  /** Reload: replace the document with the head, or stay with the failure line */
  async function reloadNow(): Promise<boolean> {
    try {
      if (await io.reload()) return true
    } catch (err) {
      console.warn('[office-web] reloading the latest version failed:', err)
    }
    return false
  }

  try {
    for (;;) {
      const choice = await step1()
      focus = 'cancel'
      if (choice === 'cancel') return failure ?? { kind: 'cancelled' }

      if (choice === 'overwrite') {
        // the confirmation names the head's revision and author
        await headRead
        const confirmed = await overwriteStep()
        if (confirmed === 'cancel') return failure ?? { kind: 'cancelled' }
        if (confirmed === 'back') {
          focus = 'overwrite'
          continue
        }
        const res = await io.overwrite().catch((err: unknown): OverwriteAttempt => ({
          ok: false,
          error: { code: 'internal', message: String(err) },
        }))
        if (res.ok) {
          return {
            kind: 'overwritten',
            ...(res.versionId ? { versionId: res.versionId } : {}),
            ...(res.file ? { file: res.file } : {}),
          }
        }
        const { code } = res.error
        const apiCode = res.error.details?.apiCode
        if (code === 'conflict') {
          // someone saved again meanwhile: the table follows the new head, choose again
          head = (await io.readHead().catch(() => null)) ?? head
          alert = format(t('uwConflictHeadMoved'), { n: head?.revision ?? dash })
          continue
        }
        if (code === 'unauthorized') {
          failure = { kind: 'failed', code: 'unauthorized' }
          alert = t('uwConflictSessionWeb')
          continue
        }
        if (code === 'too_large') {
          tooLarge = true
          alert = t('uwConflictTooLarge')
          continue
        }
        if (code === 'forbidden') {
          const reason = typeof apiCode === 'string' ? ORG_BLOCKED[apiCode] : undefined
          return await closing(
            reason
              ? format(t('uwRemoteOrgBlockedWeb'), { reason: t(reason) })
              : t('uwRemoteRevokedWeb'),
            'forbidden',
          )
        }
        if (code === 'not_found') return await closing(t('uwRemoteDeleted'), 'not_found')
        // 5xx, network, timeout: the document did not change, the buttons still work
        failure = { kind: 'failed', code: 'internal' }
        alert = t('uwConflictOverwriteFailed')
        continue
      }

      // reload: the web confirmation (keep a downloaded copy, or discard)
      let stepAlert = ''
      let stepFocus: Id = 'back'
      for (;;) {
        const picked = await reloadStep(stepAlert, stepFocus)
        stepAlert = ''
        stepFocus = 'back'
        if (picked === 'cancel') return failure ?? { kind: 'cancelled' }
        if (picked === 'back') {
          focus = 'reload'
          break
        }
        if (picked === 'discard') {
          if (await reloadNow()) return { kind: 'reloaded' }
          stepAlert = t('uwConflictReloadFailed')
          continue
        }
        // download, then reload once the user confirms they have the file
        try {
          await io.download!.send(await io.download!.bytes())
        } catch (err) {
          if ((err as { code?: string })?.code === 'too_large') tooLarge = true
          stepAlert = t('uwConflictDownloadFailed')
          stepFocus = 'download'
          continue
        }
        const checked = await checkStep()
        if (checked === 'cancel') return failure ?? { kind: 'cancelled' }
        if (checked === 'back') {
          stepFocus = 'download'
          continue
        }
        if (await reloadNow()) return { kind: 'reloaded' }
        stepAlert = t('uwConflictReloadFailed')
      }
    }
  } finally {
    dialog.close()
  }
}

/** the `save` answer for a host-sent save that met the conflict dialog */
export function conflictSaveResult(outcome: ConflictOutcome, file: FileMeta): SaveResult {
  switch (outcome.kind) {
    case 'overwritten':
      return {
        ok: true,
        file: outcome.file ?? file,
        ...(outcome.versionId ? { versionId: outcome.versionId } : {}),
      }
    case 'reloaded':
      // like "nothing to save": the file now loaded, no new version
      return { ok: true, file }
    case 'cancelled':
      return {
        ok: false,
        error: { code: 'cancelled', message: 'the user kept the edits (save conflict)' },
      }
    case 'failed':
      return {
        ok: false,
        error: { code: outcome.code, message: `overwrite failed (${outcome.code})` },
      }
  }
}
