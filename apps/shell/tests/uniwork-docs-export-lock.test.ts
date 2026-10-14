/**
 * G5-03a W4: a locked working copy (the server revoked or deleted it while it
 * is open) exports nothing — no export, no Save As copy, no print. Every module
 * policy carries the shell's lock answer (service.isLocked through the module
 * seam) and each module's export / Save As / print entry point asks it before
 * it opens a dialog, writes bytes or prints.
 *
 * The per-module helpers, the seam forwarding and the service's own verdict run
 * for real here; the entry points live in modules that pull Electron, so their
 * guard is pinned on the source (the same approach
 * uniwork-docs-module-open-guard.test.ts takes).
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setUniworkDocumentPolicy as setDocsPolicy,
  uniworkIsLocked as docsIsLocked,
} from '../../docs/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setSheetsPolicy,
  uniworkIsLocked as sheetsIsLocked,
} from '../../sheets/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setSlidesPolicy,
  uniworkIsLocked as slidesIsLocked,
} from '../../slides/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setPdfPolicy,
  uniworkIsLocked as pdfIsLocked,
} from '../../pdf/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setMarkdownPolicy,
  uniworkIsLocked as markdownIsLocked,
} from '../../markdown/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setHtmlPolicy,
  uniworkIsLocked as htmlIsLocked,
} from '../../html/src/main/uniwork-policy'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'

// modules.ts fans the seam out to all six editor mains. Their entry points pull
// Electron and module-level timers, so this test replaces them with recording
// setters: only the forwarding logic under test runs.
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
const LOCAL = 'C:/Users/me/Documents/notes.txt'

type Policy = {
  isBound(path: string): boolean
  isReadOnly(path: string): boolean
  isLocked?(path: string): boolean
}
type SetPolicy = (next: Policy | null) => void
type IsLocked = (path: string | null | undefined) => boolean

const MODULES: Array<[string, SetPolicy, IsLocked]> = [
  ['docs', setDocsPolicy, docsIsLocked],
  ['sheets', setSheetsPolicy, sheetsIsLocked],
  ['slides', setSlidesPolicy, slidesIsLocked],
  ['pdf', setPdfPolicy, pdfIsLocked],
  ['markdown', setMarkdownPolicy, markdownIsLocked],
  ['html', setHtmlPolicy, htmlIsLocked],
]

afterEach(() => {
  for (const [, setPolicy] of MODULES) setPolicy(null)
})

const readRepo = (relative: string) =>
  readFileSync(join(__dirname, '../../..', relative), 'utf8').replace(/\r\n/g, '\n')

/** the text from `marker` to the next ipcMain registration: one handler's own code */
function handlerBody(source: string, marker: RegExp): string {
  const found = source.match(marker)
  expect(found, `marker ${marker} not found`).not.toBeNull()
  const at = source.indexOf(found![0])
  const next = source.indexOf('ipcMain.', at + found![0].length)
  return source.slice(at, next === -1 ? undefined : next)
}

/** the head of a named function: enough to see its first guards */
function functionHead(source: string, name: string): string {
  const at = source.indexOf(`export function ${name}(`)
  expect(at, `${name} not found`).toBeGreaterThan(-1)
  return source.slice(at, at + 700)
}

// ── the helper, one per module ─────────────────────────────

describe('uniworkIsLocked (one helper per module)', () => {
  it.each(MODULES)('%s: locks only the path the policy names', (_name, setPolicy, isLocked) => {
    // no policy installed (standalone app, or the shell before sign-in wiring)
    expect(isLocked(LOCKED)).toBe(false)
    setPolicy({
      isBound: () => true,
      isReadOnly: () => true,
      isLocked: (path) => path === LOCKED,
    })
    expect(isLocked(LOCKED)).toBe(true)
    // an unlocked bound copy and a plain local file are unaffected
    expect(isLocked(LOCAL)).toBe(false)
    expect(isLocked(null)).toBe(false)
    expect(isLocked(undefined)).toBe(false)
  })

  it.each(MODULES)(
    '%s: unlocked bound and plain local never refuse; a missing or throwing isLocked reads as unlocked',
    (_name, setPolicy, isLocked) => {
      setPolicy({ isBound: (path) => path === LOCKED, isReadOnly: () => false })
      // the pdf / markdown / html shape: only isBound and isReadOnly
      expect(isLocked(LOCKED)).toBe(false)
      expect(isLocked(LOCAL)).toBe(false)
      // a broken policy must not break a local export
      setPolicy({
        isBound: () => true,
        isReadOnly: () => false,
        isLocked: () => {
          throw new Error('boom')
        },
      })
      expect(isLocked(LOCKED)).toBe(false)
    },
  )
})

describe('installUniworkModuleSeams forwards the lock answer', () => {
  it('every module policy asks the seam through isLocked', () => {
    const isLocked = vi.fn((path: string) => path === LOCKED)
    setters.policies.length = 0
    installUniworkModuleSeams({
      isBound: () => false,
      isReadOnly: () => false,
      isLocked,
      onUserSave: () => undefined,
      refuseLockedPath: () => false,
    })
    // docs, sheets, slides, pdf, markdown, html
    expect(setters.policies).toHaveLength(6)
    for (const policy of setters.policies) {
      const forwarded = policy as { isLocked(path: string): boolean }
      expect(forwarded.isLocked(LOCKED)).toBe(true)
      expect(forwarded.isLocked(LOCAL)).toBe(false)
    }
    expect(isLocked).toHaveBeenCalledTimes(12)
    // null restores genoffice behaviour: no policy, so nothing is locked
    installUniworkModuleSeams(null)
    expect(setters.policies.slice(6)).toEqual([null, null, null, null, null, null])
  })

  it('a seam without isLocked never locks, and modules.ts installs the forwarding', () => {
    setters.policies.length = 0
    installUniworkModuleSeams({
      isBound: () => false,
      isReadOnly: () => false,
      onUserSave: () => undefined,
      refuseLockedPath: () => false,
    })
    for (const policy of setters.policies) {
      const forwarded = policy as { isLocked(path: string): boolean }
      expect(forwarded.isLocked(LOCKED)).toBe(false)
    }
    expect(readRepo('apps/shell/src/main/uniwork-docs/modules.ts')).toMatch(
      /isLocked: \(path: string\) => seam\.isLocked\?\.\(path\) === true/,
    )
    // the seam is the service itself, installed once by index.ts
    expect(readRepo('apps/shell/src/main/index.ts')).toMatch(
      /installUniworkModuleSeams\(\s*uniworkService,/,
    )
  })
})

// ── the service's own verdict ──────────────────────────────

const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const DOC_DELETED = '01J8X4DOC0N1P2Q3R4S5T6U8'
const DOC_HEALTHY = '01J8X4DOC0N1P2Q3R4S5T6U9'
const sha256Hex = (bytes: string) => createHash('sha256').update(bytes).digest('hex')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-export-lock-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** the working copy of one document, with an optional blocked verdict */
function seedCopy(documentId: string, over: Record<string, unknown> = {}): string {
  const documentDir = join(dir, 'uniwork-documents', 'default', 'acc_1', documentId)
  mkdirSync(documentDir, { recursive: true })
  const filePath = join(documentDir, 'Plan.docx')
  const bytes = `working copy of ${documentId}`
  writeFileSync(filePath, bytes)
  writeFileSync(
    join(documentDir, BINDING_FILE),
    `${JSON.stringify(
      {
        schema: 2,
        documentId,
        workspaceId: 'ws_1',
        orgId: 'org_a',
        title: 'Plan.docx',
        filename: 'Plan.docx',
        format: 'docx',
        access: 'edit',
        baseRevision: '9',
        baseVersion: 3,
        baseChecksum: sha256Hex(bytes),
        state: 'saved',
        min_store_level: 2,
        min_app_version: '0.11.0',
        ...over,
      },
      null,
      2,
    )}\n`,
  )
  return filePath
}

function serviceFor(): UniworkDocsService {
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  return new UniworkDocsService({
    userDataDir: dir,
    appVersion: () => '0.11.0',
    profile: () => ({
      deploymentId: 'default',
      apiOrigin: 'https://uniwork.example',
      clientId: 'uniwork-office',
      channel: 'stable',
    }),
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('fake-token'),
    openPath: () => false,
    isPathOpen: () => false,
    requestModuleSave: () => false,
    reloadPath: () => undefined,
    activePath: () => undefined,
    ui,
    pushStatus: () => undefined,
    pushLaunch: () => undefined,
    reveal: () => undefined,
  })
}

describe('service.isLocked (the shell answer the modules ask)', () => {
  it('a revoked or deleted binding is locked; a healthy copy and a plain file are not', () => {
    const revoked = seedCopy(DOC, { state: 'blocked', error: 'permission_revoked' })
    const deleted = seedCopy(DOC_DELETED, { state: 'blocked', error: 'document_deleted' })
    const healthy = seedCopy(DOC_HEALTHY)
    const local = join(dir, 'notes.txt')
    writeFileSync(local, 'plain')
    const service = serviceFor()

    expect(service.isLocked(revoked)).toBe(true)
    expect(service.isLocked(deleted)).toBe(true)
    expect(service.isLocked(healthy)).toBe(false)
    expect(service.isLocked(local)).toBe(false)
    expect(service.isLocked(join(dir, 'missing.docx'))).toBe(false)

    // and the same answer reaches every module's policy through the one seam
    setters.policies.length = 0
    installUniworkModuleSeams(service)
    expect(setters.policies).toHaveLength(6)
    for (const policy of setters.policies) {
      const forwarded = policy as { isLocked(path: string): boolean }
      expect(forwarded.isLocked(revoked)).toBe(true)
      expect(forwarded.isLocked(healthy)).toBe(false)
      expect(forwarded.isLocked(local)).toBe(false)
    }
  })
})

// ── each module's entry points ask before they act ─────────

describe('every export / Save As / print entry point refuses a locked source', () => {
  it('docs: save-as, export-pdf/html, print, the buffered/merged PDF paths and the image exports', () => {
    const source = readRepo('apps/docs/src/main/docs-main.ts')
    // the tab's open document, unless the caller names one (Save As)
    expect(source).toMatch(
      /function uniworkRefusesExport\(wcId: number, sourcePath\?: string \| null\): boolean \{\s*return uniworkIsLocked\(sourcePath \?\? openDocByWc\.get\(wcId\) \?\? null\)/,
    )
    for (const channel of [
      /'docs:save-as'/,
      /'docs:save-to'/,
      /'docs:export-pdf'/,
      /'docs:export-html'/,
      /'docs:print'/,
      /'docs:print-pdf-buffer'/,
      /'docs:save-merged-pdf'/,
      /'docs:save-image-as'/,
      /'docs:pick-export-images-target'/,
      /'docs:write-export-image'/,
    ]) {
      expect(handlerBody(source, channel)).toContain('uniworkRefusesExport(')
    }
  })

  it('sheets: export-pdf, print, export-csv and a Save As ask every session the tab holds', () => {
    const source = readRepo('apps/sheets/src/main/sheets-main.ts')
    expect(source).toMatch(
      /function tabHoldsLockedDocument\(entry: SheetsTabSession\): boolean \{[\s\S]*?uniworkIsLocked\(sessionDocumentPath\(session\)\)/,
    )
    for (const channel of [
      /IPC_CHANNELS\.exportPdf[,)]/,
      /IPC_CHANNELS\.printWorkbook[,)]/,
      /IPC_CHANNELS\.exportCsv[,)]/,
      /IPC_CHANNELS\.saveWorkbook[,)]/,
    ]) {
      expect(handlerBody(source, channel)).toContain('tabHoldsLockedDocument(')
    }
  })

  it('slides: export-pdf, print, export-images, save-picture and save-as ask the session path', () => {
    const source = readRepo('apps/slides/src/main/slides-main.ts')
    for (const channel of [
      /'slides:export-images'/,
      /'slides:save-picture'/,
      /'slides:export-pdf'/,
      /'slides:print'/,
    ]) {
      expect(handlerBody(source, channel)).toContain('uniworkIsLocked(')
    }
    // the session core is environment-neutral and must not import main/, so the
    // save-as handler asks the host seam; the desktop host answers with the same
    // policy helper the four IPC guards above use
    const history = readRepo('apps/slides/src/session/handlers/history-save.ts')
    expect(handlerBody(history, /'slides:save-as'/)).toContain('ctx.host.isLocked?.(')
    expect(readRepo('apps/slides/src/main/electron-host-io.ts')).toContain(
      'isLocked: (path) => uniworkIsLocked(path)',
    )
  })

  it('pdf: Save As (and the redaction copy), print, export-images and a save-as target', () => {
    const source = readRepo('apps/pdf/src/main/pdf-main.ts')
    expect(functionHead(source, 'requestPdfSaveAs')).toContain('uniworkIsLocked(')
    expect(functionHead(source, 'sendPdfPrintRequest')).toContain('uniworkIsLocked(')
    expect(handlerBody(source, /PDF_CHANNELS\.requestRedactionCopy[,)]/)).toContain(
      'uniworkIsLocked(',
    )
    expect(handlerBody(source, /PDF_CHANNELS\.exportImages[,)]/)).toContain('uniworkIsLocked(')
    expect(handlerBody(source, /PDF_CHANNELS\.save[,)]/)).toContain('uniworkIsLocked(')
  })

  it('markdown: export-docx/pdf, image export, save-image-as, save-as and the menu entries', () => {
    const source = readRepo('apps/markdown/src/main/markdown-main.ts')
    for (const channel of [
      /MARKDOWN_CHANNELS\.exportDocx[,)]/,
      /MARKDOWN_CHANNELS\.exportPdf[,)]/,
      /MARKDOWN_CHANNELS\.prepareImageExport[,)]/,
      /MARKDOWN_CHANNELS\.saveImageAs[,)]/,
      /MARKDOWN_CHANNELS\.save[,)]/,
    ]) {
      expect(handlerBody(source, channel)).toContain('uniworkIsLocked(')
    }
    expect(functionHead(source, 'sendMarkdownExportRequest')).toContain('uniworkIsLocked(')
    expect(functionHead(source, 'sendMarkdownPrintRequest')).toContain('uniworkIsLocked(')
  })

  it('html: export-docx/pdf/html, print-html, save-as and the menu entries', () => {
    const source = readRepo('apps/html/src/main/html-main.ts')
    for (const channel of [
      /HTML_CHANNELS\.exportDocx[,)]/,
      /HTML_CHANNELS\.exportPdf[,)]/,
      /HTML_CHANNELS\.exportHtml[,)]/,
      /HTML_CHANNELS\.printHtml[,)]/,
      /HTML_CHANNELS\.save[,)]/,
    ]) {
      expect(handlerBody(source, channel)).toContain('uniworkIsLocked(')
    }
    expect(functionHead(source, 'sendHtmlExportRequest')).toContain('uniworkIsLocked(')
    expect(functionHead(source, 'sendHtmlPrintRequest')).toContain('uniworkIsLocked(')
  })
})
