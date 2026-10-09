/**
 * Frame client bootstrap (generic bridge piece, GO-B4/B5/B6; extracted from install.ts).
 *
 * Same-origin iframe (lane decision): the frame talks only to `location.origin`. The host
 * supplies theme + locale in `init` and live `theme` / `language` events; they are bound
 * before the renderer boots (its getTheme / getLanguage wait for `init`, bounded).
 */
import { createDocsFrameClient, type DocsFrameClient } from '../protocol/client'
import type { Capabilities, OfficeModule } from '../protocol/types'
import { bindHostAppearance } from './host-appearance'

export interface FrameBootOptions {
  /** what this frame build supports (sent in `ready`) */
  capabilities: Capabilities
  /** the editor this bundle runs; unset = docs (no `module` on the wire) */
  module?: OfficeModule
  frameVersion?: string
}

export function createFrameClient(options: FrameBootOptions): DocsFrameClient {
  return createDocsFrameClient({
    allowedOrigins: [location.origin],
    capabilities: options.capabilities,
    ...(options.module !== undefined ? { module: options.module } : {}),
    ...(options.frameVersion !== undefined ? { frameVersion: options.frameVersion } : {}),
  })
}

/** the bundle's version, stamped into index.html by the build (`<meta name="docs-web-version">`) */
export function frameVersionFromDocument(doc: Document = document): string | undefined {
  return doc.querySelector('meta[name="docs-web-version"]')?.getAttribute('content') ?? undefined
}

export { bindHostAppearance }
