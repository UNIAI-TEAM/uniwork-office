import type { FetchLike, UniworkDocsClientOptions } from '../client'
import { createFolderUploadTransport } from '../folder-upload-client'
import { folderUploadRunLimits, type DocumentLimits } from '../limits'
import { createFolderUploadRunnerAdapter } from './runner-adapter'
import type { FolderUploadRunnerPort } from './runner-port'
import { FolderUploadError } from './transport'
import type { FolderUploadLimits } from './types'

/**
 * The folder-upload seam of the main process: what `index.ts` hands to
 * `createUniworkDocs` (`UniworkDocsWiring.folderUpload`). It turns the server's
 * `documents.limits` into the planner's limits and builds the batch runner over
 * one transport per workspace. Electron-free: the host passes `net.fetch` for
 * storage and the signed-in client options.
 */

export interface FolderUploadWireDeps {
  /** the server's document limits (the docs service's cache) */
  limits(): Promise<DocumentLimits> | DocumentLimits
  /** the signed-in docs client options; null when signed out or no deployment is set */
  clientOptions(): UniworkDocsClientOptions | null
  /** the fetch for presigned storage URLs (Electron's `net.fetch`) */
  storageFetch: FetchLike
  /** test seam: the transport factory */
  createTransport?: typeof createFolderUploadTransport
}

/** what the host gives the runner once it exists: the way to refresh the lists */
export interface FolderUploadRunnerHooks {
  invalidate(workspaceId: string): void
}

export interface FolderUploadWiring {
  /** the planner limits; null = the server has no folder_upload block (files go one by one) */
  getLimits(): Promise<FolderUploadLimits | null>
  runner(hooks: FolderUploadRunnerHooks): FolderUploadRunnerPort
}

export function createFolderUploadWiring(deps: FolderUploadWireDeps): FolderUploadWiring {
  const createTransport = deps.createTransport ?? createFolderUploadTransport
  const runLimits = async () => folderUploadRunLimits(await deps.limits())
  return {
    async getLimits() {
      const limits = await runLimits()
      if (!limits) return null
      return {
        maxFiles: limits.maxFiles,
        maxFolders: limits.maxFolders,
        maxTotalBytes: limits.maxTotalBytes,
        maxDepth: limits.maxDepth,
        perFileMaxBytes: limits.perFileMaxBytes,
        ...(limits.uploadExtensions ? { uploadExtensions: limits.uploadExtensions } : {}),
      }
    },
    runner: (hooks) =>
      createFolderUploadRunnerAdapter({
        transportFor: (workspaceId) => {
          const options = deps.clientOptions()
          if (!options) throw new FolderUploadError('session', 'Signed out')
          return createTransport(options, workspaceId, { storageFetch: deps.storageFetch })
        },
        runLimits,
        onInvalidate: (workspaceId) => hooks.invalidate(workspaceId),
      }),
  }
}
