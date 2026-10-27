import { useEffect } from 'react'
import { useI18n } from '../locale'
import { announce } from '../uniwork-live'
import '../uniwork-zip-download/zip-download.css'
import { doneMessage } from './folder-contents-access-model'
import {
  closeFolderBatch,
  onFolderBatchSettled,
  useFolderBatches,
  type StoredFolderBatch,
} from './folder-contents-access-store'
import './share-dialog.css'

/** how long a finished bar stays before it closes itself */
const SETTLED_CLOSE_MS = 8000

/** the bar's sentence: progress while it runs, the result once it ends */
function barText(t: ReturnType<typeof useI18n>['t'], batch: StoredFolderBatch): string {
  if (batch.phase === 'completed') {
    return t('shrFcBatchDone', { title: batch.folderTitle, summary: doneMessage(t, batch) })
  }
  if (batch.phase === 'failed') {
    return t('shrFcBatchFailed', {
      title: batch.folderTitle,
      processed: batch.processed,
      total: batch.total,
    })
  }
  return batch.total > 0
    ? t('shrFcProgress', {
        title: batch.folderTitle,
        processed: batch.processed,
        total: batch.total,
      })
    : t('shrFcQueued', { title: batch.folderTitle })
}

function Bar({ batch }: { batch: StoredFolderBatch }) {
  const { t } = useI18n()
  const settled = batch.phase !== 'running'
  const text = barText(t, batch)
  const percent =
    batch.total > 0 ? Math.min(100, Math.round((batch.processed / batch.total) * 100)) : undefined

  useEffect(() => {
    if (!settled) return
    const timer = window.setTimeout(() => closeFolderBatch(batch.batchId), SETTLED_CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [settled, batch.batchId])

  return (
    <div
      className={`zd-bar zd-bar-${settled ? (batch.phase === 'completed' ? 'ok' : 'error') : 'progress'}`}
      data-testid="folder-contents-access-bar"
      data-phase={batch.phase}
    >
      <div className="zd-bar-line">
        <span className="zd-bar-text">{text}</span>
        {settled && (
          <button
            type="button"
            className="zd-bar-close"
            aria-label={t('uwPickClose')}
            onClick={() => closeFolderBatch(batch.batchId)}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
      {!settled && (
        <progress className="zd-bar-meter" max={100} value={percent} aria-label={text} />
      )}
    </div>
  )
}

/** `${batchId}` of every end already said, for the life of the window (a remount must not repeat it) */
const announced = new Set<string>()

/**
 * The progress bars of the folder-contents runs. A run goes on when the dialog that started it
 * closes; this is where it is seen. It says the end once (polite for a result, assertive for a
 * failure) and hands the sentence to `onSettled` so the screen can raise its toast.
 */
export function FolderContentsAccessBar({
  onSettled,
}: {
  onSettled?: (message: string, tone: 'ok' | 'error') => void
}) {
  const { t } = useI18n()
  const batches = useFolderBatches()

  useEffect(
    () =>
      onFolderBatchSettled((batch) => {
        if (announced.has(batch.batchId)) return
        announced.add(batch.batchId)
        const message = barText(t, batch)
        const tone = batch.phase === 'completed' ? 'ok' : 'error'
        announce(message, { assertive: tone === 'error' })
        onSettled?.(message, tone)
      }),
    // `t` is not referentially stable; the listener reads the live one through the closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSettled],
  )

  if (batches.length === 0) return null
  return (
    <div className="fca-bars" data-testid="folder-contents-access-bars">
      {batches.map((batch) => (
        <Bar key={batch.batchId} batch={batch} />
      ))}
    </div>
  )
}
