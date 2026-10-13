// G6-12 (UNI-1366) review R1-1/R1-3 (sheets-safety): the merge's inline [Undo] and the undo depth
// it is derived from. The App hands the skill `mergePathsWithUndo(...)`; the skill's merge tool
// must leave the last assistant entry with `autoApplied.undoSteps`, which the panel renders as [Undo].
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { AiChatMessage } from '../src/renderer/ai/AiChatPanel'
import { createMergeSkill, mergePathsWithUndo } from '../src/renderer/ai/merge-skill'
import type { MergeSourcesResult } from '../src/renderer/merge-workbooks'
import { mergeSourcesIntoCurrent } from '../src/renderer/merge-workbooks'
import { undoStackDepth } from '../src/renderer/undo-carry'

const att = { path: '/tmp/a.xlsx', name: 'a.xlsx', ext: 'xlsx', sizeBytes: 10 }

/** the App's patchLastAssistant over a one-entry transcript */
function transcript() {
  let entries: AiChatMessage[] = [{ role: 'assistant', text: 'merging…' } as AiChatMessage]
  return {
    patchLast: (patch: (entry: AiChatMessage) => AiChatMessage) => {
      entries = [...entries.slice(0, -1), patch(entries.at(-1)!)]
    },
    last: () => entries.at(-1)!,
  }
}

async function runMergeTool(result: MergeSourcesResult, chat = transcript()) {
  const skill = createMergeSkill({
    getAttachments: () => [att],
    mergePaths: mergePathsWithUndo(async () => result, chat.patchLast),
  })
  const exec = await skill.executeTool!({
    id: 't1',
    name: 'merge_attached_workbooks',
    input: {},
  } as never)
  return { exec, chat }
}

describe('merge_attached_workbooks lands an inline [Undo] on the last assistant entry', () => {
  it('a merge of 1 sheet / 2 undo steps gains autoApplied.undoSteps = 2', async () => {
    const { exec, chat } = await runMergeTool({
      importedSheets: 1,
      files: 1,
      sheetNames: ['Data'],
      undoSteps: 2,
    })
    expect(exec.isError).toBeFalsy()
    expect(chat.last().autoApplied).toEqual({ opCount: 1, undoSteps: 2 })
  })

  it('adds to an [Undo] the entry already has (an earlier applied plan in the same run)', async () => {
    const chat = transcript()
    chat.patchLast((entry) => ({ ...entry, autoApplied: { opCount: 3, undoSteps: 1 } }))
    await runMergeTool({ importedSheets: 2, files: 1, sheetNames: ['A', 'B'], undoSteps: 4 }, chat)
    expect(chat.last().autoApplied).toEqual({ opCount: 5, undoSteps: 5 })
  })

  it('offers no [Undo] when the bounded history may have dropped part of the merge', async () => {
    const { chat } = await runMergeTool({
      importedSheets: 1,
      files: 1,
      sheetNames: ['Data'],
      undoSteps: null,
    })
    expect(chat.last().autoApplied).toBeUndefined()
  })

  it('App.tsx hands the skill the wrapper, not the bare merge', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/App.tsx'),
      'utf8',
    )
    expect(source).toContain('mergePathsWithUndo(')
  })
})

describe('the merge reads its undo depth from the unit it started on', () => {
  function runtimeWith(stacks: Record<string, unknown[]>, active: () => string) {
    const service = { _undoStacks: new Map(Object.entries(stacks)) }
    return {
      univerAPI: { getActiveWorkbook: () => ({ getId: () => active(), getSheets: () => [] }) },
      univer: { __getInjector: () => ({ get: () => service }) },
    } as never
  }

  it('undoStackDepth(runtime, unitId) reads that unit, whichever is active', () => {
    const runtime = runtimeWith({ u1: [1, 2, 3], u2: [1] }, () => 'u2')
    expect(undoStackDepth(runtime)).toBe(1)
    expect(undoStackDepth(runtime, 'u1')).toBe(3)
  })

  it('a merge that finishes with another unit active still counts its own unit', async () => {
    let active = 'u1'
    const runtime = runtimeWith({ u1: [1, 2], u2: [1, 2, 3, 4, 5] }, () => active)
    const setMessage = vi.fn((message: string) => {
      // the active unit changes while the merge ran (the tab/session swapped)
      if (message) active = 'u2'
    })
    const result = await mergeSourcesIntoCurrent(
      { runtime, lazyWorkbookRef: { current: null }, setMessage },
      [],
    )
    // u1 held 2 entries before and after: 0 steps (a read of the active u2 would say 3)
    expect(result.undoSteps).toBe(0)
  })
})
