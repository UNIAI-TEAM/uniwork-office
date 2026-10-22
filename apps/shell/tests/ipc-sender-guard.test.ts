// Shared IPC sender guard (UNI-2073, own windows UNI-2096): channel policy table, call-time
// sender checks (destroyed / sub-frame / unknown sender / origin), refusal shapes for handle
// and on, the rate-limited log line, and the dev / packaged trusted URL rules.
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
const UPDATE_URL = 'file:///renderer/update.html'
const PDF_PASSWORD_URL = 'file:///renderer/pdf-password.html'
const SHELL_ID = 1
const EDITOR_ID = 7
const UPDATE_ID = 11
const PDF_PASSWORD_ID = 12
const OTHER_ID = 99

type OwnWindow = 'update' | 'pdf-password'

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
  const update = fakeSender(UPDATE_ID, UPDATE_URL)
  const pdfPassword = fakeSender(PDF_PASSWORD_ID, PDF_PASSWORD_URL)
  const log = vi.fn()
  let clock = 1_000_000
  const deps: IpcSenderGuardDeps = {
    shellContents: () => shell as never,
    isTrustedEditorContents: (id) => id === EDITOR_ID,
    isTrustedShellUrl: (url) => url === SHELL_URL,
    isTrustedEditorUrl: (url) => url === EDITOR_URL,
    ownWindowContents: (name) => (name === 'update' ? update : pdfPassword) as never,
    isTrustedOwnWindowUrl: (name, url) =>
      url === (name === 'update' ? UPDATE_URL : PDF_PASSWORD_URL),
    log,
    now: () => clock,
    ...overrides,
  }
  const guard = createIpcSenderGuard(deps)
  return {
    guard,
    shell,
    editor,
    update,
    pdfPassword,
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
  ['tabs:* (close)', 'tabs:close', 'shell'],
  ['tabs:* (tear-off)', 'tabs:tear-off', 'shell'],
  ['tabs:* (menu)', 'tabs:show-tab-menu', 'shell'],
  ['integrations:* (skill write)', 'integrations:install-skill', 'shell'],
  ['integrations:* (clipboard)', 'integrations:copy-text', 'shell'],
  ['dropped files', 'app:open-dropped-files', 'shell-or-editor'],
  ['ai model settings', 'ai:open-model-settings', 'editor'],
  ['update opener', 'update:open-for-update', 'shell'],
  ['update state', 'update:get-state', 'shell-or-own-window:update'],
  ['update:* (download)', 'update:download', 'own-window:update'],
  ['update:* (install)', 'update:install', 'own-window:update'],
  ['pdf-password:* (submit)', 'pdf-password:submit', 'own-window:pdf-password'],
  ['pdf-password:* (state)', 'pdf-password:get-state', 'own-window:pdf-password'],
]

const OWN_WINDOW_OF: Partial<Record<IpcSenderPolicy, OwnWindow>> = {
  'own-window:update': 'update',
  'shell-or-own-window:update': 'update',
  'own-window:pdf-password': 'pdf-password',
}

describe('policyForChannel', () => {
  it.each(FAMILIES)('%s (%s) -> %s', (_family, channel, policy) => {
    expect(policyForChannel(channel)).toBe(policy)
  })

  it.each([
    ['uniwork:cloud-status-open-account', 'editor'],
    ['uniwork:cloud-status-sign-in', 'editor'],
    ['uniwork:comments:upsert', 'editor'],
    ['uniwork:askuni-doc:stream', 'editor'],
    ['uniwork:askuni-doc:stream-cancel', 'editor'],
    ['uniwork:askuni-doc:messages', 'editor'],
    ['uniwork:askuni-doc:feedback-set', 'editor'],
    ['uniwork:askuni-doc:feedback-clear', 'editor'],
    ['uniwork:askuni-doc:flags', 'editor'],
    ['uniwork:askuni:stream', 'shell'],
    ['uniwork:askuni:flags', 'shell'],
    ['uniwork:askuni:open-citation', 'shell'],
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
    ['tabs:activate', 'shell'],
    ['tabs:list', 'shell'],
    ['tabs:detach', 'shell'],
    ['tabs:dock-torn-window', 'shell'],
    ['tabs:x', 'shell'],
    ['integrations:status', 'shell'],
    ['integrations:uninstall-skill', 'shell'],
    ['integrations:save-skill-zip', 'shell'],
    ['integrations:pick-skill-dir', 'shell'],
    ['update:later', 'own-window:update'],
    ['update:open-download', 'own-window:update'],
    ['update:check', 'own-window:update'],
    ['update:x', 'own-window:update'],
    ['pdf-password:cancel', 'own-window:pdf-password'],
    ['pdf-password:x', 'own-window:pdf-password'],
  ] as const)('%s -> %s', (channel, policy) => {
    expect(policyForChannel(channel)).toBe(policy)
  })

  it.each([
    'docs:save',
    'ai:chat',
    'ai:open-model-settings-x',
    'ai:open-model-settingsx',
    'app:open-dropped-files-x',
    'app:open-dropped-filesx',
    'tabs',
    'tabs:',
    'tabsx:a',
    'Tabs:close',
    'integrations',
    'integrations:',
    'integrationsx:a',
    'update',
    'update:',
    'updatex:y',
    'Update:download',
    'pdf-password',
    'pdf-password:',
    'pdf-passwordx:a',
    'pdf:password',
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
    expect(() => g.on('docs:open', () => {})).toThrow()
    expect(() => g.once('docs:open', () => {})).toThrow()
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
  const allowsShell =
    policy === 'shell' || policy === 'shell-or-editor' || policy === 'shell-or-own-window:update'
  const allowsEditor = policy === 'editor' || policy === 'shell-or-editor'
  const ownWindow = OWN_WINDOW_OF[policy]
  const ownSender = (ctx: ReturnType<typeof setup>, name: OwnWindow) =>
    name === 'update' ? ctx.update : ctx.pdfPassword

  if (allowsShell) {
    it('passes the shell main frame with args and return value untouched', async () => {
      const { call, shell, inner } = registerHandle(channel)
      const event = mainFrameEvent(shell)
      expect(await call(event, 'a', 2)).toEqual({ answered: ['a', 2] })
      expect(inner).toHaveBeenCalledWith(event, 'a', 2)
    })
  } else {
    it('refuses the shell calling a channel it may not call', async () => {
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
    it('refuses an editor calling a channel it may not call', async () => {
      const { call, editor, inner, guard } = registerHandle(channel)
      expect(guard.check(mainFrameEvent(editor), channel)).toEqual({
        ok: false,
        reason: 'unknown-sender',
      })
      await expect(async () => call(mainFrameEvent(editor))).rejects.toThrow(IPC_SENDER_REFUSED)
      expect(inner).not.toHaveBeenCalled()
    })
  }

  for (const name of ['update', 'pdf-password'] as const) {
    if (ownWindow === name) {
      it(`passes the live ${name} window main frame`, async () => {
        const ctx = registerHandle(channel)
        expect(await ctx.call(mainFrameEvent(ownSender(ctx, name)), 'y')).toEqual({
          answered: ['y'],
        })
        expect(ctx.inner).toHaveBeenCalledTimes(1)
      })
    } else {
      it(`refuses the ${name} window`, async () => {
        const ctx = registerHandle(channel)
        const event = mainFrameEvent(ownSender(ctx, name))
        expect(ctx.guard.check(event, channel)).toEqual({ ok: false, reason: 'unknown-sender' })
        await expect(async () => ctx.call(event)).rejects.toThrow(IPC_SENDER_REFUSED)
        expect(ctx.inner).not.toHaveBeenCalled()
      })
    }
  }

  const trusted = (ctx: ReturnType<typeof setup>) =>
    allowsShell ? ctx.shell : allowsEditor ? ctx.editor : ownSender(ctx, ownWindow!)

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

describe('own-window policies', () => {
  it.each(['update:download', 'update:get-state', 'pdf-password:submit'])(
    '%s refuses an own window as unknown-sender when ownWindowContents is absent',
    (channel) => {
      const ctx = setup({ ownWindowContents: undefined })
      const own = channel.startsWith('update:') ? ctx.update : ctx.pdfPassword
      expect(ctx.guard.check(mainFrameEvent(own), channel)).toEqual({
        ok: false,
        reason: 'unknown-sender',
      })
    },
  )

  it('refuses as unknown-sender when isTrustedOwnWindowUrl is absent', () => {
    const ctx = setup({ isTrustedOwnWindowUrl: undefined })
    expect(ctx.guard.check(mainFrameEvent(ctx.update), 'update:download')).toEqual({
      ok: false,
      reason: 'unknown-sender',
    })
  })

  it('keeps update:get-state working for the shell without the own-window deps', () => {
    const ctx = setup({ ownWindowContents: undefined, isTrustedOwnWindowUrl: undefined })
    expect(ctx.guard.check(mainFrameEvent(ctx.shell), 'update:get-state')).toEqual({ ok: true })
  })

  it('follows ownWindowContents() lazily (null while closed, a new webContents when re-opened)', () => {
    let current: FakeSender | null = null
    const names: string[] = []
    const ctx = setup({
      ownWindowContents: (name) => {
        names.push(name)
        return current as never
      },
    })
    const first = fakeSender(UPDATE_ID, UPDATE_URL)
    expect(ctx.guard.check(mainFrameEvent(first), 'update:install')).toEqual({
      ok: false,
      reason: 'unknown-sender',
    })
    current = first
    expect(ctx.guard.check(mainFrameEvent(first), 'update:install')).toEqual({ ok: true })
    const second = fakeSender(UPDATE_ID + 100, UPDATE_URL)
    current = second
    expect(ctx.guard.check(mainFrameEvent(first), 'update:install')).toEqual({
      ok: false,
      reason: 'unknown-sender',
    })
    expect(ctx.guard.check(mainFrameEvent(second), 'update:install')).toEqual({ ok: true })
    expect(names.every((n) => n === 'update')).toBe(true)
  })

  it('asks for the pdf-password window by name for pdf-password:*', () => {
    const asked = vi.fn((_name: OwnWindow) => null)
    const ctx = setup({ ownWindowContents: asked })
    ctx.guard.check(mainFrameEvent(ctx.pdfPassword), 'pdf-password:cancel')
    expect(asked).toHaveBeenCalledWith('pdf-password')
  })

  it('composite update:get-state: the shell and the live update window pass, nothing else', () => {
    const ctx = setup()
    const ch = 'update:get-state'
    expect(ctx.guard.check(mainFrameEvent(ctx.shell), ch)).toEqual({ ok: true })
    expect(ctx.guard.check(mainFrameEvent(ctx.update), ch)).toEqual({ ok: true })
    for (const other of [ctx.editor, ctx.pdfPassword]) {
      expect(ctx.guard.check(mainFrameEvent(other), ch)).toEqual({
        ok: false,
        reason: 'unknown-sender',
      })
    }
  })

  it('the update window passes update:download but not tabs:* or pdf-password:*', () => {
    const ctx = setup()
    const event = mainFrameEvent(ctx.update)
    expect(ctx.guard.check(event, 'update:download')).toEqual({ ok: true })
    for (const ch of [
      'tabs:close',
      'tabs:show-menu',
      'pdf-password:submit',
      'integrations:copy-text',
    ]) {
      expect(ctx.guard.check(event, ch)).toEqual({ ok: false, reason: 'unknown-sender' })
    }
  })

  it('the shell is refused for update:download, an editor for tabs:*', () => {
    const ctx = setup()
    expect(ctx.guard.check(mainFrameEvent(ctx.shell), 'update:download')).toEqual({
      ok: false,
      reason: 'unknown-sender',
    })
    expect(ctx.guard.check(mainFrameEvent(ctx.editor), 'tabs:close')).toEqual({
      ok: false,
      reason: 'unknown-sender',
    })
    expect(ctx.guard.check(mainFrameEvent(ctx.editor), 'tabs:tear-off')).toEqual({
      ok: false,
      reason: 'unknown-sender',
    })
  })

  it.each([
    ['update window on the pdf-password page', 'update', 'update:download', PDF_PASSWORD_URL],
    ['update window on the shell page', 'update', 'update:get-state', SHELL_URL],
    ['pdf-password window on the update page', 'pdf-password', 'pdf-password:submit', UPDATE_URL],
    ['pdf-password window on a foreign origin', 'pdf-password', 'pdf-password:submit', FOREIGN_URL],
  ] as const)('refuses the %s as origin', (_name, win, channel, url) => {
    const ctx = setup()
    const sender = win === 'update' ? ctx.update : ctx.pdfPassword
    sender.mainFrame = fakeFrame(url)
    expect(ctx.guard.check(mainFrameEvent(sender), channel)).toEqual({
      ok: false,
      reason: 'origin',
    })
  })

  it('passes the window name to isTrustedOwnWindowUrl', () => {
    const urlCheck = vi.fn((_name: OwnWindow, _url: string) => true)
    const ctx = setup({ isTrustedOwnWindowUrl: urlCheck })
    ctx.guard.check(mainFrameEvent(ctx.pdfPassword), 'pdf-password:get-state')
    expect(urlCheck).toHaveBeenCalledWith('pdf-password', PDF_PASSWORD_URL)
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

  describe('own windows, packaged (no dev env)', () => {
    const rules = trustedUrlRules({ env: {}, shellRendererDir })
    const pages = { update: 'update.html', 'pdf-password': 'pdf-password.html' } as const

    it.each(['update', 'pdf-password'] as const)('%s trusts exactly its own page', (name) => {
      const page = fileUrl(pages[name])
      expect(rules.isTrustedOwnWindowUrl(name, page)).toBe(true)
      expect(rules.isTrustedOwnWindowUrl(name, `${page}?x=1#y`)).toBe(true)
      expect(rules.isTrustedShellUrl(page)).toBe(false)
      expect(rules.isTrustedEditorUrl(page)).toBe(false)
    })

    it.each(['update', 'pdf-password'] as const)('%s refuses every other page', (name) => {
      const other = name === 'update' ? 'pdf-password.html' : 'update.html'
      for (const url of [
        fileUrl(other),
        fileUrl('index.html'),
        fileUrl('assets', pages[name]),
        pathToFileURL(join(shellRendererDir, '..', pages[name])).href,
        `${pathToFileURL(shellRendererDir).href}/..%2f${pages[name]}`,
        pathToFileURL(`${shellRendererDir}-evil/${pages[name]}`).href,
        `file://evil.host/share/${pages[name]}`,
        `http://localhost:5199/${pages[name]}`,
        `genoffice-app://docs/${pages[name]}`,
        'about:blank',
        'not a url',
        '',
      ]) {
        expect(rules.isTrustedOwnWindowUrl(name, url)).toBe(false)
      }
    })

    it('compares own-window paths case-insensitively on win32 only', () => {
      const original = process.platform
      const upper = fileUrl('UPDATE.HTML')
      try {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
        expect(rules.isTrustedOwnWindowUrl('update', upper)).toBe(false)
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
        expect(rules.isTrustedOwnWindowUrl('update', upper)).toBe(true)
        expect(rules.isTrustedOwnWindowUrl('pdf-password', upper)).toBe(false)
        expect(rules.isTrustedShellUrl(upper)).toBe(false)
      } finally {
        Object.defineProperty(process, 'platform', { value: original, configurable: true })
      }
    })
  })

  describe('own windows, dev (ELECTRON_RENDERER_URL)', () => {
    const rules = trustedUrlRules({
      env: {
        ELECTRON_RENDERER_URL: 'http://localhost:5199',
        DOCS_RENDERER_URL: 'http://localhost:5173',
      },
      shellRendererDir,
    })

    it.each([
      ['update', 'http://localhost:5199/update.html'],
      ['update', 'http://localhost:5199/update.html?x=1#y'],
      ['pdf-password', 'http://localhost:5199/pdf-password.html'],
    ] as const)('%s trusts %s', (name, url) => {
      expect(rules.isTrustedOwnWindowUrl(name, url)).toBe(true)
    })

    it.each([
      ['update', 'http://localhost:5199/'],
      ['update', 'http://localhost:5199/index.html'],
      ['update', 'http://localhost:5199/pdf-password.html'],
      ['update', 'http://localhost:5199/update.html/x'],
      ['update', 'http://localhost:5199/x/update.html'],
      ['update', 'http://localhost:5199/UPDATE.HTML'],
      ['update', 'http://localhost:5198/update.html'],
      ['update', 'https://localhost:5199/update.html'],
      ['update', 'http://127.0.0.1:5199/update.html'],
      ['update', 'http://localhost:5173/update.html'],
      ['update', 'http://localhost:5199@evil.example/update.html'],
      ['pdf-password', 'http://localhost:5199/update.html'],
      ['pdf-password', 'http://localhost:5199/'],
    ] as const)('%s refuses %s', (name, url) => {
      expect(rules.isTrustedOwnWindowUrl(name, url)).toBe(false)
    })

    it('keeps the packaged own-window pages trusted next to the dev origin', () => {
      expect(rules.isTrustedOwnWindowUrl('update', fileUrl('update.html'))).toBe(true)
      expect(rules.isTrustedOwnWindowUrl('pdf-password', fileUrl('pdf-password.html'))).toBe(true)
    })

    it('trusts no own-window dev page without ELECTRON_RENDERER_URL', () => {
      const bare = trustedUrlRules({
        env: { DOCS_RENDERER_URL: 'http://localhost:5173' },
        shellRendererDir,
      })
      expect(bare.isTrustedOwnWindowUrl('update', 'http://localhost:5173/update.html')).toBe(false)
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
