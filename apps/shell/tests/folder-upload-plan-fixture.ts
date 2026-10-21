import type { PlannedBatch, PlannedFile } from '../src/main/uniwork-docs/folder-upload/runner-types'

/**
 * Test-only stand-in for the planner (FU-A's plan.ts): turns `{path, size}`
 * entries into the PlannedBatch the runner takes, with no limit or skip rules.
 */
export interface PlanEntry {
  /** relative path with `/`; folder mode: the first segment is the root folder */
  path: string
  size: number
}

function plannedFilesOf(entries: PlanEntry[], rooted: boolean): PlannedFile[] {
  return entries.map((entry, index) => {
    // the real planner normalises to NFC, and the runner reports those names
    const path = entry.path.normalize('NFC')
    const slash = path.lastIndexOf('/')
    return {
      path,
      filename: slash < 0 ? path : path.slice(slash + 1),
      folderPath: rooted && slash >= 0 ? path.slice(0, slash) : '',
      size: entry.size,
      index,
    }
  })
}

const sum = (files: PlannedFile[]): number => files.reduce((total, f) => total + f.size, 0)

/** folder mode: every path starts with the root folder segment */
export function plannedBatch(entries: PlanEntry[], rootTitle?: string): PlannedBatch {
  const files = plannedFilesOf(entries, true)
  const rootName = entries[0]?.path.split('/')[0] ?? ''
  const folders = new Set<string>([rootName])
  for (const file of files) {
    const parts = file.folderPath.split('/')
    for (let i = 1; i <= parts.length; i += 1) folders.add(parts.slice(0, i).join('/'))
  }
  return {
    rootName,
    rootTitle: rootTitle ?? rootName,
    folders: [...folders].sort((a, b) => a.split('/').length - b.split('/').length),
    files,
    totals: { files: files.length, bytes: sum(files) },
  }
}

/** files mode: no root, no folders, every path is a bare file name */
export function plannedFiles(entries: PlanEntry[]): PlannedBatch {
  const files = plannedFilesOf(entries, false)
  return {
    rootName: null,
    rootTitle: null,
    folders: [],
    files,
    totals: { files: files.length, bytes: sum(files) },
  }
}
