/**
 * UNI-2244: the wire bodies of the folder contents access routes (spec §3.1/§3.2), under the names
 * the web's `folder-contents-access.fixtures.ts` uses. They are what the server sends, in snake_case,
 * so the client / parse tests feed them straight in and the fake test checks the fake's answers
 * against them (same numbers, read through the parser). Plain ids only.
 */

export const FOLDER_BATCH_ID = 'b_1'

/** the fake's fixed clock (`fake-share-api.ts`): the `finished_at` of an ended run */
export const FOLDER_FINISHED_AT = '2026-10-20T01:00:00Z'

export const dryRunMerge = {
  total: 42,
  preview: {
    changed: 37,
    unchanged: 0,
    skipped_not_manageable: 5,
    skipped_locked: 0,
    losing_users: 0,
    downgraded_users: 0,
    warnings: ['wide_scope'],
  },
}

export const dryRunReplace = {
  total: 42,
  preview: {
    changed: 37,
    unchanged: 0,
    skipped_not_manageable: 5,
    skipped_locked: 0,
    losing_users: 12,
    downgraded_users: 3,
    warnings: ['wide_scope', 'to_private', 'downgrade'],
  },
}

export const syncResult = {
  batch_id: FOLDER_BATCH_ID,
  mode: 'sync',
  total: 42,
  changed: 37,
  unchanged: 0,
  skipped_not_manageable: 5,
  skipped_locked: 0,
}

export const backgroundAccepted = { batch_id: FOLDER_BATCH_ID, mode: 'background', total: 1800 }

export const batchRunning = {
  batch_id: FOLDER_BATCH_ID,
  status: 'running',
  total: 1800,
  processed: 600,
  changed: 596,
  unchanged: 0,
  skipped_not_manageable: 3,
  skipped_locked: 0,
  finished_at: null,
}

export const batchCompleted = {
  batch_id: FOLDER_BATCH_ID,
  status: 'completed',
  total: 1800,
  processed: 1800,
  changed: 1790,
  unchanged: 0,
  skipped_not_manageable: 10,
  skipped_locked: 0,
  finished_at: FOLDER_FINISHED_AT,
}

/** stopped half way: what it wrote stays */
export const batchFailed = {
  batch_id: FOLDER_BATCH_ID,
  status: 'failed',
  total: 1800,
  processed: 900,
  changed: 895,
  unchanged: 0,
  skipped_not_manageable: 5,
  skipped_locked: 0,
  finished_at: FOLDER_FINISHED_AT,
}

/** the error envelopes (`{error:{code, message, fields?}}`), with the status each comes with */
export const notAFolderError = {
  status: 422,
  body: { error: { code: 'not_a_folder', message: 'x' } },
}

/** BE-1's four rejected codes, one row each (`manage` is refused for a workspace / organization row) */
export const documentAccessRejectedError = {
  status: 422,
  body: {
    error: {
      code: 'document_access_rejected',
      message: 'x',
      fields: {
        rejected: [
          {
            index: 0,
            principal_type: 'organization',
            principal_id: 'org_1',
            code: 'level_not_allowed',
          },
          {
            index: 1,
            principal_type: 'user',
            principal_id: 'u_out',
            code: 'principal_not_in_organization',
          },
          { index: 2, principal_type: 'user', principal_id: 'u_dup', code: 'duplicate_principal' },
          { index: 3, principal_type: 'user', principal_id: 'u_bg', code: 'break_glass_required' },
        ],
      },
    },
  },
}

export const batchRunningError = {
  status: 409,
  body: {
    error: {
      code: 'folder_access_batch_running',
      message: 'x',
      fields: { batch_id: FOLDER_BATCH_ID },
    },
  },
}

/** BE-1 stub until BE-2: both routes answer a coded 501 (the feature is not on this server yet) */
export const notImplementedError = {
  status: 501,
  body: { error: { code: 'not_implemented', message: 'x' } },
}

/** 400: malformed JSON, unknown mode, bad level, empty merge, more than 100 items */
export const invalidRequestError = {
  status: 400,
  body: { error: { code: 'invalid_request', message: 'x' } },
}

export const invalidJsonError = {
  status: 400,
  body: { error: { code: 'invalid_json', message: 'x' } },
}
