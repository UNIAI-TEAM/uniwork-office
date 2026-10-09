/**
 * The slice of the frame protocol client (web/docs/protocol/client.ts,
 * `DocsFrameClient`) the bridge uses. Kept structural so unit tests can hand
 * the bridge a mocked transport and the real client satisfies it unchanged.
 */
import {
  toProtocolError,
  type Capabilities,
  type FileMeta,
  type FrameRequestType,
  type FrameRequests,
  type HostRequests,
  type InitUser,
  type ProtocolErrorCode,
  type ProtocolErrorShape,
  type SavedPayload,
  type Theme,
} from '../protocol/types'

export interface PortRequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
  transfer?: Transferable[]
}

/** what the bridge needs from `init` (the token never leaves the client) */
export interface PortSession {
  documentId: string
  open?: HostRequests['open']['payload']
  /** the host's UI theme / locale from `init` (absent in unit-test sessions) */
  theme?: Theme
  locale?: string
  /** effective capabilities (frame ∩ host grant); absent in unit-test sessions */
  capabilities?: Capabilities
  /** the viewer's display data from `init.user` (additive, GO-B4: PDF note author) */
  user?: InitUser
}

type HostHandler<K extends keyof HostRequests> = (
  payload: HostRequests[K]['payload'],
  ctx: { signal: AbortSignal },
) => HostRequests[K]['result'] | Promise<HostRequests[K]['result']>

export interface FramePort {
  whenInitialized(): Promise<PortSession>
  request<K extends FrameRequestType>(
    type: K,
    payload: FrameRequests[K]['payload'],
    options?: PortRequestOptions,
  ): Promise<FrameRequests[K]['result']>
  handleOpen(handler: HostHandler<'open'>): () => void
  handleSave(handler: HostHandler<'save'>): () => void
  handleSaveAs(handler: HostHandler<'saveAs'>): () => void
  handlePrint(handler: HostHandler<'print'>): () => void
  handleCloseCheck(handler: HostHandler<'doc.closeCheck'>): () => void
  onFileRenamed(listener: (file: FileMeta) => void): () => void
  /** host `theme` / `language` events (the host is authoritative for both) */
  onTheme(listener: (theme: Theme) => void): () => void
  onLanguage(listener: (locale: string) => void): () => void
  setDirty(dirty: boolean): void
  setTitle(title: string): void
  /** a bridge dialog opened / closed (protocol `modal` event; optional for older clients) */
  setModal?(open: boolean): void
  reportSaved(payload: SavedPayload): void
  reportError(error: ProtocolErrorShape | unknown, fatal?: boolean): void
}

export function errorCode(err: unknown): ProtocolErrorCode {
  return toProtocolError(err).code
}

/** request timeouts per call class (ms) */
export const TIMEOUTS = {
  /** metadata */
  short: 30_000,
  /** document bytes up or down, server-side render */
  transfer: 120_000,
  /** the editor must START a host-requested flow (e.g. Save As serializes first); a real timer */
  editorStart: 30_000,
  /** waits on a host dialog (picker, save-as name/folder): no timeout. A request option only:
   *  never pass it to setTimeout (0 there fires at once) */
  dialog: 0,
} as const
