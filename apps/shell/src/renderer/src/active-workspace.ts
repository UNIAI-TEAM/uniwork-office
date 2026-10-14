import type { UniworkResult, UniworkWorkspaceRef } from '../../shared/home-api'
import { workErrorOfDocCode, type UniworkWorkError } from '../../shared/uniwork-work-api'
import { wbStoreGetRaw, wbStoreSetRaw } from './workbench-store-client'

/**
 * The UniWork workspace the Workbench and the Open from UniWork dialog show.
 * Kept in the workbench store, whose bucket is already per (deployment,
 * account, org): the key carries no ids, and an org switch starts from that
 * org's own choice (or its first workspace).
 */
export const ACTIVE_WORKSPACE_KEY = 'uniwork.wb.activeWorkspace'

export function readActiveWorkspaceId(): string | null {
  return wbStoreGetRaw(ACTIVE_WORKSPACE_KEY) || null
}

export function writeActiveWorkspaceId(id: string): void {
  wbStoreSetRaw(ACTIVE_WORKSPACE_KEY, id)
}

/** the stored workspace while it is still listed, else the first one, else null (no workspace yet) */
export function pickActiveWorkspace(
  items: readonly UniworkWorkspaceRef[],
  stored: string | null,
): string | null {
  return items.find((w) => w.id === stored)?.id ?? items[0]?.id ?? null
}

/** The Workbench's workspace list; `workspaces` null = still loading. */
export interface WorkspaceListState {
  workspaces: UniworkWorkspaceRef[] | null
  workspaceId: string | null
  workspaceError: UniworkWorkError | null
}

/**
 * State after a list answer. A failure keeps the last good list and pick, so an
 * offline Refresh never reads as "no workspace" and the tabs keep their cached
 * data. A first failure is an empty list, so the tabs show the error, not a skeleton.
 */
export function afterWorkspaceList(
  prev: WorkspaceListState,
  result: UniworkResult<UniworkWorkspaceRef[]>,
  stored: string | null,
): WorkspaceListState {
  if (!result.ok) {
    return {
      ...prev,
      workspaces: prev.workspaces ?? [],
      workspaceError: workErrorOfDocCode(result.error),
    }
  }
  return {
    workspaces: result.value,
    workspaceId: pickActiveWorkspace(result.value, stored),
    workspaceError: null,
  }
}
