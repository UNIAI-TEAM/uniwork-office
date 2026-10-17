import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type {
  UniworkDocActionResult,
  UniworkDocSummary,
  UniworkFirstSaveTarget,
  UniworkFolderNode,
  UniworkResult,
} from '../../../shared/home-api'
import { DEFAULT_MAX_DOCUMENT_BYTES } from '../../../shared/size-format'
import { pathKey } from '../../../shared/path-key'
import { FileBadge } from '../FileBadge'
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
import { FolderNameDialog } from './FolderNameDialog'
import { UniworkFolderPicker, type PickedFolder } from './UniworkFolderPicker'
import { FolderGlyph } from './UniworkFolderTree'
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

type SaveFailure = Extract<UniworkDocActionResult<UniworkDocSummary>, { ok: false }>

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
 * `uniworkFirstSave` and the tab is bound when it answers ok.
 */
export function SaveDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const { t, dateLocale } = useI18n()
  const id = useId()
  const [{ base, ext }] = useState(() => nameParts(path))
  const [step, setStep] = useState<'name' | 'pick'>('name')
  const [name, setName] = useState(base)
  const [target, setTarget] = useState<ShownTarget>({ kind: 'my_folder' })
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<SaveFailure | null>(null)
  const [myFolderId, setMyFolderId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [nodes, setNodes] = useState<UniworkFolderNode[] | null>(null)
  const [revealIn, setRevealIn] = useState<string | null | undefined>(undefined)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const nameRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const treeRequest = useRef<Promise<UniworkResult<UniworkFolderNode[]>> | null>(null)

  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  // the workspace the document is created in (the Workbench's own pick), then My Folder (Q3)
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
  }, [])

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

  const save = () => {
    if (busy) return
    const checked = checkDocName(name)
    const title = checked.ok ? titleWithExt(checked.name, ext) : ''
    if (!checked.ok || isDocTitleTooLong(title)) {
      setFailure({ ok: false, error: checked.ok ? 'name_too_long' : checked.error })
      nameRef.current?.focus()
      return
    }
    if (!workspaceId) {
      if (workspaceError) setFailure(workspaceError)
      return
    }
    const wire: UniworkFirstSaveTarget =
      target.kind === 'folder'
        ? { kind: 'folder', folderId: target.folderId }
        : { kind: 'my_folder' }
    setBusy(true)
    setFailure(null)
    void window.aiOffice
      .uniworkFirstSave({ tabPath: path, title, workspaceId, target: wire })
      .catch((): UniworkDocActionResult<UniworkDocSummary> => ({ ok: false, error: 'network' }))
      .then((result) => {
        if (!mounted.current) return
        setBusy(false)
        if (result.ok) onClose()
        else setFailure(result)
      })
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
      onCancel={onClose}
      initialFocus=".uws-name-input"
    >
      <div className="uws-head">
        <FileBadge ext={ext.slice(1).toLowerCase()} size={32} />
        <h3 id={`${id}-title`} className="uw-act-heading">
          {t('usDialogTitle')}
        </h3>
        <button type="button" className="uws-close" aria-label={t('usClose')} onClick={onClose}>
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
              <FolderGlyph />
            </span>
            <span className="uws-loc-text">
              <span className="uws-loc-value" id={`${id}-loc-value`}>
                {t('usSavingIn', { folder: folderLabel })}
              </span>
              <span className="uws-loc-sub">{sub}</span>
            </span>
            <span className="uws-loc-change">{t('usChange')}</span>
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
 * push for a path no tab shows is dropped.
 */
export function SaveDialogHost() {
  const [request, setRequest] = useState<{ path: string; n: number } | null>(null)

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
        if (!open || ticket !== n) return
        // a repeated File > Save for the same tab keeps the dialog (and the typed name)
        setRequest((prev) =>
          prev && pathKey(prev.path) === pathKey(path) ? prev : { path, n: ticket },
        )
      })
    })
  }, [])

  if (!request) return null
  return <SaveDialog key={request.n} path={request.path} onClose={() => setRequest(null)} />
}
