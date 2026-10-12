import type { Editor } from '@tiptap/core'
import type { PmNode } from '../editor/convert'
import { TABLE_TRAILING_SKIP } from '../editor/extensions'

/**
 * A run's rollback point. The ProseMirror tree is only part of what the AI
 * tools change: comments, headers/footers, the style table, page setup and the
 * watermark live in App state beside it and are written on save. The snapshot
 * carries both, so Roll back returns the whole document to before the run.
 */
export interface AiRunSnapshot {
  doc: PmNode
  /** opaque value from AiSideState.capture() */
  side?: unknown
}

/** one piece of App state the rollback restores (read live, written through its setter) */
export interface AiSideSlice {
  get(): unknown
  set(value: unknown): void
}

export interface AiSideState {
  capture(): unknown
  /** false when the state no longer applies (the file was saved or reloaded since) */
  restore(state: unknown): boolean
}

interface CapturedSide {
  key: unknown
  values: Record<string, unknown>
}

/**
 * Side state over named slices. `docKey` identifies the loaded file version: a
 * save or reload re-reads the file and resets every slice from it, so a
 * pre-run capture taken against an older version is not replayed (the
 * document tree still rolls back).
 */
export function createAiSideState(
  slices: Record<string, AiSideSlice>,
  docKey: () => unknown,
): AiSideState {
  return {
    capture: (): CapturedSide => ({
      key: docKey(),
      values: Object.fromEntries(Object.entries(slices).map(([name, s]) => [name, s.get()])),
    }),
    restore: (state) => {
      const captured = state as CapturedSide | undefined
      if (!captured || captured.key !== docKey()) return false
      for (const [name, slice] of Object.entries(slices)) {
        if (!(name in captured.values)) continue
        const value = captured.values[name]
        if (slice.get() !== value) slice.set(value)
      }
      return true
    },
  }
}

export function captureRunSnapshot(editor: Editor, side?: AiSideState): AiRunSnapshot {
  const doc = editor.getJSON() as PmNode
  return side ? { doc, side: side.capture() } : { doc }
}

export function restoreRunSnapshot(
  editor: Editor,
  snapshot: AiRunSnapshot,
  side?: AiSideState,
): { sideRestored: boolean } {
  editor
    .chain()
    .setMeta(TABLE_TRAILING_SKIP, true)
    .setContent(snapshot.doc as never)
    .run()
  const sideRestored =
    side !== undefined && snapshot.side !== undefined && side.restore(snapshot.side)
  return { sideRestored }
}
