import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import type { DeskToolId, DeskToolResult } from '../../shared/home-api'
import { applicableTools } from './desk-model'
import { FileBadge } from './FileBadge'
import { useI18n, type StringKey } from './locale'
import { useWbToast } from './WbToastHost'
import { WbGlyph } from './WorkbenchIcons'

/**
 * `label` is the full name (the accessible name and the drop panel's button); `short` is the
 * visible text next to the "PDF to" group label. Office format names stay untranslated.
 */
const TOOLS: readonly { id: DeskToolId; label: StringKey; short?: string; icon: ReactNode }[] = [
  {
    id: 'pdf-to-docx',
    label: 'wbDeskToolPdfToDocx',
    short: 'Word',
    icon: <FileBadge ext="docx" size={16} />,
  },
  {
    id: 'pdf-to-xlsx',
    label: 'wbDeskToolPdfToXlsx',
    short: 'Excel',
    icon: <FileBadge ext="xlsx" size={16} />,
  },
  {
    id: 'pdf-to-pptx',
    label: 'wbDeskToolPdfToPptx',
    short: 'PowerPoint',
    icon: <FileBadge ext="pptx" size={16} />,
  },
  { id: 'export-pdf', label: 'wbDeskToolExportPdf', icon: <WbGlyph id="exportPdf" /> },
  { id: 'merge-pdf', label: 'wbDeskToolMergePdf', icon: <WbGlyph id="merge" /> },
  { id: 'split-pdf', label: 'wbDeskToolSplitPdf', icon: <WbGlyph id="split" /> },
]
const CONVERT = TOOLS.slice(0, 3)
const PDF_TOOLS = TOOLS.slice(3)

type ToolError = Extract<DeskToolResult, { error: string }>['error']
const ERROR_KEY: Record<ToolError, StringKey> = {
  busy: 'wbDeskToolBusy',
  'bad-input': 'wbDeskToolBadInput',
  'not-found': 'wbDeskToolNotFound',
  'same-path': 'wbDeskToolSamePath',
  'target-open': 'wbDeskToolTargetOpen',
  encrypted: 'wbDeskToolEncrypted',
  failed: 'wbDeskToolFailed',
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path
const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')
const extOf = (path: string) => /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
const TOOL_TOAST = 'desk-tool'
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
  const titleId = useId()
  const convertId = useId()
  const [running, setRunning] = useState<DeskToolId | null>(null)
  const [splitFor, setSplitFor] = useState<{ inputs?: string[] } | null>(null)
  // raw text so a cleared field can be retyped; clamped when the split runs
  const [every, setEvery] = useState('1')
  const toasts = useWbToast()

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
    toasts.dismiss(TOOL_TOAST)
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
      if (result.outputs.length > 0) showDone(result.outputs)
    } else if (!('canceled' in result)) {
      toasts.show({ id: TOOL_TOAST, message: { key: ERROR_KEY[result.error] }, tone: 'alert' })
    }
  }

  // keys and paths only: the host translates at render
  const showDone = (outputs: string[]) => {
    const first = outputs[0]!
    toasts.show({
      id: TOOL_TOAST,
      message:
        outputs.length === 1
          ? { key: 'wbDeskToolDone', params: { name: fileName(first) } }
          : {
              key: 'wbDeskToolDoneMany',
              params: { count: outputs.length, folder: fileName(folderOf(first)) },
            },
      actions: [
        ...(outputs.length === 1
          ? [
              {
                label: 'wbCommonOpen' as const,
                onClick: () => void window.aiOffice.openPath(first),
              },
            ]
          : []),
        { label: 'wbDeskShowInFolder', onClick: () => void window.aiOffice.revealPath(first) },
      ],
    })
  }

  const busy = running !== null
  const fitting = dropped ? applicableTools(dropped) : []

  const strip = (tool: (typeof TOOLS)[number]) => (
    <button
      key={tool.id}
      type="button"
      className="wb-btn wb-btn-secondary wb-desk-tool"
      disabled={busy}
      aria-busy={running === tool.id}
      // the short "Word" sits under the visible "PDF to" label; the name says it in full
      aria-label={tool.short ? t(tool.label) : undefined}
      ref={(el) => {
        if (el) stripRefs.current.set(tool.id, el)
        else stripRefs.current.delete(tool.id)
      }}
      onClick={() => void run(tool.id)}
    >
      {tool.icon}
      {tool.short ?? t(tool.label)}
    </button>
  )

  return (
    <section className="wb-desk-card wb-block" aria-labelledby={titleId}>
      <div className="wb-desk-head">
        <h3 id={titleId}>{t('wbDeskTools')}</h3>
        <span className="wb-desk-head-note wb-desk-head-end">
          <WbGlyph id="upload" size={14} />
          {t('wbDeskDropHint')}
        </span>
      </div>
      <div className="wb-desk-tools">
        <div className="wb-desk-tool-group" role="group" aria-labelledby={convertId}>
          <span className="wb-desk-tool-label" id={convertId}>
            {t('wbDeskToolPdfTo')}
          </span>
          {CONVERT.map(strip)}
        </div>
        <span className="wb-desk-tool-sep" aria-hidden="true" />
        <div className="wb-desk-tool-group">{PDF_TOOLS.map(strip)}</div>
      </div>

      {splitFor ? (
        <div className="wb-desk-panel" onKeyDown={onEscape(closeSplit)}>
          <label className="wb-desk-split">
            {t('wbDeskSplitEvery')}
            <input
              className="wb-input"
              type="number"
              min={1}
              max={999}
              autoFocus
              value={every}
              onChange={(e) => setEvery(e.target.value)}
            />
          </label>
          <div className="wb-desk-panel-actions">
            <span className="wb-desk-panel-end">
              <button type="button" className="wb-btn wb-btn-ghost wb-btn-sm" onClick={closeSplit}>
                {t('wbCommonCancel')}
              </button>
              <button
                type="button"
                className="wb-btn wb-btn-primary wb-btn-sm"
                onClick={() => void run('split-pdf', splitFor.inputs, true)}
              >
                {t('wbDeskSplitRun')}
              </button>
            </span>
          </div>
        </div>
      ) : null}

      {dropped ? (
        <div
          className="wb-desk-panel"
          role="group"
          aria-label={t('wbDeskDropped')}
          onKeyDown={onEscape(closeDrop)}
        >
          <ul className="wb-desk-files">
            {dropped.map((p) => (
              <li key={p}>
                <FileBadge ext={extOf(p)} size={16} />
                <span>{fileName(p)}</span>
              </li>
            ))}
          </ul>
          {fitting.length === 0 ? (
            <p className="wb-desk-panel-note">{t('wbDeskDropNone')}</p>
          ) : null}
          {fitting.includes('export-pdf') && dropped.some((p) => unsavedPaths.has(p)) ? (
            <p className="wb-desk-panel-note">{t('wbDeskFromSaved')}</p>
          ) : null}
          <div className="wb-desk-panel-actions">
            {fitting.map((id) => (
              <button
                key={id}
                type="button"
                className="wb-btn wb-btn-secondary wb-btn-sm"
                disabled={busy}
                onClick={() => {
                  focusStrip()
                  void run(id, [...dropped])
                }}
              >
                {t(TOOLS.find((x) => x.id === id)!.label)}
              </button>
            ))}
            <span className="wb-desk-panel-end">
              <button type="button" className="wb-btn wb-btn-ghost wb-btn-sm" onClick={closeDrop}>
                {t('wbCommonCancel')}
              </button>
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
            </span>
          </div>
        </div>
      ) : null}
    </section>
  )
}
