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
import { registerUniworkAskUni } from '../src/main/uniwork-askuni'
import { ASKUNI_CHANNELS, ASKUNI_DOC_CHANNELS, ASKUNI_V2_CHANNELS } from '../src/shared/askuni-api'
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
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
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
}

const sources: Source[] = scannedFiles().map((full) => ({
  file: relative(root, full).replace(/\\/g, '/'),
  text: readFileSync(full, 'utf8'),
}))

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
for (const app of readdirSync(join(root, 'apps')))
  walk(join(root, 'apps', app, 'src/shared'), sharedFiles)
// the Ask UNI v2 and editor channel tables live in the ai-provider package (shared with the editor preloads)
walk(join(root, 'packages/ai-provider/src'), sharedFiles)
for (const full of sharedFiles) readConstants(readFileSync(full, 'utf8'))

/** the channels an argument expression can name; empty when it is a runtime value */
function resolveChannels(arg: string, aliases: ReadonlyMap<string, string>): string[] {
  const text = arg
    .trim()
    .replace(/^([A-Za-z_]\w*)\./, (_all, name: string) => `${aliases.get(name) ?? name}.`)
  const literal = /^'([^']*)'$|^"([^"]*)"$|^`([^`$]*)`$/.exec(text)
  if (literal) return [literal[1] ?? literal[2] ?? literal[3] ?? '']
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

/** a preload-side bridge: imports ipcRenderer from electron and never names ipcMain, so it registers nothing in main */
function isRendererOnly(text: string): boolean {
  return (
    /import\s*\{[^}]*\bipcRenderer\b[^}]*\}\s*from\s*'electron'/.test(text) &&
    !/\bipcMain\b/.test(text)
  )
}

function registrations(source: Source): Registration[] {
  if (isRendererOnly(source.text)) return []
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
  'apps/shell/src/main/uniwork-askuni/stream-service.ts':
    'registerAskUniStreamIpc (in registerUniworkAskUni, in createUniworkDocs)',
  'apps/shell/src/main/uniwork-askuni/rest-service.ts':
    'registerAskUniRestIpc (in registerUniworkAskUni, in createUniworkDocs)',
  'apps/shell/src/main/uniwork-askuni/doc-service.ts':
    'registerAskUniDocIpc, the editor family (in registerUniworkAskUni, in createUniworkDocs)',
  'apps/shell/src/main/uniwork-docs/doc-history-service.ts':
    'registerDocHistoryIpc (in createUniworkDocs)',
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

const RAW_METHODS = 'handle|handleOnce|on|once|addListener|prependListener|prependOnceListener'

/**
 * Every name the global `ipcMain` can be reached under in this file: `import { ipcMain }`,
 * `import { ipcMain as x }`, `const { ipcMain } = require('electron')`, `electron.ipcMain`, and
 * `const bus = <raw name>` aliases of any of those. A parameter that merely happens to be called
 * `ipcMain` (a registrar's guarded object) is not an import and is not raw.
 */
function rawReceivers(text: string): string[] {
  const names = new Set<string>()
  for (const imp of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'electron'/g)) {
    for (const spec of imp[1]!.split(',')) {
      const m = /^\s*(?:type\s+)?ipcMain(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(spec)
      if (m) names.add(m[1] ?? 'ipcMain')
    }
  }
  for (const m of text.matchAll(
    /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:require\(\s*'electron'\s*\)|electron)\b/g,
  )) {
    for (const spec of m[1]!.split(',')) {
      const part = /^\s*ipcMain(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*$/.exec(spec)
      if (part) names.add(part[1] ?? 'ipcMain')
    }
  }
  if (/\belectron\.ipcMain\b/.test(text)) names.add('electron.ipcMain')
  if (names.size === 0) return []
  // `const bus = ipcMain` and `const other = bus`: two passes reach a chain of three
  for (let pass = 0; pass < 2; pass++) {
    for (const m of text.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\w$.]+)\s*[;\n]/g,
    )) {
      if (names.has(m[2]!)) names.add(m[1]!)
    }
  }
  return [...names]
}

/** the first call argument starting at `from` (just after the `(`): brackets, strings and templates balanced */
function firstArgument(text: string, from: number): string {
  const skipQuoted = (start: number, quote: string): number => {
    let i = start + 1
    while (i < text.length && text[i] !== quote) {
      if (text[i] === '\\') i++
      else if (quote === '`' && text[i] === '$' && text[i + 1] === '{') {
        i = skipBraces(i + 1)
        continue
      }
      i++
    }
    return i
  }
  const skipBraces = (start: number): number => {
    let level = 0
    let i = start
    for (; i < text.length; i++) {
      const ch = text[i]!
      if (ch === "'" || ch === '"' || ch === '`') i = skipQuoted(i, ch)
      else if (ch === '{') level++
      else if (ch === '}' && --level === 0) return i + 1
    }
    return i
  }
  let depth = 0
  let i = from
  for (; i < text.length; i++) {
    const ch = text[i]!
    if (ch === "'" || ch === '"' || ch === '`') i = skipQuoted(i, ch)
    else if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break
      depth--
    } else if (ch === ',' && depth === 0) break
  }
  return text.slice(from, i).trim()
}

interface RawRegistration extends Registration {
  /** false when the channel is a template, a concatenation, a loop variable, a call, ... */
  resolved: boolean
}

/** every `<raw ipcMain>.<registration method>(...)` call in one file */
function rawRegistrations(file: string, text: string): RawRegistration[] {
  const receivers = rawReceivers(text)
  if (receivers.length === 0) return []
  const escaped = receivers.map((name) => name.replace(/\./g, '\\.')).join('|')
  const call = new RegExp(`(?<![\\w$.])(${escaped})\\.(${RAW_METHODS})\\(`, 'g')
  const aliases = new Map(
    [...text.matchAll(/const\s+(\w+)\s*=\s*([A-Z][A-Z0-9_]*)\s*$/gm)].map(
      (m) => [m[1]!, m[2]!] as const,
    ),
  )
  return [...text.matchAll(call)].map((match) => {
    const arg = firstArgument(text, match.index! + match[0].length)
    const channels = resolveChannels(arg, aliases)
    return {
      file,
      receiver: match[1]!,
      method: match[2]!,
      arg,
      channels,
      resolved: channels.length > 0,
    }
  })
}

/**
 * Raw registrations whose channel is decided at run time. Each is out of the sender guard's
 * scope today (it cannot name a guarded channel); a new one needs a reason here, i.e. someone
 * decided it. Key: `<file>: <channel expression>`.
 */
const DYNAMIC_RAW_CHANNELS: Record<string, string> = {
  'apps/slides/src/main/slides-main.ts: channel':
    'the slides document-session handlers: the keys of sessionHandlers, typed `slides:${string}`, never a guarded channel',
}

const squash = (arg: string): string => arg.replace(/\s+/g, ' ')

/** what the coverage rule rejects in one file: a guarded channel on the raw ipcMain, or an unreadable channel */
function rawOffenders(
  file: string,
  text: string,
  allow: Readonly<Record<string, string>> = DYNAMIC_RAW_CHANNELS,
): string[] {
  const offenders: string[] = []
  for (const reg of rawRegistrations(file, text)) {
    if (!reg.resolved) {
      if (allow[`${file}: ${squash(reg.arg)}`]) continue
      offenders.push(
        `${file}: ${reg.receiver}.${reg.method}(${squash(reg.arg)}) has a channel the scan cannot read`,
      )
      continue
    }
    for (const channel of scoped(reg)) {
      offenders.push(
        `${file}: ${reg.receiver}.${reg.method}(${squash(reg.arg)}) -> ${channel} (${policyForChannel(channel)})`,
      )
    }
  }
  return offenders
}

describe('raw ipcMain registrations of guarded channels', () => {
  it('registers no channel with a guard policy on the raw ipcMain, and no channel the scan cannot read', () => {
    const offenders = sources.flatMap((source) => rawOffenders(source.file, source.text))
    expect(offenders).toEqual([])
  })

  it('lists only dynamic raw channels that still exist', () => {
    const live = new Set(
      sources.flatMap((source) =>
        rawRegistrations(source.file, source.text)
          .filter((reg) => !reg.resolved)
          .map((reg) => `${source.file}: ${squash(reg.arg)}`),
      ),
    )
    expect(Object.keys(DYNAMIC_RAW_CHANNELS).filter((key) => !live.has(key))).toEqual([])
  })

  it('hands no registrar of guarded channels the raw ipcMain', () => {
    const offenders: string[] = []
    for (const source of sources) {
      const receivers = rawReceivers(source.text)
      if (receivers.length === 0) continue
      const escaped = receivers.map((name) => name.replace(/\./g, '\\.')).join('|')
      const call = new RegExp(`\\b(${REGISTRARS.join('|')})\\(\\s*(${escaped})\\b`, 'g')
      for (const match of source.text.matchAll(call)) {
        offenders.push(`${source.file}: ${match[1]}(${match[2]}, ...)`)
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * The scan has to catch every way a guarded registration can be written on the raw ipcMain.
 * Each case is a fixture fed to the same helpers the real tree goes through.
 */
describe('the raw registration scan catches the forms that used to slip through', () => {
  const header = "import { ipcMain } from 'electron'\n"
  const file = 'apps/shell/src/main/x.ts'
  const offendersOf = (body: string, imports = header, name = file) =>
    rawOffenders(name, `${imports}${body}\n`, {})

  it('control: a plain literal on the raw ipcMain', () => {
    expect(offendersOf("ipcMain.handle('uniwork-doc:save', () => 1)")).toHaveLength(1)
  })

  it('a template literal channel', () => {
    expect(offendersOf('ipcMain.handle(`uniwork-doc:${name}`, () => 1)')).toHaveLength(1)
  })

  it('a concatenated channel', () => {
    expect(offendersOf("ipcMain.handle('uniwork-doc:' + name, () => 1)")).toHaveLength(1)
  })

  it('a loop variable', () => {
    expect(offendersOf('for (const ch of names) ipcMain.handle(ch, () => 1)')).toHaveLength(1)
  })

  it('addListener, prependListener, prependOnceListener, handleOnce and once', () => {
    for (const method of [
      'addListener',
      'prependListener',
      'prependOnceListener',
      'handleOnce',
      'once',
    ]) {
      expect(offendersOf(`ipcMain.${method}('uniwork-doc:save', () => 1)`), method).toHaveLength(1)
    }
  })

  it('an aliased import', () => {
    const imports = "import { ipcMain as rawIpc } from 'electron'\n"
    expect(offendersOf("rawIpc.handle('uniwork-doc:save', () => 1)", imports)).toHaveLength(1)
  })

  it('another receiver name for the same object', () => {
    expect(
      offendersOf("const bus = ipcMain\nbus.handle('uniwork-doc:save', () => 1)"),
    ).toHaveLength(1)
  })

  it('electron.ipcMain on a default import', () => {
    const imports = "import electron from 'electron'\n"
    expect(offendersOf("electron.ipcMain.on('uniwork-doc:save', () => 1)", imports)).toHaveLength(1)
  })

  it('a *-bridge.ts under a main directory is scanned like any other file', () => {
    const text = `${header}ipcMain.on('uniwork-doc:save', () => 1)\n`
    expect(rawOffenders('apps/shell/src/main/mcp/x-bridge.ts', text, {})).toHaveLength(1)
    // and the walk really reaches the ones that exist
    expect(sources.map((s) => s.file)).toContain('apps/shell/src/main/mcp/docs-bridge.ts')
  })

  it('an ipcRenderer-only file has no raw receiver and nothing to register', () => {
    expect(rawReceivers("import { ipcRenderer } from 'electron'\nipcRenderer.on('a', f)")).toEqual(
      [],
    )
  })

  it('an unreadable channel passes only when it is allow-listed with a reason', () => {
    const text = `${header}for (const ch of names) ipcMain.handle(ch, () => 1)\n`
    expect(rawOffenders(file, text, { [`${file}: ch`]: 'reason' })).toEqual([])
    expect(rawOffenders(file, text, {})).toHaveLength(1)
  })

  it('leaves a guarded object alone: a parameter named ipcMain and an out-of-scope literal', () => {
    const param = 'export function register(ipcMain: Guarded) {\n  ipcMain.handle(c, () => 1)\n}\n'
    expect(rawOffenders(file, param, {})).toEqual([])
    expect(offendersOf("ipcMain.handle('home:open-path', () => 1)")).toEqual([])
  })

  it('reads a call argument across nested brackets, strings and templates', () => {
    expect(firstArgument('`a,${f(1, 2)}`, rest)', 0)).toBe('`a,${f(1, 2)}`')
    expect(firstArgument("fn('x,y', [1, 2]), tail)", 0)).toBe("fn('x,y', [1, 2])")
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
  // Ask UNI in the editor AI panels (UNI-2076 S7): editor views only; `uniwork:askuni:*` stays shell
  if (channel.startsWith('uniwork:askuni-doc:')) return 'editor'
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
    ASKUNI_V2_CHANNELS,
    DISCUSSION_CHANNELS,
  }

  for (const [name, table] of Object.entries(shellOnly)) {
    it(`${name}: shell`, () => {
      const values = Object.values(table)
      expect(values.length).toBeGreaterThan(0)
      for (const channel of values) expect(policyForChannel(channel), channel).toBe('shell')
    })
  }

  it('ASKUNI_DOC_CHANNELS: editor', () => {
    const values = Object.values(ASKUNI_DOC_CHANNELS)
    expect(values.length).toBeGreaterThan(0)
    for (const channel of values) expect(policyForChannel(channel), channel).toBe('editor')
  })

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

  it('registers every Ask UNI channel (shell family and editor family) without a refused registration', () => {
    const guard = createIpcSenderGuard({
      shellContents: () => null,
      isTrustedEditorContents: () => false,
      isTrustedShellUrl: () => false,
      isTrustedEditorUrl: () => false,
      log: () => {},
    })
    const registered: string[] = []
    const guarded = guard.guarded({
      handle: (channel: string) => void registered.push(channel),
    } as never)
    registerUniworkAskUni(guarded as never, {
      profile: () => null,
      authorized: async () => {
        throw new Error('unused')
      },
      isSignedIn: () => false,
      scopeKey: () => null,
      selectedOrgId: () => null,
      activeWorkspaceId: () => null,
      packaged: true,
      env: {},
      openDocument: async () => {
        throw new Error('unused')
      },
      openExternal: async () => undefined,
    })
    // the stream-event channels are main -> renderer pushes, not handlers
    expect(registered.sort()).toEqual(
      [
        ...Object.values(ASKUNI_CHANNELS),
        ...Object.values(ASKUNI_V2_CHANNELS).filter((c) => c !== ASKUNI_V2_CHANNELS.streamEvent),
        ...Object.values(ASKUNI_DOC_CHANNELS).filter((c) => c !== ASKUNI_DOC_CHANNELS.streamEvent),
      ].sort(),
    )
    expect(registered).toHaveLength(20)
  })
})
