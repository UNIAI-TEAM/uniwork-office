// Shared IPC sender guard (UNI-2073). Every uniwork*, home:uniwork-* and
// home:account-* channel is registered through `guard.guarded(ipcMain)` at the
// composition point, so each call is checked at call time: the sender is live,
// the call comes from its main frame, the webContents is the shell window or a
// trusted editor view (per the channel's policy), and the main frame URL is one
// the main itself loads. The raw ipcMain is never patched.
//
// Adding a channel (other lanes):
// - Policy comes from `policyForChannel`: a new `uniwork*` / `home:uniwork-*` /
//   `home:account-*` channel defaults to `shell`; an editor-facing channel needs an
//   explicit entry there. Anything out of scope throws at registration.
// - Register through the `guardedIpc` object in apps/shell/src/main/index.ts, never
//   the raw `ipcMain`, and add a new registrar file to `REGISTRAR_FILES` in
//   tests/ipc-guard-coverage.test.ts.
// - Only handle/on (and removeHandler/removeListener/off) exist on the guarded
//   object: handleOnce/once and addListener/prependListener/prependOnceListener throw.
import type { IpcMain, WebContents } from 'electron'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RENDERER_SCHEME, type RendererHost } from '@genoffice/electron-utils/renderer-scheme'

export const IPC_SENDER_REFUSED = 'ipc_sender_refused'

export type IpcSenderPolicy = 'shell' | 'editor' | 'shell-or-editor'
export type IpcRefusalReason = 'destroyed' | 'subframe' | 'unknown-sender' | 'origin'

/** the policy of a guarded channel, or null when the channel is not in the guard's scope */
export function policyForChannel(channel: string): IpcSenderPolicy | null {
  if (
    channel.startsWith('uniwork:comments:') ||
    // Ask UNI in the editor AI panels (UNI-2076 S7); `uniwork:askuni:*` stays shell
    channel.startsWith('uniwork:askuni-doc:') ||
    channel.startsWith('uniwork:cloud-status') ||
    channel === 'uniwork:ai-run'
  ) {
    return 'editor'
  }
  if (channel === 'uniwork:ai-flag') return 'shell-or-editor'
  if (
    /^uniwork:./.test(channel) ||
    /^uniwork-[^:]+:/.test(channel) ||
    channel.startsWith('home:uniwork-') ||
    channel.startsWith('home:account-')
  ) {
    return 'shell'
  }
  return null
}

export interface IpcSenderGuardDeps {
  /** read lazily on every call: the shell window may not exist yet or be re-created */
  shellContents(): WebContents | null
  /** tabs + Present views + detached windows + the spare sheets view + the slides audience window */
  isTrustedEditorContents(webContentsId: number): boolean
  isTrustedShellUrl(url: string): boolean
  isTrustedEditorUrl(url: string): boolean
  /** default console.warn */
  log?(line: string): void
  /** for the log rate limit in tests */
  now?(): number
}

type Listener = (event: never, ...args: never[]) => unknown

export type IpcMainLike = Partial<
  Pick<IpcMain, 'handle' | 'handleOnce' | 'on' | 'once' | 'removeHandler' | 'removeListener'>
>

export type IpcSenderCheck = { ok: true } | { ok: false; reason: IpcRefusalReason }

export interface IpcSenderGuard {
  /** an IpcMain-like object whose handle/on guard every listener; once-style and add/prepend registrations throw */
  guarded<T extends IpcMainLike>(ipc: T): T
  check(event: unknown, channel: string): IpcSenderCheck
}

const LOG_WINDOW_MS = 60_000

interface SenderLike {
  id?: unknown
  isDestroyed?: () => boolean
  mainFrame?: unknown
}

export function createIpcSenderGuard(deps: IpcSenderGuardDeps): IpcSenderGuard {
  const log = deps.log ?? ((line: string) => console.warn(line))
  const now = deps.now ?? Date.now
  const lastLogged = new Map<string, number>()

  function refuse(channel: string, reason: IpcRefusalReason): IpcSenderCheck {
    // Channel and reason only: never the URL, payload, ids or account data.
    const key = `${channel}\u0000${reason}`
    const at = now()
    const last = lastLogged.get(key)
    if (last === undefined || at - last >= LOG_WINDOW_MS) {
      lastLogged.set(key, at)
      log(`[ipc-guard] refused channel=${channel} reason=${reason}`)
    }
    return { ok: false, reason }
  }

  function check(event: unknown, channel: string): IpcSenderCheck {
    const policy = policyForChannel(channel)
    if (policy === null) throw new Error(`ipc-sender-guard: channel out of scope: ${channel}`)
    try {
      const sender = (event as { sender?: unknown } | null)?.sender as SenderLike | null | undefined
      if (!sender || typeof sender !== 'object') return refuse(channel, 'destroyed')
      if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) {
        return refuse(channel, 'destroyed')
      }
      const frame = (event as { senderFrame?: unknown }).senderFrame as { url?: unknown } | null
      if (!frame || frame !== sender.mainFrame) return refuse(channel, 'subframe')

      const isShell = policy !== 'editor' && sender === deps.shellContents()
      const isEditor =
        policy !== 'shell' &&
        typeof sender.id === 'number' &&
        deps.isTrustedEditorContents(sender.id)
      if (!isShell && !isEditor) return refuse(channel, 'unknown-sender')

      let url: unknown
      try {
        url = frame.url
      } catch {
        return refuse(channel, 'destroyed')
      }
      if (typeof url !== 'string') return refuse(channel, 'destroyed')
      const trusted =
        (isShell && deps.isTrustedShellUrl(url)) || (isEditor && deps.isTrustedEditorUrl(url))
      return trusted ? { ok: true } : refuse(channel, 'origin')
    } catch {
      // A getter on a torn-down sender threw: treat it as gone.
      return refuse(channel, 'destroyed')
    }
  }

  function assertInScope(channel: string): void {
    if (policyForChannel(channel) === null) {
      throw new Error(`ipc-sender-guard: refusing to register out-of-scope channel ${channel}`)
    }
  }

  function guardInvoke(channel: string, handler: Listener): Listener {
    return ((event: never, ...args: never[]) => {
      if (!check(event, channel).ok) throw new Error(IPC_SENDER_REFUSED)
      return handler(event, ...args)
    }) as Listener
  }

  function guardEvent(channel: string, listener: Listener): Listener {
    return ((event: never, ...args: never[]) => {
      if (!check(event, channel).ok) return
      listener(event, ...args)
    }) as Listener
  }

  function guarded<T extends IpcMainLike>(ipc: T): T {
    // channel -> original listener -> wrapped listeners (same listener may be added twice)
    const wrappers = new Map<string, Map<Listener, Listener[]>>()
    const remember = (channel: string, listener: Listener, wrapped: Listener) => {
      let byListener = wrappers.get(channel)
      if (!byListener) wrappers.set(channel, (byListener = new Map()))
      byListener.set(listener, [...(byListener.get(listener) ?? []), wrapped])
    }
    const forget = (channel: string, listener: Listener): Listener | undefined => {
      const list = wrappers.get(channel)?.get(listener)
      const wrapped = list?.pop()
      if (list && list.length === 0) wrappers.get(channel)!.delete(listener)
      return wrapped
    }
    const raw = ipc as unknown as Record<string, (...args: unknown[]) => unknown>

    const unguardedAdd = (method: string) => () => {
      throw new Error(`guarded ipc: ${method} would register unguarded, use on()`)
    }

    const overrides: Record<string, (...args: never[]) => unknown> = {
      handle: (channel: string, handler: Listener) => {
        assertInScope(channel)
        return raw.handle.call(ipc, channel, guardInvoke(channel, handler))
      },
      // A refused first call would consume a one-shot listener, so they are not offered.
      handleOnce: () => {
        throw new Error('guarded ipc: handleOnce is not supported, use handle()')
      },
      on: (channel: string, listener: Listener) => {
        assertInScope(channel)
        const wrapped = guardEvent(channel, listener)
        remember(channel, listener, wrapped)
        raw.on.call(ipc, channel, wrapped)
        return proxy
      },
      once: () => {
        throw new Error('guarded ipc: once is not supported, use on()')
      },
      addListener: unguardedAdd('addListener'),
      prependListener: unguardedAdd('prependListener'),
      prependOnceListener: unguardedAdd('prependOnceListener'),
      removeHandler: (channel: string) => raw.removeHandler.call(ipc, channel),
      removeListener: (channel: string, listener: Listener) => {
        raw.removeListener.call(ipc, channel, forget(channel, listener) ?? listener)
        return proxy
      },
    }
    overrides.off = overrides.removeListener

    const proxy: T = new Proxy(ipc, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && Object.hasOwn(overrides, prop) && prop in target) {
          return overrides[prop]
        }
        const value: unknown = Reflect.get(target, prop, receiver)
        if (typeof value !== 'function') return value
        // Chainable methods (removeAllListeners, setMaxListeners) return the raw target: keep the guard.
        return (...args: unknown[]) => {
          const result: unknown = value.apply(target, args)
          return result === target ? proxy : result
        }
      },
    })
    return proxy
  }

  return { guarded, check }
}

const EDITOR_HOSTS: ReadonlySet<RendererHost> = new Set<RendererHost>([
  'docs',
  'sheets',
  'slides',
  'pdf',
  'markdown',
  'html',
])

const EDITOR_DEV_ENV = [
  'DOCS_RENDERER_URL',
  'SHEETS_RENDERER_URL',
  'SLIDES_RENDERER_URL',
  'PDF_RENDERER_URL',
  'MARKDOWN_RENDERER_URL',
  'HTML_RENDERER_URL',
] as const

function parseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** origin of an http(s) dev server URL, null when unset or not http(s) */
function devOrigin(value: string | undefined): string | null {
  if (!value) return null
  const url = parseUrl(value)
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null
  return url.origin
}

function isHttpOriginIn(url: URL, origins: ReadonlySet<string>): boolean {
  return (url.protocol === 'http:' || url.protocol === 'https:') && origins.has(url.origin)
}

/** dev and packaged URL rules built from the same env/consts the main uses to load the windows */
export function trustedUrlRules(input: { env: NodeJS.ProcessEnv; shellRendererDir: string }): {
  isTrustedShellUrl(url: string): boolean
  isTrustedEditorUrl(url: string): boolean
} {
  const shellOrigins = new Set<string>()
  const shellDev = devOrigin(input.env.ELECTRON_RENDERER_URL)
  if (shellDev) shellOrigins.add(shellDev)

  const editorOrigins = new Set<string>()
  for (const key of EDITOR_DEV_ENV) {
    const origin = devOrigin(input.env[key])
    if (origin) editorOrigins.add(origin)
  }

  // The packaged shell loads exactly one page; the platform is read per call.
  const fold = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path)
  const shellPage = resolve(input.shellRendererDir, 'index.html')

  return {
    isTrustedShellUrl(value) {
      const url = parseUrl(value)
      if (!url) return false
      if (isHttpOriginIn(url, shellOrigins)) return true
      if (url.protocol !== 'file:' || url.host !== '') return false
      let path: string
      try {
        // Rejects encoded separators (%2f) and non-local hosts.
        path = fileURLToPath(url)
      } catch {
        return false
      }
      if (path.includes('\0')) return false
      return fold(resolve(path)) === fold(shellPage)
    },
    isTrustedEditorUrl(value) {
      const url = parseUrl(value)
      if (!url) return false
      if (isHttpOriginIn(url, editorOrigins)) return true
      return (
        url.protocol === `${RENDERER_SCHEME}:` &&
        url.username === '' &&
        url.password === '' &&
        url.port === '' &&
        EDITOR_HOSTS.has(url.hostname as RendererHost)
      )
    },
  }
}
