import type { UniworkDocErrorCode, UniworkSourceFile } from '../../../shared/home-api'
import type { StringKey, TFunc } from '../locale'

/**
 * The sub-line wording for the modules this build has a name for (the web's Chat, Tasks, Meetings,
 * Email); a new one has none. These are whole phrases ("Sent in Chat", "From a task"), not the plural
 * nav/filter labels (`uwSourceOrigin*`), which read wrong after "Sent in".
 */
export function sourceOriginKeyOf(origin: string): StringKey | null {
  switch (origin) {
    case 'chat':
      return 'dlSourceOriginChat'
    case 'task':
      return 'dlSourceOriginTask'
    case 'meeting':
      return 'dlSourceOriginMeeting'
    case 'email':
      return 'dlSourceOriginEmail'
    default:
      return null
  }
}

/**
 * The line under a source file's name on Từ nơi khác: where it came from, "Sent in Chat · #channel"
 * (V-STATES F-04, VS-3), from the row's module and its parent's title. Only a `chat_channel` parent
 * gets a "#" (unless its title already has one): a `chat_dm` is a person or a group room. A parent
 * without a title leaves the module alone; a module this build has no name for shows its parent
 * only; neither shows nothing.
 */
export function sourceOriginLine(
  source: Pick<UniworkSourceFile, 'source' | 'parent'>,
  t: TFunc,
): string | null {
  const parts = sourceOriginParts(source, t)
  return parts ? [parts.module, parts.parent].filter(Boolean).join(' · ') : null
}

/**
 * The same line in its two pieces, so a screen can set the parent in its own `<bdi>`: in an RTL
 * line (ar, he) the neutral "#" between the module name and a Latin channel name would otherwise
 * resolve to RTL and draw "general#" (UNI-2080 RV-12).
 */
export function sourceOriginParts(
  source: Pick<UniworkSourceFile, 'source' | 'parent'>,
  t: TFunc,
): { module: string; parent: string } | null {
  const key = sourceOriginKeyOf(source.source)
  const title = source.parent.title.trim()
  const parent =
    source.parent.kind === 'chat_channel' && title && !title.startsWith('#') ? `#${title}` : title
  const module = key ? t(key) : ''
  return module || parent ? { module, parent } : null
}

/**
 * UNI-1993 (UW-SOURCE-RO): can a source row open view only in the app? The server decides first
 * (`canOpenInApp`, which also carries its txt switch); the app only adds "an editor module reads
 * this file", mirroring the web's `sourceOpenAction`. The extensions are the ones the shell's
 * opener accepts (docx xlsx pptx pdf md markdown html htm txt); a txt goes to the markdown module.
 */
const OPEN_EXTENSIONS: ReadonlySet<string> = new Set([
  'docx',
  'xlsx',
  'pptx',
  'pdf',
  'md',
  'markdown',
  'html',
  'htm',
  'txt',
])

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/pdf': 'pdf',
  'text/markdown': 'md',
  'text/html': 'html',
  'text/plain': 'txt',
}

type SourceOpenFacts = Pick<UniworkSourceFile, 'canOpenInApp' | 'extension' | 'name' | 'mimeType'>

/** the row's extension as the server sent it (lowercase, no dot), else its name's, else its MIME type's */
function rawExtensionOf(
  source: Pick<UniworkSourceFile, 'extension' | 'name' | 'mimeType'>,
): string {
  const ext = source.extension.trim().toLowerCase().replace(/^\./, '')
  if (ext) return ext
  const dot = source.name.lastIndexOf('.')
  if (dot > 0 && dot < source.name.length - 1) return source.name.slice(dot + 1).toLowerCase()
  const mime = source.mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  return EXTENSION_BY_MIME[mime] ?? ''
}

/**
 * The extension an open sends (the editor module follows it), or null when no module reads the
 * file. Independent of `canOpenInApp`.
 */
export function sourceOpenExtension(
  source: Pick<UniworkSourceFile, 'extension' | 'name' | 'mimeType'>,
): string | null {
  const ext = rawExtensionOf(source)
  return OPEN_EXTENSIONS.has(ext) ? ext : null
}

/** Open (view only) is the row's primary action; false means Download, as before */
export function openable(source: SourceOpenFacts): boolean {
  return source.canOpenInApp === true && sourceOpenExtension(source) !== null
}

/** what the Documents list does with a failed open (contract 3.4) */
export type SourceOpenFailure =
  | { kind: 'gone' }
  | { kind: 'offline' }
  | { kind: 'too_large' }
  | { kind: 'notice'; error: UniworkDocErrorCode }
  | { kind: 'generic' }

/**
 * Map the shell's failure code of an open: a vanished file (toast + the list reloads), no
 * connection (toast + Try again), too big (toast + Download), a session / deployment / keystore /
 * permission problem (the notice bus, same sentences as opening a document), anything else (the
 * generic toast). An unknown code is the generic one.
 */
export function sourceOpenFailureOf(error: string): SourceOpenFailure {
  switch (error) {
    case 'not_found':
    case 'deleted':
      return { kind: 'gone' }
    case 'network':
    case 'timeout':
      return { kind: 'offline' }
    case 'too_large':
      return { kind: 'too_large' }
    case 'forbidden':
    case 'session_expired':
    case 'not_signed_in':
    case 'wrong_deployment':
    case 'keystore_locked':
      return { kind: 'notice', error }
    default:
      return { kind: 'generic' }
  }
}
