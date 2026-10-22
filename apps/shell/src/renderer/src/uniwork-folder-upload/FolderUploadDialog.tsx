import { useEffect, useId, useState } from 'react'
import { ActionModal } from '../UniworkDocActions'
import { useI18n } from '../locale'
import type { PreflightSDO } from './bridge'
import {
  formatRunSize,
  groupSkipped,
  pluralKey,
  refusalMessage,
  skipReasonLabel,
  targetLabelOf,
} from './copy'
import './folder-upload.css'

/**
 * The look before the upload (UNI-2052): what would go up, what is skipped and
 * why, and whether the run is refused up front. Nothing is written until
 * Upload is pressed, so cancelling changes nothing.
 */
export function FolderUploadDialog({
  preflight,
  queued,
  starting,
  failed,
  onSubmit,
  onCancel,
}: {
  preflight: PreflightSDO
  /** pre-flights still waiting behind this one (several folders dropped at once) */
  queued: number
  /** the run is being started: closing waits, the button reads "Preparing…" */
  starting: boolean
  /** the last attempt to start did not go through */
  failed: boolean
  onSubmit: (options: { shareWithWorkspace: boolean }) => void
  onCancel: () => void
}) {
  const { t, dateLocale } = useI18n()
  const id = useId()
  const [share, setShare] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  // each staged pre-flight starts from the safe defaults: private, lists collapsed
  useEffect(() => {
    setShare(false)
    setExpanded(new Set())
  }, [preflight.preflightId])

  const { mode, refusal, totals, parentShared } = preflight
  const folderMode = mode === 'folder'
  const title = folderMode ? (preflight.rootNamePreview ?? preflight.rootName ?? '') : ''
  const renamed =
    folderMode &&
    !!preflight.rootName &&
    !!preflight.rootNamePreview &&
    preflight.rootNamePreview !== preflight.rootName
  const groups = groupSkipped(preflight.skipped)
  // a shared destination wins; else folders land private in My Folder, workspace-visible elsewhere
  const shareHintKey = parentShared
    ? 'fuDlgShareInherited'
    : !folderMode
      ? 'fuDlgShareHintFiles'
      : preflight.target.inMyFolder || preflight.target.myFolder
        ? 'fuDlgShareHintFolder'
        : 'fuDlgShareHintWorkspace'

  const toggleGroup = (reason: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(reason)) next.delete(reason)
      else next.add(reason)
      return next
    })

  const submit = () => {
    if (refusal || starting) return
    // no switch (the server cannot share on upload) = private
    // a destination that shares already covers the files: nothing to send
    onSubmit({ shareWithWorkspace: preflight.shareAvailable && !parentShared && share })
  }

  return (
    <ActionModal
      labelledBy={`${id}-title`}
      describedBy={`${id}-desc`}
      className="fu-dialog"
      initialFocus={refusal ? '.btn-secondary' : '[data-fu-submit]'}
      onCancel={onCancel}
    >
      <form
        className="uw-act-form"
        noValidate
        data-testid="folder-upload-dialog"
        data-mode={mode}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <h3 id={`${id}-title`}>{t(folderMode ? 'fuDlgTitleFolder' : 'fuDlgTitleFiles')}</h3>
        <p id={`${id}-desc`} className="fu-desc">
          {t('fuDlgDescription')}
        </p>
        <dl className="fu-meta">
          {folderMode && (
            <>
              <dt>{t('fuDlgRoot')}</dt>
              <dd className="fu-meta-strong" data-testid="folder-upload-root">
                {title}
              </dd>
            </>
          )}
          <dt>{t('fuDlgTarget')}</dt>
          <dd data-testid="folder-upload-target">{targetLabelOf(preflight.target, t)}</dd>
        </dl>
        {renamed && (
          <p className="fu-note" data-testid="folder-upload-renamed">
            {t('fuDlgRenamed', { name: preflight.rootName ?? '', title })}
          </p>
        )}
        {refusal ? (
          <div className="fu-refusal" role="alert" data-testid="folder-upload-refusal">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M8 4.75v3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="11.1" r="0.9" fill="currentColor" />
            </svg>
            <div>
              <p className="fu-refusal-title">
                {t(folderMode ? 'fuDlgRefusalTitleFolder' : 'fuDlgRefusalTitleFiles')}
              </p>
              <p>{refusalMessage(t, refusal, mode, dateLocale)}</p>
            </div>
          </div>
        ) : (
          <p className="fu-summary" data-testid="folder-upload-summary">
            {t(pluralKey('fuDlgSummary', totals.files), {
              count: totals.files,
              size: formatRunSize(totals.bytes, dateLocale),
            })}
          </p>
        )}
        {preflight.skipped.length > 0 && (
          <section
            className="fu-skipped"
            aria-label={t(pluralKey('fuDlgSkipped', preflight.skipped.length), {
              count: preflight.skipped.length,
            })}
          >
            <h4>
              {t(pluralKey('fuDlgSkipped', preflight.skipped.length), {
                count: preflight.skipped.length,
              })}
            </h4>
            <ul>
              {groups.map((group) => {
                const open = expanded.has(group.reason)
                const listId = `${id}-skip-${group.reason}`
                return (
                  <li key={group.reason}>
                    <div className="fu-skipped-row">
                      <span>
                        {t('fuDlgSkippedReason', {
                          reason: skipReasonLabel(t, group.reason),
                          count: group.paths.length,
                        })}
                      </span>
                      <button
                        type="button"
                        className="fu-link"
                        aria-expanded={open}
                        aria-controls={listId}
                        onClick={() => toggleGroup(group.reason)}
                      >
                        {t(open ? 'fuDlgHide' : 'fuDlgShow')}
                      </button>
                    </div>
                    {open && (
                      <ul id={listId} className="fu-paths">
                        {group.paths.map((path, index) => (
                          // files mode keeps same-named files: the path alone is not a key
                          <li key={`${index}:${path}`} title={path}>
                            {path}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}
        {!refusal && preflight.shareAvailable && (
          <div className="fu-share">
            <label className="fu-share-row">
              <span id={`${id}-share`}>{t('fuDlgShare')}</span>
              <button
                type="button"
                role="switch"
                className="fu-switch"
                aria-checked={parentShared || share}
                aria-labelledby={`${id}-share`}
                aria-describedby={`${id}-share-hint`}
                aria-disabled={parentShared || starting || undefined}
                onClick={() => {
                  if (!parentShared && !starting) setShare((prev) => !prev)
                }}
              />
            </label>
            <p id={`${id}-share-hint`} className="fu-note">
              {t(shareHintKey)}
            </p>
          </div>
        )}
        {queued > 0 && (
          <p className="fu-note">{t(pluralKey('fuDlgQueued', queued), { count: queued })}</p>
        )}
        {failed && (
          <p className="uw-act-error fu-error" role="alert">
            {t('fuDlgStartFailed')}
          </p>
        )}
        <div className="modal-buttons">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            data-fu-submit=""
            aria-disabled={!!refusal || starting || undefined}
            aria-busy={starting || undefined}
          >
            {starting ? t('fuDlgStarting') : t('uwDocUpload')}
          </button>
        </div>
      </form>
    </ActionModal>
  )
}
