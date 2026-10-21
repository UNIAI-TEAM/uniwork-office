import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { UniworkFolderNode, UniworkResult, UniworkWorkspaceRef } from '../../shared/home-api'
import { useI18n, type StringKey } from './locale'
import {
  DOC_NAME_ERROR_KEYS,
  UNIWORK_ERROR_KEYS,
  checkDocName,
  isDocTitleTooLong,
  nameWithExtension,
  uploadTooLargeTextOf,
  workspaceLabel,
  type DocNameError,
  type NewDocKind,
  type RowActions,
} from './uniwork-docs-model'
import { FileBadge } from './FileBadge'
import { placeMenu } from './menu-placement'
import { UniworkFolderPicker } from './uniwork-folders/UniworkFolderPicker'
import { getArchiveImpact } from './uniwork-library-api'
import { MY_FOLDER_LABEL_KEY, type PathPart } from './uniwork-folders/uniwork-folders-model'

/**
 * S18 pieces of the UniWork library: the New document / Upload dialog, the
 * row "…" menu and the one-step archive confirmation. They know nothing about
 * the bridge: the library dialog passes the calls in (uniwork-library-api.ts).
 */

const FOCUSABLE =
  'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]'

/** where a new or uploaded document goes */
export interface DocTarget {
  workspaceId: string
  /** null = the workspace's top level */
  folderId: string | null
  /** FD-11: the folder's root-first path, for the Location button's label (never sent) */
  folderPath?: PathPart[]
}

/** FD-11: reads a workspace's folder tree for the Location picker */
export type LoadFolderTree = (workspaceId: string) => Promise<UniworkResult<UniworkFolderNode[]>>

/** errors a dialog field shows in place; every other failure is a toast */
export type DocFieldError =
  | DocNameError
  | 'unsupported_format'
  | 'too_large'
  | { kind: 'too_large'; name: string; sizeBytes: number; maxBytes: number }

/** what an action answers: done, a field error shown in place, or anything else (toast) */
export type ActionOutcome = { ok: true } | { ok: false; error: DocFieldError | 'failed' }

/** an upload under way: bytes sent of the total (total 0 = not known yet) */
export interface UploadProgress {
  name: string
  loaded: number
  total: number
  /** BIGUP-A1: 'checking' while the server verifies a chunked upload; absent = uploading */
  phase?: 'uploading' | 'checking'
}

/**
 * Modal shell per the fork's dialog pattern: Tab stays inside, Escape cancels,
 * focus goes back to whatever opened it. Keys never reach the library dialog
 * underneath (it would close on the same Escape).
 */
export function ActionModal({
  labelledBy,
  describedBy,
  className,
  onCancel,
  initialFocus,
  restoreFocus = true,
  children,
}: {
  labelledBy: string
  /** the id of the modal's body sentence, when it has one */
  describedBy?: string
  className?: string
  onCancel: () => void
  initialFocus?: string
  restoreFocus?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first =
      (initialFocus && ref.current?.querySelector<HTMLElement>(initialFocus)) ||
      ref.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    return () => {
      if (!restoreFocus) return
      // the opener may have been re-rendered away: then the library keeps focus
      if (opener?.isConnected) opener.focus()
    }
    // focus moves once, when the modal opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }
    if (event.key === 'Tab') {
      event.stopPropagation()
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      if (nodes.length === 0) return
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
      return
    }
    // arrows, Enter, Home/End belong to this modal's own controls
    event.stopPropagation()
  }

  return (
    <div
      className="modal-overlay uw-act-overlay"
      onClick={(e) => {
        e.stopPropagation()
        onCancel()
      }}
    >
      <div
        className={`modal uw-act${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  )
}

/** the label of each kind the New document dialog and the Quick create strip offer (the web's names); Plain text is in neither (New menu only), so its entry is the New menu's label and only satisfies the Record type */
export const NEW_KIND_LABEL_KEY: Record<NewDocKind, StringKey> = {
  page: 'uhQuickPage',
  docx: 'uhQuickDocx',
  xlsx: 'uhQuickXlsx',
  pptx: 'uhQuickPptx',
  md: 'uhQuickMd',
  txt: 'uhNewMenuTxt',
  html: 'uhQuickHtml',
  pdf: 'uhQuickPdf',
}

/**
 * The location fields shared by New document and Upload (FD-11 S4): the
 * workspace select, then a "Location" button that shows the chosen path and
 * opens the folder picker (folders deeper than the server allows are listed
 * disabled with their reason).
 */
export function LocationFields({
  workspaces,
  target,
  loadTree,
  locked,
  onChange,
}: {
  workspaces: UniworkWorkspaceRef[]
  target: DocTarget
  loadTree: LoadFolderTree
  /** an upload is under way: the place it goes to cannot change any more */
  locked?: boolean
  onChange: (target: DocTarget) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [picking, setPicking] = useState(false)
  const path = target.folderId ? (target.folderPath ?? []) : []
  const label =
    path.length > 0
      ? [t('ufRoot'), ...path.map((p) => p.title)].join(' › ')
      : t(MY_FOLDER_LABEL_KEY)
  return (
    <fieldset className="uw-act-field uw-act-location">
      <legend className="uw-act-label">{t('ufLocation')}</legend>
      <div className="uw-act-location-row">
        {workspaces.length > 0 && (
          <select
            className="uw-act-select"
            id={`${id}-ws`}
            aria-label={t('uwPickWorkspace')}
            value={target.workspaceId}
            disabled={locked}
            onChange={(e) => onChange({ workspaceId: e.target.value, folderId: null })}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {workspaceLabel(w, t)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="uwf-location-btn"
          title={label}
          aria-label={`${t('ufLocation')}: ${label}`}
          aria-haspopup="dialog"
          aria-disabled={locked || undefined}
          onClick={() => {
            if (!locked) setPicking(true)
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M1.75 4.25c0-.69.56-1.25 1.25-1.25h3l1.5 1.5h5.5c.69 0 1.25.56 1.25 1.25v6c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25z"
              fill="currentColor"
            />
          </svg>
          <span className="uwf-location-path">{label}</span>
        </button>
      </div>
      {picking && (
        <UniworkFolderPicker
          title={t('ufChooseLocation')}
          confirmLabel={t('ufChoose')}
          workspaceId={target.workspaceId}
          loadTree={loadTree}
          rootBlocked
          initialFolderId={target.folderId}
          onPick={(picked) => {
            setPicking(false)
            onChange({
              workspaceId: target.workspaceId,
              folderId: picked.folderId,
              folderPath: picked.path,
            })
          }}
          onCancel={() => setPicking(false)}
        />
      )}
    </fieldset>
  )
}

export function FieldError({
  id,
  error,
  keys = DOC_NAME_ERROR_KEYS,
}: {
  id: string
  error: DocFieldError | null
  /** the copy per error (a folder name has its own 255 wording) */
  keys?: Record<DocNameError, StringKey>
}) {
  const { t, dateLocale } = useI18n()
  let text = ''
  if (typeof error === 'string') {
    text =
      error === 'unsupported_format'
        ? t(UNIWORK_ERROR_KEYS.unsupported_format)
        : error === 'too_large'
          ? t(UNIWORK_ERROR_KEYS.too_large)
          : t(keys[error])
  } else if (error) {
    // a refusal that names the file and the limit (SIZE-F1 §6.2)
    text = uploadTooLargeTextOf(error, t, dateLocale)
  }
  // always in the DOM so aria-describedby points at something stable
  return (
    <p className="uw-act-error" id={id} role={error ? 'alert' : undefined}>
      {text}
    </p>
  )
}

/**
 * New document: name (required), type, location. On success the library opens
 * the new document by its id; nothing is copied locally first.
 */
export function NewDocDialog<K extends NewDocKind>({
  workspaces,
  initialTarget,
  kinds,
  initialKind,
  loadTree,
  onCreate,
  onCancel,
}: {
  workspaces: UniworkWorkspaceRef[]
  initialTarget: DocTarget
  /** the kinds the Type row offers, in order (UniNote is a page, not a file format) */
  kinds: readonly K[]
  /** the kind selected on open; the first one when absent */
  initialKind?: K
  loadTree: LoadFolderTree
  onCreate: (input: DocTarget & { name: string; format: K }) => Promise<ActionOutcome>
  onCancel: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [name, setName] = useState('')
  const [format, setFormat] = useState<K>(initialKind ?? kinds[0]!)
  const [target, setTarget] = useState(initialTarget)
  const [error, setError] = useState<DocFieldError | null>(null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (busy) return
    const checked = checkDocName(name)
    if (!checked.ok) {
      setError(checked.error)
      nameRef.current?.focus()
      return
    }
    // the server keeps the extension in the title: the name as sent is what the limit counts
    const sent = nameWithExtension(checked.name, format)
    if (isDocTitleTooLong(sent)) {
      setError('name_too_long')
      nameRef.current?.focus()
      return
    }
    setBusy(true)
    void onCreate({
      workspaceId: target.workspaceId,
      folderId: target.folderId,
      name: sent,
      format,
    }).then((outcome) => {
      setBusy(false)
      if (outcome.ok || outcome.error === 'failed') return
      setError(outcome.error)
      nameRef.current?.focus()
    })
  }

  return (
    <ActionModal labelledBy={`${id}-title`} onCancel={onCancel}>
      <form
        className="uw-act-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <h3 id={`${id}-title`}>{t('uwDocNew')}</h3>
        <div className="uw-act-field">
          <label className="uw-act-label" htmlFor={`${id}-name`}>
            {t('uwDocName')}
          </label>
          <input
            id={`${id}-name`}
            ref={nameRef}
            className="uw-act-input"
            type="text"
            value={name}
            required
            aria-required="true"
            aria-invalid={error !== null}
            aria-describedby={`${id}-error`}
            spellCheck={false}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
          />
          <FieldError id={`${id}-error`} error={error} />
        </div>
        <fieldset className="uw-act-field">
          <legend className="uw-act-label">{t('uwDocType')}</legend>
          <div className="uw-act-types">
            {kinds.map((f) => (
              <label key={f} className={`uw-act-type${format === f ? ' on' : ''}`}>
                <input
                  type="radio"
                  name={`${id}-format`}
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                />
                <FileBadge ext={f} size={22} />
                <span>{t(NEW_KIND_LABEL_KEY[f])}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <LocationFields
          workspaces={workspaces}
          target={target}
          loadTree={loadTree}
          onChange={setTarget}
        />
        <div className="modal-buttons">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
          >
            {t('uwDocCreate')}
          </button>
        </div>
      </form>
    </ActionModal>
  )
}

/**
 * Upload: choose a file (main's file dialog), then where it goes. Progress
 * shows in the dialog while the bytes go up; a same-name clash shows at the
 * file row.
 */
export function UploadDocDialog({
  workspaces,
  initialTarget,
  loadTree,
  pickFile,
  onUpload,
  progress,
  onCancel,
}: {
  workspaces: UniworkWorkspaceRef[]
  initialTarget: DocTarget
  loadTree: LoadFolderTree
  pickFile: () => Promise<{ path: string; name: string } | null>
  onUpload: (input: DocTarget & { path: string; name: string }) => Promise<ActionOutcome>
  progress: UploadProgress | null
  onCancel: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [file, setFile] = useState<{ path: string; name: string } | null>(null)
  const [target, setTarget] = useState(initialTarget)
  const [error, setError] = useState<DocFieldError | null>(null)
  const [busy, setBusy] = useState(false)
  const pickRef = useRef<HTMLButtonElement>(null)

  const choose = () => {
    if (busy) return
    void pickFile()
      .then((picked) => {
        if (picked) {
          setFile(picked)
          setError(null)
        }
      })
      .catch(() => undefined)
  }

  const submit = () => {
    if (busy || !file) return
    setBusy(true)
    void onUpload({
      workspaceId: target.workspaceId,
      folderId: target.folderId,
      path: file.path,
      name: file.name,
    }).then((outcome) => {
      setBusy(false)
      if (outcome.ok || outcome.error === 'failed') return
      setError(outcome.error)
      pickRef.current?.focus()
    })
  }

  const checking = progress?.phase === 'checking'
  const percent =
    !checking && progress && progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null
  const progressLabel = checking
    ? t('uwUploadChecking')
    : t('uwDocUploading', { name: progress?.name ?? file?.name ?? '' })

  return (
    <ActionModal labelledBy={`${id}-title`} onCancel={onCancel}>
      <h3 id={`${id}-title`}>{t('uwDocUpload')}</h3>
      <div className="uw-act-field">
        <div className="uw-act-file">
          <button
            type="button"
            ref={pickRef}
            className="btn btn-secondary"
            aria-describedby={`${id}-error`}
            aria-invalid={error !== null || undefined}
            onClick={choose}
          >
            {t('uwDocUploadPick')}
          </button>
          {file && <span className="uw-act-file-name">{file.name}</span>}
        </div>
        <FieldError id={`${id}-error`} error={error} />
      </div>
      <LocationFields
        workspaces={workspaces}
        target={target}
        loadTree={loadTree}
        locked={busy}
        onChange={setTarget}
      />
      {busy && (
        <div className="uw-act-progress" role="status">
          <span>{progressLabel}</span>
          <progress
            className="uw-act-bar"
            max={100}
            value={percent ?? undefined}
            aria-label={progressLabel}
          />
        </div>
      )}
      <div className="modal-buttons">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={busy || !file || undefined}
          aria-busy={busy || undefined}
          onClick={submit}
        >
          {t('uwDocUpload')}
        </button>
      </div>
    </ActionModal>
  )
}

/**
 * One-step confirmation before a document is archived (it can be restored
 * later). Focus starts on Cancel: the safe answer, not the destructive one.
 *
 * UNI-2066: for a folder (`folderId`) the impact is read when the confirm opens; when it
 * hands other people's documents back to their owners, one sentence (never a number)
 * says so. The read is advisory: a failure, "too large" or 0 adds no sentence and the
 * confirm works as soon as the read settles.
 */
export function ArchiveConfirm({
  name,
  folderId,
  onConfirm,
  onCancel,
}: {
  name: string
  /** the folder being trashed: its impact is read for the relocated-documents sentence */
  folderId?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [impact, setImpact] = useState<'loading' | 'relocated' | 'none'>(
    folderId ? 'loading' : 'none',
  )
  useEffect(() => {
    if (!folderId) return
    let live = true
    setImpact('loading')
    void getArchiveImpact(folderId)
      .then((res) => {
        if (!live) return
        setImpact(
          res.ok && !res.value.tooLarge && res.value.relocatedCount > 0 ? 'relocated' : 'none',
        )
      })
      .catch(() => {
        if (live) setImpact('none')
      })
    return () => {
      live = false
    }
  }, [folderId])
  return (
    <ActionModal labelledBy={`${id}-title`} onCancel={onCancel} initialFocus=".btn-secondary">
      <h3 id={`${id}-title`} className="uw-act-heading">
        {t('uwDocArchive')} · {name}
      </h3>
      <p>{t('uwDocArchiveConfirm', { name })}</p>
      {impact === 'relocated' && <p>{t('ufTrashRelocated')}</p>}
      <div className="modal-buttons">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={impact === 'loading' || undefined}
          onClick={() => {
            if (impact !== 'loading') onConfirm()
          }}
        >
          {t('uwDocArchive')}
        </button>
      </div>
    </ActionModal>
  )
}

export type RowAction = keyof RowActions

// the callers of the popup placement import it from here
export { placeMenu }

/**
 * The row's "…" menu (menu button pattern): Enter/Space/ArrowDown opens it on
 * the first item, arrows move, Escape closes it and returns to the button.
 * Only the actions this person has are listed; there is no delete.
 */
export function RowMenu({
  docId,
  title,
  actions,
  tabbable,
  onAction,
}: {
  docId: string
  title: string
  actions: RowActions
  tabbable: boolean
  onAction: (action: RowAction) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const items: { action: RowAction; label: string }[] = []
  if (actions.rename) items.push({ action: 'rename', label: t('uwDocRename') })
  if (actions.archive) items.push({ action: 'archive', label: t('uwDocArchive') })
  if (actions.restore) items.push({ action: 'restore', label: t('uwDocRestore') })
  if (actions.offline)
    items.push({
      action: 'offline',
      label: t(actions.offline === 'pin' ? 'uwOfflinePin' : 'uwOfflineUnpin'),
    })

  // measured before paint: the popup never shows at a wrong place first
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (buttonRef.current && menuRef.current) placeMenu(buttonRef.current, menuRef.current)
    }
    place()
    window.addEventListener('resize', place)
    // the list scrolls under an open popup: keep it beside its button
    document.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && e.target !== buttonRef.current) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    const at = nodes.indexOf(document.activeElement as HTMLElement)
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      nodes[(at + step + nodes.length) % nodes.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      nodes[event.key === 'Home' ? 0 : nodes.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      // the popup lives at the end of the body: leave from the button so Tab continues in the row
      close(true)
    }
  }

  return (
    <span className="uw-row-menu">
      <button
        type="button"
        ref={buttonRef}
        className={`uw-pick-info-btn uw-row-menu-btn${open ? ' on' : ''}`}
        data-menu-for={docId}
        aria-label={t('uwDocActionsFor', { name: title })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        tabIndex={tabbable || open ? 0 : -1}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            setOpen(true)
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            className="uw-row-menu-list"
            role="menu"
            id={menuId}
            aria-label={t('uwDocActionsFor', { name: title })}
            ref={menuRef}
            onKeyDown={onMenuKey}
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((item) => (
              <button
                key={item.action}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="uw-row-menu-item"
                onClick={() => {
                  setOpen(false)
                  // the menu is about to unmount: park focus on its button so a modal
                  // opened by the action remembers it and gives it back on close
                  buttonRef.current?.focus()
                  onAction(item.action)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  )
}

/**
 * The row title being renamed in place: Enter saves, Escape cancels, an empty
 * or taken name shows at the field. The extension stays as it was.
 */
export function RenameField({
  initial,
  label,
  error,
  busy,
  onSave,
  onCancel,
  onEdit,
  errorKeys,
  nameLabel,
}: {
  initial: string
  label: string
  error: DocNameError | null
  busy: boolean
  onSave: (value: string) => void
  onCancel: () => void
  onEdit: () => void
  /** FD-11: a folder's own error copy */
  errorKeys?: Record<DocNameError, StringKey>
  /** FD-11: the field's name ("Folder name"); default "Name" */
  nameLabel?: string
}) {
  const { t } = useI18n()
  const id = useId()
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <span className="uw-rename" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        className="uw-act-input uw-rename-input"
        type="text"
        value={value}
        aria-label={`${nameLabel ?? t('uwDocName')} · ${label}`}
        aria-invalid={error !== null}
        aria-describedby={`${id}-error`}
        aria-busy={busy || undefined}
        readOnly={busy}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value)
          onEdit()
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          // the library's list keys (arrows, Enter, Escape) stay out of the field
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            if (!busy) onSave(value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <FieldError id={`${id}-error`} error={error} keys={errorKeys} />
    </span>
  )
}

/**
 * Failure note near the foot of the library (an action did not apply): icon,
 * the message, and a dismiss button; it also clears itself after a while.
 */
export function ActionToast({
  message,
  onDone,
  tone = 'error',
  action,
}: {
  message: string
  onDone: () => void
  /** UNI-1961: one command beside the text (the web's toast action, e.g. Hoàn tác) */
  action?: { label: string; onClick: () => void }
  /**
   * FD-11 'ok': a done note (moved, created). It has no live role: the caller
   * says it once through the shell's uniwork-live region instead.
   */
  tone?: 'error' | 'ok'
}) {
  const { t } = useI18n()
  useEffect(() => {
    const timer = window.setTimeout(onDone, 6000)
    return () => window.clearTimeout(timer)
  }, [message, onDone])
  return (
    <div
      className={`uw-act-toast${tone === 'ok' ? ' ok' : ''}`}
      role={tone === 'ok' ? undefined : 'alert'}
    >
      <svg
        className="uw-act-toast-icon"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M8 4.75v3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11.1" r="0.9" fill="currentColor" />
      </svg>
      <span className="uw-act-toast-text">{message}</span>
      {action && (
        <button
          type="button"
          className="uw-act-toast-action"
          onClick={() => {
            onDone()
            action.onClick()
          }}
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        className="uw-act-toast-close"
        aria-label={t('uwPickClose')}
        onClick={onDone}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M3 3l8 8M11 3l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}
