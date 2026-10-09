import { useI18n } from './i18n/locale'

/// Full-window state of the web frame when no workbook engine is installed
/// (UNI-1016, GO-D3 = C: the xlsx engine runs as WASM in a frame Worker, a
/// follow-up). Shown instead of the grid when the bridge reports
/// `capabilities.xlsxEngine === false`, or when an open fails with the
/// `engine-unavailable` code (web-engine.ts). Never shown on the desktop.
export function EngineUnavailableScreen(): React.JSX.Element {
  const { t } = useI18n()
  return (
    <main className="engine-unavailable" data-testid="sheets-engine-unavailable">
      <section className="engine-unavailable-card" role="alert" aria-live="polite">
        <span className="engine-unavailable-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4">
            <rect x="7" y="9" width="34" height="30" rx="4" />
            <path d="M7 19h34M7 29h34M19 9v30M30 9v30" strokeLinecap="round" />
          </svg>
        </span>
        <h1 className="engine-unavailable-title">{t('appWebEngineTitle')}</h1>
        <p className="engine-unavailable-body">{t('appWebEngineBody')}</p>
        <p className="engine-unavailable-hint">{t('appWebEngineHint')}</p>
      </section>
    </main>
  )
}
