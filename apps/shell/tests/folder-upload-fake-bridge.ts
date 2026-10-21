import { vi } from 'vitest'
import type {
  FolderUploadBridge,
  FolderUploadProgressEvent,
  PreflightSDO,
} from '../src/renderer/src/uniwork-folder-upload/bridge'

/** A pre-flight the way main answers it, with the parts a test does not care about filled in */
export function preflightOf(overrides: Partial<PreflightSDO> = {}): PreflightSDO {
  return {
    preflightId: 'pf-1',
    mode: 'folder',
    rootName: 'Hồ sơ 2052',
    target: { workspaceId: 'ws-1', folderId: 'f-board', label: 'Báo cáo HĐQT Q4' },
    totals: { files: 40, bytes: 125.3 * 1024 * 1024 },
    skipped: [],
    refusal: null,
    shareAvailable: true,
    ...overrides,
  }
}

export interface FakeFolderUploadBridge extends FolderUploadBridge {
  pick: ReturnType<typeof vi.fn<FolderUploadBridge['pick']>>
  preflight: ReturnType<typeof vi.fn<FolderUploadBridge['preflight']>>
  start: ReturnType<typeof vi.fn<FolderUploadBridge['start']>>
  foldersAvailable: ReturnType<typeof vi.fn<FolderUploadBridge['foldersAvailable']>>
  cancel: ReturnType<typeof vi.fn<FolderUploadBridge['cancel']>>
  retry: ReturnType<typeof vi.fn<FolderUploadBridge['retry']>>
  dismiss: ReturnType<typeof vi.fn<FolderUploadBridge['dismiss']>>
  /** push a progress event as main would */
  emit(event: FolderUploadProgressEvent): void
  listeners: number
}

/** In-memory bridge: every channel is a spy, `emit` plays main's pushed progress */
export function createFakeFolderUploadBridge(
  opts: { folders?: boolean; runId?: string } = {},
): FakeFolderUploadBridge {
  const listeners = new Set<(event: FolderUploadProgressEvent) => void>()
  const bridge = {
    pick: vi.fn<FolderUploadBridge['pick']>(async () => null),
    preflight: vi.fn<FolderUploadBridge['preflight']>(async () => []),
    start: vi.fn<FolderUploadBridge['start']>(async () => ({
      ok: true,
      runId: opts.runId ?? 'run-1',
    })),
    foldersAvailable: vi.fn(async () => opts.folders !== false),
    cancel: vi.fn<FolderUploadBridge['cancel']>(async () => undefined),
    retry: vi.fn<FolderUploadBridge['retry']>(async () => undefined),
    dismiss: vi.fn<FolderUploadBridge['dismiss']>(async () => undefined),
    onProgress: (cb: (event: FolderUploadProgressEvent) => void) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    emit: (event: FolderUploadProgressEvent) => listeners.forEach((cb) => cb(event)),
    get listeners() {
      return listeners.size
    },
  } as unknown as FakeFolderUploadBridge
  return bridge
}

export function progressOf(
  overrides: Partial<FolderUploadProgressEvent> = {},
): FolderUploadProgressEvent {
  return {
    runId: 'run-1',
    phase: 'uploading',
    done: 0,
    failed: 0,
    total: 40,
    sentBytes: 0,
    totalBytes: 0,
    ...overrides,
  }
}
