/**
 * The `ai` web bridge of every module frame (Docs, pdf, markdown, html, slides, sheets;
 * CONTRACT C16, GO-A7 contract).
 *
 * Off (no `ai` grant, or a port without a frame token): every AI member answers exactly as before
 * this bridge existed (the "unavailable" stubs of web/docs/bridge/ai.ts and the modules' own
 * stubs) and every AI capability key stays false, so nothing AI is visible.
 *
 * On: the members talk to the frame-token AI routes (./client.ts):
 *   - aiStream / aiChat: ai-provider's native wire format on the BYOK proxy (./stream.ts),
 *   - getAiSettings: the provider/model choice of this viewer over the providers that have a key
 *     stored in UniWork (never a key: `apiKey` is the masked hint or ''), setAiSettings keeps only the choice,
 *   - webSearch / imageSearch / aiGenerateImage (generateImage) / analyzeMedia: the UniWork cloud
 *     tools, each behind its capability (`webSearch`, `imageSearch`, `imageGeneration`) AND the
 *     server's `GET cloud` tool switch,
 *   - aiGskStatus / gskStatus: signed in (the viewer is a UniWork user), cloud availability,
 *   - aiGskLogin / openAiSettings: the in-frame AI settings dialog (./ui.ts): UniWork credentials
 *     (GET / PUT / DELETE, masked `key_hint`), provider + model choice, cloud credits.
 * Every typed failure (402/403/404/424/429/502/503, 401 after a refresh) is returned in the
 * member's own error shape with its translated text. A failed chat turn shows that text once, as
 * the panel's inline error; a failed one-shot chat or tool call (search, image, media) also raises
 * the in-frame state card, because no transcript would tell the user. The model chip's "manage" row opens the
 * AI settings (`openAiModelSettings`), so every panel can reach them from the error it shows.
 */
import { AI_PROVIDERS, defaultAiSettings } from '../../../../packages/ai-provider/src/providers'
import type {
  AiProviderId,
  AiSettings,
  AiStreamChunk,
} from '../../../../packages/ai-provider/src/types'
import { setUniworkCloudStatus } from '../../../../packages/ai-provider/src/uniwork-cloud'
import type { Capabilities } from '../../../docs/protocol/types'
import type { BridgeObject } from '../../../docs/bridge/safe-api'
import type { FramePort } from '../../../docs/bridge/frame-port'
import {
  createAiWebClient,
  type AiCloudStatus,
  type AiCredentialList,
  type AiMedia,
  type AiWebClient,
} from './client'
import { AiWebError, isAiWebError } from './errors'
import { createWebAiStreams, type WireProtocol, type WebAiStreams } from './stream'
import { describeAiError, openAiSettingsDialog, showAiState } from './ui'

/** what the frame supports (sent in `ready`; effective = frame ∩ host grant) */
export const AI_FRAME_CAPABILITIES: Capabilities = Object.freeze({
  ai: true,
  webSearch: true,
  imageSearch: true,
  imageGeneration: true,
})

/**
 * Host grants -> renderer capability keys. Each cloud tool needs `ai` too; `aiCredentials` (web
 * only) shows the AI settings entry. Without the `ai` grant everything stays false.
 */
export function aiHostGrants(granted: Capabilities | undefined): Record<string, boolean> {
  const ai = granted?.ai === true
  return {
    ai,
    aiCredentials: ai,
    webSearch: ai && granted?.webSearch === true,
    imageSearch: ai && granted?.imageSearch === true,
    imageGeneration: ai && granted?.imageGeneration === true,
  }
}

/** genoffice providers the web can run: the server's table ∩ genoffice ids, no CLI / UniAI pool */
const WEB_PROVIDER_IDS = new Set<string>(
  AI_PROVIDERS.map((p) => p.id).filter((id) => id !== 'genspark' && id !== 'codex'),
)

export function providerLabel(id: string): string {
  return AI_PROVIDERS.find((p) => p.id === id)?.label ?? id
}

/** the viewer's provider/model choice (not a secret; a per-viewer convenience) */
interface AiChoice {
  provider?: string
  models: Record<string, string>
}

const CHOICE_KEY = 'uniwork.office.web.ai.choice'

function readChoice(): AiChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null') as AiChoice | null
    if (raw && typeof raw === 'object') {
      return {
        // only a provider the web can run: the value comes from localStorage and ends up in a URL
        ...(typeof raw.provider === 'string' && WEB_PROVIDER_IDS.has(raw.provider)
          ? { provider: raw.provider }
          : {}),
        models: raw.models && typeof raw.models === 'object' ? raw.models : {},
      }
    }
  } catch {
    // storage blocked or unreadable: defaults
  }
  return { models: {} }
}

function writeChoice(choice: AiChoice): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice))
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

export interface WebAiState {
  credentials: AiCredentialList
  cloud: AiCloudStatus | null
}

/** one frame's AI session; null-safe: `active()` is false whenever AI is off */
export interface WebAi {
  active(): Promise<boolean>
  client(): AiWebClient | null
  state(refresh?: boolean): Promise<WebAiState | null>
  settings(): Promise<AiSettings>
  choose(provider: string, model?: string): void
  /** the credentials or the choice changed (a key added / removed, a model picked); returns the unsubscribe */
  onChanged(handler: () => void): () => void
  streams: WebAiStreams
  openSettings(): Promise<void>
  /** the typed failure -> its card + its text */
  fail(err: unknown, provider?: string): string
}

const EMPTY: WebAiState = { credentials: { items: [], providers: [] }, cloud: null }

/**
 * How long a loaded credential list is trusted. A key may be added in UniWork settings (another
 * tab) or removed there at any time; every AI call and every settings read re-fetches once the
 * answer is older than this, and window focus / tab visibility mark it stale at once.
 */
export const CREDENTIALS_TTL_MS = 4000

/** what a change of the credential list looks like to a subscriber (never a key) */
function credentialSignature(list: AiCredentialList): string {
  return list.items
    .map((c) => `${c.provider}:${c.key_hint}:${c.base_url}:${c.updated_at}`)
    .sort()
    .join('|')
}

export function createWebAi(opts: {
  port: Pick<FramePort, 'whenInitialized' | 'getToken' | 'refreshToken'>
  capabilities: Record<string, unknown>
  /** test seams */
  fetch?: typeof fetch
  origin?: string
  now?: () => number
  /** the window whose focus / visibility refresh the credentials (default: the frame's) */
  win?: Pick<Window, 'addEventListener'> & { document?: Pick<Document, 'addEventListener'> }
}): WebAi {
  let clientRef: AiWebClient | null = null
  let state: WebAiState = EMPTY
  let loading: Promise<WebAiState> | null = null
  let loadedAt = 0
  let everLoaded = false
  let choice = readChoice()
  const changeListeners = new Set<() => void>()
  const now = opts.now ?? Date.now

  function notifyChanged(): void {
    for (const listener of [...changeListeners]) {
      try {
        listener()
      } catch (err) {
        console.error('[web-bridge] onAiSettingsChanged listener threw', err)
      }
    }
  }

  const activation = opts.port
    .whenInitialized()
    .then((session) => {
      const tokens = opts.port
      if (
        session.capabilities?.ai !== true ||
        !session.apiBase ||
        !tokens.getToken ||
        !tokens.refreshToken
      ) {
        return false
      }
      clientRef = createAiWebClient({
        documentId: session.documentId,
        apiBase: session.apiBase,
        tokens: { getToken: tokens.getToken, refreshToken: tokens.refreshToken },
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(opts.origin ? { origin: opts.origin } : {}),
      })
      // early: the cloud tool switches land before the first AI run; a failure is retried on use
      void load(true).catch(() => {})
      watchForeground()
      return true
    })
    .catch(() => false)

  async function load(refresh = false): Promise<WebAiState> {
    const client = clientRef
    if (!client) return EMPTY
    if (loading && !refresh && now() - loadedAt < CREDENTIALS_TTL_MS) return loading
    const run = (async () => {
      const [credentials, cloud] = await Promise.all([
        client.listCredentials(),
        client.cloudStatus().catch(() => null),
      ])
      const changed =
        everLoaded && credentialSignature(credentials) !== credentialSignature(state.credentials)
      state = { credentials, cloud }
      loadedAt = now()
      everLoaded = true
      applyCloud(cloud)
      if (changed) notifyChanged()
      return state
    })()
    loading = run
    try {
      return await run
    } catch (err) {
      // a failed refresh keeps the last answer but makes the next call try again
      if (loading === run) loading = null
      throw err
    }
  }

  /** back in the tab / window: a key may have been added in UniWork settings meanwhile */
  function watchForeground(): void {
    const win = opts.win ?? (typeof window === 'undefined' ? undefined : window)
    if (!win) return
    const refreshNow = (): void => void load(true).catch(() => {})
    win.addEventListener('focus', refreshNow)
    win.document?.addEventListener('visibilitychange', () => {
      if ((win.document as Document | undefined)?.visibilityState !== 'hidden') refreshNow()
    })
  }

  /** the server switches a cloud tool off (not configured, no entitlement): its entries hide */
  function applyCloud(cloud: AiCloudStatus | null): void {
    if (!cloud) return
    const caps = opts.capabilities
    const on = (key: string, tool: boolean): void => {
      if (caps[key] === true && !(cloud.enabled && tool)) caps[key] = false
    }
    on('webSearch', cloud.tools.web_search)
    on('imageSearch', cloud.tools.image_search)
    on('imageGeneration', cloud.tools.image_generate)
    publishCloudStatus(cloud)
  }

  /**
   * GO-A7's ai-provider gates its cloud entries (media pickers, cloudToolsEnabled) on the
   * process-wide UniWork cloud status, which the desktop shell publishes from its main process.
   * The frame publishes the server's answer instead, narrowed to what the host granted.
   */
  function publishCloudStatus(cloud: AiCloudStatus): void {
    const caps = opts.capabilities
    const media = caps.imageGeneration === true
    const exhausted = cloud.credits.remaining !== null && cloud.credits.remaining <= 0
    setUniworkCloudStatus({
      state: !cloud.enabled ? 'not-entitled' : exhausted ? 'credits-exhausted' : 'ready',
      enabled: cloud.enabled,
      tools: {
        web_search: caps.webSearch === true,
        image_search: caps.imageSearch === true,
        image_generate: media,
        media_analyze: media && cloud.tools.media_analyze,
        transcribe: media && cloud.tools.transcribe,
      },
      credits: {
        unit: cloud.credits.unit,
        used: cloud.credits.used,
        limit: cloud.credits.limit,
        remaining: cloud.credits.remaining,
        periodEnd: cloud.credits.period_end,
      },
    })
  }

  function protocolOf(provider: string): WireProtocol | null {
    const row = state.credentials.providers.find((p) => p.id === provider)
    const p = row?.protocol
    return p === 'openai-compatible' || p === 'anthropic' || p === 'gemini' ? p : null
  }

  function protocolBaseOf(provider: string): string {
    return state.credentials.providers.find((p) => p.id === provider)?.default_base_url ?? ''
  }

  /** usable = has a stored key, the server knows its protocol, genoffice can drive it */
  function usableProviders(): string[] {
    return state.credentials.items
      .map((c) => c.provider)
      .filter((id) => WEB_PROVIDER_IDS.has(id) && protocolOf(id))
  }

  async function settings(): Promise<AiSettings> {
    const base = defaultAiSettings()
    if (!(await activation)) return base
    await load().catch(() => EMPTY)
    const usable = usableProviders()
    const fallback = state.credentials.providers.find((p) => WEB_PROVIDER_IDS.has(p.id))?.id
    const provider = (
      choice.provider && usable.includes(choice.provider)
        ? choice.provider
        : (usable[0] ?? choice.provider ?? fallback ?? 'openai')
    ) as AiProviderId
    const providers = { ...base.providers }
    for (const id of Object.keys(providers) as AiProviderId[]) {
      const model = choice.models[id]
      const stored = state.credentials.items.find((c) => c.provider === id)
      const usableHere = usable.includes(id)
      providers[id] = {
        ...providers[id],
        // The real key never reaches the frame. A provider with a key stored in UniWork carries
        // its masked hint (non-empty, never sent: ./stream.ts drops it) so the shared picker and
        // `activeProvider` see it as configured; one without stays empty and is not listed.
        apiKey: usableHere ? stored?.key_hint || '…' : '',
        ...(usableHere && providers[id].baseUrl !== undefined
          ? { baseUrl: stored?.base_url || protocolBaseOf(id) || providerLabel(id) }
          : {}),
        ...(model ? { model } : {}),
      }
    }
    const cloudOn = opts.capabilities.imageGeneration === true
    // UniAI is the desktop's pool of cloud models: the web runs only the viewer's own providers
    return { ...base, provider, providers, gskToolsEnabled: cloudOn, uniAiAvailable: false }
  }

  function choose(provider: string, model?: string): void {
    choice = {
      provider,
      models: { ...choice.models, ...(model ? { [provider]: model } : {}) },
    }
    writeChoice(choice)
    notifyChanged()
  }

  function fail(err: unknown, provider = ''): string {
    const typed = isAiWebError(err)
      ? err
      : new AiWebError({
          code: (err as { code?: string })?.code === 'unauthorized' ? 'unauthorized' : 'unknown',
          status: 0,
          message: err instanceof Error ? err.message : String(err),
        })
    showAiState(typed, providerLabel(provider), { openSettings })
    return describeAiError(typed, providerLabel(provider))
  }

  async function openSettings(): Promise<void> {
    if (!(await activation) || !clientRef) return
    const client = clientRef
    await openAiSettingsDialog({
      load: async () => load(true),
      client,
      current: async () => {
        const s = await settings()
        return { provider: s.provider, model: s.providers[s.provider]?.model ?? '' }
      },
      choose,
      supported: (id) => WEB_PROVIDER_IDS.has(id),
      label: providerLabel,
      models: (id) => AI_PROVIDERS.find((p) => p.id === id)?.models ?? [],
    })
    // keys saved or removed in the dialog, a model picked: every panel's chip re-reads
    notifyChanged()
  }

  const streams = createWebAiStreams({
    client: {
      get base() {
        return clientRef?.base ?? ''
      },
      fetch: (path, init) => {
        if (!clientRef) return Promise.reject(new AiWebError({ code: 'unknown', status: 0 }))
        return clientRef.fetch(path, init)
      },
    },
    protocolOf,
    // a failed chat turn is announced once, by the panel's inline error (the typed text below);
    // only the calls with no transcript (one-shot chat here, the tool members below) raise the card
    describe: (err, provider) => describeAiError(err, providerLabel(provider)),
    onChatFailure: (err, provider) => showAiState(err, providerLabel(provider), { openSettings }),
  })

  return {
    active: () => activation,
    client: () => clientRef,
    state: async (refresh) => ((await activation) ? load(refresh) : null),
    settings,
    choose,
    onChanged: (handler) => {
      changeListeners.add(handler)
      return () => {
        changeListeners.delete(handler)
      }
    },
    streams,
    openSettings,
    fail,
  }
}

// ------------------------------------------------------------------ members

const MEDIA_DATA_URL = /^data:([^;,]+);base64,(.*)$/s

/** a data: URL as contract media bytes; other URLs cannot be read by the frame (CSP connect-src) */
export function mediaFromUrl(url: string): AiMedia | null {
  const m = MEDIA_DATA_URL.exec(url)
  return m ? { mime: m[1]!, data_base64: m[2]! } : null
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

const clampResults = (n: unknown, d: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : d

/** the AI keys every module global gets (each one falls back to the module's own member when off) */
export const WEB_AI_MEMBERS = [
  'getAiSettings',
  'setAiSettings',
  'aiStream',
  'aiStreamCancel',
  'onAiStream',
  'aiChat',
  'aiGskStatus',
  'aiGskLogin',
  'gskStatus',
  'webSearch',
  'imageSearch',
  'aiGenerateImage',
  'generateImage',
  'analyzeMedia',
  'openAiSettings',
  'openAiModelSettings',
  'onAiSettingsChanged',
] as const

type Fn = (...args: unknown[]) => unknown

/**
 * `base` with its AI members replaced by the web AI bridge while AI is on (later wins over the
 * module's stubs; while off each member calls the module's own one, so nothing changes).
 */
export function withWebAi(base: BridgeObject, ai: WebAi): BridgeObject {
  const own = (key: string): Fn | undefined =>
    typeof base[key] === 'function' ? (base[key] as Fn) : undefined
  const when =
    (key: string, on: Fn, offDefault?: Fn): Fn =>
    async (...args) =>
      (await ai.active())
        ? on(...args)
        : (own(key) ?? offDefault ?? (async () => undefined))(...args)

  /**
   * The provider/model of a turn = this viewer's current choice: renderers read the settings once
   * at boot, before a key may have been added in the AI settings dialog. Everything else of the
   * renderer's settings (output cap, ...) is kept.
   */
  const current = async (given: AiSettings | undefined): Promise<AiSettings> => {
    const now = await ai.settings()
    return {
      ...(given ?? now),
      provider: now.provider,
      providers: {
        ...(given?.providers ?? now.providers),
        [now.provider]: now.providers[now.provider],
      },
    }
  }

  const members: BridgeObject = {
    getAiSettings: when('getAiSettings', () => ai.settings()),
    setAiSettings: when('setAiSettings', async (settings) => {
      const s = settings as AiSettings | undefined
      if (s?.provider) ai.choose(s.provider, s.providers?.[s.provider]?.model)
    }),
    aiStream: when('aiStream', async (request) => {
      const r = request as Parameters<WebAiStreams['aiStream']>[0]
      return ai.streams.aiStream({ ...r, settings: await current(r.settings) })
    }),
    aiStreamCancel: when('aiStreamCancel', (id) => ai.streams.aiStreamCancel(String(id))),
    // sync subscriber: the handler hears the module's own stream (stubs) and the web one
    onAiStream: (handler: unknown) => {
      const h = handler as (chunk: AiStreamChunk) => void
      const offOwn = own('onAiStream')?.(h) as (() => void) | undefined
      const offWeb = ai.streams.onAiStream(h)
      return () => {
        offOwn?.()
        offWeb()
      }
    },
    aiChat: when('aiChat', async (request) => {
      const r = request as Parameters<WebAiStreams['aiChat']>[0]
      return ai.streams.aiChat({ ...r, settings: await current(r.settings) })
    }),
    aiGskStatus: when('aiGskStatus', async () => ({ loggedIn: true })),
    // sync subscriber like onAiStream: the model chip re-reads after a key or a model change
    onAiSettingsChanged: (handler: unknown) => {
      const h = handler as () => void
      const offOwn = own('onAiSettingsChanged')?.(h) as (() => void) | undefined
      const offWeb = ai.onChanged(h)
      return () => {
        offOwn?.()
        offWeb()
      }
    },
    aiGskLogin: when('aiGskLogin', () => ai.openSettings()),
    gskStatus: when('gskStatus', async () => {
      const st = await ai.state().catch(() => null)
      return { available: st?.cloud?.enabled === true }
    }),
    webSearch: when('webSearch', async (query, maxResults) => {
      try {
        const r = await ai.client()!.search({
          query: String(query ?? '').slice(0, 400),
          kind: 'web',
          max_results: clampResults(maxResults, 6),
        })
        return {
          results: r.results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet })),
          ...(r.answer ? { answer: r.answer } : {}),
          method: 'uniwork',
        }
      } catch (err) {
        return { results: [], method: 'error', error: ai.fail(err) }
      }
    }),
    imageSearch: when('imageSearch', async (query, maxResults) => {
      try {
        const r = await ai.client()!.search({
          query: String(query ?? '').slice(0, 400),
          kind: 'image',
          max_results: clampResults(maxResults, 8),
        })
        return {
          images: r.results
            .filter((x) => x.image_url || x.thumbnail_url)
            .map((x) => ({
              title: x.title,
              imageUrl: (x.image_url || x.thumbnail_url)!,
              sourceUrl: x.url,
              source: hostOf(x.url),
            })),
          method: 'uniwork',
        }
      } catch (err) {
        return { images: [], method: 'error', error: ai.fail(err) }
      }
    }),
  }

  const generate = async (op: unknown): Promise<{ url?: string; error?: string }> => {
    const o = (op ?? {}) as {
      prompt?: string
      aspectRatio?: string
      imageSize?: string
      referenceImageUrls?: string[]
    }
    try {
      const refs = (o.referenceImageUrls ?? [])
        .map(mediaFromUrl)
        .filter((m): m is AiMedia => m !== null)
        .slice(0, 4)
      const r = await ai.client()!.generateImage({
        prompt: String(o.prompt ?? '').slice(0, 4000),
        ...(o.aspectRatio ? { aspect_ratio: o.aspectRatio } : {}),
        ...(o.imageSize ? { image_size: o.imageSize } : {}),
        ...(refs.length ? { reference_images: refs } : {}),
      })
      const img = r.images[0]
      if (!img) return { error: ai.fail(new AiWebError({ code: 'unknown', status: 200 })) }
      return { url: `data:${img.mime};base64,${img.data_base64}` }
    } catch (err) {
      return { error: ai.fail(err) }
    }
  }
  members.aiGenerateImage = when('aiGenerateImage', generate)
  members.generateImage = when('generateImage', generate)
  members.analyzeMedia = when('analyzeMedia', async (op) => {
    const o = (op ?? {}) as { mediaUrls?: string[]; requirements?: string }
    const media = (o.mediaUrls ?? [])
      .map(mediaFromUrl)
      .filter((m): m is AiMedia => m !== null)
      .slice(0, 4)
    try {
      const r = await ai.client()!.analyzeMedia({
        requirements: String(o.requirements ?? '').slice(0, 4000),
        media,
      })
      return { text: r.text }
    } catch (err) {
      return { error: ai.fail(err) }
    }
  })
  members.openAiSettings = when('openAiSettings', () => ai.openSettings())
  // the model chip's "manage" row (every panel's AiModelPicker bridge) is the keys' way in
  members.openAiModelSettings = when('openAiModelSettings', () => ai.openSettings())

  return { ...base, ...members }
}
