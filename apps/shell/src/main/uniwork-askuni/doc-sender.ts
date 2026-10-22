import { RENDERER_SCHEME, type RendererHost } from '@genoffice/electron-utils/renderer-scheme'
import type { WebContents } from 'electron'

/**
 * The temporary sender rule of every `uniwork:askuni-doc:*` handler until
 * the UNI-2073 guard gives the family policy `editor`: an editor tab view or
 * a detached editor window (never the shell page), its main frame, on an
 * editor origin. One call per handler, like createShellSenderCheck.
 */

const EDITOR_HOSTS: ReadonlySet<string> = new Set<RendererHost>([
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

const parse = (value: string): URL | null => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
const isHttp = (url: URL) => url.protocol === 'http:' || url.protocol === 'https:'

/** the editor page rule: dev = an editor renderer's dev origin, packaged = genoffice-app://<editor> */
export function askUniEditorUrlRule(env: NodeJS.ProcessEnv): (url: string) => boolean {
  const devOrigins = new Set<string>()
  for (const key of EDITOR_DEV_ENV) {
    const url = env[key] ? parse(env[key]) : null
    if (url && isHttp(url)) devOrigins.add(url.origin)
  }
  return (value) => {
    const url = parse(value)
    if (!url) return false
    if (isHttp(url)) return devOrigins.has(url.origin)
    return (
      url.protocol === `${RENDERER_SCHEME}:` &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      EDITOR_HOSTS.has(url.hostname)
    )
  }
}

export function createEditorSenderCheck(deps: {
  shellContents(): WebContents | null
  /** a tab manager view of an editor tab or the view of a detached editor window */
  isEditorContents(webContentsId: number): boolean
  isEditorUrl(url: string): boolean
}): (event: unknown) => boolean {
  return function isTrustedEditorSender(event) {
    if (!event || typeof event !== 'object') return false
    const { sender, senderFrame } = event as {
      sender?: { id: number; mainFrame: unknown; isDestroyed(): boolean }
      senderFrame?: { url: string } | null
    }
    if (!sender || typeof sender.isDestroyed !== 'function' || sender.isDestroyed()) return false
    if (!senderFrame || senderFrame !== sender.mainFrame) return false
    if (sender === (deps.shellContents() as unknown)) return false
    if (!deps.isEditorContents(sender.id)) return false
    try {
      return deps.isEditorUrl(senderFrame.url)
    } catch {
      // a disposed frame throws on .url
      return false
    }
  }
}
