/**
 * AI + search + image stubs (W6 - UNI-1011 spike).
 *
 * Default-exports a partial DesktopApi merged into window.desktop by install.ts.
 * Nothing here talks to a model: every call is answered locally with fixed data so
 * the renderer's AI UI paths (panel, agent tool loop, web/image search, image
 * generation) can be exercised in the browser. Each stub documents the UniWork
 * ai.Gateway endpoint it will map to once GO-B3 wires a real backend. The endpoint
 * paths below are PROPOSALS (no ai.Gateway contract exists in this repo yet).
 *
 * Streaming protocol (reproduced from apps/docs/src/preload/index.ts +
 * apps/docs/src/main/docs-main.ts `ai:stream`):
 *   - renderer subscribes with onAiStream(handler) BEFORE calling aiStream
 *     (packages/agent-core/src/electron-transport.ts), filters chunks by requestId;
 *   - aiStream(request) returns a promise that resolves only AFTER the turn ended
 *     (main `await`s the whole provider stream); chunks are pushed meanwhile as
 *     { requestId, type: 'delta' | 'reasoning' | 'tool-call' | 'ping' | 'done' | 'error' };
 *   - cancel: aiStreamCancel(requestId) aborts, main then emits a plain `done`
 *     (NOT an error) and the aiStream promise resolves;
 *   - exactly one terminal chunk (`done` or `error`) per request.
 *
 * | method            | stub behaviour                                  | UniWork ai.Gateway endpoint (proposed)        |
 * |-------------------|--------------------------------------------------|-----------------------------------------------|
 * | aiStream          | 10 `delta` chunks, 50 ms apart, then `done`      | POST /api/ai/stream  (SSE; one event/chunk)   |
 * | aiStreamCancel    | abort the timer loop, emit `done`                | DELETE /api/ai/stream/:requestId (or close SSE) |
 * | onAiStream        | in-page listener set (no network)                | n/a - SSE events of POST /api/ai/stream       |
 * | aiChat            | fixed one-shot reply                             | POST /api/ai/chat                             |
 * | getAiSettings     | "configured" settings object (see below)         | GET  /api/ai/settings                         |
 * | setAiSettings     | memory + localStorage                            | PUT  /api/ai/settings                         |
 * | aiGskStatus       | { loggedIn: true }                               | GET  /api/ai/account  (session -> plan/quota) |
 * | aiGskLogin        | no-op                                            | redirect to UniWork login (not a Gateway call)|
 * | aiOpenBilling     | no-op                                            | UniWork billing page (not a Gateway call)     |
 * | webSearch         | 2 fixed results                                  | POST /api/ai/web-search                       |
 * | imageSearch       | 2 fixed SVG data: URLs                           | POST /api/ai/image-search                     |
 * | fetchImage        | rasterised PNG placeholder (data: URLs decoded)  | GET  /api/ai/fetch-image?url=  (SSRF-guarded) |
 * | aiGenerateImage   | inline SVG data: URL                             | POST /api/ai/generate-image                   |
 * | getAiPanelPrefs   | defaults                                         | user preference (no Gateway call)             |
 *
 * "Configured": the renderer never inspects apiKey (grep in apps/docs/src/renderer:
 * only App.tsx DEFAULT_SETTINGS). What gates UI is aiGskStatus().loggedIn
 * (AiPanel.tsx:466/841: login button, generate_image gate via imageGenerationAvailable)
 * and settings.gskToolsEnabled. getAiSettings therefore returns provider 'genspark'
 * (the managed-gateway path), gskToolsEnabled true, plus stub keys on every BYOK
 * provider so a switch to any provider also looks configured.
 *
 * Not in this module (other classes): pickAttachments / addAttachmentPaths /
 * addPastedImage / readAttachment* (BROWSER, W4), createDocument (AI create_document
 * tool, needs a new tab -> HIDE, see hide.ts).
 */
import { AI_PROVIDERS } from '../../../apps/docs/src/shared/ipc'
import type {
  AiChatResponse,
  AiSettings,
  AiStreamChunk,
  DesktopApi,
} from '../../../apps/docs/src/shared/ipc'

const STUB_PREFIX = '[web spike] stub AI reply'
const STUB_REPLY =
  `${STUB_PREFIX} - no model was called. This text is streamed by the browser shim ` +
  'in ten chunks, fifty milliseconds apart, so the panel, cancel button and ' +
  'done handling can be exercised. A real build routes this through the UniWork ai.Gateway.'
const CHUNK_COUNT = 10
const CHUNK_INTERVAL_MS = 50
const SETTINGS_KEY = 'web-spike.aiSettings'
const STUB_KEY = 'web-spike-stub-key'

// ---- stream plumbing -------------------------------------------------------

const listeners = new Set<(chunk: AiStreamChunk) => void>()
/** in-flight requests: abort() wakes the sleeping loop so cancel is immediate */
const active = new Map<string, { abort: () => void }>()

function emit(chunk: AiStreamChunk): void {
  for (const listener of [...listeners]) {
    try {
      listener(chunk)
    } catch (err) {
      console.error('[web-spike] onAiStream listener threw', err)
    }
  }
}

/** split the reply into CHUNK_COUNT word-aligned pieces whose concatenation is exact */
function replyChunks(): string[] {
  const words = STUB_REPLY.split(/(?<=\s)/)
  const out: string[] = []
  for (let i = 0; i < CHUNK_COUNT; i++) {
    const from = Math.floor((i * words.length) / CHUNK_COUNT)
    const to = Math.floor(((i + 1) * words.length) / CHUNK_COUNT)
    out.push(words.slice(from, to).join(''))
  }
  return out
}

/** resolves true after ms, or false as soon as `signal` aborts */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false)
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// ---- settings --------------------------------------------------------------

function defaultStubSettings(): AiSettings {
  const providers = {} as AiSettings['providers']
  for (const meta of AI_PROVIDERS) {
    providers[meta.id] = {
      apiKey: STUB_KEY,
      model: meta.defaultModel,
      baseUrl: meta.needsBaseUrl ? 'https://ai-gateway.invalid/v1' : undefined,
      cliPath: meta.needsCliPath ? '' : undefined,
    }
  }
  return { provider: 'genspark', providers, gskToolsEnabled: true }
}

let settings: AiSettings = (() => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...defaultStubSettings(), ...(JSON.parse(raw) as Partial<AiSettings>) }
  } catch {
    /* storage unavailable or corrupt: fall through to defaults */
  }
  return defaultStubSettings()
})()

// ---- image helpers ---------------------------------------------------------

function svgDataUrl(label: string, w = 320, h = 180): string {
  const esc = label.replace(/[<>&"]/g, '')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="#cfd8dc"/>` +
    `<rect x="8" y="8" width="${w - 16}" height="${h - 16}" fill="none" stroke="#546e7a" stroke-dasharray="6 4"/>` +
    `<text x="50%" y="50%" font-family="sans-serif" font-size="16" fill="#37474f" ` +
    `text-anchor="middle" dominant-baseline="middle">${esc}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 1x1 PNG, used only when no canvas is available */
const FALLBACK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = src
  })
}

/** the renderer only embeds png/jpeg/gif (tools.ts sniffImageMime), so SVG is rasterised */
async function placeholderPng(source: string | null, label: string): Promise<string> {
  try {
    const img = await loadImage(source ?? svgDataUrl(label))
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 320
    canvas.height = img.naturalHeight || 180
    const ctx = canvas.getContext('2d')
    if (!ctx) return FALLBACK_PNG_BASE64
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1] ?? FALLBACK_PNG_BASE64
  } catch {
    return FALLBACK_PNG_BASE64
  }
}

// ---- the module ------------------------------------------------------------

export default {
  getAiSettings: async () => structuredClone(settings),

  setAiSettings: async (next) => {
    settings = structuredClone(next)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      /* in-memory only */
    }
  },

  getAiPanelPrefs: async () => ({ fontSize: 'default', customFontSize: 14, spellcheck: true }),

  aiChat: async (): Promise<AiChatResponse> => ({ ok: true, content: STUB_REPLY }),

  aiStream: async (request) => {
    const { requestId } = request
    const controller = new AbortController()
    active.set(requestId, { abort: () => controller.abort() })
    try {
      for (const text of replyChunks()) {
        if (!(await sleep(CHUNK_INTERVAL_MS, controller.signal))) break
        emit({ requestId, type: 'delta', text })
      }
      // abort -> plain `done` (desktop parity); normal end -> done + stopReason
      emit(
        controller.signal.aborted
          ? { requestId, type: 'done' }
          : { requestId, type: 'done', stopReason: 'end_turn' },
      )
    } finally {
      active.delete(requestId)
    }
  },

  aiStreamCancel: async (requestId) => {
    active.get(requestId)?.abort()
  },

  onAiStream: (handler) => {
    listeners.add(handler)
    return () => {
      listeners.delete(handler)
    }
  },

  aiGskStatus: async (withEmail) =>
    withEmail
      ? { loggedIn: true, email: 'web-spike@uniwork.invalid' }
      : { loggedIn: true },

  aiGskLogin: async () => {},

  aiOpenBilling: async () => {},

  webSearch: async (query, maxResults) => {
    const results = [
      {
        title: `[web spike] stub result 1 for "${query}"`,
        url: 'https://example.com/web-spike/1',
        snippet: 'Fixed stub search result. Real results come from the UniWork ai.Gateway.',
      },
      {
        title: `[web spike] stub result 2 for "${query}"`,
        url: 'https://example.com/web-spike/2',
        snippet: 'Second fixed stub search result.',
      },
    ]
    return { results: results.slice(0, maxResults ?? results.length), method: 'web-spike-stub' }
  },

  imageSearch: async (query, maxResults) => {
    const images = [1, 2].map((n) => ({
      title: `[web spike] stub image ${n} for "${query}"`,
      imageUrl: svgDataUrl(`web spike stub image ${n}`),
      sourceUrl: `https://example.com/web-spike/image/${n}`,
      source: 'web-spike-stub',
      width: 320,
      height: 180,
    }))
    return { images: images.slice(0, maxResults ?? images.length), method: 'web-spike-stub' }
  },

  fetchImage: async (url) => {
    // data: URLs (our own aiGenerateImage / imageSearch output) are decoded locally;
    // anything else cannot be fetched cross-origin from a page, so a placeholder
    // stands in for the server-side SSRF-guarded fetch.
    const source = url.startsWith('data:') ? url : null
    return { base64: await placeholderPng(source, 'web spike stub image'), mime: 'image/png' }
  },

  aiGenerateImage: async (op) => ({
    url: svgDataUrl(`web spike generated: ${op.prompt.slice(0, 40)}`),
  }),
} satisfies Partial<DesktopApi>
