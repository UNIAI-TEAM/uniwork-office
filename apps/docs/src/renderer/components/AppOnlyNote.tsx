import type { ReactElement } from 'react'
import type { Params } from '@genoffice/i18n'
import { appOpenAvailable } from '../capabilities'
import { useI18n, type StringKey } from '../i18n/locale'

/**
 * "Use the app" message of the web frame (A7 / B): a feature the web build does not have is shown
 * with what it is (`lead`), the shared localised hint to open the document in the UniWork Office
 * app, and the Open-in-app action when the host granted `desktopOpen`. The host owns every dialog
 * and alert of the launch flow, so the action's result needs no handling here.
 */
export function AppOnlyNote({
  lead,
  leadParams,
  feature,
  testId,
}: {
  lead: StringKey
  leadParams?: Params
  /** opaque diagnostics tag for the host (never shown) */
  feature: string
  testId: string
}): ReactElement {
  const { t } = useI18n()
  return (
    <div className="app-only-note" data-testid={testId}>
      <p className="app-only-lead">{t(lead, leadParams)}</p>
      <p className="app-only-hint">{t('appOnlyHint')}</p>
      {appOpenAvailable() && (
        <button
          type="button"
          className="btn-primary app-only-open"
          onClick={() => void window.desktop.openInApp?.(feature)}
        >
          {t('appOnlyOpen')}
        </button>
      )}
    </div>
  )
}
