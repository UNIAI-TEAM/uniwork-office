import { useI18n } from './i18n/locale'

/// Full-window state of the web frame when no workbook engine is installed
/// (UNI-1016, GO-D3 = C: the xlsx engine runs as WASM in a frame Worker, a
/// follow-up). Shown instead of the grid when the bridge reports
/// `capabilities.xlsxEngine === false`, or when an open fails with the
/// `engine-unavailable` code (web-engine.ts). Never shown on the desktop.
/// `reason: 'too-large'` is the size gate (web-engine.ts WEB_TOO_LARGE): the
/// host replaces the frame with the G3 editor; this is what shows meanwhile.
export function EngineUnavailableScreen({
  reason = 'engine',
  overlay = false,
}: {
  readonly reason?: 'engine' | 'too-large'
  /// cover the already mounted workbook shell instead of replacing it
  readonly overlay?: boolean
} = {}): React.JSX.Element {
  const { t } = useI18n()
  const tooLarge = reason === 'too-large'
  return (
    <main
      className={`engine-unavailable${overlay ? ' engine-unavailable-overlay' : ''}`}
      data-testid={tooLarge ? 'sheets-too-large' : 'sheets-engine-unavailable'}
    >
      <section className="engine-unavailable-card" role="alert" aria-live="polite">
        <span className="engine-unavailable-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4">
            <rect x="7" y="9" width="34" height="30" rx="4" />
            <path d="M7 19h34M7 29h34M19 9v30M30 9v30" strokeLinecap="round" />
          </svg>
        </span>
        <h1 className="engine-unavailable-title">
          {t(tooLarge ? 'appWebTooLargeTitle' : 'appWebEngineTitle')}
        </h1>
        <p className="engine-unavailable-body">
          {t(tooLarge ? 'appWebTooLargeBody' : 'appWebEngineBody')}
        </p>
        <p className="engine-unavailable-hint">{t('appWebEngineHint')}</p>
      </section>
    </main>
  )
}
