/**
 * G5-11f (d3-1): the shell's sign-out sweep clears the crash-recovery copy of
 * a working copy through one registered clearer. It must reach all three
 * editors that keep recovery copies under userData; slides had no clearer, so a
 * tick landing after the sweep wrote the deck's plaintext back.
 */
import { describe, expect, it, vi } from 'vitest'

const { calls, recordingMain } = vi.hoisted(() => {
  const names: string[] = []
  const recording = (clearers: Record<string, string>) => {
    const out: Record<string, unknown> = {
      setUniworkDocumentPolicy: () => {},
    }
    for (const [exportName, label] of Object.entries(clearers)) {
      out[exportName] = (path: string) => void names.push(`${label}:${path}`)
    }
    return out
  }
  return { calls: { names }, recordingMain: recording }
})

vi.mock('../../docs/src/main/docs-main', () => ({
  ...recordingMain({ clearDocsRecoveryCopy: 'docs' }),
  clearDocsOriginalsFor: () => {},
  setDocsUserSaveHook: () => {},
}))
vi.mock('../../sheets/src/main/sheets-main', () => ({
  ...recordingMain({ clearWorkbookRecovery: 'sheets' }),
  setSheetsUserSaveHook: () => {},
}))
vi.mock('../../slides/src/main/slides-main', () => ({
  ...recordingMain({ clearSlidesRecovery: 'slides' }),
  setSlidesUserSaveHook: () => {},
}))
vi.mock('../../pdf/src/main/pdf-main', () => ({
  ...recordingMain({}),
  setPdfUserSaveHook: () => {},
}))
vi.mock('../../markdown/src/main/markdown-main', () => ({
  ...recordingMain({}),
  setMarkdownUserSaveHook: () => {},
}))
vi.mock('../../html/src/main/html-main', () => ({
  ...recordingMain({}),
  setHtmlUserSaveHook: () => {},
}))

import { installUniworkModuleSeams } from '../src/main/uniwork-docs/modules'

describe('installUniworkModuleSeams clear-recovery seam', () => {
  it('the registered clearer reaches docs, sheets and slides', () => {
    let registered: ((path: string) => void) | null = null
    installUniworkModuleSeams({
      isBound: () => true,
      isReadOnly: () => false,
      onUserSave: () => {},
      refuseLockedPath: () => false,
      setClearRecovery: (clear: (path: string) => void) => {
        registered = clear
      },
    } as never)
    expect(registered).not.toBeNull()
    registered!('/u/deck.pptx')
    expect(calls.names.sort()).toEqual([
      'docs:/u/deck.pptx',
      'sheets:/u/deck.pptx',
      'slides:/u/deck.pptx',
    ])
  })
})
