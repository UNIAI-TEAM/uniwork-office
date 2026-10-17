import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type {
  UniworkDocActionResult,
  UniworkDocSummary,
  UniworkFirstSaveInput,
  UniworkFirstSaveTarget,
  UniworkFolderNode,
  UniworkResult,
} from '../../../shared/home-api'
import { DEFAULT_MAX_DOCUMENT_BYTES } from '../../../shared/size-format'
import { pathKey } from '../../../shared/path-key'
import { FileBadge } from '../FileBadge'
import { stateOf } from '../account-model'
import { pickActiveWorkspace, readActiveWorkspaceId } from '../active-workspace'
import { useI18n, type StringKey } from '../locale'
import { ActionModal, ActionToast } from '../UniworkDocActions'
import {
  DOC_NAME_ERROR_KEYS,
  UNIWORK_ERROR_KEYS,
  checkDocName,
  isDocTitleTooLong,
  uploadTooLargeTextOf,
} from '../uniwork-docs-model'
import { loadFolderTree, onTreeChanged } from '../uniwork-library-api'
import { announce } from '../uniwork-live'
import { currentWorkbenchBucket, isWorkbenchBucketCleared } from '../workbench-bucket'
import { FolderNameDialog } from './FolderNameDialog'
import { UniworkFolderPicker, type PickedFolder } from './UniworkFolderPicker'
import { FolderGlyph, MyFolderGlyph } from './UniworkFolderTree'
import {
  MY_FOLDER_LABEL_KEY,
  folderVisibilityTagOf,
  myFolderIdOf,
  type PathPart,
} from './uniwork-folders-model'
import { useFolderActions } from './use-folder-actions'
import './uniwork-folders.css'
import './save-dialog.css'

type TFn = ReturnType<typeof useI18n>['t']

/** where the first save goes, as the dialog shows it (the wire target drops the path) */
type ShownTarget = { kind: 'my_folder' } | { kind: 'folder'; folderId: string; path: PathPart[] }

type FirstSaveResult = UniworkDocActionResult<UniworkDocSummary>

type SaveFailure = Extract<FirstSaveResult, { ok: false }>

/**
 * FE-S01-R1-1: a first save outlives its dialog. Once sent it cannot be
 * cancelled, so its run is kept here by tab (pathKey) with the dialogs that
 * watch that tab. A refusal that names a created document (bind failed /
 * orphaned) that no dialog is left to show waits in `unshown` for the host's
 * next render, and is said at once through the shell's live region. A kept
 * result names a document of one account's workspace: it is tagged with both
 * and never shown to another (FE-S01-R2-3).
 */
type Kept = { path: string; failure: SaveFailure; bucket: string; workspaceId: string }

const running = new Map<string, Promise<FirstSaveResult>>()
const watching = new Map<string, number>()
let unshown: readonly Kept[] = []
const unshownListeners = new Set<() => void>()

function setUnshown(next: readonly Kept[]) {
  unshown = next
  for (const listener of unshownListeners) listener()
}

function onUnshown(listener: () => void): () => void {
  unshownListeners.add(listener)
  return () => {
    unshownListeners.delete(listener)
  }
}

/** the refusals that leave a document in UniWork: the person must hear its id and title */
const namesDocument = (failure: SaveFailure) =>
  failure.error === 'first_save_bind_failed' || failure.error === 'first_save_orphaned'

/** whether a kept result belongs to the signed-in account (bucket) and the workspace shown */
function isOwnKept(entry: Kept): boolean {
  if (isWorkbenchBucketCleared() || entry.bucket !== currentWorkbenchBucket()) return false
  const active = readActiveWorkspaceId()
  return active === null || active === entry.workspaceId
}

/** the kept results that may still be shown: another account's or workspace's are dropped */
function ownKept(): readonly Kept[] {
  if (unshown.every(isOwnKept)) return unshown
  setUnshown(unshown.filter(isOwnKept))
  return unshown
}

/** takes the kept result of a tab out of the store (null when there is none to show) */
function takeKept(path: string): SaveFailure | null {
  const key = pathKey(path)
  const entry = ownKept().find((k) => pathKey(k.path) === key)
  if (!entry) return null
  setUnshown(unshown.filter((k) => k !== entry))
  return entry.failure
}

function watchTab(key: string): () => void {
  watching.set(key, (watching.get(key) ?? 0) + 1)
  return () => {
    const left = (watching.get(key) ?? 1) - 1
    if (left > 0) watching.set(key, left)
    else watching.delete(key)
  }
}

function startFirstSave(
  input: UniworkFirstSaveInput,
  say: (failure: SaveFailure) => string,
): Promise<FirstSaveResult> {
  const key = pathKey(input.tabPath)
  // the account the document is created for, as it is when the save is sent
  const bucket = currentWorkbenchBucket()
  const run = window.aiOffice
    .uniworkFirstSave(input)
    .catch((): FirstSaveResult => ({ ok: false, error: 'network' }))
  running.set(key, run)
  // registered before any dialog's own handler, so it sees who still watches
  void run.then((result) => {
    running.delete(key)
    if (result.ok || watching.has(key) || !namesDocument(result)) return
    setUnshown([
      ...unshown,
      { path: input.tabPath, failure: result, bucket, workspaceId: input.workspaceId },
    ])
    announce(say(result), { assertive: true })
  })
  return run
}

/** Test seam: forget every run and unshown result between cases. */
export function resetFirstSavesForTests(): void {
  running.clear()
  watching.clear()
  setUnshown([])
}

function Spinner() {
  return (
    <svg className="uw-spinner" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeDasharray="26"
        strokeDashoffset="18"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** the file name split into the editable name and its fixed extension (".docx") */
export function nameParts(path: string): { base: string; ext: string } {
  const file = path.split(/[\\/]/).pop() ?? ''
  const dot = file.lastIndexOf('.')
  return dot > 0 ? { base: file.slice(0, dot), ext: file.slice(dot) } : { base: file, ext: '' }
}

/** the title sent on create: the name plus the fixed extension, once */
function titleWithExt(name: string, ext: string): string {
  return ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? `${name}${ext}` : name
}

/**
 * The one line a refused first save shows at the field. Every code has its own
 * copy; the two "created but not bound" codes name the document (id + title)
 * so the person can find it (trash, or still in its folder).
 */
export function firstSaveErrorText(failure: SaveFailure, t: TFn, dateLocale: string): string {
  const named = {
    id: failure.documentId ?? '—',
    title: failure.documentTitle ?? '—',
  }
  switch (failure.error) {
    case 'name_empty':
    case 'name_too_long':
      return t(DOC_NAME_ERROR_KEYS[failure.error])
    case 'invalid_destination':
      return t('usErrInvalidDestination')
    case 'my_folder_locked':
      return t('usErrMyFolderLocked')
    case 'first_save_flush_failed':
      return t('usErrFlushFailed')
    case 'first_save_bind_failed':
      return t('usErrBindFailed', named)
    case 'first_save_orphaned':
      return t('usErrOrphaned', named)
    case 'conflict':
      return t('usErrAlreadyBound')
    case 'not_found':
      return t('usErrNotFound')
    case 'too_large':
      // SIZE-F1: the same refusal an upload shows, with the name and the limit
      return failure.name && typeof failure.sizeBytes === 'number'
        ? uploadTooLargeTextOf(
            {
              name: failure.name,
              sizeBytes: failure.sizeBytes,
              maxBytes: failure.maxBytes ?? DEFAULT_MAX_DOCUMENT_BYTES,
            },
            t,
            dateLocale,
          )
        : t(UNIWORK_ERROR_KEYS.too_large)
    case 'folder_name_taken':
    case 'move_name_taken':
    case 'upload_cancelled':
      return t('uwDocActionFailed')
    default: {
      const key: StringKey | undefined = UNIWORK_ERROR_KEYS[failure.error]
      return key ? t(key) : t('uwDocActionFailed')
    }
  }
}

/**
 * SAVE-01 §4: the SaveDialog of a tab's first Save to UniWork (board
 * SaveDialog.dc.html). State 1 "Đặt tên tài liệu" asks the name only, with
 * the extension fixed, and shows where it goes (My Folder by default, private
 * to the person); "Đổi" opens State 2 "Chọn nơi lưu", the FD-11 picker with
 * its save parts. My Folder is ensured when the dialog opens (Q3) and its id
 * marks the current row. Close / Esc cancel and send nothing; Lưu sends one
 * `uniworkFirstSave` and the tab is bound when it answers ok. A sent save
 * cannot be cancelled: while it runs close / Esc / backdrop do nothing, and its
 * result reaches the person even if the dialog goes away (FE-S01-R1-1).
 */
export function SaveDialog({
  path,
  onClose,
  initialFailure = null,
  onHold,
}: {
  path: string
  onClose: () => void
  /** a result kept while no dialog could show it */
  initialFailure?: SaveFailure | null
  /** whether the dialog must not be replaced: a save runs, or its result is on screen */
  onHold?: (hold: boolean) => void
}) {
  const { t, dateLocale } = useI18n()
  const id = useId()
  const [{ base, ext }] = useState(() => nameParts(path))
  const [step, setStep] = useState<'name' | 'pick'>('name')
  const [name, setName] = useState(base)
  const [target, setTarget] = useState<ShownTarget>({ kind: 'my_folder' })
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<SaveFailure | null>(null)
  const [resolveAttempt, setResolveAttempt] = useState(0)
  const [myFolderId, setMyFolderId] = useState<string | null>(null)
  // a save this tab already sent (from a dialog that went away) is still running
  const [saving, setSaving] = useState(() => running.has(pathKey(path)))
  // Lưu pressed before the workspace is known: it is sent once it resolves (FE-S01-R1-2)
  const [queued, setQueued] = useState(false)
  const busy = saving || queued
  const [failure, setFailure] = useState<SaveFailure | null>(initialFailure)
  const [nodes, setNodes] = useState<UniworkFolderNode[] | null>(null)
  const [revealIn, setRevealIn] = useState<string | null | undefined>(undefined)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const nameRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const treeRequest = useRef<Promise<UniworkResult<UniworkFolderNode[]>> | null>(null)

  const settle = (result: FirstSaveResult) => {
    if (!mounted.current) return
    setSaving(false)
    if (result.ok) onClose()
    else setFailure(result)
  }

  useEffect(() => {
    mounted.current = true
    const unwatch = watchTab(pathKey(path))
    let live = true
    const run = running.get(pathKey(path))
    if (run) void run.then((result) => live && settle(result))
    else {
      // FE-S01-R2-2: the run settled between the first render and this effect
      setSaving(false)
      const kept = takeKept(path)
      if (kept) setFailure(kept)
    }
    return () => {
      live = false
      mounted.current = false
      unwatch()
    }
    // the tab is fixed for the dialog's life; a reopened dialog joins its tab's run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    onHold?.(busy || failure !== null)
  }, [busy, failure, onHold])

  // the workspace the document is created in (the Workbench's own pick), then My Folder (Q3);
  // read again when Lưu is pressed after the read failed
  useEffect(() => {
    let live = true
    const stored = readActiveWorkspaceId()
    const resolved: Promise<UniworkResult<string>> = stored
      ? Promise.resolve({ ok: true, value: stored })
      : window.aiOffice
          .uniworkListWorkspaces()
          .catch((): UniworkResult<never> => ({ ok: false, error: 'network' }))
          .then((result) => {
            if (!result.ok) return result
            const picked = pickActiveWorkspace(result.value, null)
            return picked ? { ok: true, value: picked } : { ok: false, error: 'not_found' }
          })
    void resolved.then((result) => {
      if (!live) return
      if (!result.ok) {
        setWorkspaceError({ ok: false, error: result.error })
        return
      }
      setWorkspaceId(result.value)
      void window.aiOffice
        .uniworkEnsureMyFolder(result.value)
        .catch((): UniworkResult<never> => ({ ok: false, error: 'network' }))
        .then((ensured) => {
          // a failed ensure does not block: the server ensures My Folder on create too
          if (live && ensured.ok) setMyFolderId(ensured.value.id)
        })
    })
    return () => {
      live = false
    }
  }, [resolveAttempt])

  /** one tree read shared by the picker's own load and the dialog's refreshes */
  const loadTree = useCallback((ws: string) => {
    if (!treeRequest.current) {
      const request = loadFolderTree(ws).catch((): UniworkResult<UniworkFolderNode[]> => ({
        ok: false,
        error: 'network',
      }))
      treeRequest.current = request
      void request.then((result) => {
        if (treeRequest.current === request) treeRequest.current = null
        if (mounted.current && result.ok) setNodes(result.value)
      })
    }
    return treeRequest.current
  }, [])

  const refreshTree = useCallback(() => {
    if (!workspaceId) return
    treeRequest.current = null
    void loadTree(workspaceId)
  }, [workspaceId, loadTree])

  useEffect(() => {
    if (!workspaceId || nodes === null) return
    return onTreeChanged((event) => {
      if (event.workspaceId === workspaceId) refreshTree()
    })
  }, [workspaceId, nodes === null, refreshTree]) // eslint-disable-line react-hooks/exhaustive-deps

  const actions = useFolderActions({
    workspaceId: workspaceId ?? '',
    onChanged: refreshTree,
    onCreated: setRevealIn,
    notify: (message, tone) => setToast({ message, tone }),
  })

  const mineId = myFolderId ?? (nodes ? myFolderIdOf(nodes) : null)

  /** the title to send, or null once the field says why the name cannot be sent */
  const checkedTitle = (): string | null => {
    const checked = checkDocName(name)
    const title = checked.ok ? titleWithExt(checked.name, ext) : ''
    if (!checked.ok || isDocTitleTooLong(title)) {
      setFailure({ ok: false, error: checked.ok ? 'name_too_long' : checked.error })
      nameRef.current?.focus()
      return null
    }
    return title
  }

  const send = (ws: string) => {
    const title = checkedTitle()
    if (title === null) return
    const wire: UniworkFirstSaveTarget =
      target.kind === 'folder'
        ? { kind: 'folder', folderId: target.folderId }
        : { kind: 'my_folder' }
    setSaving(true)
    setFailure(null)
    void startFirstSave({ tabPath: path, title, workspaceId: ws, target: wire }, (refused) =>
      firstSaveErrorText(refused, t, dateLocale),
    ).then(settle)
  }

  const save = () => {
    if (busy || checkedTitle() === null) return
    if (workspaceId) {
      send(workspaceId)
      return
    }
    // FE-S01-R1-2: wait (busy) for the workspace; a failed read is read again
    setFailure(null)
    setQueued(true)
    if (workspaceError) {
      setWorkspaceError(null)
      setResolveAttempt((n) => n + 1)
    }
  }

  useEffect(() => {
    if (!queued) return
    if (workspaceId) {
      setQueued(false)
      send(workspaceId)
    } else if (workspaceError) {
      setQueued(false)
      setFailure(workspaceError)
    }
  }, [queued, workspaceId, workspaceError]) // eslint-disable-line react-hooks/exhaustive-deps

  // a sent save cannot be cancelled: close / Esc / backdrop wait for its answer
  const cancel = () => {
    if (!saving) onClose()
  }

  const onPick = (picked: PickedFolder) => {
    setStep('name')
    if (picked.folderId === null) return
    // My Folder goes as its own destination, never as a folder id
    setTarget(
      picked.folderId === mineId
        ? { kind: 'my_folder' }
        : { kind: 'folder', folderId: picked.folderId, path: picked.path },
    )
  }

  if (step === 'pick' && workspaceId) {
    const nameDialog = actions.nameDialog
    return (
      <>
        <UniworkFolderPicker
          className="uws-pick"
          title={t('usPickTitle')}
          confirmLabel={t('ufChoose')}
          confirmLabelFor={(folder) => t('usChooseFolder', { folder })}
          workspaceId={workspaceId}
          loadTree={loadTree}
          nodes={nodes ?? undefined}
          initialFolderId={target.kind === 'folder' ? target.folderId : mineId}
          rootBlocked
          onBack={() => setStep('name')}
          backLabel={t('usBack')}
          onCancel={() => setStep('name')}
          headerAction={(chosenId) => (
            <button
              type="button"
              className="btn btn-secondary uwf-picker-new"
              onClick={() => actions.openCreate(chosenId, chosenId !== null)}
            >
              {t('ufNewFolder')}
            </button>
          )}
          searchLabel={t('usSearchFolders')}
          note={t('usSharedNote')}
          tagOf={(row) => {
            const key = folderVisibilityTagOf(row)
            return key ? t(key) : null
          }}
          checkLabel={t('usSelected')}
          revealChildrenOf={revealIn}
          onPick={onPick}
        />
        {nameDialog?.mode === 'create' && (
          <FolderNameDialog
            title={nameDialog.sub ? t('ufNewSubfolder') : t('ufNewFolder')}
            submitLabel={t('ufCreate')}
            onSubmit={actions.submitName}
            onCancel={actions.closeNameDialog}
          />
        )}
        {toast && <ActionToast message={toast.message} tone={toast.tone} onDone={clearToast} />}
      </>
    )
  }

  const folderLabel =
    target.kind === 'folder'
      ? (target.path[target.path.length - 1]?.title ?? '')
      : t(MY_FOLDER_LABEL_KEY)
  const sub =
    target.kind === 'folder'
      ? [t('ufRoot'), ...target.path.map((p) => p.title)].join(' › ')
      : t('usMyFolderPrivate')
  const errorText = failure ? firstSaveErrorText(failure, t, dateLocale) : ''

  return (
    <ActionModal
      labelledBy={`${id}-title`}
      className="uws-dialog"
      onCancel={cancel}
      initialFocus=".uws-name-input"
    >
      <div className="uws-head">
        <FileBadge ext={ext.slice(1).toLowerCase()} size={32} />
        <h3 id={`${id}-title`} className="uw-act-heading">
          {t('usDialogTitle')}
        </h3>
        <button
          type="button"
          className="uws-close"
          aria-label={t('usClose')}
          aria-disabled={saving || undefined}
          onClick={cancel}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <p className="uws-hint">{t('usHint')}</p>
      <form
        className="uw-act-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className="uw-act-field">
          <label className="uw-act-label" htmlFor={`${id}-name`}>
            {t('usName')}
          </label>
          <div className="uws-name-box">
            <input
              id={`${id}-name`}
              ref={nameRef}
              className="uw-act-input uws-name-input"
              type="text"
              value={name}
              required
              aria-required="true"
              aria-invalid={failure !== null}
              aria-describedby={`${id}-error`}
              spellCheck={false}
              readOnly={busy}
              onChange={(e) => {
                setName(e.target.value)
                if (failure) setFailure(null)
              }}
            />
            {ext && <span className="uws-ext">{ext}</span>}
          </div>
        </div>
        <div className="uw-act-field">
          <span className="uw-act-label" id={`${id}-loc`}>
            {t('usLocation')}
          </span>
          <button
            type="button"
            className="uws-loc"
            aria-labelledby={`${id}-loc ${id}-loc-value`}
            aria-haspopup="dialog"
            aria-disabled={busy || !workspaceId || undefined}
            onClick={() => {
              if (!busy && workspaceId) setStep('pick')
            }}
          >
            <span className="uws-loc-icon" aria-hidden="true">
              {target.kind === 'my_folder' ? <MyFolderGlyph /> : <FolderGlyph />}
            </span>
            <span className="uws-loc-text">
              <span className="uws-loc-value" id={`${id}-loc-value`}>
                {t('usSavingIn', { folder: folderLabel })}
              </span>
              <span className="uws-loc-sub">{sub}</span>
            </span>
            <span className="uws-loc-change">{t('usChange')}</span>
            <svg
              className="uws-loc-chev"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
        <p className="uw-act-error" id={`${id}-error`} role={failure ? 'alert' : undefined}>
          {errorText}
        </p>
        <div className="modal-buttons">
          <button
            type="submit"
            className="btn btn-primary uws-save"
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
          >
            {busy && <Spinner />}
            {t('usSave')}
          </button>
        </div>
      </form>
    </ActionModal>
  )
}

/** whether one of the window's tabs shows `path` (a push for any other path is dropped) */
async function isOpenTab(path: string): Promise<boolean> {
  try {
    const tabs = await window.aiOfficeTabs.list()
    const key = pathKey(path)
    return tabs.some((tab) => tab.filePath !== undefined && pathKey(tab.filePath) === key)
  } catch {
    return false
  }
}

/**
 * SAVE-01 / S01-R1-6: listens for main's first-save-open push. Every push is
 * acknowledged at once, before anything that can fail or wait, so File > Save
 * knows the renderer heard it; then the dialog opens for the push's tab. A
 * push for a path no tab shows is dropped. A push for another tab never
 * replaces a dialog whose save runs or whose result is on screen: it is held
 * and opens when that dialog closes (FE-S01-R1-1). A result kept while the
 * host was away opens with its dialog when the host renders again. A held push
 * or a kept result is checked against the open tabs again before it opens; a
 * closed tab's entry is dropped (a kept result was already said through the
 * live region when it was kept) (FE-S01-R2-4). Signing out clears the kept
 * results (FE-S01-R2-3).
 */
export function SaveDialogHost() {
  type Request = { path: string; key: number; failure?: SaveFailure }
  const [request, setRequest] = useState<Request | null>(null)
  const shown = useRef<Request | null>(null)
  const held = useRef<Request[]>([])
  const holding = useRef(false)
  const seq = useRef(0)
  const kept = useSyncExternalStore(onUnshown, () => unshown)
  // a held push or kept result is being checked against the open tabs
  const [checking, setChecking] = useState(false)

  const show = useCallback((next: Omit<Request, 'key'>) => {
    const same = (r: Request) => pathKey(r.path) === pathKey(next.path)
    const current = shown.current
    // a repeated File > Save for the same tab keeps the dialog (and the typed name)
    if (current && same(current)) return
    const keyed = { ...next, key: ++seq.current }
    if (current && holding.current) {
      if (!held.current.some(same)) held.current.push(keyed)
      return
    }
    shown.current = keyed
    holding.current = false
    setRequest(keyed)
  }, [])

  const close = useCallback(() => {
    shown.current = null
    holding.current = false
    setRequest(null)
  }, [])

  const hold = useCallback((on: boolean) => {
    holding.current = on
  }, [])

  useEffect(() => {
    // a bridge without the SAVE-01 push (a stale preload) simply never opens the dialog
    if (typeof window.aiOffice?.onUniworkFirstSaveOpen !== 'function') return
    let n = 0
    return window.aiOffice.onUniworkFirstSaveOpen(({ path }) => {
      if (typeof path !== 'string' || !path) return
      try {
        void window.aiOffice.uniworkFirstSaveOpenAck(path).catch(() => undefined)
      } catch {
        // a missing bridge method must not keep the dialog from opening
      }
      const ticket = ++n
      void isOpenTab(path).then((open) => {
        if (open && ticket === n) show({ path })
      })
    })
  }, [show])

  useEffect(() => {
    if (typeof window.aiOffice?.onAccountStatus !== 'function') return
    return window.aiOffice.onAccountStatus((status) => {
      if (stateOf(status) === 'signed-out') setUnshown([])
    })
  }, [])

  // with no dialog: the next held push, else a result no dialog was left to
  // show (shown once, in its tab's dialog), each only while its tab is open
  useEffect(() => {
    if (request || checking) return
    let next: Omit<Request, 'key'> | undefined = held.current.shift()
    if (!next) {
      const [first, ...rest] = ownKept()
      if (!first) return
      setUnshown(rest)
      next = { path: first.path, failure: first.failure }
    }
    const entry = next
    setChecking(true)
    void isOpenTab(entry.path).then((open) => {
      setChecking(false)
      if (!open) return
      const current = shown.current
      // a push opened meanwhile: the entry waits behind it like any held push
      if (current && pathKey(current.path) !== pathKey(entry.path)) {
        held.current.unshift({ ...entry, key: ++seq.current })
      } else show(entry)
    })
  }, [request, checking, kept, show])

  if (!request) return null
  return (
    <SaveDialog
      key={request.key}
      path={request.path}
      initialFailure={request.failure}
      onClose={close}
      onHold={hold}
    />
  )
}
