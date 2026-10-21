/**
 * UNI-2052: the renderer's view of the folder / multi-file upload bridge.
 *
 * The shapes are the shared IPC types (`shared/folder-upload-api.ts`) and the
 * object is the one the preload exposes as `window.uniworkFolderUpload`; this
 * file only gives them the names the screens use. An older main without the
 * bridge leaves it absent and the feature stays hidden. The absolute paths of
 * a pre-flight stay in main (keyed by `preflightId`): the renderer only ever
 * sees relative paths.
 */
import type {
  BatchUploadFailure,
  BatchUploadMode,
  BatchUploadPhase,
  BatchUploadProgress,
  BatchUploadSkipReason,
  FolderUploadBridge,
  PreflightSDO,
} from '../../../shared/folder-upload-api'

export type { FolderUploadBridge, PreflightSDO }

/** A run of one picked or dropped folder, or of loose files straight into the destination */
export type FolderUploadMode = BatchUploadMode
/** Why a file is not in the run: the web's five reasons plus the three only the desktop app can see */
export type FolderUploadSkipReason = BatchUploadSkipReason
export type FolderUploadPhase = BatchUploadPhase
export type FolderUploadFailure = BatchUploadFailure
export type FolderUploadProgressEvent = BatchUploadProgress

declare global {
  interface Window {
    uniworkFolderUpload?: FolderUploadBridge
  }
}

/** The bridge, or null when this main does not have it (the feature is then hidden) */
export function getFolderUploadBridge(): FolderUploadBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = window.uniworkFolderUpload
  return bridge && typeof bridge.pick === 'function' ? bridge : null
}
