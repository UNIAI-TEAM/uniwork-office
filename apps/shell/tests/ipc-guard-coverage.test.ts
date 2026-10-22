import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createIpcSenderGuard,
  policyForChannel,
  type IpcSenderPolicy,
} from '../src/main/ipc-sender-guard'
import { registerAiRunIpc } from '../src/main/ai-run-registry'
import { registerUniworkAiFlagIpc } from '../src/main/uniwork-ai-flag'
import { registerUniworkCloudStatusIpc } from '../src/main/uniwork-cloud-status'
import { registerUniworkWork } from '../src/main/uniwork-work/wiring'
import { HOME_CHANNELS, UNIWORK_DOC_CHANNELS, UNIWORK_SHARE_CHANNELS } from '../src/shared/home-api'
import { ASKUNI_CHANNELS } from '../src/shared/askuni-api'
import { SOURCE_VIEW_CHANNELS } from '../src/shared/source-view'
import { UNIWORK_SYNC_CENTER_CHANNELS } from '../src/shared/sync-center'
import { UNIWORK_WORK_CHANNELS } from '../src/shared/uniwork-work-api'
import { ZIP_DOWNLOAD_CHANNELS } from '../src/shared/zip-download-api'
import { AI_RUN_CHANNEL } from '../../../packages/electron-utils/src/ai-run'
import {
  COMMENTS_CHANNELS,
  DISCUSSION_CHANNELS,
} from '../../../packages/electron-utils/src/comments-ipc'
import { UNIWORK_AI_FLAG_GET } from '../../../packages/electron-utils/src/uniwork-ai-flag'
import {
  UNIWORK_CLOUD_STATUS_GET,
  UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT,
  UNIWORK_CLOUD_STATUS_SIGN_IN,
} from '../../../packages/electron-utils/src/uniwork-cloud-status'

/**
 * UNI-2073 coverage: every channel the sender guard has a policy for must be registered through
 * `guard.guarded(ipcMain)`, never on the raw `ipcMain`. The scan reads the main-process sources
 * (apps/shell/src/main, every editor main bundled into the shell, packages/electron-utils/src),
 * resolves the channel constants from their declarations and checks (1) raw registrations,
 * (2) registrar calls handed the raw `ipcMain`, (3) the composition in index.ts, (4) that no new
 * registrar file appears without being listed here, and (5) the policy of every channel constant.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../..')

// ---- the scanned sources ----

function walk(dir: string, out: string[]): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return // an app without a main process
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'dist') continue
      walk(full, out)
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      // the preload-side bridges call ipcRenderer, they register nothing in main
      !/-bridge\.tsx?$/.test(entry.name)
    ) {
      out.push(full)
    }
  }
}

function scannedFiles(): string[] {
  const files: string[] = []
  walk(join(root, 'apps/shell/src/main'), files)
  walk(join(root, 'packages/electron-utils/src'), files)
  for (const app of readdirSync(join(root, 'apps'))) {
    if (app !== 'shell') walk(join(root, 'apps', app, 'src/main'), files)
  }
  return files
}

interface Source {
  file: string
  text: string
  /** true when the file imports the global `ipcMain` from electron (a bare `ipcMain.` is then raw) */
  importsRawIpcMain: boolean
}

const sources: Source[] = scannedFiles().map((full) => {
  const text = readFileSync(full, 'utf8')
  return {
    file: relative(root, full).replace(/\\/g, '/'),
    text,
    importsRawIpcMain: /import\s*\{[^}]*\bipcMain\b[^}]*\}\s*from\s*'electron'/.test(text),
  }
})

// ---- channel constants, read from the declarations the registrars read them from ----

const CONSTANT_TABLES = new Map<string, Array<Record<string, string> | string>>()

function addConstant(name: string, value: Record<string, string> | string): void {
  CONSTANT_TABLES.set(name, [...(CONSTANT_TABLES.get(name) ?? []), value])
}

function readConstants(text: string): void {
  for (const m of text.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*'([^'\n]*)'/g)) {
    addConstant(m[1]!, m[2]!)
  }
  for (const m of text.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*\{([\s\S]*?)\n\}/g)) {
    const table: Record<string, string> = {}
    for (const pair of m[2]!.matchAll(/^\s*([A-Za-z0-9_]+):\s*'([^'\n]*)'/gm)) {
      table[pair[1]!] = pair[2]!
    }
    if (Object.keys(table).length > 0) addConstant(m[1]!, table)
  }
}

for (const source of sources) readConstants(source.text)
const sharedFiles: string[] = []
walk(join(root, 'apps/shell/src/shared'), sharedFiles)
for (const full of sharedFiles) readConstants(readFileSync(full, 'utf8'))

/** the channels an argument expression can name; empty when it is a runtime value */
function resolveChannels(arg: string, aliases: ReadonlyMap<string, string>): string[] {
  const text = arg
    .trim()
    .replace(/^([A-Za-z_]\w*)\./, (_all, name: string) => `${aliases.get(name) ?? name}.`)
  const literal = /^'([^']*)'$|^"([^"]*)"$/.exec(text)
  if (literal) return [literal[1] ?? literal[2] ?? '']
  const member = /^([A-Z][A-Z0-9_]*)\.([A-Za-z0-9_]+)$/.exec(text)
  if (member) {
    return (CONSTANT_TABLES.get(member[1]!) ?? []).flatMap((table) =>
      typeof table === 'object' && typeof table[member[2]!] === 'string'
        ? [table[member[2]!]!]
        : [],
    )
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(text)) {
    return (CONSTANT_TABLES.get(text) ?? []).filter((t): t is string => typeof t === 'string')
  }
  return []
}

interface Registration {
  file: string
  receiver: string
  method: string
  arg: string
  channels: string[]
}

/** `ipcMain`, a registrar's `ipc` parameter, or a guarded alias (`...Ipc`); never `wc.on` or `ipcRenderer` */
const IPC_LIKE = /^(ipcMain|ipc|\w+Ipc|guarded\w*)$/

const REGISTER_CALL = /\b([A-Za-z_$][\w$]*)\.(handle|handleOnce|on|once)\(\s*([^,()]+?)\s*,/g

/** a registrar's local helper, called as `handle(CHANNEL, ...)` / `handleDiscussion(CHANNEL, ...)` */
const LOCAL_HELPER_CALL = /(?<![.\w$])(handle\w*)\(\s*([^,()]+?)\s*,/g

function registrations(source: Source): Registration[] {
  // `const C = UNIWORK_WORK_CHANNELS` style aliases of a constants table
  const aliases = new Map(
    [...source.text.matchAll(/const\s+(\w+)\s*=\s*([A-Z][A-Z0-9_]*)\s*$/gm)].map(
      (m) => [m[1]!, m[2]!] as const,
    ),
  )
  const direct = [...source.text.matchAll(REGISTER_CALL)]
    .filter((match) => IPC_LIKE.test(match[1]!))
    .map((match) => ({
      file: source.file,
      receiver: match[1]!,
      method: match[2]!,
      arg: match[3]!,
      channels: resolveChannels(match[3]!, aliases),
    }))
  const viaHelper = [...source.text.matchAll(LOCAL_HELPER_CALL)].map((match) => ({
    file: source.file,
    receiver: '(local helper)',
    method: match[1]!,
    arg: match[2]!,
    channels: resolveChannels(match[2]!, aliases),
  }))
  return [...direct, ...viaHelper]
}

const scoped = (reg: Registration): string[] => reg.channels.filter((c) => policyForChannel(c))

/**
 * Registrars of in-scope channels: they take the ipc object as their first argument, and the
 * composition (apps/shell/src/main/index.ts) must hand them a guarded one.
 */
const REGISTRARS = [
  'createUniworkDocs',
  'registerUniworkWork',
  'registerAccountIpc',
  'registerAiRunIpc',
  'registerUniworkAiFlagIpc',
  'registerUniworkCloudStatusIpc',
] as const

/** the registrars index.ts composes itself (registerUniworkCloudStatusIpc runs inside registerAccountIpc) */
const COMPOSED_IN_INDEX = REGISTRARS.filter((name) => name !== 'registerUniworkCloudStatusIpc')

/**
 * Every file allowed to register an in-scope channel. A new file that registers one fails the
 * "lists every file" test until it is listed here, i.e. until someone decided how its ipc object
 * gets guarded.
 */
const REGISTRAR_FILES: Record<string, string> = {
  'apps/shell/src/main/index.ts': 'uniwork-doc:bar-inset, registered on the guarded object',
  'apps/shell/src/main/uniwork-docs/wiring.ts': 'createUniworkDocs',
  'apps/shell/src/main/uniwork-docs/comments-wiring.ts':
    'createUniworkComments (in createUniworkDocs)',
  'apps/shell/src/main/uniwork-docs/first-save-open.ts':
    'registerFirstSaveOpenAck (in createUniworkDocs)',
  'apps/shell/src/main/uniwork-docs/first-save-name.ts':
    'registerFirstSaveNameAnswer (in createUniworkDocs)',
  'apps/shell/src/main/uniwork-askuni/service.ts': 'registerAskUniIpc (in createUniworkDocs)',
  'apps/shell/src/main/uniwork-askuni/open-citation.ts':
    'registerAskUniOpenIpc (in createUniworkDocs)',
  'apps/shell/src/main/uniwork-sync/sync-center.ts': 'registerSyncCenterIpc (in createUniworkDocs)',
  'apps/shell/src/main/uniwork-sync/offline-library/api.ts':
    'registerOfflineLibraryIpc (in createUniworkDocs)',
  'apps/shell/src/main/uniwork-work/wiring.ts': 'registerUniworkWork',
  'apps/shell/src/main/uniwork-auth/index.ts': 'registerAccountIpc',
  'apps/shell/src/main/uniwork-cloud-status.ts':
    'registerUniworkCloudStatusIpc (in registerAccountIpc)',
  'apps/shell/src/main/uniwork-ai-flag.ts': 'registerUniworkAiFlagIpc',
  'apps/shell/src/main/ai-run-registry.ts': 'registerAiRunIpc',
  // a standalone editor (no shell, never run inside it) answers the pulls with a constant "off";
  // it has no data to protect and the guard lives in the shell
  'packages/electron-utils/src/uniwork-ai-flag.ts':
    'answerUniworkAiFlagOff (standalone editors only)',
  'packages/electron-utils/src/uniwork-cloud-status.ts':
    'answerUniworkCloudStatusOff (standalone editors only)',
}

const isIndex = (file: string): boolean => file === 'apps/shell/src/main/index.ts'

// ---- 1. raw registrations ----

describe('raw ipcMain registrations of guarded channels', () => {
  it('registers no channel with a guard policy on the raw ipcMain', () => {
    const offenders: string[] = []
    for (const source of sources) {
      if (!source.importsRawIpcMain) continue
      for (const reg of registrations(source)) {
        if (reg.receiver !== 'ipcMain') continue
        for (const channel of scoped(reg)) {
          offenders.push(
            `${reg.file}: ipcMain.${reg.method}(${reg.arg}) -> ${channel} (${policyForChannel(channel)})`,
          )
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('hands no registrar of guarded channels the raw ipcMain', () => {
    const offenders: string[] = []
    const call = new RegExp(
      `\\b(${REGISTRARS.join('|')})\\(\\s*(ipcMain|electron\\.ipcMain)\\b`,
      'g',
    )
    for (const source of sources) {
      if (!source.importsRawIpcMain && !source.text.includes('electron.ipcMain')) continue
      for (const match of source.text.matchAll(call)) {
        offenders.push(`${source.file}: ${match[1]}(${match[2]}, ...)`)
      }
    }
    expect(offenders).toEqual([])
  })
})

// ---- 2. the composition in index.ts ----

describe('composition in apps/shell/src/main/index.ts', () => {
  const index = sources.find((s) => isIndex(s.file))!

  it('builds the guards from the raw ipcMain and uses only those for the registrars', () => {
    const aliases = [
      ...index.text.matchAll(/const\s+(\w+)\s*=\s*[\w.]+\.guarded\(\s*ipcMain\s*\)/g),
    ].map((m) => m[1]!)
    expect(aliases.length).toBeGreaterThan(0)
    for (const name of COMPOSED_IN_INDEX) {
      const calls = [
        ...index.text.matchAll(new RegExp(`\\b${name}\\(\\s*([A-Za-z_$][\\w$.]*)`, 'g')),
      ]
      expect(calls.length, `${name} is called from index.ts`).toBeGreaterThan(0)
      for (const call of calls) {
        const arg = call[1]!
        expect(aliases.includes(arg), `${name}(${arg}, ...) gets a guarded ipc object`).toBe(true)
      }
    }
  })

  it('registers uniwork-doc:bar-inset on a guarded object, not on the raw ipcMain', () => {
    const calls = registrations(index).filter((r) =>
      r.channels.includes(UNIWORK_DOC_CHANNELS.barInset),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]!.receiver).not.toBe('ipcMain')
  })

  it('reads the shell window lazily (a function, never a captured webContents)', () => {
    expect(/createIpcSenderGuard\(\{[\s\S]{0,300}shellContents:\s*\(\)\s*=>/.test(index.text)).toBe(
      true,
    )
  })
})

// ---- 3. no unlisted registrar file ----

describe('registrar files', () => {
  it('lists every file that registers a guarded channel, and only those', () => {
    const files = sources
      .filter((source) => registrations(source).some((reg) => scoped(reg).length > 0))
      .map((source) => source.file)
    expect(files.sort()).toEqual(Object.keys(REGISTRAR_FILES).sort())
  })

  it('has no channel in a registrar file that the guard would refuse to register', () => {
    const offenders: string[] = []
    for (const source of sources) {
      // index.ts registers hundreds of other channels on the raw ipcMain; its guarded ones are checked above
      if (!REGISTRAR_FILES[source.file] || isIndex(source.file)) continue
      for (const reg of registrations(source)) {
        for (const channel of reg.channels) {
          if (policyForChannel(channel) === null) {
            offenders.push(`${reg.file}: ${reg.receiver}.${reg.method}(${reg.arg}) -> ${channel}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

// ---- 4. the policy of every channel constant ----

/** the intended policy, written down independently of the guard's own table */
function expectedPolicy(channel: string): IpcSenderPolicy | null {
  if (channel.startsWith('uniwork:comments:')) return 'editor'
  if (channel.startsWith('uniwork:cloud-status')) return 'editor'
  if (channel === 'uniwork:ai-run') return 'editor'
  if (channel === 'uniwork:ai-flag') return 'shell-or-editor'
  if (/^uniwork[:-]/.test(channel)) return 'shell'
  if (channel.startsWith('home:uniwork-') || channel.startsWith('home:account-')) return 'shell'
  return null
}

describe('policy of every uniwork* and home account channel constant', () => {
  const shellOnly: Record<string, Record<string, string>> = {
    UNIWORK_DOC_CHANNELS,
    UNIWORK_SHARE_CHANNELS,
    UNIWORK_SYNC_CENTER_CHANNELS,
    UNIWORK_WORK_CHANNELS,
    ZIP_DOWNLOAD_CHANNELS,
    SOURCE_VIEW_CHANNELS,
    ASKUNI_CHANNELS,
    DISCUSSION_CHANNELS,
  }

  for (const [name, table] of Object.entries(shellOnly)) {
    it(`${name}: shell`, () => {
      const values = Object.values(table)
      expect(values.length).toBeGreaterThan(0)
      for (const channel of values) expect(policyForChannel(channel), channel).toBe('shell')
    })
  }

  it('COMMENTS_CHANNELS: editor', () => {
    for (const channel of Object.values(COMMENTS_CHANNELS)) {
      expect(policyForChannel(channel), channel).toBe('editor')
    }
  })

  it('cloud status and ai-run: editor; ai-flag: shell or editor', () => {
    for (const channel of [
      UNIWORK_CLOUD_STATUS_GET,
      UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT,
      UNIWORK_CLOUD_STATUS_SIGN_IN,
      AI_RUN_CHANNEL,
    ]) {
      expect(policyForChannel(channel), channel).toBe('editor')
    }
    expect(policyForChannel(UNIWORK_AI_FLAG_GET)).toBe('shell-or-editor')
  })

  it('every home:account-* and home:uniwork-* channel: shell', () => {
    const accountChannels = Object.values(HOME_CHANNELS).filter(
      (c) => c.startsWith('home:account-') || c.startsWith('home:uniwork-'),
    )
    expect(accountChannels.length).toBeGreaterThanOrEqual(9)
    for (const channel of accountChannels) expect(policyForChannel(channel), channel).toBe('shell')
  })

  it('every channel registered in a registrar file has its intended policy', () => {
    const wrong: string[] = []
    for (const source of sources) {
      if (!REGISTRAR_FILES[source.file] || isIndex(source.file)) continue
      for (const reg of registrations(source)) {
        for (const channel of reg.channels) {
          const expected = expectedPolicy(channel)
          if (expected === null || policyForChannel(channel) !== expected) {
            wrong.push(`${reg.file}: ${channel} -> ${String(policyForChannel(channel))}`)
          }
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('finds the channels it claims to scan (the scan itself is not empty)', () => {
    const all = sources.flatMap((s) => registrations(s)).flatMap((r) => scoped(r))
    // 135 uniwork channels and 11 home account/cloud ones are registered across the shell main
    expect(all.length).toBeGreaterThan(120)
  })
})

// ---- 5. the real guard accepts what the registrars register ----

describe('registrars under the real guard', () => {
  it('registers every channel of the small registrars without a refused registration', () => {
    const guard = createIpcSenderGuard({
      shellContents: () => null,
      isTrustedEditorContents: () => false,
      isTrustedShellUrl: () => false,
      isTrustedEditorUrl: () => false,
      log: () => {},
    })
    const registered: string[] = []
    const record = (channel: string) => {
      registered.push(channel)
    }
    const guarded = guard.guarded({ handle: record, on: record } as never) as {
      handle(channel: string, fn: () => unknown): void
      on(channel: string, fn: () => unknown): void
    }
    registerAiRunIpc(guarded as never)
    registerUniworkAiFlagIpc(guarded as never)
    registerUniworkCloudStatusIpc(guarded as never, { get: () => null })
    registerUniworkWork(guarded as never, {
      profile: () => null,
      identity: () => null,
      org: () => null,
      authorized: async () => {
        throw new Error('unused')
      },
      openExternal: async () => undefined,
    })
    expect(registered.sort()).toEqual(
      [
        AI_RUN_CHANNEL,
        UNIWORK_AI_FLAG_GET,
        UNIWORK_CLOUD_STATUS_GET,
        UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT,
        UNIWORK_CLOUD_STATUS_SIGN_IN,
        ...Object.values(UNIWORK_WORK_CHANNELS),
      ].sort(),
    )
  })
})
