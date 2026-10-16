import type { ReactElement } from 'react'
import { useI18n } from '../i18n/locale'

/**
 * Shown for as long as an AI run is open: hand edits are paused then (a hand edit folded into
 * the run's single undo entry would vanish with "Undo this run"), and the reason is written out
 * instead of leaving the tools silently dead. Stopping the assistant ends the run.
 */
export function EditsPausedNotice({ active }: { active: boolean }): ReactElement | null {
  const { t } = useI18n()
  if (!active) return null
  return (
    <div className="pdf-toast pdf-toast-notice ai-edits-paused" role="status">
      <span>{t('aiEditsPaused')}</span>
    </div>
  )
}
