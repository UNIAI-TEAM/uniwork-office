import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_SENDER_REFUSED, trustedUrlRules } from '../src/main/ipc-sender-guard'
import { registerUniworkAskUni, type UniworkAskUniWiring } from '../src/main/uniwork-askuni/index'
import {
  ASKUNI_CHANNELS,
  ASKUNI_DOC_CHANNELS,
  ASKUNI_V2_CHANNELS,
  type AskUniStreamEvent,
} from '../src/shared/askuni-api'
import {
  EDITOR_URL,
  FOREIGN_URL,
  SHELL_URL,
  createGuardedFakeIpc,
  fakeView,
  fromMainFrame,
} from './uniwork-askuni-guard-fixture'

/**
 * UNI-2076 s8-guard: every Ask UNI handler is registered on the UNI-2073
 * guarded ipc object and takes its sender rule from the guard's channel
 * policy: `uniwork:askuni:*` = shell page main frame, `uniwork:askuni-doc:*` =
 * a trusted editor view main frame. The handlers keep what the guard does not
 * do (per-sender conversation ownership, main-derived document, events to
 * event.sender only). The wiring below gets no sender dependency of its own.
 */

const WS = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const DOC = '01J8DOC0000000000000000001'

const shell = fakeView(1, SHELL_URL)
const editor7 = fakeView(7, EDITOR_URL)
const editor9 = fakeView(9, 'genoffice-app://sheets/index.html')
const stranger = fakeView(11, EDITOR_URL)
const foreignEditor = fakeView(12, FOREIGN_URL)
const foreignShell = fakeView(13, FOREIGN_URL)

let shellContents: unknown = shell
const fake = createGuardedFakeIpc({
  shell: () => shellContents,
  editors: new Set([7, 9, 12]),
})
const { ipcMain, handlers, call } = fake

function wiring(over: Partial<UniworkAskUniWiring> = {}): UniworkAskUniWiring {
  return {
    profile: () => null,
    authorized: (c) => c('tok_secret'),
    isSignedIn: () => true,
    scopeKey: () => 'acc_1:org_a',
    selectedOrgId: () => 'org_a',
    activeWorkspaceId: () => null,
    packaged: false,
    env: { UNIWORK_ASKUNI_FAKE: '1' },
    openDocument: async () => ({ ok: true, value: { path: '/tmp/doc.docx' } }),
    openExternal: async () => undefined,
    editorPath: (sender) => ({ 7: '/w/a.docx', 9: '/w/b.xlsx' })[sender.id as 7 | 9] ?? null,
    docBinding: () => ({ workspaceId: WS, documentId: DOC }),
    fakeStreamDelayMs: 0,
    ...over,
  }
}

const SHELL_CHANNELS = [
  ...Object.values(ASKUNI_CHANNELS),
  ASKUNI_V2_CHANNELS.stream,
  ASKUNI_V2_CHANNELS.streamCancel,
  ASKUNI_V2_CHANNELS.flags,
  ASKUNI_V2_CHANNELS.capabilities,
  ASKUNI_V2_CHANNELS.conversations,
  ASKUNI_V2_CHANNELS.messages,
  ASKUNI_V2_CHANNELS.rename,
  ASKUNI_V2_CHANNELS.delete,
  ASKUNI_V2_CHANNELS.feedbackSet,
  ASKUNI_V2_CHANNELS.feedbackClear,
  ASKUNI_V2_CHANNELS.lookup,
]
const DOC_HANDLE_CHANNELS = Object.values(ASKUNI_DOC_CHANNELS).filter(
  (c) => c !== ASKUNI_DOC_CHANNELS.streamEvent,
)

const refused = (channel: string, event: unknown) =>
  expect(call(channel, event, {})).rejects.toThrow(IPC_SENDER_REFUSED)

beforeEach(() => {
  handlers.clear()
  shellContents = shell
  for (const view of [shell, editor7, editor9]) view.sent.length = 0
})
afterEach(() => vi.unstubAllGlobals())

describe('registration on the guarded ipc object', () => {
  it('registers the shell family and the editor family and nothing else', () => {
    registerUniworkAskUni(ipcMain, wiring())
    expect([...handlers.keys()].sort()).toEqual([...SHELL_CHANNELS, ...DOC_HANDLE_CHANNELS].sort())
    expect(SHELL_CHANNELS).toHaveLength(14)
    expect(DOC_HANDLE_CHANNELS).toHaveLength(6)
  })
})

describe('uniwork:askuni:* (policy shell)', () => {
  it.each(SHELL_CHANNELS)('%s: the shell page main frame reaches the handler', async (channel) => {
    registerUniworkAskUni(ipcMain, wiring())
    await expect(call(channel, fromMainFrame(shell), {})).resolves.not.toBeUndefined()
  })

  const refusals: Array<[string, () => unknown]> = [
    ['an editor view', () => fromMainFrame(editor7)],
    ['a frame inside the shell', () => ({ sender: shell, senderFrame: { url: SHELL_URL } })],
    ['an unknown webContents', () => fromMainFrame(stranger)],
    ['the shell page on a foreign origin', () => fromMainFrame(foreignShell)],
    ['no event at all', () => undefined],
  ]
  it.each(SHELL_CHANNELS)(
    '%s: every other sender is refused with no side effect',
    async (channel) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      registerUniworkAskUni(ipcMain, wiring())
      for (const [, event] of refusals) await refused(channel, event())
      expect(fetch).not.toHaveBeenCalled()
      expect([shell, editor7].flatMap((view) => view.sent)).toEqual([])
    },
  )

  it('a destroyed shell and a shell window that is gone are refused', async () => {
    registerUniworkAskUni(ipcMain, wiring())
    const gone = fakeView(21, SHELL_URL)
    shellContents = gone
    gone.destroy()
    await refused(ASKUNI_CHANNELS.context, fromMainFrame(gone))
    shellContents = null
    await refused(ASKUNI_CHANNELS.context, fromMainFrame(shell))
  })

  it('the shell window is read at call time (re-created window answers)', async () => {
    registerUniworkAskUni(ipcMain, wiring())
    const fresh = fakeView(22, SHELL_URL)
    shellContents = fresh
    await refused(ASKUNI_CHANNELS.context, fromMainFrame(shell))
    await expect(call(ASKUNI_CHANNELS.context, fromMainFrame(fresh))).resolves.toMatchObject({
      signedIn: true,
    })
  })
})

describe('uniwork:askuni-doc:* (policy editor)', () => {
  it.each(DOC_HANDLE_CHANNELS)(
    '%s: an editor view main frame reaches the handler',
    async (channel) => {
      registerUniworkAskUni(ipcMain, wiring())
      await expect(call(channel, fromMainFrame(editor7), {})).resolves.not.toBeUndefined()
      await expect(call(channel, fromMainFrame(editor9), {})).resolves.not.toBeUndefined()
    },
  )

  const refusals: Array<[string, () => unknown]> = [
    ['the shell page', () => fromMainFrame(shell)],
    ['a frame inside an editor', () => ({ sender: editor7, senderFrame: { url: EDITOR_URL } })],
    ['an unknown webContents', () => fromMainFrame(stranger)],
    ['an editor view on a foreign origin', () => fromMainFrame(foreignEditor)],
    ['no event at all', () => undefined],
  ]
  it.each(DOC_HANDLE_CHANNELS)(
    '%s: every other sender is refused with no side effect',
    async (channel) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      registerUniworkAskUni(ipcMain, wiring())
      for (const [, event] of refusals) await refused(channel, event())
      const gone = fakeView(7, EDITOR_URL)
      gone.destroy()
      await refused(channel, fromMainFrame(gone))
      expect(fetch).not.toHaveBeenCalled()
      expect([shell, editor7, editor9, foreignEditor].flatMap((view) => view.sent)).toEqual([])
    },
  )

  it('a refused doc call never starts a run or records a conversation', async () => {
    registerUniworkAskUni(ipcMain, wiring())
    await refused(ASKUNI_DOC_CHANNELS.stream, fromMainFrame(shell))
    await refused(ASKUNI_DOC_CHANNELS.stream, fromMainFrame(foreignEditor))
    await new Promise((r) => setTimeout(r, 20))
    expect([shell, foreignEditor].flatMap((view) => view.sent)).toEqual([])
  })
})

describe('what the guard does not do stays in the handlers', () => {
  const waitFor = async (pred: () => boolean) => {
    for (let i = 0; i < 200 && !pred(); i += 1) await new Promise((r) => setTimeout(r, 5))
  }
  const events = (view: { sent: unknown[] }) => view.sent as AskUniStreamEvent[]

  async function runOn(view: typeof editor7, path?: string) {
    registerUniworkAskUni(ipcMain, wiring(path ? { editorPath: () => path } : {}))
    const start = (await call(ASKUNI_DOC_CHANNELS.stream, fromMainFrame(view), {
      question: 'docs: plan',
      locale: 'en',
      // a renderer-named workspace or document is ignored
      workspaceId: 'ws_other',
      documentId: 'doc_other',
    })) as { ok: boolean; requestId?: string }
    expect(start.ok).toBe(true)
    await waitFor(() => events(view).some((e) => e.type === 'done'))
    const run = events(view).find((e) => e.type === 'run') as
      { conversationId?: string } | undefined
    return { run, start }
  }

  it('events go to the asking editor only', async () => {
    await runOn(editor7)
    expect(events(editor7).map((e) => e.type)[0]).toBe('run')
    expect(events(editor9)).toEqual([])
    expect(shell.sent).toEqual([])
  })

  it('conversations and feedback answer only for the editor that saw the run', async () => {
    const { run } = await runOn(editor7)
    const conversationId = run?.conversationId
    expect(typeof conversationId).toBe('string')
    // another trusted editor passes the guard but is not the owner
    expect(
      await call(ASKUNI_DOC_CHANNELS.messages, fromMainFrame(editor9), { conversationId }),
    ).toEqual({ ok: false, error: 'forbidden' })
    expect(
      await call(ASKUNI_DOC_CHANNELS.feedbackSet, fromMainFrame(editor9), {
        conversationId,
        messageId: 'm1',
        rating: 'up',
      }),
    ).toEqual({ ok: false, error: 'forbidden' })
    expect(
      await call(ASKUNI_DOC_CHANNELS.feedbackClear, fromMainFrame(editor9), {
        conversationId,
        messageId: 'm1',
      }),
    ).toEqual({ ok: false, error: 'forbidden' })
    expect(
      await call(ASKUNI_DOC_CHANNELS.messages, fromMainFrame(editor7), { conversationId }),
    ).toMatchObject({ ok: true })
  })

  it('a local file is not bound and another account copy is hidden: no stream either way', async () => {
    registerUniworkAskUni(ipcMain, wiring({ docBinding: () => null }))
    expect(await call(ASKUNI_DOC_CHANNELS.flags, fromMainFrame(editor7))).toMatchObject({
      bound: 'local',
    })
    handlers.clear()
    registerUniworkAskUni(ipcMain, wiring({ docBinding: () => 'hidden' }))
    expect(await call(ASKUNI_DOC_CHANNELS.flags, fromMainFrame(editor7))).toMatchObject({
      bound: 'hidden',
    })
    expect(
      await call(ASKUNI_DOC_CHANNELS.stream, fromMainFrame(editor7), {
        question: 'x',
        locale: 'en',
      }),
    ).toMatchObject({ ok: false, error: 'forbidden' })
    expect(events(editor7)).toEqual([])
  })

  it('an editor without a shown path is a local file, not a refusal', async () => {
    registerUniworkAskUni(ipcMain, wiring({ editorPath: () => null }))
    expect(await call(ASKUNI_DOC_CHANNELS.flags, fromMainFrame(editor7))).toMatchObject({
      bound: 'local',
    })
  })
})

describe('the temporary sender helpers are gone', () => {
  const main = join(__dirname, '..', 'src', 'main')
  const text = (file: string) => readFileSync(join(main, file), 'utf8')

  it('no sender.ts / doc-sender.ts under uniwork-askuni', () => {
    expect(existsSync(join(main, 'uniwork-askuni/sender.ts'))).toBe(false)
    expect(existsSync(join(main, 'uniwork-askuni/doc-sender.ts'))).toBe(false)
  })

  it.each([
    'uniwork-askuni/service.ts',
    'uniwork-askuni/stream-service.ts',
    'uniwork-askuni/rest-service.ts',
    'uniwork-askuni/doc-service.ts',
    'uniwork-askuni/open-citation.ts',
    'uniwork-askuni/index.ts',
  ])('%s checks no sender of its own', (file) => {
    expect(text(file)).not.toMatch(
      /isShellSender|isEditorSender|createShellSenderCheck|createEditorSenderCheck|shellContents|isEditorContents/,
    )
  })

  it('index.ts and the docs wiring no longer feed an editor-view predicate into Ask UNI', () => {
    expect(text('index.ts')).not.toContain('isAskUniEditorView')
    expect(text('uniwork-docs/wiring.ts')).not.toMatch(/isEditorContents/)
  })

  it('the docs wiring still derives the editor path and binding in main', () => {
    const wiring = text('uniwork-docs/wiring.ts').replace(/\s+/g, ' ')
    expect(wiring).toContain('editorPath: (sender) => wiring.commentsPathFor?.(sender) ?? null,')
    expect(wiring).toContain('docBinding: (path) => askUniDocBinding(service, path),')
  })

  it('Ask UNI is registered through the guarded object createUniworkDocs receives', () => {
    const wiring = text('uniwork-docs/wiring.ts')
    expect(wiring).toMatch(/registerUniworkAskUni\(ipcMain,/)
    expect(text('index.ts')).toMatch(/createUniworkDocs\(guardedIpc,/)
  })
})

/**
 * The editor page rule moved from askUniEditorUrlRule to the guard's
 * isTrustedEditorUrl: the same cases still hold there.
 */
describe('the guard editor URL rule keeps the old askUniEditorUrlRule cases', () => {
  const rules = trustedUrlRules({ env: {}, shellRendererDir: '/app/out/renderer' })

  it('packaged: the six editor hosts of the app scheme only', () => {
    for (const host of ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html']) {
      expect(rules.isTrustedEditorUrl(`genoffice-app://${host}/index.html`)).toBe(true)
    }
    for (const url of [
      'genoffice-app://shell/index.html',
      'genoffice-app://docs.evil/index.html',
      'genoffice-app://u@docs/index.html',
      'genoffice-app://docs:81/index.html',
      'file:///app/out/renderer/index.html',
      'https://docs/index.html',
      'about:blank',
      'not a url',
    ]) {
      expect(rules.isTrustedEditorUrl(url), url).toBe(false)
    }
  })

  it('dev: the origins of the six editor renderer URLs, never the shell dev server', () => {
    const dev = trustedUrlRules({
      env: {
        DOCS_RENDERER_URL: 'http://localhost:5174/',
        HTML_RENDERER_URL: 'http://localhost:5179',
        ELECTRON_RENDERER_URL: 'http://localhost:5173',
      },
      shellRendererDir: '/app/out/renderer',
    })
    expect(dev.isTrustedEditorUrl('http://localhost:5174/index.html?x=1')).toBe(true)
    expect(dev.isTrustedEditorUrl('http://localhost:5179/')).toBe(true)
    expect(dev.isTrustedEditorUrl('http://localhost:5173/')).toBe(false)
    expect(dev.isTrustedEditorUrl('http://localhost:5175/')).toBe(false)
  })
})
