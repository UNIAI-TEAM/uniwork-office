import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
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
  // raw text so a cleared field can be retyped; clamped when the split runs
  const [every, setEvery] = useState('1')
  // keys and paths only; translated at render
  const [toast, setToast] = useState<{ outputs: string[] } | { error: StringKey } | null>(null)

  // strip buttons by tool id; focus goes back here when a panel closes or a run ends
  const stripRefs = useRef(new Map<DeskToolId, HTMLButtonElement>())
  const focusAfterRender = useRef<DeskToolId | null>(null)
  const focusStrip = (tool: DeskToolId = TOOLS[0]!.id) => {
    focusAfterRender.current = tool
  }
  useEffect(() => {
    const tool = focusAfterRender.current
    const el = tool && stripRefs.current.get(tool)
    if (el && !el.disabled) {
      el.focus()
      focusAfterRender.current = null
    }
  })

  const closeSplit = () => {
    setSplitFor(null)
    focusStrip('split-pdf')
  }
  const closeDrop = () => {
    onDropHandled()
    focusStrip()
  }
  const onEscape = (close: () => void) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') close()
  }

  const run = async (tool: DeskToolId, inputs?: string[], askedSplit = false) => {
    onDropHandled()
    if (tool === 'split-pdf' && !askedSplit) {
      focusAfterRender.current = null // the page-count input takes focus
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
        ...(tool === 'split-pdf' ? { splitEvery: clampEvery(every) } : {}),
      })
      .catch((): DeskToolResult => ({ ok: false, error: 'failed' }))
    setRunning(null)
    focusStrip(tool)
    if (result.ok) {
      if (result.outputs.length > 0) setToast({ outputs: result.outputs })
    } else if (!('canceled' in result)) setToast({ error: ERROR_KEY[result.error] })
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
            ref={(el) => {
              if (el) stripRefs.current.set(tool.id, el)
              else stripRefs.current.delete(tool.id)
            }}
            onClick={() => void run(tool.id)}
          >
            <FileBadge ext={tool.ext} size={16} />
            {t(tool.label)}
          </button>
        ))}
        <p className="wb-desk-hint">{t('wbDeskDropHint')}</p>
      </div>

      {splitFor ? (
        <div className="wb-desk-panel wb-block wb-desk-split" onKeyDown={onEscape(closeSplit)}>
          <label>
            {t('wbDeskSplitEvery')}{' '}
            <input
              type="number"
              min={1}
              max={999}
              autoFocus
              value={every}
              onChange={(e) => setEvery(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="wb-btn wb-btn-primary wb-btn-sm"
            onClick={() => void run('split-pdf', splitFor.inputs, true)}
          >
            {t('wbDeskSplitRun')}
          </button>
          <button type="button" className="wb-btn wb-btn-ghost wb-btn-sm" onClick={closeSplit}>
            {t('wbCommonCancel')}
          </button>
        </div>
      ) : null}

      {dropped ? (
        <div
          className="wb-desk-panel wb-block"
          role="group"
          aria-label={t('wbDeskDropHint')}
          onKeyDown={onEscape(closeDrop)}
        >
          <p>{dropped.map(fileName).join(', ')}</p>
          {fitting.length === 0 ? <p>{t('wbDeskDropNone')}</p> : null}
          {fitting.map((id) => (
            <button
              key={id}
              type="button"
              className="wb-btn wb-btn-primary wb-btn-sm"
              disabled={busy}
              onClick={() => {
                focusStrip()
                void run(id, [...dropped])
              }}
            >
              {t(TOOLS.find((x) => x.id === id)!.label)}
            </button>
          ))}
          <button
            type="button"
            className="wb-btn wb-btn-secondary wb-btn-sm"
            onClick={() => {
              for (const p of dropped) void window.aiOffice.openPath(p)
              closeDrop()
            }}
          >
            {t('wbCommonOpen')}
          </button>
          <button type="button" className="wb-btn wb-btn-ghost wb-btn-sm" onClick={closeDrop}>
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
