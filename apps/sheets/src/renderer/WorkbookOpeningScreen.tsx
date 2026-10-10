import { useI18n } from './i18n/locale'

/// Full-window loading state while a workbook opens (the web frame boots the engine and reads the
/// file first, which can take a few seconds on a large workbook): spinner, the localised line and
/// a sheet-shaped skeleton in the look of the other full-window states.
export function WorkbookOpeningScreen(): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="workbook-opening-screen" role="status" aria-live="polite">
      <div className="workbook-opening-card">
        <span className="workbook-opening-spinner" aria-hidden="true" />
        <p className="workbook-opening-text">{t('appOpeningWorkbook')}</p>
        <div className="workbook-opening-skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, row) => (
            <span key={row} className="workbook-opening-skeleton-row" />
          ))}
        </div>
      </div>
    </div>
  )
}
