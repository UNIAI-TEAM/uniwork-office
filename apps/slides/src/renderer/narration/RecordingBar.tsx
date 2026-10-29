import { useModalDialog } from '../components/modal-dialog'
import { useI18n } from '../i18n/locale'
import { formatClock } from '../slideshow-utils'
import type { RecordingPhase } from './use-recording'

/** The show's recording bar: what is being recorded, the time on this slide and in all, pause. */
export function RecordingBar({
  phase,
  slideElapsedMs,
  elapsedMs,
  onTogglePause,
}: {
  phase: RecordingPhase
  slideElapsedMs: number
  elapsedMs: number
  onTogglePause: () => void
}) {
  const { t } = useI18n()
  if (phase === 'failed') {
    return <div className="ss-record ss-record-failed">{t('paneShowRecordFailed')}</div>
  }
  return (
    <div className="ss-record" onClick={(e) => e.stopPropagation()}>
      <span className={`ss-record-dot${phase === 'recording' ? ' on' : ''}`} aria-hidden="true" />
      <span className="ss-record-state">
        {t(phase === 'paused' ? 'paneShowRecordPaused' : 'paneShowRecording')}
      </span>
      <span className="ss-record-cur">{formatClock(slideElapsedMs)}</span>
      <span className="ss-record-total">
        {t('paneShowRehearseTotal', { time: formatClock(elapsedMs) })}
      </span>
      <button
        className="ss-record-btn"
        disabled={phase === 'starting'}
        onClick={onTogglePause}
        data-tip={t(phase === 'paused' ? 'paneShowRecordResume' : 'paneShowRecordPause')}
      >
        {t(phase === 'paused' ? 'paneShowRecordResume' : 'paneShowRecordPause')}
      </button>
    </div>
  )
}

const keepTake = (): void => {}

/** Post-recording confirmation modal: shares the Custom Size dialog's useModalDialog contract. */
export function RecordNarrationDialog({
  durationMs,
  onSave,
  onDiscard,
}: {
  durationMs: number
  onSave: () => void
  onDiscard: () => void
}) {
  // Escape is a no-op on purpose: closing here would discard the take just recorded,
  // so only the two buttons decide. The hook still registers the Escape overlay.
  const { titleId, dialogProps } = useModalDialog(keepTake)
  const { t } = useI18n()
  return (
    <div className="modal-backdrop">
      <div className="modal" {...dialogProps}>
        <h2 id={titleId}>{t('appRecordTitle')}</h2>
        <p className="rehearse-summary">
          {t('appRecordSummary', { duration: formatClock(durationMs) })}
        </p>
        <div className="modal-actions">
          <button onClick={onDiscard}>{t('appRecordDiscard')}</button>
          <button className="primary" onClick={onSave}>
            {t('appRecordSave')}
          </button>
        </div>
      </div>
    </div>
  )
}
