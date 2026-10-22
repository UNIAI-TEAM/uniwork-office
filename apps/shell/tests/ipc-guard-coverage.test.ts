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
 * UNI-2073 / UNI-2082 coverage: every channel the sender guard has a policy for must be registered
 * through `guard.guarded(ipcMain)`, never on the raw `ipcMain`. The scan reads the main-process
 * sources (apps/shell/src/main, every editor main bundled into the shell,
 * packages/electron-utils/src), resolves the channel constants from their declarations and checks
 * (1) raw registrations, (2) registrar calls handed the raw `ipcMain`, (3) the composition in
 * index.ts, (4) that no new registrar file appears without being listed here, (5) the policy of
 * every channel constant and (6) that every `home:*` channel is registered on the guarded object.
 *
 * Two rules keep the scan from needing one regex per spelling:
 * - a file that imports electron's `ipcMain` may only use it as a direct `ipcMain.<method>(` call
 *   (judged by channel) or at a site listed in RAW_PASS_THROUGH; any other occurrence fails;
 * - a registration whose channel resolves to a guarded one is found whatever its receiver is
 *   called, and a parameter declared `IpcMain` / `IpcMainLike` is a receiver too.
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

/**
 * The same text with every comment blanked: length and line breaks are kept, so offsets and line
 * numbers still point into the original. Strings, templates and regex literals are skipped over,
 * so a `//` inside `'http://x'` or a quote inside a regex does not confuse it.
 */
function stripComments(text: string): string {
  const n = text.length
  const out: string[] = []
  const templates: number[] = [] // the brace depth each open `${` was entered at
  let depth = 0
  let inTemplate = false
  let prev = '' // the last significant character in code: tells a regex literal from a division
  let i = 0
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
  while (i < n) {
    const ch = text[i]!
    if (inTemplate) {
      if (ch === '\\') {
        out.push(text.slice(i, i + 2))
        i += 2
      } else if (ch === '`') {
        out.push(ch)
        i++
        inTemplate = false
        prev = ch
      } else if (ch === '$' && text[i + 1] === '{') {
        out.push('${')
        i += 2
        templates.push(depth)
        inTemplate = false
        prev = '{'
      } else {
        out.push(ch)
        i++
      }
      continue
    }
    const next = text[i + 1]
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i)
      const stop = end < 0 ? n : end
      out.push(blank(text.slice(i, stop)))
      i = stop
      continue
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      out.push(blank(text.slice(i, stop)))
      i = stop
      continue
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < n && text[j] !== ch && text[j] !== '\n') {
        if (text[j] === '\\') j++
        j++
      }
      out.push(text.slice(i, j + 1))
      i = j + 1
      prev = ch
      continue
    }
    if (ch === '`') {
      out.push(ch)
      i++
      inTemplate = true
      continue
    }
    if (ch === '/' && (prev === '' || '(,=:[!&|?{};'.includes(prev))) {
      let j = i + 1
      let inClass = false
      while (j < n && text[j] !== '\n') {
        const c = text[j]!
        if (c === '\\') j++
        else if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) break
        j++
      }
      if (text[j] === '/') {
        out.push(text.slice(i, j + 1))
        i = j + 1
        prev = ')'
        continue
      }
    }
    if (ch === '{') depth++
    if (ch === '}') {
      if (templates.length > 0 && templates[templates.length - 1] === depth) {
        templates.pop()
        out.push(ch)
        i++
        inTemplate = true
        continue
      }
      depth--
    }
    out.push(ch)
    i++
    if (!/\s/.test(ch)) prev = ch
  }
  return out.join('')
}

const strippedCache = new Map<string, string>()
/** the code of a file without its comments (memoised: the same text is scanned by several rules) */
function code(text: string): string {
  let stripped = strippedCache.get(text)
  if (stripped === undefined) {
    stripped = stripComments(text)
    strippedCache.set(text, stripped)
  }
  return stripped
}

const lineOf = (text: string, offset: number): number => text.slice(0, offset).split('\n').length

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
for (const full of sharedFiles) readConstants(readFileSync(full, 'utf8'))

/** the channels an argument expression can name; empty when it is a runtime value */
function resolveChannels(
  arg: string,
  aliases: ReadonlyMap<string, string>,
  shadowed: ReadonlySet<string> = new Set(),
): string[] {
  const text = arg
    .trim()
    .replace(/^([A-Za-z_]\w*)\./, (_all, name: string) => `${aliases.get(name) ?? name}.`)
  // a table or constant the file declares itself may differ from the exported one of that name
  const head = /^[A-Z][A-Z0-9_]*/.exec(text)?.[0]
  if (head !== undefined && shadowed.has(head)) return []
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

/**
 * `ipcMain`, a registrar's `ipc` parameter, or a guarded alias (`...Ipc`); never `wc.on` or `ipcRenderer`.
 * Receivers outside this shape still count when they are declared `IpcMain` / `IpcMainLike` in the
 * file or when the call names a guarded channel (see `registrations`).
 */
const IPC_LIKE = /^(ipcMain|ipc|\w+Ipc|guarded\w*)$/

/** `bus: IpcMain`, `ipc?: IpcMainLike`, `{ bus: IpcMain }`: the name a registrar gives its ipc parameter */
const IPC_PARAMETER = /\b([A-Za-z_$][\w$]*)\s*\??:\s*(?:IpcMain|IpcMainLike)\b/g

const REGISTER_CALL =
  /\b([A-Za-z_$][\w$]*)\s*\??\.\s*(handle|handleOnce|on|once)\(\s*([^,()]+?)\s*,/g

/** a registrar's local helper, called as `handle(CHANNEL, ...)` / `handleDiscussion(CHANNEL, ...)` */
const LOCAL_HELPER_CALL = /(?<![.\w$])(handle\w*)\(\s*([^,()]+?)\s*,/g

/** a preload-side bridge: imports ipcRenderer from electron and never names ipcMain, so it registers nothing in main */
function isRendererOnly(text: string): boolean {
  return (
    /import\s*\{[^}]*\bipcRenderer\b[^}]*\}\s*from\s*['"]electron['"]/.test(text) &&
    !/\bipcMain\b/.test(text)
  )
}

/**
 * A channel the guard covers: it has a policy, or the table written down in this file says it
 * must have one. The second half keeps a channel the guard's own table forgot from slipping out of
 * the scan; the policy tests below then fail on the table.
 */
const inScope = (channel: string): boolean =>
  policyForChannel(channel) !== null || expectedPolicy(channel) !== null

/**
 * Every registration call in a file, on any receiver that is ipc-like, declared `IpcMain` /
 * `IpcMainLike`, an alias of the raw `ipcMain`, or that names a guarded channel.
 */
function registrations(source: Source): Registration[] {
  const text = code(source.text)
  if (isRendererOnly(text)) return []
  // `const C = UNIWORK_WORK_CHANNELS` style aliases of a constants table
  const aliases = new Map(
    [...text.matchAll(/const\s+(\w+)\s*=\s*([A-Z][A-Z0-9_]*)\s*$/gm)].map(
      (m) => [m[1]!, m[2]!] as const,
    ),
  )
  const receivers = new Set([
    ...[...text.matchAll(IPC_PARAMETER)].map((m) => m[1]!),
    ...rawReceivers(text),
    ...guardedAliases(text),
  ])
  const direct = [...text.matchAll(REGISTER_CALL)]
    .map((match) => ({
      file: source.file,
      receiver: match[1]!,
      method: match[2]!,
      arg: match[3]!,
      channels: resolveChannels(match[3]!, aliases),
    }))
    .filter(
      (reg) =>
        IPC_LIKE.test(reg.receiver) || receivers.has(reg.receiver) || reg.channels.some(inScope),
    )
  const viaHelper = [...text.matchAll(LOCAL_HELPER_CALL)].map((match) => ({
    file: source.file,
    receiver: '(local helper)',
    method: match[1]!,
    arg: match[2]!,
    channels: resolveChannels(match[2]!, aliases),
  }))
  return [...direct, ...viaHelper]
}

const scoped = (reg: Registration): string[] => reg.channels.filter(inScope)

/**
 * The files that register a guarded channel against the files listed as allowed to: a new one is
 * `unlisted`, a listed one that no longer registers any is `stale`.
 */
function registrarFileDiff(
  files: readonly Source[],
  listed: Readonly<Record<string, string>>,
): { unlisted: string[]; stale: string[] } {
  const registering = files
    .filter((source) => registrations(source).some((reg) => scoped(reg).length > 0))
    .map((source) => source.file)
    .sort()
  const names = Object.keys(listed).sort()
  return {
    unlisted: registering.filter((file) => !names.includes(file)),
    stale: names.filter((file) => !registering.includes(file)),
  }
}

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

const RAW_METHODS = 'handle|handleOnce|on|once|addListener|prependListener|prependOnceListener'

const IDENT = '[A-Za-z_$][\\w$]*'
/** the module specifier of electron, either quote, main-process entry included */
const ELECTRON_MODULE = `(?:'electron(?:/main)?'|"electron(?:/main)?")`
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface ElectronImports {
  /** the names electron's `ipcMain` is reachable under because this file imports it */
  names: string[]
  /** the import statements themselves: reading them is not a use of `ipcMain` */
  spans: Array<[number, number]>
}

/**
 * How a file imports electron's `ipcMain`: `import { ipcMain }` (any quote, `electron` or
 * `electron/main`, `as x`), a default or `* as` namespace (`e.ipcMain`), and the `require(...)` /
 * `await import(...)` destructure or namespace forms. A parameter that merely happens to be called
 * `ipcMain` (a registrar's guarded object) is not an import and is not raw.
 */
function electronImports(text: string): ElectronImports {
  const names = new Set<string>()
  const namespaces = new Set<string>()
  const spans: Array<[number, number]> = []
  const take = (m: RegExpMatchArray): void => {
    spans.push([m.index!, m.index! + m[0].length])
  }
  const specifiers = (list: string): void => {
    for (const spec of list.split(',')) {
      const m = new RegExp(
        `^\\s*(?:type\\s+)?ipcMain(?:\\s+as\\s+(${IDENT})|\\s*:\\s*(${IDENT}))?\\s*$`,
      ).exec(spec)
      if (m) names.add(m[1] ?? m[2] ?? 'ipcMain')
    }
  }
  const loaded = `(?:await\\s+)?(?:require|import)\\(\\s*${ELECTRON_MODULE}\\s*\\)`
  for (const m of text.matchAll(
    new RegExp(
      `import\\s*(?:(${IDENT})\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*${ELECTRON_MODULE}`,
      'g',
    ),
  )) {
    take(m)
    if (m[1]) namespaces.add(m[1])
    specifiers(m[2]!)
  }
  for (const m of text.matchAll(
    new RegExp(`import\\s+(${IDENT})\\s+from\\s*${ELECTRON_MODULE}`, 'g'),
  )) {
    take(m)
    namespaces.add(m[1]!)
  }
  for (const m of text.matchAll(
    new RegExp(`import\\s*\\*\\s*as\\s+(${IDENT})\\s+from\\s*${ELECTRON_MODULE}`, 'g'),
  )) {
    take(m)
    namespaces.add(m[1]!)
  }
  for (const m of text.matchAll(
    new RegExp(`\\b(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${loaded}`, 'g'),
  )) {
    take(m)
    specifiers(m[1]!)
  }
  for (const m of text.matchAll(
    new RegExp(`\\b(?:const|let|var)\\s+(${IDENT})\\s*=\\s*${loaded}`, 'g'),
  )) {
    take(m)
    namespaces.add(m[1]!)
  }
  if (/\belectron\s*\.\s*ipcMain\b/.test(text)) namespaces.add('electron')
  for (const ns of namespaces) {
    for (const m of text.matchAll(
      new RegExp(`\\b(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${escapeRegExp(ns)}\\b`, 'g'),
    )) {
      take(m)
      specifiers(m[1]!)
    }
    if (new RegExp(`(?<![\\w$.])${escapeRegExp(ns)}\\s*\\.\\s*ipcMain\\b`).test(text)) {
      names.add(`${ns}.ipcMain`)
    }
  }
  return { names: [...names], spans }
}

/**
 * Every name the raw `ipcMain` can be reached under in this file: the import names above and
 * `const bus = <raw name>` aliases of any of those (a type annotation or an `as` cast included).
 */
function rawReceivers(text: string): string[] {
  const names = new Set(electronImports(text).names)
  if (names.size === 0) return []
  // `const bus = ipcMain` and `const other = bus`: two passes reach a chain of three
  for (let pass = 0; pass < 2; pass++) {
    for (const m of text.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*\(?\s*([\w$.]+)\s*(?:as\s+[^;\n)]+)?\)?\s*[;\n]/g,
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
function rawRegistrations(file: string, rawText: string): RawRegistration[] {
  const text = code(rawText)
  const receivers = rawReceivers(text)
  if (receivers.length === 0) return []
  const escaped = receivers.map(escapeRegExp).join('|')
  const call = new RegExp(`(?<![\\w$.])(${escaped})\\s*\\.\\s*(${RAW_METHODS})\\s*\\(`, 'g')
  const aliases = new Map(
    [...text.matchAll(/const\s+(\w+)\s*=\s*([A-Z][A-Z0-9_]*)\s*$/gm)].map(
      (m) => [m[1]!, m[2]!] as const,
    ),
  )
  const shadowed = new Set(
    [...text.matchAll(/(?<!export\s+)\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\b/g)].map(
      (m) => m[1]!,
    ),
  )
  return [...text.matchAll(call)].map((match) => {
    const arg = firstArgument(text, match.index! + match[0].length)
    const channels = resolveChannels(arg, aliases, shadowed)
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

interface PassThrough {
  file: string
  /** the call the raw `ipcMain` is handed to, as written (whitespace is free) */
  text: string
  /** exactly this many occurrences: a further one fails, a missing one is stale */
  count: number
  reason: string
}

/**
 * The only places a raw `ipcMain` may appear other than as `ipcMain.<method>(...)`: it is handed on
 * as a value. Each entry names the call, so a new hand-over (or a copy of one) fails until
 * someone decided it here.
 */
const RAW_PASS_THROUGH: readonly PassThrough[] = [
  {
    file: 'apps/shell/src/main/index.ts',
    text: 'ipcSenderGuard.guarded(ipcMain)',
    count: 1,
    reason:
      'the one place the guard wraps the raw ipcMain; every registrar gets the wrapped object',
  },
  ...[
    'apps/docs/src/main/docs-main.ts',
    'apps/html/src/main/html-main.ts',
    'apps/markdown/src/main/markdown-main.ts',
    'apps/pdf/src/main/pdf-main.ts',
    'apps/sheets/src/main/sheets-main.ts',
    'apps/slides/src/main/slides-main.ts',
  ].flatMap((file) =>
    ['answerUniworkAiFlagOff(ipcMain)', 'answerUniworkCloudStatusOff(ipcMain)'].map((text) => ({
      file,
      text,
      count: 1,
      reason:
        'a standalone editor answers the pulls with a constant "off"; the guard lives in the shell',
    })),
  ),
]

/**
 * Rule R1. In a file that imports electron's `ipcMain`, every occurrence of the raw name has to be
 * the import, a direct `<raw>.<method>(` call (judged by its channel by `rawOffenders`) or one
 * of the listed pass-through sites. Optional chaining, a cast, a computed method name, an alias, a
 * destructure, a registrar call, an object property: none of them needs its own pattern, they all
 * fail here.
 */
function rawUseOffenders(
  file: string,
  rawText: string,
  passThrough: readonly PassThrough[],
): string[] {
  const text = code(rawText)
  const offenders: string[] = []
  const allowed: Array<[number, number]> = []
  for (const entry of passThrough.filter((p) => p.file === file)) {
    const pattern = new RegExp(escapeRegExp(entry.text).replace(/\s+/g, '\\s+'), 'g')
    const found = [...text.matchAll(pattern)]
    if (found.length !== entry.count) {
      offenders.push(
        `${file}: pass-through \`${entry.text}\` is listed ${entry.count} time(s), found ${found.length}`,
      )
    }
    for (const m of found) allowed.push([m.index!, m.index! + m[0].length])
  }
  // a re-export hands the raw ipcMain to importers this scan would never read as raw
  for (const m of text.matchAll(/\bexport\s*(?:type\s*)?\{[^}]*\bipcMain\b[^}]*\}/g)) {
    offenders.push(`${file}:${lineOf(text, m.index!)}: ipcMain is re-exported`)
  }
  // `require('electron').ipcMain` / `(await import('electron')).ipcMain`: a use no import names
  for (const m of text.matchAll(/\)\s*\.\s*ipcMain\b/g)) {
    offenders.push(`${file}:${lineOf(text, m.index!)}: ipcMain taken from a call result`)
  }
  const { names, spans } = electronImports(text)
  if (names.length === 0) return offenders
  let body = text
  for (const [from, to] of spans) {
    body = body.slice(0, from) + body.slice(from, to).replace(/[^\n]/g, ' ') + body.slice(to)
  }
  for (const name of names) {
    for (const m of body.matchAll(new RegExp(`(?<![\\w$.])${escapeRegExp(name)}(?![\\w$])`, 'g'))) {
      const at = m.index!
      if (allowed.some(([from, to]) => at >= from && at < to)) continue
      if (/^\s*\.\s*[A-Za-z_$][\w$]*\s*\(/.test(body.slice(at + m[0].length))) continue
      const line = body.slice(body.lastIndexOf('\n', at) + 1, body.indexOf('\n', at)).trim()
      offenders.push(
        `${file}:${lineOf(body, at)}: ${name} is not a direct ipcMain.<method>(...) call: ${line}`,
      )
    }
  }
  return offenders
}

interface DynamicRaw {
  reason: string
  /** exactly this many unreadable registrations under the key: a further one fails, a missing one is stale */
  count: number
}

/**
 * Raw registrations whose channel is decided at run time. Each is out of the sender guard's
 * scope today (it cannot name a guarded channel); a new one needs a reason here, i.e. someone
 * decided it. Key: `<file>: <channel expression>`; the count is how many there are.
 */
const DYNAMIC_RAW_CHANNELS: Record<string, DynamicRaw> = {
  'apps/slides/src/main/slides-main.ts: channel': {
    reason:
      'the slides document-session handlers: the keys of sessionHandlers, typed `slides:${string}`, never a guarded channel',
    count: 1,
  },
}

const squash = (arg: string): string => arg.replace(/\s+/g, ' ')

/** what the coverage rule rejects in one file: a guarded channel on the raw ipcMain, an unreadable channel, a raw use */
function rawOffenders(
  file: string,
  text: string,
  allow: Readonly<Record<string, DynamicRaw>> = DYNAMIC_RAW_CHANNELS,
  passThrough: readonly PassThrough[] = RAW_PASS_THROUGH,
): string[] {
  const offenders = rawUseOffenders(file, text, passThrough)
  const unreadable = new Map<string, RawRegistration[]>()
  for (const reg of rawRegistrations(file, text)) {
    if (!reg.resolved) {
      const key = `${file}: ${squash(reg.arg)}`
      unreadable.set(key, [...(unreadable.get(key) ?? []), reg])
      continue
    }
    for (const channel of scoped(reg)) {
      offenders.push(
        `${file}: ${reg.receiver}.${reg.method}(${squash(reg.arg)}) -> ${channel} (${String(policyForChannel(channel))})`,
      )
    }
  }
  for (const [key, regs] of unreadable) {
    const allowance = allow[key]?.count ?? 0
    if (regs.length <= allowance) continue
    if (allowance === 0) {
      for (const reg of regs) {
        offenders.push(
          `${file}: ${reg.receiver}.${reg.method}(${squash(reg.arg)}) has a channel the scan cannot read`,
        )
      }
    } else {
      offenders.push(
        `${key}: ${regs.length} registrations the scan cannot read, ${allowance} allowed`,
      )
    }
  }
  return offenders
}

/** allow-list entries whose live count differs from the listed one (a lower count is as stale as none) */
function dynamicRawMismatches(
  files: readonly Source[],
  allow: Readonly<Record<string, DynamicRaw>>,
): string[] {
  const live = new Map<string, number>()
  for (const source of files) {
    for (const reg of rawRegistrations(source.file, source.text)) {
      if (reg.resolved) continue
      const key = `${source.file}: ${squash(reg.arg)}`
      live.set(key, (live.get(key) ?? 0) + 1)
    }
  }
  return Object.entries(allow)
    .filter(([key, entry]) => (live.get(key) ?? 0) !== entry.count)
    .map(([key, entry]) => `${key}: allows ${entry.count}, found ${live.get(key) ?? 0}`)
}

describe('raw ipcMain registrations of guarded channels', () => {
  it('registers no channel with a guard policy on the raw ipcMain, and no channel the scan cannot read', () => {
    const offenders = sources.flatMap((source) => rawOffenders(source.file, source.text))
    expect(offenders).toEqual([])
  })

  it('lists only dynamic raw channels that still exist, as often as they exist', () => {
    expect(dynamicRawMismatches(sources, DYNAMIC_RAW_CHANNELS)).toEqual([])
  })

  it('lists only pass-through files the scan reads', () => {
    const files = new Set(sources.map((source) => source.file))
    expect(RAW_PASS_THROUGH.filter((entry) => !files.has(entry.file))).toEqual([])
  })

  it('hands no registrar of guarded channels the raw ipcMain', () => {
    const offenders: string[] = []
    for (const source of sources) {
      const text = code(source.text)
      const receivers = rawReceivers(text)
      if (receivers.length === 0) continue
      const escaped = receivers.map(escapeRegExp).join('|')
      const call = new RegExp(`\\b(${REGISTRARS.join('|')})\\(\\s*(${escaped})\\b`, 'g')
      for (const match of text.matchAll(call)) {
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
    rawOffenders(name, `${imports}${body}\n`, {}, [])

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
    // the alias itself is a raw use, and the registration on it is a guarded channel on the raw object
    expect(
      offendersOf("const bus = ipcMain\nbus.handle('uniwork-doc:save', () => 1)"),
    ).toHaveLength(2)
  })

  it('electron.ipcMain on a default import', () => {
    const imports = "import electron from 'electron'\n"
    expect(offendersOf("electron.ipcMain.on('uniwork-doc:save', () => 1)", imports)).toHaveLength(1)
  })

  it('a *-bridge.ts under a main directory is scanned like any other file', () => {
    const text = `${header}ipcMain.on('uniwork-doc:save', () => 1)\n`
    expect(rawOffenders('apps/shell/src/main/mcp/x-bridge.ts', text, {}, [])).toHaveLength(1)
    // and the walk really reaches the ones that exist
    expect(sources.map((s) => s.file)).toContain('apps/shell/src/main/mcp/docs-bridge.ts')
  })

  it('an ipcRenderer-only file has no raw receiver and nothing to register', () => {
    expect(rawReceivers("import { ipcRenderer } from 'electron'\nipcRenderer.on('a', f)")).toEqual(
      [],
    )
  })

  it('leaves a guarded object alone: a parameter named ipcMain and an out-of-scope literal', () => {
    const param = 'export function register(ipcMain: Guarded) {\n  ipcMain.handle(c, () => 1)\n}\n'
    expect(rawOffenders(file, param, {}, [])).toEqual([])
    expect(offendersOf("ipcMain.handle('app:get-theme', () => 1)")).toEqual([])
    expect(offendersOf("ipcMain.removeHandler('home:recents')")).toEqual([])
  })

  it('reads a call argument across nested brackets, strings and templates', () => {
    expect(firstArgument('`a,${f(1, 2)}`, rest)', 0)).toBe('`a,${f(1, 2)}`')
    expect(firstArgument("fn('x,y', [1, 2]), tail)", 0)).toBe("fn('x,y', [1, 2])")
  })
})

/** RBG2-2: the spellings the reviewer found, each one on a guarded home channel and each turning red */
describe('every way to spell the raw ipcMain turns red', () => {
  const header = "import { ipcMain } from 'electron'\n"
  const file = 'apps/shell/src/main/x.ts'
  const offendersOf = (body: string, imports = header) =>
    rawOffenders(file, `${imports}${body}\n`, {}, [])

  it.each([
    ['optional chaining', "ipcMain?.handle('home:recents', () => 1)"],
    ['a cast around the receiver', "(ipcMain as IpcMain).handle('home:recents', () => 1)"],
    [
      'a double cast around the receiver',
      "(ipcMain as unknown as IpcMain).handle('home:recents', () => 1)",
    ],
    ['a computed method name', "ipcMain['handle']('home:recents', () => 1)"],
    ['a cast alias', "const bus = ipcMain as IpcMain\nbus.handle('home:recents', () => 1)"],
    ['a typed alias', "const bus: IpcMain = ipcMain\nbus.handle('home:recents', () => 1)"],
    ['a registrar call, whatever its parameter is called', 'registerHome(ipcMain)'],
    ['a destructured method', "const { handle } = ipcMain\nhandle('home:recents', () => 1)"],
    ['a method reference', "const handle = ipcMain.handle\nhandle('home:recents', () => 1)"],
    ['an object property', 'const deps = { ipcMain }'],
    ['an inline require', "require('electron').ipcMain.handle('home:recents', () => 1)"],
    ['an inline dynamic import', "(await import('electron')).ipcMain.handle('home:recents', f)"],
  ])('%s', (_label, body) => {
    expect(offendersOf(body).length).toBeGreaterThan(0)
  })

  const imports: Array<[string, string, string]> = [
    ['a double-quoted import', 'import { ipcMain } from "electron"\n', 'ipcMain'],
    ['an electron/main import', "import { ipcMain } from 'electron/main'\n", 'ipcMain'],
    [
      'a double-quoted electron/main import',
      'import { ipcMain } from "electron/main"\n',
      'ipcMain',
    ],
    [
      'a multi-line import',
      "import {\n  app,\n  ipcMain,\n  shell,\n} from 'electron'\n",
      'ipcMain',
    ],
    ['an import with an alias', "import { ipcMain as raw } from 'electron'\n", 'raw'],
    ['a default import', "import electron from 'electron'\n", 'electron.ipcMain'],
    ['a namespace import', "import * as e from 'electron'\n", 'e.ipcMain'],
    ['a require destructure', "const { ipcMain } = require('electron')\n", 'ipcMain'],
    ['a double-quoted require', 'const { ipcMain } = require("electron")\n', 'ipcMain'],
    [
      'a require destructure with a rename',
      "const { ipcMain: raw } = require('electron')\n",
      'raw',
    ],
    ['a dynamic import destructure', "const { ipcMain } = await import('electron')\n", 'ipcMain'],
    [
      'a require namespace',
      "const electron = require('electron')\nconst { ipcMain } = electron\n",
      'ipcMain',
    ],
  ]
  it.each(imports)('%s: a guarded literal and a template channel', (_label, importText, name) => {
    expect(offendersOf(`${name}.handle('home:recents', () => 1)`, importText)).toHaveLength(1)
    expect(offendersOf(`${name}.handle(\`home:\${key}\`, () => 1)`, importText)).toHaveLength(1)
    // the same import used for an out-of-scope literal is fine, so the offender above is the channel
    expect(offendersOf(`${name}.handle('app:get-theme', () => 1)`, importText)).toEqual([])
  })

  it('a pass-through is listed by call text and count, never by file alone', () => {
    const entry: PassThrough = { file, text: 'wrap(ipcMain)', count: 1, reason: 'test' }
    const offenders = (body: string) => rawOffenders(file, `${header}${body}\n`, {}, [entry])
    expect(offenders('const g = wrap(ipcMain)')).toEqual([])
    // a second hand-over of the same call, a different call, and a listed call that vanished
    expect(offenders('wrap(ipcMain)\nwrap(ipcMain)')).toHaveLength(1)
    expect(offenders('wrap(ipcMain)\nother(ipcMain)')).toHaveLength(1)
    expect(offenders('const g = 1')).toHaveLength(1)
    // another file with the same text is not covered
    expect(
      rawOffenders('apps/shell/src/main/y.ts', `${header}wrap(ipcMain)\n`, {}, [entry]),
    ).toHaveLength(1)
  })

  it('the pass-through list of the real tree is the 13 hand-overs and nothing else', () => {
    expect(RAW_PASS_THROUGH).toHaveLength(13)
    expect(RAW_PASS_THROUGH.every((entry) => entry.count === 1 && entry.reason.length > 0)).toBe(
      true,
    )
  })

  it('does not read a raw ipcMain out of a comment', () => {
    const text = `${header}// ipcMain?.handle('home:recents', f)\n/* registerHome(ipcMain) */\n`
    expect(rawOffenders(file, text, {}, [])).toEqual([])
  })
})

/** RBG2-4: the allow-list entry is a count, not a licence for the expression */
describe('an allow-listed unreadable channel is counted', () => {
  const header = "import { ipcMain } from 'electron'\n"
  const file = 'apps/slides/src/main/slides-main.ts'
  const key = `${file}: channel`
  const body = (calls: number): string =>
    `${header}${Array.from({ length: calls }, () => 'ipcMain.handle(channel, () => 1)').join('\n')}\n`
  const allow = (count: number): Record<string, DynamicRaw> => ({
    [key]: { reason: 'the session handlers', count },
  })

  it('passes up to the allowed count', () => {
    expect(rawOffenders(file, body(1), allow(1), [])).toEqual([])
    expect(rawOffenders(file, body(2), allow(2), [])).toEqual([])
  })

  it('fails a second unresolved handle with the same expression', () => {
    expect(rawOffenders(file, body(2), allow(1), [])).toHaveLength(1)
    expect(rawOffenders(file, body(3), allow(1), [])).toHaveLength(1)
  })

  it('fails every unreadable registration without an entry', () => {
    expect(rawOffenders(file, body(2), {}, [])).toHaveLength(2)
  })

  it('calls an entry stale when fewer than its count are live', () => {
    const files = [{ file, text: body(1) }]
    expect(dynamicRawMismatches(files, allow(1))).toEqual([])
    expect(dynamicRawMismatches(files, allow(2))).toHaveLength(1)
    expect(dynamicRawMismatches([{ file, text: body(2) }], allow(1))).toHaveLength(1)
    expect(dynamicRawMismatches([{ file, text: header }], allow(1))).toHaveLength(1)
  })

  it('the one entry of the real tree is the slides session loop, exactly once', () => {
    expect(Object.keys(DYNAMIC_RAW_CHANNELS)).toEqual([key])
    expect(DYNAMIC_RAW_CHANNELS[key]!.count).toBe(1)
  })
})

/** RBG2-2 (registrar side): a registrar parameter is found whatever it is called */
describe('a registrar file is found whatever its ipc parameter is called', () => {
  const importIpc = "import type { IpcMain, IpcMainLike } from 'electron'\n"
  const diff = (text: string, name = 'apps/shell/src/main/y.ts') =>
    registrarFileDiff([{ file: name, text: `${importIpc}${text}\n` }], {})

  it('control: the ipc-like names the scan always knew', () => {
    for (const receiver of ['ipcMain', 'ipc', 'homeIpc', 'guardedIpc']) {
      expect(diff(`${receiver}.handle('home:recents', f)`).unlisted, receiver).toHaveLength(1)
    }
  })

  it('a parameter named bus, declared IpcMain or IpcMainLike, is a receiver', () => {
    const receivers = (text: string) =>
      registrations({ file: 'apps/shell/src/main/y.ts', text: `${importIpc}${text}\n` }).map(
        (reg) => reg.receiver,
      )
    expect(receivers('export function reg(bus: IpcMain) { bus.handle(name, f) }')).toEqual(['bus'])
    expect(receivers('export function reg(bus?: IpcMainLike) { bus?.on(name, f) }')).toEqual([
      'bus',
    ])
    expect(
      receivers('export function reg(deps: { bus: IpcMain }) { deps.bus.once(name, f) }'),
    ).toEqual(['bus'])
    // the same call on a name nobody declared is not a registration
    expect(receivers('export function reg(bus: Thing) { bus.handle(name, f) }')).toEqual([])
    expect(
      diff("export function reg(bus: IpcMain) { bus.handle('home:recents', f) }").unlisted,
    ).toEqual(['apps/shell/src/main/y.ts'])
  })

  it('a receiver nobody declared, as soon as the channel is a guarded one', () => {
    expect(diff("thing.handle('uniwork-doc:save', f)").unlisted).toHaveLength(1)
    expect(diff('thing.handle(HOME_CHANNELS.recents, f)').unlisted).toHaveLength(1)
  })

  it('does not take a webContents listener or an out-of-scope channel for a registration', () => {
    expect(diff("wc.on('did-finish-load', f)").unlisted).toEqual([])
    expect(diff("bus.handle('app:get-theme', f)").unlisted).toEqual([])
  })

  it('reports a listed file that no longer registers anything as stale', () => {
    const files = [{ file: 'apps/shell/src/main/y.ts', text: 'export const x = 1\n' }]
    expect(registrarFileDiff(files, { 'apps/shell/src/main/y.ts': 'gone' }).stale).toEqual([
      'apps/shell/src/main/y.ts',
    ])
  })
})

describe('the comment stripper', () => {
  it('keeps length and line breaks, so offsets and line numbers still hold', () => {
    const text = "a // x\n/* b\nc */ d 'e // f'\n`g ${h /* i */} // j`\nk\n"
    const stripped = stripComments(text)
    expect(stripped).toHaveLength(text.length)
    expect([...stripped].filter((ch) => ch === '\n')).toHaveLength(5)
    expect(stripped).toContain("d 'e // f'")
    expect(stripped).toContain('// j`')
    expect(stripped).not.toMatch(/[xbci]\b/)
  })

  it('skips a regex literal with quotes, and a division', () => {
    const text = 'const r = /[\'"]electron/g // ipcMain\nconst q = a / b / c // ipcMain\n'
    const stripped = stripComments(text)
    expect(stripped).toContain('/[\'"]electron/g')
    expect(stripped).not.toContain('ipcMain')
  })
})

// ---- 2. the composition in index.ts ----

/** the names a file gives the guarded wrappers of the raw ipcMain: `const guardedIpc = guard.guarded(ipcMain)` */
function guardedAliases(text: string): string[] {
  return [...code(text).matchAll(/\bconst\s+(\w+)\s*=\s*[\w.]+\.guarded\(\s*ipcMain\s*\)/g)].map(
    (m) => m[1]!,
  )
}

/**
 * Registrations on a guarded alias that the guard would not accept: a channel it has no policy for
 * (it throws at registration, and the app stops at start) or one the scan cannot read. index.ts
 * registers hundreds of other channels on the raw ipcMain, so this is the check that stops an
 * over-eager search-and-replace of `ipcMain.handle(` from taking an out-of-scope `app:*` line along.
 */
function guardedRegistrationOffenders(source: Source): string[] {
  const aliases = new Set(guardedAliases(source.text))
  return registrations(source)
    .filter((reg) => aliases.has(reg.receiver))
    .flatMap((reg) => {
      if (reg.channels.length === 0) {
        return [
          `${reg.file}: ${reg.receiver}.${reg.method}(${squash(reg.arg)}) has a channel the scan cannot read`,
        ]
      }
      return reg.channels
        .filter((channel) => policyForChannel(channel) === null)
        .map(
          (channel) =>
            `${reg.file}: ${reg.receiver}.${reg.method}(${squash(reg.arg)}) -> ${channel} has no guard policy`,
        )
    })
}

describe('composition in apps/shell/src/main/index.ts', () => {
  const index = sources.find((s) => isIndex(s.file))!

  it('builds the guards from the raw ipcMain and uses only those for the registrars', () => {
    const aliases = guardedAliases(index.text)
    expect(aliases.length).toBeGreaterThan(0)
    for (const name of COMPOSED_IN_INDEX) {
      const calls = [
        ...code(index.text).matchAll(new RegExp(`\\b${name}\\(\\s*([A-Za-z_$][\\w$.]*)`, 'g')),
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
    expect(
      /createIpcSenderGuard\(\{[\s\S]{0,300}shellContents:\s*\(\)\s*=>/.test(code(index.text)),
    ).toBe(true)
  })

  it('registers only channels the guard accepts on its guarded objects', () => {
    expect(guardedRegistrationOffenders(index)).toEqual([])
    // and it really sees them: bar-inset plus the home channels once they are wired
    const guarded = new Set(guardedAliases(index.text))
    expect(registrations(index).filter((reg) => guarded.has(reg.receiver)).length).toBeGreaterThan(
      0,
    )
  })

  it('the guarded-receiver check turns red on an out-of-scope or unreadable channel', () => {
    const file = 'apps/shell/src/main/index.ts'
    const offenders = (body: string) =>
      guardedRegistrationOffenders({
        file,
        text: `import { ipcMain } from 'electron'\nconst g = guard.guarded(ipcMain)\n${body}\n`,
      })
    expect(offenders("g.handle('uniwork-doc:save', f)")).toEqual([])
    expect(offenders("g.handle('app:get-theme', f)")).toHaveLength(1)
    expect(offenders('g.handle(someChannel, f)')).toHaveLength(1)
    expect(offenders("ipcMain.handle('app:get-theme', f)")).toEqual([])
  })
})

// ---- 3. no unlisted registrar file ----

describe('registrar files', () => {
  it('lists every file that registers a guarded channel, and only those', () => {
    expect(registrarFileDiff(sources, REGISTRAR_FILES)).toEqual({ unlisted: [], stale: [] })
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
  // the markdown editor's wiki links open a path through the shell, so the editor side may call it too
  if (channel === 'home:open-path') return 'shell-or-editor'
  // the six editor preloads call the app-wide alias of home:set-ai-panel-prefs, so the editor side too
  if (channel === 'app:set-ai-panel-prefs') return 'shell-or-editor'
  if (/^home:./.test(channel)) return 'shell'
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
    // 135 uniwork channels, 11 home account/cloud ones and the 81 other home channels
    expect(all.length).toBeGreaterThan(200)
  })
})

// ---- 5. the home channels (UNI-2082) ----

/** the HOME_CHANNELS constants main sends to a renderer: nothing registers them, so they need no policy */
const HOME_PUSH_ONLY: readonly string[] = [
  HOME_CHANNELS.folderChanged,
  HOME_CHANNELS.accountLoginEvent,
  HOME_CHANNELS.openSettings,
  HOME_CHANNELS.accountStatusEvent,
  HOME_CHANNELS.uniworkCloudStatusEvent,
  HOME_CHANNELS.openSettingsEvent,
  HOME_CHANNELS.agentIntentEvent,
  HOME_CHANNELS.wbBucketChanged,
]

const HOME_VALUES: readonly string[] = Object.values(HOME_CHANNELS)

/** raw registrations (any spelling the scan resolves) of a HOME_CHANNELS value */
function rawHomeRegistrations(files: readonly Source[]): string[] {
  return files.flatMap((source) =>
    rawRegistrations(source.file, source.text)
      .filter((reg) => reg.channels.some((channel) => HOME_VALUES.includes(channel)))
      .map((reg) => `${reg.file}: ${reg.receiver}.${reg.method}(${squash(reg.arg)})`),
  )
}

describe('every home channel is accounted for and guarded', () => {
  const registered = new Map<string, number>()
  for (const source of sources) {
    for (const reg of registrations(source)) {
      for (const channel of reg.channels) {
        if (HOME_VALUES.includes(channel))
          registered.set(channel, (registered.get(channel) ?? 0) + 1)
      }
    }
  }

  it('is either registered or listed as push-only, never both', () => {
    expect({
      neither: HOME_VALUES.filter((c) => !registered.has(c) && !HOME_PUSH_ONLY.includes(c)),
      both: HOME_PUSH_ONLY.filter((c) => registered.has(c)),
    }).toEqual({ neither: [], both: [] })
    expect(registered.size).toBe(HOME_VALUES.length - HOME_PUSH_ONLY.length)
  })

  it('is registered once', () => {
    expect([...registered].filter(([, count]) => count !== 1)).toEqual([])
  })

  it('has its intended policy on every registered channel', () => {
    const wrong: string[] = []
    for (const channel of registered.keys()) {
      const expected = expectedPolicy(channel)
      if (expected === null || policyForChannel(channel) !== expected) {
        wrong.push(
          `${channel}: expected ${String(expected)}, guard says ${String(policyForChannel(channel))}`,
        )
      }
    }
    expect(wrong).toEqual([])
  })

  it('is shell-only except home:open-path, which the markdown editor also calls', () => {
    const others = [...registered.keys()].filter((channel) => expectedPolicy(channel) !== 'shell')
    expect(others).toEqual(['home:open-path'])
    expect(expectedPolicy('home:open-path')).toBe('shell-or-editor')
  })

  it('is registered on no raw ipcMain: no channel with a HOME_CHANNELS value stays unguarded', () => {
    expect(rawHomeRegistrations(sources)).toEqual([])
  })

  it('the raw home check turns red on a constant, a literal and an alias', () => {
    const header = "import { ipcMain } from 'electron'\n"
    const files = (body: string): Source[] => [
      { file: 'apps/shell/src/main/x.ts', text: `${header}${body}\n` },
    ]
    expect(rawHomeRegistrations(files('ipcMain.handle(HOME_CHANNELS.recents, f)'))).toHaveLength(1)
    expect(rawHomeRegistrations(files("ipcMain.handle('home:open-path', f)"))).toHaveLength(1)
    expect(
      rawHomeRegistrations(files('const bus = ipcMain\nbus.handle(HOME_CHANNELS.deleteFiles, f)')),
    ).toHaveLength(1)
    expect(rawHomeRegistrations(files("ipcMain.handle('app:get-theme', f)"))).toEqual([])
    expect(rawHomeRegistrations(files('guardedIpc.handle(HOME_CHANNELS.recents, f)'))).toEqual([])
  })
})

// ---- 6. the real guard accepts what the registrars register ----

/** HGB-1: the setter alias of a guarded home setter is guarded; the read-only getters stay raw */
describe('the app: ai panel prefs aliases', () => {
  const index = sources.find((s) => isIndex(s.file))!
  const onReceiver = (channel: string) =>
    registrations(index)
      .filter((reg) => reg.channels.includes(channel))
      .map((reg) => reg.receiver)
  const guarded = new Set(guardedAliases(index.text))

  it('registers app:set-ai-panel-prefs once, on a guarded object', () => {
    const receivers = onReceiver('app:set-ai-panel-prefs')
    expect(receivers).toHaveLength(1)
    expect(guarded.has(receivers[0]!)).toBe(true)
  })

  it('leaves the four read-only app:get-* getters on the raw ipcMain', () => {
    for (const channel of [
      'app:get-theme',
      'app:get-document-theme',
      'app:get-auto-save-default',
      'app:get-ai-panel-prefs',
    ]) {
      expect(onReceiver(channel), channel).toEqual(['ipcMain'])
      expect(policyForChannel(channel), channel).toBeNull()
    }
  })

  it('no editor main registers the setter on its own ipcMain', () => {
    const standalone = sources
      .filter((source) => !isIndex(source.file))
      .flatMap((source) => registrations(source))
      .filter((reg) => reg.channels.includes('app:set-ai-panel-prefs'))
    expect(standalone).toEqual([])
  })
})

/** HGB-4: two false-greens of the raw scan, each a fixture that has to turn red */
describe('the raw scan reads a shadowed table and a re-exported ipcMain', () => {
  const header = "import { ipcMain } from 'electron'\n"

  it('a local table that shadows an exported *_CHANNELS name is not read as the exported one', () => {
    const body =
      "const PDF_CHANNELS = { save: 'home:delete-files' }\nipcMain.handle(PDF_CHANNELS.save, f)\n"
    expect(rawOffenders('apps/shell/src/main/x.ts', header + body, {}, [])).not.toEqual([])
  })

  it('an exported table declared in the file itself still resolves', () => {
    const body =
      "export const X_CHANNELS = { a: 'home:delete-files' }\nipcMain.handle(X_CHANNELS.a, f)\n"
    expect(rawOffenders('apps/shell/src/main/x.ts', header + body, {}, [])).toHaveLength(1)
  })

  it('a module that re-exports electron ipcMain is flagged, from or after an import', () => {
    const from = "export { ipcMain } from 'electron'\n"
    const after = "import { ipcMain } from 'electron'\nexport { ipcMain }\n"
    const renamed = "import { ipcMain } from 'electron'\nexport { ipcMain as rawIpc }\n"
    for (const text of [from, after, renamed]) {
      expect(rawUseOffenders('apps/shell/src/main/raw-ipc.ts', text, [])).not.toEqual([])
    }
    expect(
      rawUseOffenders('apps/shell/src/main/x.ts', "export { app } from 'electron'\n", []),
    ).toEqual([])
  })
})

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
