import type { ReactElement } from 'react'
import { useI18n } from './locale'

/** "On this device" tag of the local-only Workbench tabs (Forms, Notes, the four pillars). */
export function LocalTag(): ReactElement {
  const { t } = useI18n()
  return <span className="wb-local-tag">{t('wbOnThisDevice')}</span>
}
