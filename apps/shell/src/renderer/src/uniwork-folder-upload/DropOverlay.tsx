import { useI18n } from '../locale'
import type { DropZoneBox } from './use-library-drop'
import './folder-upload.css'

/** Over the library while files hover: where they would go. Never takes events itself (the list below handles the drop) */
export function DropOverlay({ targetLabel, box }: { targetLabel: string; box: DropZoneBox }) {
  const { t } = useI18n()
  return (
    <div className="fu-drop" aria-hidden="true" data-testid="folder-upload-drop" style={box}>
      <div className="fu-drop-card">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 16.5v2A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <strong>{t('fuDropTitle')}</strong>
        <span>{t('fuDropHint', { target: targetLabel })}</span>
      </div>
    </div>
  )
}
