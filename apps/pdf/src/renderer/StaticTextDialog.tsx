import type { ReactElement, RefObject } from 'react'
import { Dropdown } from '@genoffice/ui'
import type { StringKey, TFunc } from './i18n/locale'
import { ColorPickerPopover } from './ColorPicker'
import { useModalDialog } from './modal-dialog'

export type StaticTextAlign = 'left' | 'center' | 'right'

/**
 * The text dialog shared by Home > Insert text, editing an inserted text and Fill Form > Add text.
 * It mounts only while open, so useModalDialog puts the focus in the textarea on every open
 * (typing works at once), Escape cancels, and the opener gets the focus back.
 */
export function StaticTextDialog({
  t,
  titleKey,
  text,
  size,
  color,
  colorOpen,
  align,
  colorFieldRef,
  onText,
  onSize,
  onColor,
  onColorOpen,
  onAlign,
  onCancel,
  onConfirm,
}: {
  t: TFunc
  titleKey: StringKey
  text: string
  size: number
  color: string
  colorOpen: boolean
  align: StaticTextAlign
  /** guard root of the color popover for the App's outside-click dismissal */
  colorFieldRef: RefObject<HTMLDivElement | null>
  onText: (value: string) => void
  onSize: (value: number) => void
  onColor: (value: string) => void
  onColorOpen: (open: boolean) => void
  onAlign: (value: StaticTextAlign) => void
  onCancel: () => void
  onConfirm: () => void
}): ReactElement {
  // the color popover closes itself on Escape while open
  const dialogRef = useModalDialog(onCancel, { escape: !colorOpen })
  return (
    <div className="pdf-modal-mask" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="pdf-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t(titleKey)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pdf-modal-title">{t(titleKey)}</div>
        <textarea
          className="pdf-modal-textarea"
          value={text}
          placeholder={t('formAddTextPlaceholder')}
          onChange={(e) => onText(e.target.value)}
        />
        <label className="pdf-field">
          <span>{t('formTextSize')}</span>
          <input
            className="pdf-modal-input"
            type="number"
            min={6}
            max={72}
            value={size}
            onChange={(e) => onSize(Math.min(72, Math.max(6, Number(e.target.value) || 14)))}
          />
        </label>
        <div className="pdf-field-grid">
          <div ref={colorFieldRef} className="pdf-field pdf-color-field">
            <span>{t('formTextColor')}</span>
            <button
              type="button"
              className="pdf-color-trigger"
              aria-expanded={colorOpen}
              onClick={() => onColorOpen(!colorOpen)}
            >
              <span className="pdf-color-trigger-swatch" style={{ background: color }} />
              <span>{color.toUpperCase()}</span>
            </button>
            {colorOpen && (
              <ColorPickerPopover
                value={color}
                onPick={onColor}
                onClose={() => onColorOpen(false)}
              />
            )}
          </div>
          <label className="pdf-field">
            <span>{t('formTextAlign')}</span>
            <Dropdown
              className="pdf-modal-dd"
              ariaLabel={t('formTextAlign')}
              value={align}
              options={[
                { value: 'left', label: t('formAlignLeft') },
                { value: 'center', label: t('formAlignCenter') },
                { value: 'right', label: t('formAlignRight') },
              ]}
              onPick={onAlign}
            />
          </label>
        </div>
        <div className="pdf-modal-actions">
          <button className="pdf-modal-btn" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button className="pdf-modal-btn primary" disabled={!text.trim()} onClick={onConfirm}>
            {t('ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
