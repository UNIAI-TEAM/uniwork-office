import { useState } from 'react'
import type { ReactElement } from 'react'
import type { DeskToolId, DeskToolResult } from '../../shared/home-api'
import { applicableTools } from './desk-model'
import { FileBadge } from './FileBadge'
import { useI18n, type StringKey } from './locale'

const TOOLS: readonly { id: DeskToolId; label: StringKey; ext: string }[] = [
  { id: 'pdf-to-docx', label: 'wbDeskToolPdfToDocx', ext: 'docx' },
  { id: 'pdf-to-xlsx', label: 'wbDeskToolPdfToXlsx', ext: 'xlsx' },
  { id: 'pdf-to-pptx', label: 'wbDeskToolPdfToPptx', ext: 'pptx' },
  { id: 'export-pdf', label: 'wbDeskToolExportPdf', ext: 'pdf' },
  { id: 'merge-pdf', label: 'wbDeskToolMergePdf', ext: 'pdf' },
  { id: 'split-pdf', label: 'wbDeskToolSplitPdf', ext: 'pdf' },
]

type ToolError = Extract<DeskToolResult, { error: string }>['error']
const ERROR_KEY: Record<ToolError, StringKey> = {
  busy: 'wbDeskToolBusy',
  'bad-input': 'wbDeskToolBadInput',
  'not-found': 'wbDeskToolNotFound',
  'same-path': 'wbDeskToolSamePath',
  'target-open': 'wbDeskToolTargetOpen',
  failed: 'wbDeskToolFailed',
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path
const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')
const clampEvery = (raw: string) => Math.min(999, Math.max(1, Math.floor(Number(raw)) || 1))

/** the Desk's tool strip, drop chooser, split popover and result toast (office desk spec §4) */
export function DeskTools({
  dropped,
  onDropHandled,
  unsavedPaths,
}: {
  /** files dropped on the Desk, waiting for a tool; null when none */
  dropped: readonly string[] | null
  onDropHandled: () => void
  /** files open with unsaved changes: Export PDF reads the saved version */
  unsavedPaths: ReadonlySet<string>
}): ReactElement {
  const { t } = useI18n()
  const [running, setRunning] = useState<DeskToolId | null>(null)
  const [splitFor, setSplitFor] = useState<{ inputs?: string[] } | null>(null)
  const [every, setEvery] = useState(1)
  // keys and paths only; translated at render
  const [toast, setToast] = useState<{ outputs: string[] } | { error: StringKey } | null>(null)

  const run = async (tool: DeskToolId, inputs?: string[], askedSplit = false) => {
    onDropHandled()
    if (tool === 'split-pdf' && !askedSplit) {
      setSplitFor(inputs ? { inputs } : {})
      return
    }
    setSplitFor(null)
    setToast(null)
    setRunning(tool)
    const result = await window.aiOffice
      .runDeskTool({
        tool,
        ...(inputs ? { inputs } : {}),
        ...(tool === 'split-pdf' ? { splitEvery: every } : {}),
      })
      .catch((): DeskToolResult => ({ ok: false, error: 'failed' }))
    setRunning(null)
    if (result.ok) setToast({ outputs: result.outputs })
    else if (!('canceled' in result)) setToast({ error: ERROR_KEY[result.error] })
  }

  const busy = running !== null
  const fitting = dropped ? applicableTools(dropped) : []

  return (
    <section className="wb-desk-section" aria-label={t('wbDeskTools')}>
      <div className="wb-desk-tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="wb-btn wb-btn-secondary wb-btn-sm wb-desk-tool"
            disabled={busy}
            aria-busy={running === tool.id}
            onClick={() => void run(tool.id)}
          >
            <FileBadge ext={tool.ext} size={16} />
            {t(tool.label)}
          </button>
        ))}
        <p className="wb-desk-hint">{t('wbDeskDropHint')}</p>
      </div>

      {splitFor ? (
        <div className="wb-desk-panel wb-block wb-desk-split">
          <label>
            {t('wbDeskSplitEvery')}{' '}
            <input
              type="number"
              min={1}
              max={999}
              value={every}
              onChange={(e) => setEvery(clampEvery(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="wb-btn wb-btn-primary wb-btn-sm"
            onClick={() => void run('split-pdf', splitFor.inputs, true)}
          >
            {t('wbDeskSplitRun')}
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-ghost wb-btn-sm"
            onClick={() => setSplitFor(null)}
          >
            {t('wbCommonCancel')}
          </button>
        </div>
      ) : null}

      {dropped ? (
        <div className="wb-desk-panel wb-block" role="group" aria-label={t('wbDeskDropHint')}>
          <p>{dropped.map(fileName).join(', ')}</p>
          {fitting.length === 0 ? <p>{t('wbDeskDropNone')}</p> : null}
          {fitting.map((id) => (
            <button
              key={id}
              type="button"
              className="wb-btn wb-btn-primary wb-btn-sm"
              disabled={busy}
              onClick={() => void run(id, [...dropped])}
            >
              {t(TOOLS.find((x) => x.id === id)!.label)}
            </button>
          ))}
          <button
            type="button"
            className="wb-btn wb-btn-secondary wb-btn-sm"
            onClick={() => {
              for (const p of dropped) void window.aiOffice.openPath(p)
              onDropHandled()
            }}
          >
            {t('wbCommonOpen')}
          </button>
          <button type="button" className="wb-btn wb-btn-ghost wb-btn-sm" onClick={onDropHandled}>
            {t('wbCommonCancel')}
          </button>
          {fitting.includes('export-pdf') && dropped.some((p) => unsavedPaths.has(p)) ? (
            <p>{t('wbDeskFromSaved')}</p>
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <div className="wb-toast" role={'error' in toast ? 'alert' : 'status'}>
          {'error' in toast ? (
            <span>{t(toast.error)}</span>
          ) : (
            <>
              <span>
                {toast.outputs.length === 1
                  ? t('wbDeskToolDone', { name: fileName(toast.outputs[0]!) })
                  : t('wbDeskToolDoneMany', {
                      count: toast.outputs.length,
                      folder: fileName(folderOf(toast.outputs[0]!)),
                    })}
              </span>
              {toast.outputs.length === 1 ? (
                <button
                  type="button"
                  className="wb-link"
                  onClick={() => void window.aiOffice.openPath(toast.outputs[0]!)}
                >
                  {t('wbCommonOpen')}
                </button>
              ) : null}
              <button
                type="button"
                className="wb-link"
                onClick={() => void window.aiOffice.revealPath(toast.outputs[0]!)}
              >
                {t('wbDeskShowInFolder')}
              </button>
            </>
          )}
          <button type="button" className="wb-link" onClick={() => setToast(null)}>
            {t('wbOvDismiss')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
