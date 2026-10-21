import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { UniworkFirstSaveNameRequest, UniworkFolderNode } from '../../../shared/home-api'
import { FileBadge } from '../FileBadge'
import { useI18n, type StringKey } from '../locale'
import { ActionModal } from '../UniworkDocActions'
import {
  DOC_NAME_ERROR_KEYS,
  UNIWORK_ERROR_KEYS,
  checkDocName,
  isDocTitleTooLong,
} from '../uniwork-docs-model'
import { loadFolderTree, moveDocument, renameDocument } from '../uniwork-library-api'
import { FirstSaveShare } from './FirstSaveShare'
import { nameParts } from './SaveDialog'
import { UniworkFolderPicker, type PickedFolder } from './UniworkFolderPicker'
import { shareFailureKey, shareWithWorkspace, useFirstSaveShareState } from './first-save-share'
import { FolderGlyph, MyFolderGlyph } from './UniworkFolderTree'
import {
  MY_FOLDER_LABEL_KEY,
  buildFolderIndex,
  folderPath,
  myFolderIdOf,
  withMyFolderLabel,
  type PathPart,
} from './uniwork-folders-model'
import './uniwork-folders.css'
import './save-dialog.css'
import './first-save-name.css'

type Verdict = 'continue' | 'cancel'

/** the name plus the fixed extension, once */
function titleWithExt(name: string, ext: string): string {
  return ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? `${name}${ext}` : name
}

function errorKeyOf(error: string): StringKey {
  const byName = (DOC_NAME_ERROR_KEYS as Record<string, StringKey | undefined>)[error]
  const byCode = (UNIWORK_ERROR_KEYS as Record<string, StringKey | undefined>)[error]
  return byName ?? byCode ?? 'uwDocActionFailed'
}

/**
 * UNI-1959 part 4 (the web's UNI-1960): the first save of a document created
 * blank from the New menu asks "Name the document" and where it lives, before
 * the upload runs. Main holds the save until this answers: Save renames (when
 * the name changed), moves (when the folder changed) and answers `continue`;
 * Cancel / Esc answer `cancel`. A refused rename or move keeps the dialog with
 * its reason at the field and answers nothing, so nothing is half-saved; a
 * retry does not repeat a rename that already went through.
 */
function FirstSaveNameDialog({
  request,
  onAnswer,
}: {
  request: UniworkFirstSaveNameRequest
  onAnswer: (verdict: Verdict) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [{ base, ext }] = useState(() => nameParts(request.title))
  const [name, setName] = useState(base)
  const [nodes, setNodes] = useState<UniworkFolderNode[] | null>(null)
  // the folder the document sits in now, then the one picked (null path = not read yet)
  const [place, setPlace] = useState<{ id: string | null; path: PathPart[] | null }>({
    id: request.parentId,
    path: null,
  })
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<StringKey | null>(null)
  // what the server already holds: a retry after a refused move must not rename again
  const [savedTitle, setSavedTitle] = useState(request.title)
  const [savedParent, setSavedParent] = useState(request.parentId)
  // the web's first-save switch: shown for a document the person manages, locked when already shared
  const shareState = useFirstSaveShareState(request.documentId)
  const [shareOn, setShareOn] = useState(false)
  // the workspace already holds the grant this dialog wrote: a retry after a refused move must not write it again
  const [shared, setShared] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    let live = true
    void loadFolderTree(request.workspaceId)
      .catch(() => ({ ok: false as const, error: 'network' as const }))
      .then((result) => {
        if (live && result.ok) setNodes(result.value)
      })
    return () => {
      live = false
      mounted.current = false
    }
  }, [request.workspaceId])

  const myFolderLabel = t(MY_FOLDER_LABEL_KEY)
  const labelled = useMemo(
    () => (nodes ? withMyFolderLabel(nodes, myFolderLabel) : null),
    [nodes, myFolderLabel],
  )
  const index = useMemo(() => buildFolderIndex(labelled ?? []), [labelled])
  const mineId = nodes ? myFolderIdOf(nodes) : null
  const path = place.path ?? (labelled ? folderPath(index, place.id) : null)
  const placeText = path ? path.map((part) => part.title).join(' › ') : '…'
  const inMyFolder = place.id !== null && place.id === mineId

  const cancel = () => {
    if (!busy) onAnswer('cancel')
  }

  const save = async () => {
    if (busy) return
    const checked = checkDocName(name)
    const title = checked.ok ? titleWithExt(checked.name, ext) : ''
    if (!checked.ok || isDocTitleTooLong(title)) {
      setErrorKey(DOC_NAME_ERROR_KEYS[checked.ok ? 'name_too_long' : checked.error])
      nameRef.current?.focus()
      return
    }
    setBusy(true)
    setErrorKey(null)
    try {
      if (title !== savedTitle) {
        const renamed = await renameDocument(request.documentId, title)
        if (!mounted.current) return
        if (!renamed.ok) {
          setErrorKey(errorKeyOf(renamed.error))
          nameRef.current?.focus()
          return
        }
        setSavedTitle(title)
      }
      if (shareState && !shareState.alreadyShared && shareOn && !shared) {
        const result = await shareWithWorkspace(request.workspaceId, request.documentId)
        if (!mounted.current) return
        if (!result.ok) {
          // like a refused move: the dialog stays and the save does not continue
          setErrorKey(shareFailureKey(result.error))
          return
        }
        setShared(true)
      }
      if (place.id !== savedParent) {
        const moved = await moveDocument({ documentId: request.documentId, parentId: place.id })
        if (!mounted.current) return
        if (!moved.ok) {
          setErrorKey(errorKeyOf(moved.error))
          return
        }
        setSavedParent(place.id)
      }
      onAnswer('continue')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  if (picking) {
    return (
      <UniworkFolderPicker
        className="uws-pick"
        title={t('usPickTitle')}
        confirmLabel={t('ufChoose')}
        confirmLabelFor={(folder) => t('usChooseFolder', { folder })}
        workspaceId={request.workspaceId}
        loadTree={loadFolderTree}
        nodes={nodes ?? undefined}
        initialFolderId={place.id}
        rootBlocked
        onBack={() => setPicking(false)}
        backLabel={t('usBack')}
        onCancel={() => setPicking(false)}
        checkLabel={t('usSelected')}
        onPick={(picked: PickedFolder) => {
          setPicking(false)
          if (picked.folderId === null) return
          setPlace({ id: picked.folderId, path: picked.path })
        }}
      />
    )
  }

  return (
    <ActionModal
      labelledBy={`${id}-title`}
      className="uws-dialog ufs-dialog"
      onCancel={cancel}
      initialFocus=".uws-name-input"
    >
      <div className="uws-head">
        <FileBadge ext={ext.slice(1).toLowerCase()} size={32} />
        <h3 id={`${id}-title`} className="uw-act-heading">
          {t('usFirstTitle')}
        </h3>
      </div>
      <form
        className="uw-act-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
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
              aria-invalid={errorKey !== null}
              aria-describedby={`${id}-error`}
              spellCheck={false}
              readOnly={busy}
              onChange={(e) => {
                setName(e.target.value)
                if (errorKey) setErrorKey(null)
              }}
            />
            {ext && <span className="uws-ext">{ext}</span>}
          </div>
        </div>
        <div className="ufs-loc">
          <span className="ufs-loc-icon" aria-hidden="true">
            {inMyFolder ? <MyFolderGlyph /> : <FolderGlyph />}
          </span>
          <span className="ufs-loc-text">
            <span className="ufs-loc-label">{t('ufLocation')}</span>
            <span className="ufs-loc-value">{placeText}</span>
          </span>
          <button
            type="button"
            className="btn btn-secondary ufs-change"
            aria-haspopup="dialog"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) setPicking(true)
            }}
          >
            {t('usChange')}
          </button>
        </div>
        <p className="ufs-hint">{t('usFirstHint')}</p>
        {shareState && (
          <FirstSaveShare
            checked={shareOn || shared}
            alreadyShared={shareState.alreadyShared}
            disabled={busy}
            onChange={setShareOn}
          />
        )}
        <p className="uw-act-error" id={`${id}-error`} role={errorKey ? 'alert' : undefined}>
          {errorKey ? t(errorKey) : ''}
        </p>
        <div className="modal-buttons">
          <button
            type="button"
            className="btn btn-secondary ufs-cancel"
            aria-disabled={busy || undefined}
            onClick={cancel}
          >
            {t('cancel')}
          </button>
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

/**
 * Listens for main's "Name the document" push and shows one dialog per ask, in
 * order. Every ask is answered exactly once with its own id: by the dialog's
 * verdict, or `cancel` when this host goes away with it still open or queued (a
 * shell reload or remount - main would otherwise hold the Save forever). Each
 * push is acknowledged on receipt so main knows a host is listening, and a
 * dismiss from main (its tab closed, its session ended) drops the ask without
 * an answer - main has already settled it.
 */
export function FirstSaveNameHost() {
  const [queue, setQueue] = useState<UniworkFirstSaveNameRequest[]>([])
  // the asks not yet answered or dismissed
  const open = useRef(new Set<string>())

  const answer = useCallback((requestId: string, verdict: 'continue' | 'cancel') => {
    if (!open.current.delete(requestId)) return
    void Promise.resolve(
      window.aiOffice.uniworkFirstSaveNameAnswer({ requestId, answer: verdict }),
    ).catch(() => undefined)
  }, [])

  useEffect(() => {
    // a bridge without the push (a stale preload) simply never opens the dialog
    if (typeof window.aiOffice?.onUniworkFirstSaveName !== 'function') return
    const offAsk = window.aiOffice.onUniworkFirstSaveName((request) => {
      if (open.current.has(request.requestId)) return
      open.current.add(request.requestId)
      setQueue((prev) => [...prev, request])
      void Promise.resolve(
        window.aiOffice.uniworkFirstSaveNameAnswer({
          requestId: request.requestId,
          answer: 'shown',
        }),
      ).catch(() => undefined)
    })
    const offDismiss =
      typeof window.aiOffice.onUniworkFirstSaveNameDismiss === 'function'
        ? window.aiOffice.onUniworkFirstSaveNameDismiss((requestId) => {
            open.current.delete(requestId)
            setQueue((prev) => prev.filter((r) => r.requestId !== requestId))
          })
        : undefined
    const pending = open.current
    return () => {
      offAsk()
      offDismiss?.()
      for (const requestId of [...pending]) answer(requestId, 'cancel')
    }
  }, [answer])

  const current = queue[0]
  if (!current) return null
  return (
    <FirstSaveNameDialog
      key={current.requestId}
      request={current}
      onAnswer={(verdict) => {
        setQueue((prev) => prev.filter((r) => r.requestId !== current.requestId))
        answer(current.requestId, verdict)
      }}
    />
  )
}
