/**
 * G5-04g (R1-be-3): every editor module's open chokepoint asks the shell before
 * it reads a working copy whose folder declares a store this build does not
 * read. The shell forwards service.refuseLockedPath through the module seam as
 * the policy's optional refuseOpen, and the module helper answers "not refused"
 * for a policy without that method, a throwing policy, or no policy at all.
 * (The seam's own decision is exercised at runtime in
 * uniwork-docs-lock-guard.test.ts; this file pins the forwarding and the
 * ordering inside each module's open path.)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  setUniworkDocumentPolicy as setDocsPolicy,
  uniworkRefusesOpen as docsRefusesOpen,
} from '../../docs/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setSheetsPolicy,
  uniworkRefusesOpen as sheetsRefusesOpen,
} from '../../sheets/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setSlidesPolicy,
  uniworkRefusesOpen as slidesRefusesOpen,
} from '../../slides/src/main/uniwork-policy'

// modules.ts fans the seam out to all six editor mains. Their entry points pull
// Electron and module-level timers, so this test replaces them with recording
// setters: only the forwarding logic under test runs. Everything the hoisted
// vi.mock factories touch must live inside vi.hoisted.
const setters = vi.hoisted(() => {
  const policies: unknown[] = []
  const hooks: unknown[] = []
  const recordingMain = () => ({
    setUniworkDocumentPolicy: (policy: unknown) => void policies.push(policy),
  })
  return { policies, hooks, recordingMain }
})

vi.mock('../../docs/src/main/docs-main', () => ({
  ...setters.recordingMain(),
  setDocsUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../sheets/src/main/sheets-main', () => ({
  ...setters.recordingMain(),
  setSheetsUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../slides/src/main/slides-main', () => ({
  ...setters.recordingMain(),
  setSlidesUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../pdf/src/main/pdf-main', () => ({
  ...setters.recordingMain(),
  setPdfUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../markdown/src/main/markdown-main', () => ({
  ...setters.recordingMain(),
  setMarkdownUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../html/src/main/html-main', () => ({
  ...setters.recordingMain(),
  setHtmlUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))

import { installUniworkModuleSeams } from '../src/main/uniwork-docs/modules'

const LOCKED = 'C:/u/uniwork-documents/dep/acc/doc1/Plan.docx'
const OTHER = 'C:/Users/me/Documents/notes.docx'

type Policy = {
  isBound(path: string): boolean
  isReadOnly(path: string): boolean
  refuseOpen?(path: string): boolean
}
type SetPolicy = (next: Policy | null) => void
type RefusesOpen = (path: string | null | undefined) => boolean

const MODULES: Array<[string, SetPolicy, RefusesOpen]> = [
  ['docs', setDocsPolicy, docsRefusesOpen],
  ['sheets', setSheetsPolicy, sheetsRefusesOpen],
  ['slides', setSlidesPolicy, slidesRefusesOpen],
]

afterEach(() => {
  for (const [, setPolicy] of MODULES) setPolicy(null)
})

const read = (relative: string) =>
  readFileSync(join(__dirname, '..', relative), 'utf8').replace(/\r\n/g, '\n')

/** the same for a sibling app, from the repository root */
const readRepo = (relative: string) =>
  readFileSync(join(__dirname, '../../..', relative), 'utf8').replace(/\r\n/g, '\n')

describe('uniworkRefusesOpen (one helper per module)', () => {
  it.each(MODULES)(
    '%s: refuses only the path the policy names',
    (_name, setPolicy, refusesOpen) => {
      // no policy installed (standalone app, or the shell before sign-in wiring)
      expect(refusesOpen(LOCKED)).toBe(false)
      setPolicy({
        isBound: () => true,
        isReadOnly: () => false,
        refuseOpen: (path) => path === LOCKED,
      })
      expect(refusesOpen(LOCKED)).toBe(true)
      expect(refusesOpen(OTHER)).toBe(false)
      // a path-less call never asks
      expect(refusesOpen(null)).toBe(false)
      expect(refusesOpen(undefined)).toBe(false)
    },
  )

  it.each(MODULES)(
    '%s: a policy without refuseOpen or a throwing one never refuses',
    (_name, setPolicy, refusesOpen) => {
      // the pdf / markdown / html shape: only isBound and isReadOnly
      setPolicy({ isBound: () => true, isReadOnly: () => true })
      expect(refusesOpen(LOCKED)).toBe(false)
      // a broken policy must not break a local open
      setPolicy({
        isBound: () => true,
        isReadOnly: () => false,
        refuseOpen: () => {
          throw new Error('boom')
        },
      })
      expect(refusesOpen(LOCKED)).toBe(false)
    },
  )
})

describe('installUniworkModuleSeams forwards refuseLockedPath (R1-be-3)', () => {
  it('every module policy asks the service through refuseOpen', () => {
    const refuseLockedPath = vi.fn((path: string) => path === LOCKED)
    setters.policies.length = 0
    installUniworkModuleSeams({
      isBound: () => false,
      isReadOnly: () => false,
      onUserSave: () => undefined,
      refuseLockedPath,
    })
    // docs, sheets, slides, pdf, markdown, html
    expect(setters.policies).toHaveLength(6)
    for (const policy of setters.policies) {
      const forwarded = policy as { refuseOpen(path: string): boolean }
      expect(forwarded.refuseOpen(LOCKED)).toBe(true)
      expect(forwarded.refuseOpen(OTHER)).toBe(false)
    }
    expect(refuseLockedPath).toHaveBeenCalledTimes(12)
    // null restores genoffice behaviour: no policy, so nothing is refused
    installUniworkModuleSeams(null)
    expect(setters.policies.slice(6)).toEqual([null, null, null, null, null, null])
  })

  it('the seam is the service itself, installed once by index.ts', () => {
    expect(read('src/main/uniwork-docs/modules.ts')).toMatch(
      /refuseOpen: \(path: string\) => seam\.refuseLockedPath\(path\)/,
    )
    // G8-02: the same installation carries the comment-author source
    expect(read('src/main/index.ts')).toMatch(
      /installUniworkModuleSeams\(\s*uniworkService,\s*createCommentAuthorResolver\(\{\s*isBound: \(path\) => uniworkService\.isBound\(path\),\s*displayName: uniworkAccountDisplayName,\s*\}\),\s*\)/,
    )
  })
})

describe('each open chokepoint refuses before its first file read', () => {
  it('docs: loadDocx guards after the type check and before the first read', () => {
    const source = readRepo('apps/docs/src/main/docs-main.ts')
    const fn = source.slice(source.indexOf('async function loadDocx('))
    const typeCheck = fn.indexOf("if (typeof filePath !== 'string'")
    const guard = fn.indexOf('if (uniworkRefusesOpen(filePath)) return null')
    const firstRead = fn.indexOf('existsSync(filePath)')
    expect(typeCheck).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(typeCheck)
    expect(guard).toBeLessThan(firstRead)
    // both docs open routes funnel through this chokepoint
    expect(source).toMatch(
      /ipcMain\.handle\('docs:open', async \(event\) => \{[\s\S]*?loadDocx\(result\.filePaths\[0\], event\.sender\.id\)/,
    )
    expect(source).toMatch(
      /ipcMain\.handle\('docs:open-path', \(event, filePath: string\) => loadDocx\(filePath, event\.sender\.id\)\)/,
    )
  })

  it('slides: openAndBuild guards before readFile and answers null', () => {
    const source = readRepo('apps/slides/src/main/slides-main.ts')
    const fn = source.slice(source.indexOf('async function openAndBuild('))
    const guard = fn.indexOf('if (uniworkRefusesOpen(path)) return null')
    const firstRead = fn.indexOf('await readFile(path)')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(firstRead)
    // null is this function's existing nothing-opened result
    expect(fn.slice(0, guard)).toMatch(/Promise<OpenResult \| null>/)
    // the open routes (picker, path, queued restore) all funnel through it
    expect(source).toMatch(/return openAndBuild\(e\.sender, path, fitWidthPx\)/)
    expect(source).toMatch(
      /result = await openAndBuild\(e\.sender, queued, fitWidthPx, reloading\)/,
    )
    // G5-04g (R1-be-2-3): each route also guards the ORIGINAL path before
    // rejectLegacyPpt reads it, not only inside openAndBuild
    expect(source).toMatch(
      /if \(uniworkRefusesOpen\(r\.filePaths\[0\]\)\) return null\n\s*if \(await rejectLegacyPpt\(r\.filePaths\[0\]\)\) return null/,
    )
    expect(source).toMatch(
      /if \(uniworkRefusesOpen\(path\)\) return null\n\s*if \(await rejectLegacyPpt\(path\)\) return null/,
    )
    expect(source).toMatch(
      /if \(uniworkRefusesOpen\(queued\) \|\| \(await rejectLegacyPpt\(queued\)\)\) \{/,
    )
  })

  it('sheets: openWorkbookSession guards before the snapshot copy', () => {
    const source = readRepo('apps/sheets/src/main/sheets-main.ts')
    const fn = source.slice(source.indexOf('async function openWorkbookSession('))
    const guard = fn.indexOf('if (uniworkRefusesOpen(path)) return null')
    const firstRead = fn.indexOf('await snapshotWorkbook(path)')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(firstRead)
    expect(fn.slice(0, guard)).toMatch(/Promise<WorkbookFile \| null>/)
    // the widened result type is handled at both call sites (open, merge source)
    expect(source).toMatch(/if \(result === null\) return null/)
    expect(source).toMatch(/if \(result === null\) continue/)
    // G5-04g (R1-be-2-2): prepareWorkbookForOpen refuses the ORIGINAL path before
    // it derives one (recovery copy / empty xlsx), so a locked working copy is
    // never opened under a derived path
    const prep = source.slice(source.indexOf('async function prepareWorkbookForOpen('))
    const prepGuard = prep.indexOf('if (uniworkRefusesOpen(path)) return null')
    const derived = prep.indexOf('pendingRecoveryFor(path)')
    expect(prepGuard).toBeGreaterThan(-1)
    expect(prepGuard).toBeLessThan(derived)
    expect(prep.slice(0, prepGuard)).toMatch(/\| null>/)
    // both call sites treat the refused (null) prepare as nothing to open
    expect(source).toMatch(/if \(prepared === null\) return null/)
    expect(source).toMatch(/if \(prepared === null\) continue/)
  })
})
