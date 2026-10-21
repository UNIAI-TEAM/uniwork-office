import { planFileUpload, planFolderUpload } from '../src/main/uniwork-docs/folder-upload/plan'
import type { PlannedBatch } from '../src/main/uniwork-docs/folder-upload/runner-types'
import type { FolderUploadLimits } from '../src/main/uniwork-docs/folder-upload/types'

/**
 * Test helper over the app's real planner (folder-upload/plan.ts): turns
 * `{path, size}` entries into the plan the runner takes. The limits are wide
 * open so a test only meets the planner's name and format rules; a plan the
 * planner refuses or trims is a broken test, so it throws.
 */
export interface PlanEntry {
  /** relative path with `/`; folder mode: the first segment is the root folder */
  path: string
  size: number
}

const OPEN_LIMITS: FolderUploadLimits = {
  maxFiles: 10_000,
  maxFolders: 10_000,
  maxTotalBytes: Number.MAX_SAFE_INTEGER,
  maxDepth: 100,
  perFileMaxBytes: Number.MAX_SAFE_INTEGER,
}

function whole(plan: ReturnType<typeof planFolderUpload>, entries: PlanEntry[]): PlannedBatch {
  if (plan.refusal || plan.skipped.length > 0 || plan.files.length !== entries.length) {
    throw new Error(
      `the planner trimmed the test plan: ${JSON.stringify({ refusal: plan.refusal, skipped: plan.skipped })}`,
    )
  }
  return plan
}

/** folder mode: every path starts with the root folder segment */
export function plannedBatch(entries: PlanEntry[], rootTitle?: string): PlannedBatch {
  const plan = whole(
    planFolderUpload(entries, { limits: OPEN_LIMITS, parentLevel: 1, siblingNames: [] }),
    entries,
  )
  return rootTitle === undefined ? plan : { ...plan, rootTitle }
}

/** files mode: no root, no folders, every path is a bare file name */
export function plannedFiles(entries: PlanEntry[]): PlannedBatch {
  return whole(planFileUpload(entries, { limits: OPEN_LIMITS, parentLevel: 1 }), entries)
}
