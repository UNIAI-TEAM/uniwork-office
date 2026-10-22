import type { IpcMain } from 'electron'
import {
  DOC_HISTORY_CHANNELS,
  type DocHistoryResult,
  type UniworkDocHistoryApi,
} from '../../shared/doc-history-api'
import type { DocHistoryClient } from './doc-history-client'

/**
 * UNI-2077: the service behind the `uniwork-doc-history:*` channels (the
 * Version history and Access log sheets). It answers every call with a
 * `DocHistoryResult` (never a rejection, so nothing crosses IPC as an
 * exception) and maps the server's refusals the way the web's sheets read them.
 */

export interface DocHistoryOpenCopy {
  /** the edit lock this app holds on the open tab, if any */
  editLockId: string | null
  /** the server revision the open working copy is based on */
  baseRevision: string | null
}

export interface DocHistoryServiceDeps {
  /** the client of the current profile; throws `not_signed_in` without one */
  client(): DocHistoryClient
  isSignedIn(): boolean
  /** the open tab of this document in this session, or null when it is not open here */
  openCopy(documentId: string): Promise<DocHistoryOpenCopy | null>
  /** a restore landed: an open tab of the document takes the new revision (S6 flow) */
  noteRestored(notice: {
    documentId: string
    revision: string
    version: number
    versionId: string
  }): void
  /** opens the read-only `@vN` copy of a file version in a tab */
  openVersionView(documentId: string, versionNo: number): Promise<{ path: string; title: string }>
  /** save dialog + the version's bytes to the chosen file; null = the dialog was canceled */
  downloadVersion(
    documentId: string,
    versionNo: number,
    suggestedName: string,
  ): Promise<{ path: string } | null>
}

const notYet = async (): Promise<DocHistoryResult<never>> => ({ ok: false, error: 'server_error' })

export function createDocHistoryService(deps: DocHistoryServiceDeps): UniworkDocHistoryApi {
  void deps
  return {
    versions: notYet,
    version: notYet,
    createVersion: notYet,
    restore: notYet,
    openVersion: notYet,
    downloadVersion: notYet,
    accessLogs: notYet,
  }
}

/**
 * The channels, each answered only for the shell window's main frame (the
 * temporary rule until the UNI-2073 sender guard covers `uniwork-*` channels
 * at the composition point); any other sender gets `forbidden`.
 */
export function registerDocHistoryIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: UniworkDocHistoryApi,
  isShellMainFrame: (event: unknown) => boolean,
): void {
  const refused: DocHistoryResult<never> = { ok: false, error: 'forbidden' }
  const on = <K extends keyof UniworkDocHistoryApi>(name: K): void => {
    ipc.handle(DOC_HISTORY_CHANNELS[name], (event, input: unknown) =>
      isShellMainFrame(event)
        ? (service[name] as (input: unknown) => Promise<unknown>)(input)
        : Promise.resolve(refused),
    )
  }
  on('versions')
  on('version')
  on('createVersion')
  on('restore')
  on('openVersion')
  on('downloadVersion')
  on('accessLogs')
}
