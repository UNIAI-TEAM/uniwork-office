/**
 * G8-13 (UNI-1408): which comment panel the open workbook gets. A workbook in server mode (bound to
 * UniWork on desktop, or a web frame that claims `comments`) gets the server panel; anything else
 * keeps today's threaded-comments pane, untouched. Both open and close through the same pane state,
 * so the ribbon's Show Comments toggle drives either.
 */
import { useMemo, useRef, useSyncExternalStore } from 'react'

import type { WorkbookFile } from '../../shared/desktop-api'
import { useI18n } from '../i18n/locale'
import { ThreadedCommentsPane } from '../ThreadedCommentsPane'
import { threadPane, threadStore } from '../threaded-comments'
import type { UniverRuntime } from '../univer-state'
import { serverAnchorStore } from './anchor-store'
import { useServerMode } from './mode'
import type { ServerCommentsApi } from './seam'
import { SheetsServerComments, type InFileThread } from './SheetsServerComments'
import { createUniverEditorView } from './univer-view'
import type { SheetsEditorView } from './adapter'

export interface SheetsCommentsSurfaceProps {
  getRuntime: () => UniverRuntime | null
  /** the open workbook; null before one opens */
  file: WorkbookFile | null
  onStatus(text: string): void
  /** test seams */
  api?: ServerCommentsApi
  view?: SheetsEditorView
}

/** the key of the document behind the open workbook: a Save reopens the same one, Save As another */
export function commentsDocKey(file: Pick<WorkbookFile, 'path' | 'name'> | null): string | null {
  return file ? (file.path ?? file.name) : null
}

export function SheetsCommentsSurface(p: SheetsCommentsSurfaceProps) {
  const { lang, t } = useI18n()
  const mode = useServerMode(commentsDocKey(p.file), p.file?.path ?? null, p.api)
  const pane = useSyncExternalStore(threadPane.subscribe, threadPane.getState)
  const threadsVersion = useSyncExternalStore(threadStore.subscribe, threadStore.getVersion)
  // bumps on a sheet rename (and on server-anchor moves): the in-file labels name live sheets
  const anchorsVersion = useSyncExternalStore(
    serverAnchorStore.subscribe,
    serverAnchorStore.getVersion,
  )
  const fileRef = useRef(p.file)
  fileRef.current = p.file
  const { getRuntime } = p
  const view = useMemo(
    () => p.view ?? createUniverEditorView(getRuntime, () => fileRef.current),
    [p.view, getRuntime],
  )
  const inFile = useMemo((): InFileThread[] => {
    if (!mode) return []
    const sheets = view.sheets()
    return threadStore.allThreads().flatMap(({ sheetId, threads }) => {
      const name = sheets.find((s) => s.id === sheetId)?.name
      return name === undefined ? [] : threads.map((thread) => ({ sheetName: name, thread }))
    })
    // the store versions are the dependencies; `view` reads the live sheets
  }, [mode, view, threadsVersion, anchorsVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!mode) return <ThreadedCommentsPane getRuntime={getRuntime} />
  return (
    <SheetsServerComments
      mode={mode}
      view={view}
      lang={lang}
      panelOpen={pane.open}
      onOpenPanel={() => threadPane.show()}
      onClosePanel={() => threadPane.close()}
      onStatus={p.onStatus}
      saveFirstMessage={t('appCommentSaveFirst')}
      selectCellMessage={t('appSelectCellFirst')}
      inFile={inFile}
      neutralAuthor={t('appThreadNeutralAuthor')}
    />
  )
}
