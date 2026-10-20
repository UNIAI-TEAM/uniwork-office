/**
 * UNI-1993 (UW-SOURCE-RO) contract 3.7 item 4: all six editor modules read the
 * source view through the one seam they already use. The mains are replaced by
 * setters that forward to each module's real `uniwork-policy`, so the policy
 * helpers the editors call (`uniworkIsBound`, `uniworkIsReadOnly`,
 * `uniworkIsLocked`, `uniworkReadOnlySave`, `uniworkSaveDecision`) run for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as docs from '../../docs/src/main/uniwork-policy'
import * as html from '../../html/src/main/uniwork-policy'
import * as markdown from '../../markdown/src/main/uniwork-policy'
import * as pdf from '../../pdf/src/main/uniwork-policy'
import * as sheets from '../../sheets/src/main/uniwork-policy'
import * as slides from '../../slides/src/main/uniwork-policy'

// modules.ts imports the six editor mains (Electron-bound): stand-ins that only
// install the policy and hook into the module's real uniwork-policy
vi.mock('../../docs/src/main/docs-main', async () => {
  const real = await import('../../docs/src/main/uniwork-policy')
  return {
    setUniworkDocumentPolicy: real.setUniworkDocumentPolicy,
    setDocsUserSaveHook: real.setUniworkUserSaveHook,
    clearDocsOriginalsFor: () => undefined,
    clearDocsRecoveryCopy: () => undefined,
  }
})
vi.mock('../../sheets/src/main/sheets-main', async () => {
  const real = await import('../../sheets/src/main/uniwork-policy')
  return {
    setUniworkDocumentPolicy: real.setUniworkDocumentPolicy,
    setSheetsUserSaveHook: real.setUniworkUserSaveHook,
    clearWorkbookRecovery: () => undefined,
  }
})
vi.mock('../../slides/src/main/slides-main', async () => {
  const real = await import('../../slides/src/main/uniwork-policy')
  return {
    setUniworkDocumentPolicy: real.setUniworkDocumentPolicy,
    setSlidesUserSaveHook: real.setUniworkUserSaveHook,
    clearSlidesRecovery: () => undefined,
  }
})
vi.mock('../../pdf/src/main/pdf-main', async () => {
  const real = await import('../../pdf/src/main/uniwork-policy')
  return {
    setUniworkDocumentPolicy: real.setUniworkDocumentPolicy,
    setPdfUserSaveHook: real.setUniworkUserSaveHook,
  }
})
vi.mock('../../markdown/src/main/markdown-main', async () => {
  const real = await import('../../markdown/src/main/uniwork-policy')
  return {
    setUniworkDocumentPolicy: real.setUniworkDocumentPolicy,
    setMarkdownUserSaveHook: real.setUniworkUserSaveHook,
  }
})
vi.mock('../../html/src/main/html-main', async () => {
  const real = await import('../../html/src/main/uniwork-policy')
  return {
    setUniworkDocumentPolicy: real.setUniworkDocumentPolicy,
    setHtmlUserSaveHook: real.setUniworkUserSaveHook,
  }
})

import { installUniworkModuleSeams, type UniworkModuleSeam } from '../src/main/uniwork-docs/modules'
import { SourceViewRegistry, withSourceViews } from '../src/main/uniwork-docs/source-view'

const SOURCE = '/u/uniwork-drafts-preview/sources-s1/ab12/Plan.docx'
const LOCAL = '/home/me/Documents/notes.docx'
const BOUND = '/u/uniwork-documents/dep/acc/doc1/Plan.docx'

const MODULES = [
  ['docs', docs],
  ['sheets', sheets],
  ['slides', slides],
  ['pdf', pdf],
  ['markdown', markdown],
  ['html', html],
] as const

function serviceSeam() {
  return {
    isBound: vi.fn((p: string) => p === BOUND),
    isReadOnly: vi.fn((p: string) => p === BOUND),
    isLocked: vi.fn(() => false),
    onUserSave: vi.fn(),
    onReadOnlySave: vi.fn(),
    refuseLockedPath: vi.fn(() => false),
  } satisfies UniworkModuleSeam
}

let registry: SourceViewRegistry
beforeEach(() => {
  registry = new SourceViewRegistry()
  registry.add(SOURCE, { name: 'Plan.docx', origin: 'chat', parentTitle: 'Launch' })
})
afterEach(() => installUniworkModuleSeams(null))

describe.each(MODULES)('%s sees a source view through the module seam', (_name, mod) => {
  it('reads bound + read-only + locked for the source path, and the service verdict for the rest', () => {
    const service = serviceSeam()
    installUniworkModuleSeams(service, null, { registry })
    expect(mod.uniworkIsBound(SOURCE)).toBe(true)
    expect(mod.uniworkIsReadOnly(SOURCE)).toBe(true)
    expect(mod.uniworkIsLocked(SOURCE)).toBe(true)
    // a real working copy still follows the service; a plain local file stays plain
    expect(mod.uniworkIsBound(BOUND)).toBe(true)
    expect(mod.uniworkIsReadOnly(BOUND)).toBe(true)
    expect(mod.uniworkIsLocked(BOUND)).toBe(false)
    expect(mod.uniworkIsBound(LOCAL)).toBe(false)
    expect(mod.uniworkIsReadOnly(LOCAL)).toBe(false)
    expect(mod.uniworkIsLocked(LOCAL)).toBe(false)
  })

  it('Ctrl+S on the source path reaches the source hint, not the service popover', () => {
    const service = serviceSeam()
    const onSourceSave = vi.fn()
    installUniworkModuleSeams(service, null, { registry, onSourceSave })
    mod.uniworkReadOnlySave(SOURCE)
    expect(onSourceSave).toHaveBeenCalledWith(SOURCE)
    expect(service.onReadOnlySave).not.toHaveBeenCalled()
    mod.uniworkReadOnlySave(BOUND)
    expect(service.onReadOnlySave).toHaveBeenCalledWith(BOUND)
  })

  it('a refused export / Save As / print on the source path asks the shell for the hint; other paths stay silent', () => {
    const service = serviceSeam()
    const onSourceLocked = vi.fn()
    installUniworkModuleSeams(service, null, { registry, onSourceLocked })
    expect(mod.uniworkIsLocked(SOURCE)).toBe(true)
    expect(onSourceLocked).toHaveBeenCalledWith(SOURCE)
    onSourceLocked.mockClear()
    expect(mod.uniworkIsLocked(BOUND)).toBe(false)
    expect(mod.uniworkIsLocked(LOCAL)).toBe(false)
    expect(onSourceLocked).not.toHaveBeenCalled()
  })

  it('a user save is refused and fires no hook', () => {
    const service = serviceSeam()
    installUniworkModuleSeams(service, null, { registry })
    // the save-gate input differs per module; one superset carries every field
    const verdict =
      mod === docs
        ? docs.uniworkSaveDecision('user', SOURCE)
        : (mod.uniworkSaveDecision as (input: unknown) => { write: boolean; fireHook: boolean })({
            origin: 'user',
            kind: 'save',
            mode: 'save',
            saveAs: false,
            currentPath: SOURCE,
            targetPath: SOURCE,
          })
    expect(verdict?.write).toBe(false)
    expect(verdict?.fireHook).toBe(false)
    mod.notifyUniworkUserSave(SOURCE)
    expect(service.onUserSave).not.toHaveBeenCalled()
  })
})

describe('installUniworkModuleSeams without a source registry', () => {
  it('is the same as before: an unregistered path is whatever the service says', () => {
    const service = serviceSeam()
    installUniworkModuleSeams(service)
    for (const [, mod] of MODULES) {
      expect(mod.uniworkIsBound(SOURCE)).toBe(false)
      expect(mod.uniworkIsReadOnly(SOURCE)).toBe(false)
      expect(mod.uniworkIsLocked(SOURCE)).toBe(false)
    }
    docs.notifyUniworkUserSave(LOCAL)
    expect(service.onUserSave).toHaveBeenCalledWith(LOCAL)
  })

  it('composes with an already wrapped seam (withSourceViews outside)', () => {
    installUniworkModuleSeams(withSourceViews(serviceSeam(), registry))
    for (const [, mod] of MODULES) {
      expect(mod.uniworkIsBound(SOURCE)).toBe(true)
      expect(mod.uniworkIsReadOnly(SOURCE)).toBe(true)
      expect(mod.uniworkIsLocked(SOURCE)).toBe(true)
    }
  })

  it('a removed source reads as a plain path again (the tab closed and the file was swept)', () => {
    installUniworkModuleSeams(serviceSeam(), null, { registry })
    registry.remove(SOURCE)
    for (const [, mod] of MODULES) expect(mod.uniworkIsReadOnly(SOURCE)).toBe(false)
  })
})
