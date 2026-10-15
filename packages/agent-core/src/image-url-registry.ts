/**
 * Provenance of the image URLs an AI run may insert (signed policy: an image URL the AI inserts
 * must come from the same run's image_search / generate_image result or a chat attachment).
 *
 * "Same turn" = same run: one user request, which is one AgentLoop.run(). The registry is created
 * once per panel and emptied at the start of every run: the skills call `beginRun()` from
 * `buildContext()`, which the loop invokes exactly once per run before any tool executes (the
 * loop itself has no run-start hook, and a panel-side reset could miss a path that reaches
 * `loop.run` another way).
 *
 * Matching is exact on the trimmed string: no prefix, substring, host or case folding, so a
 * registered URL never vouches for a sibling. A generated `data:` URL is kept by identity.
 * Enforcement is live-gated by `enforce` (UniWork AI turns only; BYOK keeps today's rules but the
 * registry still records).
 */

export type ImageUrlSource = 'image_search' | 'generate_image' | 'attachment'

/** What the model reads when an unregistered image URL is refused; nothing was fetched. */
export const IMAGE_URL_REFUSAL =
  'This image URL was not accepted: only an image URL returned by image_search or generate_image in this request, or an image the user attached to the chat, can be inserted. ' +
  'Use image_search or generate_image to get one, or ask the user to attach the image. Nothing was downloaded.'

export interface ImageUrlRegistryOptions {
  /** live predicate: refuse unregistered URLs (the provider is UniWork AI); absent = never */
  enforce?: () => boolean
  /** live reader: local paths of the image attachments of the run's user message */
  attachments?: () => readonly string[]
}

export interface ImageUrlRegistry {
  /** forget the previous run's URLs and take this run's attachments; call once per run */
  beginRun(): void
  register(url: string, source: ImageUrlSource): void
  isAllowed(url: string): boolean
  /** null = proceed (registered, or not enforcing); otherwise the refusal to hand the model */
  check(url: string): string | null
}

/** file:// spelling of an absolute local path, so an attachment also matches its URL form */
function fileUrlOf(path: string): string | null {
  if (!path.startsWith('/')) return null
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}

export function createImageUrlRegistry(options: ImageUrlRegistryOptions = {}): ImageUrlRegistry {
  const allowed = new Set<string>()
  const register = (url: string, _source: ImageUrlSource): void => {
    const key = url.trim()
    if (key) allowed.add(key)
  }
  const isAllowed = (url: string): boolean => {
    const key = url.trim()
    return key !== '' && allowed.has(key)
  }
  return {
    beginRun() {
      allowed.clear()
      for (const path of options.attachments?.() ?? []) {
        register(path, 'attachment')
        const url = fileUrlOf(path.trim())
        if (url) register(url, 'attachment')
      }
    },
    register,
    isAllowed,
    check: (url) => (options.enforce?.() === true && !isAllowed(url) ? IMAGE_URL_REFUSAL : null),
  }
}
