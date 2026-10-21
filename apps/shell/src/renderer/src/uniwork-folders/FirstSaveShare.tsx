import { useId } from 'react'
import { useI18n } from '../locale'

/**
 * The "Share with workspace" row of the first-save dialogs (the web's FirstSaveShare, UNI-2038 G4).
 * Off by default; an already-shared document shows it on and aria-disabled (turning sharing off is
 * the Share dialog's job, never this one's). It is locked too while a save runs.
 */
export function FirstSaveShare({
  checked,
  alreadyShared,
  disabled,
  onChange,
}: {
  checked: boolean
  alreadyShared: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  const { t } = useI18n()
  const labelId = useId()
  const hintId = useId()
  const on = alreadyShared || checked
  const locked = alreadyShared || disabled
  const hint = alreadyShared ? t('usShareAlready') : checked ? t('usShareHint') : null
  return (
    <div data-testid="first-save-share" className="ufs-share">
      <label className="ufs-share-row">
        <span id={labelId} className="ufs-share-label">
          {t('usShareToggle')}
        </span>
        <button
          type="button"
          role="switch"
          className="ufs-switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          aria-disabled={locked || undefined}
          onClick={() => {
            if (!locked) onChange(!on)
          }}
        />
      </label>
      {hint ? (
        <p id={hintId} className="ufs-share-hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
