import type {
  FileDownloadResult,
  ZipDownloadBridge,
  ZipDownloadProgress,
  ZipDownloadStartInput,
  ZipDownloadStartResult,
} from '../src/shared/zip-download-api'

/** an in-memory bridge: the test answers start / downloadFile by hand and pushes progress */
export interface FakeZipBridge extends ZipDownloadBridge {
  starts: ZipDownloadStartInput[]
  files: Array<{ workspaceId: string; documentId: string; suggestedName: string }>
  canceled: string[]
  /** answer for the next start() / downloadFile(); default = accepted with run id `run-N` */
  nextStart: ZipDownloadStartResult | Promise<ZipDownloadStartResult> | null
  nextFile: FileDownloadResult | Promise<FileDownloadResult> | null
  push(event: Partial<ZipDownloadProgress> & { runId: string }): void
}

export function fakeZipBridge(): FakeZipBridge {
  const listeners = new Set<(p: ZipDownloadProgress) => void>()
  let runs = 0
  const bridge: FakeZipBridge = {
    starts: [],
    files: [],
    canceled: [],
    nextStart: null,
    nextFile: null,
    async start(input) {
      bridge.starts.push(input)
      const answer = bridge.nextStart
      bridge.nextStart = null
      return answer ?? { ok: true, runId: `run-${++runs}` }
    },
    async cancel(runId) {
      bridge.canceled.push(runId)
    },
    onProgress(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async downloadFile(input) {
      bridge.files.push(input)
      const answer = bridge.nextFile
      bridge.nextFile = null
      return answer ?? { ok: true, path: `/tmp/${input.suggestedName}` }
    },
    push(event) {
      const full: ZipDownloadProgress = {
        phase: 'building',
        bytes: 0,
        totalBytes: null,
        fileCount: null,
        skipped: [],
        path: null,
        error: null,
        ...event,
      }
      for (const listener of [...listeners]) listener(full)
    },
  }
  return bridge
}
