/**
 * G5-09 desktop conflict dialog (EXPERIENCE S5): what main sends the shell
 * renderer, and what the renderer answers.
 */

/** the in-flight intent state that blocks Reload / Overwrite / Save as a copy */
export type UniworkConflictIntentBlock = 'none' | 'committing' | 'reconciling' | 'reconciling-stuck'

/** why "Keep my version as a draft" cannot be chosen ('ok' = it can) */
export type UniworkConflictKeepDraft = 'ok' | 'drafts_full' | 'store_full' | 'keystore_locked'

/** one line in the dialog's alert region (`role=alert`), null = none */
export type UniworkConflictNotice =
  | 'head_moved'
  | 'reload_failed'
  | 'overwrite_failed'
  | 'save_copy_done'
  | 'save_copy_failed'
  /** G5-12: the copy was refused because the person is not a member of the source's workspace */
  | 'save_copy_no_seat'
  /** G5-12 (BE-12-304): the copy was refused by the folder the source sits in (403 forbidden) */
  | 'save_copy_folder_refused'
  /** G5-12: "Download my version" wrote the file (noticeArg = its name) */
  | 'download_done'
  | 'download_failed'

export interface UniworkConflictView {
  /** a fresh id per opened dialog; every answer echoes it */
  sessionId: string
  path: string
  documentId: string
  title: string
  /** module of the open document; 'docs' shows "View differences" (v1: Docs/DOCX only) */
  module: 'docs' | 'sheets' | 'slides' | 'other'
  mine: { baseVersion: number | null }
  server: { version: number | null; savedAt: string | null; by: string | null }
  /** edit access still held; false = no Overwrite, no Save as a copy, line uwConflictNoEdit */
  canEdit: boolean
  online: boolean
  /** the head's bytes are in the offline library (always false until G5-05) */
  headOffline: boolean
  intent: UniworkConflictIntentBlock
  keepDraft: UniworkConflictKeepDraft
  draftCap: number
  aiRunning: boolean
  /** in-place lock while open: lost read access / deleted → body + Close only */
  locked: 'none' | 'revoked' | 'deleted'
  notice: UniworkConflictNotice | null
  /**
   * head version for uwConflictHeadMoved {n}, the copy title for uwConflictSaveCopyDone {title},
   * or the saved file name for uwConflictDownloadDone {file}
   */
  noticeArg: string | null
}

export type UniworkConflictAction =
  | { kind: 'cancel' }
  | { kind: 'reload'; keep: 'draft' | 'discard'; stopAi: boolean }
  | { kind: 'overwrite'; stopAi: boolean }
  | { kind: 'save-copy'; stopAi: boolean }
  /** G5-12: the no-seat fallback of Save as a copy - the local version to a file the person picks */
  | { kind: 'download-mine'; stopAi: boolean }

/**
 * main's answer: 'closed' = the dialog is over (status is the document now);
 * 'view' = stay open and re-render with the new view (head moved, failure,
 * save-copy done/failed, lock while open).
 */
export type UniworkConflictReply = { kind: 'closed' } | { kind: 'view'; view: UniworkConflictView }
