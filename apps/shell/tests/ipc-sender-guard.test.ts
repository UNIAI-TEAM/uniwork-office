// Shared IPC sender guard (UNI-2073): channel policy table, call-time sender checks
// (destroyed / sub-frame / unknown sender / origin), refusal shapes for handle and on,
// the rate-limited log line, and the dev / packaged trusted URL rules.
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  IPC_SENDER_REFUSED,
  createIpcSenderGuard,
  policyForChannel,
  trustedUrlRules,
  type IpcSenderGuardDeps,
  type IpcSenderPolicy,
} from '../src/main/ipc-sender-guard'

const SHELL_URL = 'http://localhost:5199/'
const EDITOR_URL = 'genoffice-app://docs/index.html?mode=tab'
const FOREIGN_URL = 'https://evil.example/'
const SHELL_ID = 1
const EDITOR_ID = 7
const OTHER_ID = 99

interface FakeSender {
  id: number
  isDestroyed: () => boolean
  mainFrame: object | null
}

function fakeFrame(url: string): { url: string } {
  return { url }
}

function fakeSender(id: number, url: string, destroyed = false): FakeSender {
  return { id, isDestroyed: () => destroyed, mainFrame: fakeFrame(url) }
}

/** like mainFrameEvent() in uniwork-cloud-status.test.ts: the frame is the sender's main frame */
function mainFrameEvent(sender: FakeSender) {
  return { sender, senderFrame: sender.mainFrame }
}

/** like forgedSubframeEvent(): a frame of the sender that is not its main frame */
function subframeEvent(sender: FakeSender) {
  return { sender, senderFrame: fakeFrame((sender.mainFrame as { url: string }).url) }
}

function setup(overrides: Partial<IpcSenderGuardDeps> = {}) {
  const shell = fakeSender(SHELL_ID, SHELL_URL)
  const editor = fakeSender(EDITOR_ID, EDITOR_URL)
  const log = vi.fn()
  let clock = 1_000_000
  const deps: IpcSenderGuardDeps = {
    shellContents: () => shell as never,
    isTrustedEditorContents: (id) => id === EDITOR_ID,
    isTrustedShellUrl: (url) => url === SHELL_URL,
    isTrustedEditorUrl: (url) => url === EDITOR_URL,
    log,
    now: () => clock,
    ...overrides,
  }
  const guard = createIpcSenderGuard(deps)
  return {
    guard,
    shell,
    editor,
    log,
    tick: (ms: number) => {
      clock += ms
    },
  }
}

const FAMILIES: ReadonlyArray<[family: string, channel: string, policy: IpcSenderPolicy]> = [
  ['doc', 'uniwork-doc:list', 'shell'],
  ['share', 'uniwork-share:create-link', 'shell'],
  ['sync-center', 'uniwork-sync-center:sync-now', 'shell'],
  ['work', 'uniwork-work:list', 'shell'],
  ['askuni', 'uniwork:askuni:ask', 'shell'],
  ['discussion', 'uniwork:discussion:panel', 'shell'],
  ['home:uniwork-*', 'home:uniwork-cloud-status', 'shell'],
  ['home:account-*', 'home:account-status', 'shell'],
  ['home:*', 'home:recents', 'shell'],
  ['home:* (destructive file op)', 'home:delete-files', 'shell'],
  ['home:* (native dialog)', 'home:wb-export-backup', 'shell'],
  ['home:* (settings setter)', 'home:set-theme', 'shell'],
  ['home:open-path', 'home:open-path', 'shell-or-editor'],
  ['app: ai panel prefs setter', 'app:set-ai-panel-prefs', 'shell-or-editor'],
  ['comments', 'uniwork:comments:list', 'editor'],
  ['cloud-status', 'uniwork:cloud-status', 'editor'],
  ['ai-run', 'uniwork:ai-run', 'editor'],
  ['ai-flag', 'uniwork:ai-flag', 'shell-or-editor'],
]

describe('policyForChannel', () => {
  it.each(FAMILIES)('%s (%s) -> %s', (_family, channel, policy) => {
    expect(policyForChannel(channel)).toBe(policy)
  })

  it.each([
    ['uniwork:cloud-status-open-account', 'editor'],
    ['uniwork:cloud-status-sign-in', 'editor'],
    ['uniwork:comments:upsert', 'editor'],
    ['uniwork-doc:bar-inset', 'shell'],
    ['uniwork:discussion:reveal:release', 'shell'],
    ['home:uniwork-cloud-sign-in', 'shell'],
    ['home:account-login', 'shell'],
    ['home:recent-list', 'shell'],
    ['home:run-desk-tool', 'shell'],
    ['home:folder-root-add', 'shell'],
    ['home:x', 'shell'],
    ['home:open-path', 'shell-or-editor'],
    ['app:set-ai-panel-prefs', 'shell-or-editor'],
  ] as const)('%s -> %s', (channel, policy) => {
    expect(policyForChannel(channel)).toBe(policy)
  })

  it.each([
    'docs:save',
    'tabs:open',
    'ai:chat',
    'app:get-theme',
    'app:get-ai-panel-prefs',
    'app:get-document-theme',
    'app:get-auto-save-default',
    'docs:x',
    'home',
    'home:',
    'homepage:x',
    'xhome:a',
    'Home:recents',
    'home-open-path',
    'settings:get',
    'update:check',
    'sheets:uniwork-state',
    'xuniwork:doc',
    'uniwork',
    '',
  ])('%j is out of scope (null)', (channel) => {
    expect(policyForChannel(channel)).toBeNull()
  })
})

describe('guarded(ipc) registration', () => {
  it('throws when an out-of-scope channel is registered through the guard', () => {
    const { guard } = setup()
    const ipc = { handle: vi.fn(), handleOnce: vi.fn(), on: vi.fn(), once: vi.fn() }
    const g = guard.guarded(ipc)
    expect(() => g.handle('docs:save', () => 1)).toThrow(/docs:save/)
    expect(() => g.handleOnce('docs:save', () => 1)).toThrow()
    expect(() => g.on('tabs:open', () => {})).toThrow()
    expect(() => g.once('tabs:open', () => {})).toThrow()
    expect(ipc.handle).not.toHaveBeenCalled()
    expect(ipc.on).not.toHaveBeenCalled()
  })

  it('throws at registration for handleOnce and once, in scope or not (a refused first call would consume the one-shot)', () => {
    const { guard } = setup()
    const ipc = { handleOnce: vi.fn(), once: vi.fn() }
    const g = guard.guarded(ipc)
    expect(() => g.handleOnce('uniwork-share:create-link', () => 1)).toThrow(/handleOnce/)
    expect(() => g.once('uniwork:discussion:panel', () => {})).toThrow(/once/)
    expect(ipc.handleOnce).not.toHaveBeenCalled()
    expect(ipc.once).not.toHaveBeenCalled()
  })

  it.each(['addListener', 'prependListener', 'prependOnceListener'])(
    '%s on the guarded object throws instead of registering unguarded',
    (method) => {
      const { guard } = setup()
      const fn = vi.fn()
      const ipc = { [method]: fn, on: vi.fn() }
      const g = guard.guarded(ipc) as unknown as Record<string, (...args: unknown[]) => unknown>
      expect(() => g[method]('uniwork-doc:save', () => {})).toThrow(/use on\(\)/)
      expect(fn).not.toHaveBeenCalled()
    },
  )

  it('off maps to the guarded removeListener', () => {
    const { guard } = setup()
    const ipc = { on: vi.fn(), off: vi.fn(), removeListener: vi.fn() }
    const g = guard.guarded(ipc) as typeof ipc
    const listener = vi.fn()
    g.on('uniwork:ai-run', listener)
    const wrapped = ipc.on.mock.calls[0][1]
    g.off('uniwork:ai-run', listener)
    expect(ipc.removeListener).toHaveBeenCalledWith('uniwork:ai-run', wrapped)
    expect(ipc.off).not.toHaveBeenCalled()
  })

  it('removeAllListeners stays a pass-through (it only removes)', () => {
    const { guard } = setup()
    const ipc = { removeAllListeners: vi.fn() }
    const g = guard.guarded(ipc) as typeof ipc
    g.removeAllListeners('uniwork:ai-run')
    expect(ipc.removeAllListeners).toHaveBeenCalledWith('uniwork:ai-run')
  })

  it.each([
    ['removeAllListeners', (g: EventEmitter) => g.removeAllListeners('x')],
    ['setMaxListeners', (g: EventEmitter) => g.setMaxListeners(5)],
  ])(
    '%s hands back the guarded object, not the raw ipc, so a chained on() stays guarded',
    (_name, call) => {
      const { guard, shell } = setup()
      const ipc = new EventEmitter()
      const g = guard.guarded(ipc)
      const chained = call(g)
      expect(chained).toBe(g)
      expect(chained).not.toBe(ipc)
      const listener = vi.fn()
      chained.on('uniwork-doc:x', listener)
      expect(ipc.listeners('uniwork-doc:x')).not.toContain(listener)
      ipc.emit('uniwork-doc:x', subframeEvent(shell))
      expect(listener).not.toHaveBeenCalled()
      ipc.emit('uniwork-doc:x', mainFrameEvent(shell))
      expect(listener).toHaveBeenCalledTimes(1)
    },
  )

  it('leaves the raw ipc object untouched', () => {
    const { guard } = setup()
    const handle = vi.fn()
    const ipc = { handle }
    const g = guard.guarded(ipc)
    expect(g).not.toBe(ipc)
    expect(ipc.handle).toBe(handle)
    g.handle('uniwork-doc:list', () => 1)
    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle.mock.calls[0][0]).toBe('uniwork-doc:list')
    expect(handle.mock.calls[0][1]).not.toBe(undefined)
  })

  it('removeHandler delegates and removeListener removes the wrapped listener', () => {
    const { guard } = setup()
    const ipc = { on: vi.fn(), removeListener: vi.fn(), removeHandler: vi.fn() }
    const g = guard.guarded(ipc)
    const listener = vi.fn()
    g.on('uniwork:ai-run', listener)
    const wrapped = ipc.on.mock.calls[0][1]
    g.removeListener('uniwork:ai-run', listener)
    expect(ipc.removeListener).toHaveBeenCalledWith('uniwork:ai-run', wrapped)
    g.removeHandler('uniwork-doc:list')
    expect(ipc.removeHandler).toHaveBeenCalledWith('uniwork-doc:list')
  })
})

function registerHandle(channel: string, deps: Partial<IpcSenderGuardDeps> = {}) {
  const ctx = setup(deps)
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const inner = vi.fn((_event: unknown, ...args: unknown[]) => ({ answered: args }))
  ctx.guard
    .guarded({
      handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(ch, fn),
    })
    .handle(channel, inner)
  return {
    ...ctx,
    inner,
    call: (event: unknown, ...args: unknown[]) => handlers.get(channel)!(event, ...args),
  }
}

describe.each(FAMILIES)('%s channel %s (%s)', (_family, channel, policy) => {
  const allowsShell = policy !== 'editor'
  const allowsEditor = policy !== 'shell'

  if (allowsShell) {
    it('passes the shell main frame with args and return value untouched', async () => {
      const { call, shell, inner } = registerHandle(channel)
      const event = mainFrameEvent(shell)
      expect(await call(event, 'a', 2)).toEqual({ answered: ['a', 2] })
      expect(inner).toHaveBeenCalledWith(event, 'a', 2)
    })
  } else {
    it('refuses the shell calling an editor-only channel', async () => {
      const { call, shell, inner } = registerHandle(channel)
      await expect(async () => call(mainFrameEvent(shell))).rejects.toThrow(IPC_SENDER_REFUSED)
      expect(inner).not.toHaveBeenCalled()
    })
  }

  if (allowsEditor) {
    it('passes an editor view main frame', async () => {
      const { call, editor, inner } = registerHandle(channel)
      expect(await call(mainFrameEvent(editor), 'x')).toEqual({ answered: ['x'] })
      expect(inner).toHaveBeenCalledTimes(1)
    })
  } else {
    it('refuses an editor calling a shell-only channel', async () => {
      const { call, editor, inner } = registerHandle(channel)
      await expect(async () => call(mainFrameEvent(editor))).rejects.toThrow(IPC_SENDER_REFUSED)
      expect(inner).not.toHaveBeenCalled()
    })
  }

  const trusted = (ctx: ReturnType<typeof setup>) => (allowsShell ? ctx.shell : ctx.editor)

  it.each([
    ['sub-frame', (s: FakeSender) => subframeEvent(s), 'subframe'],
    ['null senderFrame', (s: FakeSender) => ({ sender: s, senderFrame: null }), 'subframe'],
    ['missing sender', () => ({ senderFrame: {} }), 'destroyed'],
    [
      'destroyed sender',
      (s: FakeSender) => {
        const dead = { ...s, isDestroyed: () => true }
        return { sender: dead, senderFrame: dead.mainFrame }
      },
      'destroyed',
    ],
    [
      'disposed frame whose url throws',
      (s: FakeSender) => {
        const frame = {
          get url(): string {
            throw new Error('Render frame was disposed before WebFrameMain could be accessed')
          },
        }
        s.mainFrame = frame
        return { sender: s, senderFrame: frame }
      },
      'destroyed',
    ],
    [
      'foreign origin in the trusted window',
      (s: FakeSender) => {
        s.mainFrame = fakeFrame(FOREIGN_URL)
        return mainFrameEvent(s)
      },
      'origin',
    ],
    ['other window', () => mainFrameEvent(fakeSender(OTHER_ID, SHELL_URL)), 'unknown-sender'],
  ] as const)('refuses %s', async (_name, build, reason) => {
    const ctx = registerHandle(channel)
    const event = build(trusted(ctx))
    expect(ctx.guard.check(event, channel)).toEqual({ ok: false, reason })
    await expect(async () => ctx.call(event)).rejects.toThrow(IPC_SENDER_REFUSED)
    expect(ctx.inner).not.toHaveBeenCalled()
  })
})

describe('check() reads every input at call time', () => {
  it('follows shellContents() lazily (null before the window exists, then re-created)', () => {
    let current: FakeSender | null = null
    const ctx = setup({ shellContents: () => current as never })
    const first = fakeSender(SHELL_ID, SHELL_URL)
    expect(ctx.guard.check(mainFrameEvent(first), 'uniwork-doc:list')).toEqual({
      ok: false,
      reason: 'unknown-sender',
    })
    current = first
    expect(ctx.guard.check(mainFrameEvent(first), 'uniwork-doc:list')).toEqual({ ok: true })
    const second = fakeSender(SHELL_ID + 1, SHELL_URL)
    current = second
    expect(ctx.guard.check(mainFrameEvent(first), 'uniwork-doc:list').ok).toBe(false)
    expect(ctx.guard.check(mainFrameEvent(second), 'uniwork-doc:list')).toEqual({ ok: true })
  })

  it('ai-flag checks the URL of the kind that matched (shell URL from an editor is refused)', () => {
    const ctx = setup()
    const editorOnShellUrl = fakeSender(EDITOR_ID, SHELL_URL)
    expect(ctx.guard.check(mainFrameEvent(editorOnShellUrl), 'uniwork:ai-flag')).toEqual({
      ok: false,
      reason: 'origin',
    })
  })

  it('errors and return values of allowed calls pass through', async () => {
    const { guard, shell } = setup()
    const handlers = new Map<string, (event: unknown) => unknown>()
    const g = guard.guarded({
      handle: (ch: string, fn: (event: unknown) => unknown) => handlers.set(ch, fn),
    })
    const boom = new Error('boom')
    g.handle('uniwork-doc:list', () => {
      throw boom
    })
    g.handle('uniwork-doc:get', async () => 42)
    expect(() => handlers.get('uniwork-doc:list')!(mainFrameEvent(shell))).toThrow(boom)
    expect(await handlers.get('uniwork-doc:get')!(mainFrameEvent(shell))).toBe(42)
  })
})

describe('refusal shapes and logging', () => {
  it('on drops a refused call without calling the listener or setting returnValue', () => {
    const { guard, editor, shell } = setup()
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>()
    const add = (ch: string, fn: (event: unknown, ...args: unknown[]) => void) =>
      listeners.set(ch, fn)
    const g = guard.guarded({ on: add })
    const onListener = vi.fn()
    g.on('uniwork:ai-run', onListener)

    const refused: Record<string, unknown> = { ...mainFrameEvent(shell), reply: vi.fn() }
    expect(listeners.get('uniwork:ai-run')!(refused, { state: 'running' })).toBeUndefined()
    expect(onListener).not.toHaveBeenCalled()
    expect(refused.reply).not.toHaveBeenCalled()
    expect('returnValue' in refused).toBe(false)

    const allowed = mainFrameEvent(editor)
    listeners.get('uniwork:ai-run')!(allowed, { state: 'idle' })
    expect(onListener).toHaveBeenCalledWith(allowed, { state: 'idle' })
  })

  it('logs channel and reason only, once per channel+reason per 60 s', async () => {
    const ctx = registerHandle('uniwork-doc:list')
    const secret = { path: '/home/user/secret.docx', accountId: 'acc_1' }
    ctx.shell.mainFrame = fakeFrame(FOREIGN_URL)
    const foreign = mainFrameEvent(ctx.shell)
    const refuse = () =>
      expect(async () => ctx.call(foreign, secret)).rejects.toThrow(IPC_SENDER_REFUSED)

    await refuse()
    expect(ctx.log).toHaveBeenCalledTimes(1)
    const line = ctx.log.mock.calls[0][0] as string
    expect(line).toBe('[ipc-guard] refused channel=uniwork-doc:list reason=origin')
    expect(line).not.toContain('evil')
    expect(line).not.toContain('secret')
    expect(line).not.toContain('acc_1')
    expect(line).not.toContain(String(SHELL_ID))

    await refuse()
    ctx.tick(59_999)
    await refuse()
    expect(ctx.log).toHaveBeenCalledTimes(1)

    // another reason on the same channel has its own window
    await expect(async () => ctx.call(subframeEvent(ctx.shell))).rejects.toThrow(IPC_SENDER_REFUSED)
    expect(ctx.log).toHaveBeenCalledTimes(2)

    ctx.tick(1)
    await refuse()
    expect(ctx.log).toHaveBeenCalledTimes(3)
  })

  it('defaults the log to console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const shell = fakeSender(SHELL_ID, SHELL_URL)
      const guard = createIpcSenderGuard({
        shellContents: () => shell as never,
        isTrustedEditorContents: () => false,
        isTrustedShellUrl: () => true,
        isTrustedEditorUrl: () => true,
      })
      const handlers = new Map<string, (event: unknown) => unknown>()
      guard
        .guarded({ handle: (ch: string, fn: (event: unknown) => unknown) => handlers.set(ch, fn) })
        .handle('uniwork-work:list', () => 1)
      await expect(async () =>
        handlers.get('uniwork-work:list')!(subframeEvent(shell)),
      ).rejects.toThrow()
      expect(warn).toHaveBeenCalledWith(
        '[ipc-guard] refused channel=uniwork-work:list reason=subframe',
      )
    } finally {
      warn.mockRestore()
    }
  })
})

describe('trustedUrlRules', () => {
  const shellRendererDir = join(
    '/opt',
    'UniWork Office',
    'resources',
    'app.asar',
    'out',
    'renderer',
  )
  const fileUrl = (...parts: string[]) => pathToFileURL(join(shellRendererDir, ...parts)).href

  describe('packaged (no dev env)', () => {
    const rules = trustedUrlRules({ env: {}, shellRendererDir })

    it.each([
      fileUrl('index.html'),
      `${fileUrl('index.html')}?mode=tab`,
      `${fileUrl('index.html')}#/home?x=1`,
    ])('shell trusts %s', (url) => {
      expect(rules.isTrustedShellUrl(url)).toBe(true)
      expect(rules.isTrustedEditorUrl(url)).toBe(false)
    })

    it.each([
      pathToFileURL(join(shellRendererDir, '..', 'x.html')).href,
      `${pathToFileURL(shellRendererDir).href}/../x.html`,
      `${pathToFileURL(shellRendererDir).href}/%2e%2e/x.html`,
      `${pathToFileURL(shellRendererDir).href}/..%2fx.html`,
      pathToFileURL(`${shellRendererDir}-evil/index.html`).href,
      pathToFileURL(shellRendererDir).href,
      'file:///etc/passwd',
      'file://evil.host/share/index.html',
      'http://localhost:5199/',
      'about:blank',
      'blob:file:///abc',
      'data:text/html,hi',
      'javascript:alert(1)',
      'devtools://devtools/bundled/inspector.html',
      'html-preview://view-7/',
      'not a url',
      '',
      fileUrl('update.html'),
      fileUrl('assets', 'index.html'),
    ])('shell refuses %s', (url) => {
      expect(rules.isTrustedShellUrl(url)).toBe(false)
    })

    it('compares paths case-insensitively on win32 only', () => {
      const original = process.platform
      const upper = fileUrl('index.html').replace('/opt/', '/OPT/').replace('renderer', 'RENDERER')
      try {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
        expect(rules.isTrustedShellUrl(upper)).toBe(false)
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
        expect(rules.isTrustedShellUrl(upper)).toBe(true)
        expect(rules.isTrustedShellUrl(fileUrl('INDEX.HTML'))).toBe(true)
        expect(rules.isTrustedShellUrl(fileUrl('update.html'))).toBe(false)
      } finally {
        Object.defineProperty(process, 'platform', { value: original, configurable: true })
      }
    })

    it.each(['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html'])(
      'editor trusts genoffice-app://%s',
      (host) => {
        expect(rules.isTrustedEditorUrl(`genoffice-app://${host}/index.html?mode=tab`)).toBe(true)
        expect(rules.isTrustedShellUrl(`genoffice-app://${host}/index.html`)).toBe(false)
      },
    )

    it.each([
      'genoffice-app://docs.evil/index.html',
      'genoffice-app://docs@evil/index.html',
      'genoffice-app://evil@docs.evil/index.html',
      'genoffice-app://user:pw@docs/index.html',
      'genoffice-app://docs:8080/index.html',
      'genoffice-app://shell/index.html',
      'genoffice-app://DOCS.evil/',
      'genoffice-docx-media://docs/x.png',
      'html-preview://view-7/',
      'https://docs/index.html',
      'http://localhost:5173/',
      fileUrl('index.html'),
      'blob:genoffice-app://docs/123',
      'about:srcdoc',
      'data:text/html,x',
      'javascript:void 0',
      'devtools://devtools/',
    ])('editor refuses %s', (url) => {
      expect(rules.isTrustedEditorUrl(url)).toBe(false)
    })
  })

  describe('dev (renderer URLs in env)', () => {
    const env = {
      ELECTRON_RENDERER_URL: 'http://localhost:5199',
      DOCS_RENDERER_URL: 'http://localhost:5173',
      SHEETS_RENDERER_URL: 'http://localhost:5174/',
      SLIDES_RENDERER_URL: 'http://localhost:5175',
      PDF_RENDERER_URL: 'http://localhost:5176',
      MARKDOWN_RENDERER_URL: 'http://localhost:5177',
      HTML_RENDERER_URL: 'http://localhost:5178',
    }
    const rules = trustedUrlRules({ env, shellRendererDir })

    it('shell trusts the same origin as ELECTRON_RENDERER_URL', () => {
      expect(rules.isTrustedShellUrl('http://localhost:5199/')).toBe(true)
      expect(rules.isTrustedShellUrl('http://localhost:5199/update.html')).toBe(true)
      expect(rules.isTrustedEditorUrl('http://localhost:5199/')).toBe(false)
    })

    it.each([
      'http://localhost:5198/',
      'http://localhost:51999/',
      'https://localhost:5199/',
      'http://127.0.0.1:5199/',
      'http://localhost.evil:5199/',
      'http://localhost:5199@evil.example/',
      'http://localhost/',
      'http://localhost:5173/',
    ])('shell refuses %s', (url) => {
      expect(rules.isTrustedShellUrl(url)).toBe(false)
    })

    it.each([5173, 5174, 5175, 5176, 5177, 5178])(
      'editor trusts the dev origin on port %i',
      (port) => {
        expect(rules.isTrustedEditorUrl(`http://localhost:${port}/index.html?mode=tab`)).toBe(true)
        expect(rules.isTrustedShellUrl(`http://localhost:${port}/`)).toBe(false)
      },
    )

    it.each([
      'http://localhost:5179/',
      'http://localhost:5199/',
      'https://localhost:5173/',
      'http://127.0.0.1:5173/',
    ])('editor refuses %s', (url) => {
      expect(rules.isTrustedEditorUrl(url)).toBe(false)
    })

    it('keeps the packaged origins trusted next to the dev ones', () => {
      expect(rules.isTrustedEditorUrl('genoffice-app://sheets/index.html')).toBe(true)
      expect(rules.isTrustedShellUrl(fileUrl('index.html'))).toBe(true)
    })
  })

  it('ignores a malformed or non-http dev URL instead of trusting everything', () => {
    const rules = trustedUrlRules({
      env: { ELECTRON_RENDERER_URL: 'not a url', DOCS_RENDERER_URL: 'file:///tmp/' },
      shellRendererDir,
    })
    expect(rules.isTrustedShellUrl('not a url')).toBe(false)
    expect(rules.isTrustedEditorUrl('file:///tmp/index.html')).toBe(false)
    expect(rules.isTrustedEditorUrl('file:///etc/passwd')).toBe(false)
  })
})
