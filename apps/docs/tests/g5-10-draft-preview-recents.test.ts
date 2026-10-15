/**
 * G5-10 (BE-2n-2 / BE-3n-1): a read-only kept-draft preview is a temporary decrypted copy. The
 * docs module has its own recents writer (pushRecent, reached from loadDocx when a docs tab
 * consumes the queued open), so the shell's guard alone is not enough: the real docs recorder
 * runs here with electron mocked and a real userData directory, and recent.json is read back.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ dir: '' }))

vi.mock('@genoffice/ai-search', () => ({}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => env.dir),
    on: vi.fn(),
    once: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => {})),
    isPackaged: false,
    getVersion: () => '0.0.0',
    getName: () => 'test',
  },
  BrowserWindow: class {
    static fromWebContents() {
      return null
    }
    static getFocusedWindow() {
      return null
    }
    static getAllWindows() {
      return []
    }
  },
  dialog: { showSaveDialog: vi.fn(), showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn(), removeHandler: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  session: { defaultSession: {} },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1000, height: 800 } }) },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  clipboard: {},
  webContents: { fromId: vi.fn() },
  WebContentsView: class {},
}))

import { DRAFT_PREVIEW_DIR } from '@genoffice/electron-utils/draft-preview'
import { readRecentFiles, recordRecentFile } from '../src/main/docs-main'

const roots: string[] = []

beforeEach(() => {
  env.dir = mkdtempSync(join(tmpdir(), 'uw-docs-recents-'))
  roots.push(env.dir)
})

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

function previewPath(): string {
  const dir = join(env.dir, DRAFT_PREVIEW_DIR, 'session-1', 'draft-1')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'Contract.docx')
  writeFileSync(file, 'x')
  return file
}

describe('docs recents writer and a kept-draft preview', () => {
  it('a preview path never lands in recent.json, with an empty list or an existing one', () => {
    const preview = previewPath()
    recordRecentFile(preview)
    expect(readRecentFiles()).toEqual([])
    expect(() => readFileSync(join(env.dir, 'recent.json'), 'utf8')).toThrow()

    const normal = join(env.dir, 'Notes.docx')
    recordRecentFile(normal)
    recordRecentFile(preview)
    expect(readRecentFiles()).toEqual([normal])
    expect(JSON.parse(readFileSync(join(env.dir, 'recent.json'), 'utf8'))).toEqual([normal])
  })

  it('a normal document still becomes the head of the list', () => {
    const a = join(env.dir, 'a.docx')
    const b = join(env.dir, 'b.docx')
    recordRecentFile(a)
    recordRecentFile(b)
    recordRecentFile(a)
    expect(readRecentFiles()).toEqual([a, b])
  })
})
