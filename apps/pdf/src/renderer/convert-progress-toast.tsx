import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useI18n } from './i18n/locale'
import type { PdfConvertProgressEvent } from '../shared/ipc'

export interface PdfConvertProgressSeam {
  onConvertProgress?: (handler: (progress: PdfConvertProgressEvent) => void) => () => void
  convertCancel?: () => Promise<void>
}

export function usePdfConvertProgress(api?: PdfConvertProgressSeam | null): {
  progress: PdfConvertProgressEvent | null
  cancel: () => void
} {
  const resolvedApi = api === undefined ? window.pdfApi : api
  const [progress, setProgress] = useState<PdfConvertProgressEvent | null>(null)

  useEffect(() => {
    const subscribe = resolvedApi?.onConvertProgress
    if (typeof subscribe !== 'function') {
      setProgress(null)
      return
    }
    const off = subscribe((event) => {
      if (!event || event.done) {
        setProgress(null)
      } else {
        setProgress(event)
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [resolvedApi])

  const cancel = useCallback(() => {
    try {
      void Promise.resolve(resolvedApi?.convertCancel?.()).catch(() => {})
    } catch {
      // Cancelling must not show any error
    }
  }, [resolvedApi])

  return { progress, cancel }
}

/** Progress toast shown while a local PDF -> Office conversion started from this tab is running (UNI-2167) */
export function ConvertProgressToast({
  progress,
  onCancel,
}: {
  progress: PdfConvertProgressEvent | null
  onCancel: () => void
}): ReactElement | null {
  const { t } = useI18n()
  const active = Boolean(progress && !progress.done)
  const [cancelling, setCancelling] = useState(false)
  useEffect(() => {
    if (!active) setCancelling(false)
  }, [active])
  if (!progress || progress.done) return null
  const hasPageProgress = progress.page > 0 && progress.total > 0
  const text =
    progress.format === 'xlsx'
      ? hasPageProgress
        ? t('convertToExcelRunning', { page: progress.page, total: progress.total })
        : t('convertToExcelPreparing')
      : progress.format === 'pptx'
        ? hasPageProgress
          ? t('convertToPptRunning', { page: progress.page, total: progress.total })
          : t('convertToPptPreparing')
        : hasPageProgress
          ? t('convertToWordRunning', { page: progress.page, total: progress.total })
          : t('convertToWordPreparing')
  return (
    <div className="pdf-toast pdf-toast-notice" role="status" data-testid="pdf-convert-toast">
      <span>{text}</span>
      <button
        type="button"
        disabled={cancelling}
        onClick={() => {
          setCancelling(true)
          onCancel()
        }}
      >
        {t('cancel')}
      </button>
    </div>
  )
}
