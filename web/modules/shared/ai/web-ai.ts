/**
 * The `ai` web bridge of every module frame (Docs, pdf, markdown, html, slides, sheets;
 * CONTRACT C16, GO-A7 contract). UniWork AI is the only AI of the frame (UNI-2289): no key store,
 * no BYOK proxy, no provider choice.
 *
 * Off (no `uniworkAi` grant, or a port without a frame token): every AI member answers exactly as
 * before this bridge existed (the "unavailable" stubs of web/docs/bridge/ai.ts and the modules' own
 * stubs) and every AI capability key stays false, so nothing AI is visible.
 *
 * On: the members talk to the frame-token AI routes (./client.ts):
 *   - aiStream / aiChat: UniWork AI turns on the frame route (./stream.ts),
 *   - getAiSettings: UniWork AI, the one provider (no key; the server's policy names the model);
 *     setAiSettings keeps nothing, there is nothing to choose,
 *   - webSearch / imageSearch / aiGenerateImage (generateImage) / analyzeMedia: the UniWork cloud
 *     tools, each behind its capability (`webSearch`, `imageSearch`, `imageGeneration`) AND the
 *     server's `GET cloud` tool switch,
 *   - aiGskStatus / gskStatus: signed in (the viewer is a UniWork user), cloud availability;
 *     aiGskLogin has nothing to open,
 *   - window.uniworkCloudStatus: the credits the model chip reads, on the bridge a desktop
 *     preload exposes, fed by this frame's own GET cloud.
 * Every typed failure of a cloud tool (402/403/429/502/503, 401 after a refresh) is returned in the
 * member's own error shape with its translated text and raises the in-frame state card, because no
 * transcript would tell the user. A failed chat turn shows its text once, as the panel's inline error.
 */
import {
  defaultAiSettings,
  setUniworkAiAvailable,
} from '../../../../packages/ai-provider/src/providers'
import type { AiSettings, AiStreamChunk } from '../../../../packages/ai-provider/src/types'
import {
  getUniworkCloudStatus,
  onUniworkCloudStatus,
  setUniworkCloudStatus,
} from '../../../../packages/ai-provider/src/uniwork-cloud'
import {
  UNIWORK_CLOUD_STATUS_BRIDGE_KEY,
  parseUniworkCloudStatusSnapshot,
  type UniworkCloudStatusSnapshot,
} from '../../../../packages/electron-utils/src/uniwork-cloud-status'
import type { streamUniwork } from '../../../../packages/ai-provider/src/uniwork/protocol'
import {
  UNIWORK_PROVIDER_ID,
  type UniworkFormat,
} from '../../../../packages/ai-provider/src/uniwork/types'
import { aiUniworkText } from '../../../../packages/ui/src/strings-ai-uniwork'
import {
  DocsProtocolError,
  type AiStartPayload,
  type AiStartResult,
  type Capabilities,
  type OfficeModule,
} from '../../../docs/protocol/types'
import type { BridgeObject } from '../../../docs/bridge/safe-api'
import type { FramePort } from '../../../docs/bridge/frame-port'
import { webLanguage } from '../../../docs/bridge/browser'
import { createAiWebClient, type AiCloudStatus, type AiMedia, type AiWebClient } from './client'
import type { AiRunTracker } from '../ai-run'
import { aiWebText } from '../i18n/strings-ai-web'
import { AiWebError, isAiWebError, uniworkFailureKey, type UniworkFailure } from './errors'
import { createAiHandoff, type AiHandoff, type AiPreset } from './handoff'
import { createWebAiStreams, type WebAiStreams } from './stream'
import { describeAiError, showAiState } from './ui'

/** what the frame supports (sent in `ready`; effective = frame ∩ host grant) */
export const AI_FRAME_CAPABILITIES: Capabilities = Object.freeze({
  webSearch: true,
  imageSearch: true,
  imageGeneration: true,
  // UniWork AI (X-02 key): the frame runs the `uniwork` adapter over its frame-token route
  uniworkAi: true,
})

/**
 * Host grants -> renderer capability keys (the Grant formula of the UniWork AI design, one source
 * for every module):
 *   - `ai` (the panel opens) = `uniworkAi` = the UniWork AI grant; an old `ai` grant alone opens
 *     nothing, UniWork AI being the only AI (UNI-2289),
 *   - each cloud tool needs the UniWork AI grant plus its own.
 * Without the UniWork AI grant everything stays false.
 */
export function aiHostGrants(granted: Capabilities | undefined): Record<string, boolean> {
  const ai = granted?.uniworkAi === true
  return {
    ai,
    uniworkAi: ai,
    webSearch: ai && granted?.webSearch === true,
    imageSearch: ai && granted?.imageSearch === true,
    imageGeneration: ai && granted?.imageGeneration === true,
  }
}

/** the module of the frame session -> the format token the UniWork AI server knows it by */
const FORMAT_OF_MODULE: Record<OfficeModule, UniworkFormat> = {
  docs: 'docx',
  sheets: 'xlsx',
  slides: 'pptx',
  pdf: 'pdf',
  markdown: 'markdown',
  html: 'html',
}

export interface WebAiState {
  cloud: AiCloudStatus | null
}

/**
 * Identity tuple for the web frame's UniWork AI disclosure acknowledgement store
 * (`{ account, org, document }`) and the `{org}` display name.
 */
export interface WebUniworkAiIdentity {
  account: string
  org: string
  orgName: string
  document: string
}

/** one frame's AI session; null-safe: `active()` is false whenever AI is off */
export interface WebAi {
  active(): Promise<boolean>
  client(): AiWebClient | null
  state(refresh?: boolean): Promise<WebAiState | null>
  settings(): Promise<AiSettings>
  /** UniWork AI is the one provider: a pick from the renderer changes nothing */
  choose(provider: string, model?: string): void
  /**
   * the settings changed (the server turned UniWork AI off, or named another organization);
   * returns the unsubscribe
   */
  onChanged(handler: () => void): () => void
  streams: WebAiStreams
  /** the typed failure -> its card + its text */
  fail(err: unknown): string
  /** UniWork AI disclosure identity and org display name for this frame session; null before init */
  uniworkIdentity(): WebUniworkAiIdentity | null
  /** the job the host handed to the panel (`ai.start`): its presets, header and parts */
  handoff: Pick<AiHandoff, 'consumePreset' | 'onPreset'>
  /** `ai.start`: accept the job while UniWork AI is on; otherwise refuse `unsupported` */
  startHandoff(job: AiStartPayload): Promise<AiStartResult>
}

const EMPTY: WebAiState = { cloud: null }

/**
 * How long a cloud status answer is trusted: a settings read after this asks the server again (the
 * credits, the tool switches and the UniWork AI model may change at any time).
 */
const CLOUD_STATUS_TTL_MS = 4000

export function createWebAi(opts: {
  port: Pick<FramePort, 'whenInitialized' | 'getToken' | 'refreshToken'>
  capabilities: Record<string, unknown>
  /** the frame's AI turn tracker (X-02 `aiRun`, the S6 bar); absent = chat turns are not tracked */
  aiRun?: AiRunTracker
  /** test seams */
  fetch?: typeof fetch
  /**
   * the module this frame runs (its format token goes to UniWork AI); unset = what the session says,
   * else Docs (the module-less frame is the Docs one)
   */
  module?: OfficeModule
  /** the UniWork AI adapter (default: ai-provider `streamUniwork`) */
  uniworkStream?: typeof streamUniwork
  origin?: string
  now?: () => number
}): WebAi {
  let clientRef: AiWebClient | null = null
  let state: WebAiState = EMPTY
  let loading: Promise<WebAiState> | null = null
  let loadedAt = 0
  // what the host granted this frame (set at activation): UniWork AI, and which cloud tools
  let uniworkGranted = false
  let cloudWanted = false
  /** a cloud status was published: before it, the window bridge answers "not read yet" (null) */
  let cloudPublished = false
  /** UniWork AI turned off by the server after the grant was minted (capability / format off) */
  let uniworkOff = false
  let frameSession: {
    documentId: string
    module?: OfficeModule
    workspaceId?: string
    orgId?: string
    account?: string
    orgName?: string
  } | null = null
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
      uniworkGranted = session.capabilities?.uniworkAi === true
      if (!uniworkGranted || !session.apiBase || !tokens.getToken || !tokens.refreshToken) {
        return false
      }
      const granted = session.capabilities
      // the availability flag adds the `uniwork` entry to AI_PROVIDERS (every list built from it)
      setUniworkAiAvailable(true)
      // the cloud status is always read (it names the UniWork AI model); its tool switches apply
      // only to a frame that was granted a cloud tool
      cloudWanted =
        granted?.webSearch === true ||
        granted?.imageSearch === true ||
        granted?.imageGeneration === true
      const sessionModule = (session as { module?: OfficeModule }).module
      const workspaceId = (session as { workspaceId?: string }).workspaceId?.trim()
      const orgId = (session as { orgId?: string }).orgId?.trim()
      const orgName = (session as { orgName?: string }).orgName?.trim()
      const account =
        session.user?.id?.trim() ||
        session.recovery?.scope?.split(':')[0]?.trim() ||
        session.user?.displayName?.trim()
      const module = opts.module ?? sessionModule
      frameSession = {
        documentId: session.documentId,
        ...(module ? { module } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(orgId ? { orgId } : {}),
        ...(account ? { account } : {}),
        ...(orgName ? { orgName } : {}),
      }
      clientRef = createAiWebClient({
        documentId: session.documentId,
        apiBase: session.apiBase,
        tokens: { getToken: tokens.getToken, refreshToken: tokens.refreshToken },
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(opts.origin ? { origin: opts.origin } : {}),
      })
      installCloudStatusBridge()
      // early: the cloud tool switches land before the first AI run; a failure is retried on use
      void load(true).catch(() => {})
      return true
    })
    .catch(() => false)

  async function load(refresh = false): Promise<WebAiState> {
    const client = clientRef
    if (!client) return EMPTY
    if (loading && !refresh && now() - loadedAt < CLOUD_STATUS_TTL_MS) return loading
    const run = (async () => {
      const cloud = await client.cloudStatus().catch(() => null)
      const changed =
        (cloud?.org_id ?? '') !== (state.cloud?.org_id ?? '') ||
        (cloud?.org_name ?? '') !== (state.cloud?.org_name ?? '')
      state = { cloud }
      loadedAt = now()
      // the tool switches follow a granted tool only; the status (credits) is always published
      if (cloud) {
        if (cloudWanted) applyCloud(cloud)
        publishCloudStatus(cloud)
      }
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

  /** the server switches a cloud tool off (not configured, no entitlement): its entries hide */
  function applyCloud(cloud: AiCloudStatus): void {
    const caps = opts.capabilities
    const on = (key: string, tool: boolean): void => {
      if (caps[key] === true && !(cloud.enabled && tool)) caps[key] = false
    }
    on('webSearch', cloud.tools.web_search)
    on('imageSearch', cloud.tools.image_search)
    on('imageGeneration', cloud.tools.image_generate)
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
    // before the set: it notifies the window bridge's listeners synchronously
    cloudPublished = true
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

  /**
   * The published credits as the window bridge hands them over; null until the first read
   * answered. The state is `ready`: the host granted UniWork AI and there is no other provider to
   * switch to, so an off state comes back as the turn's own answer (a 403 hides the panel, a 402 is
   * the turn's error) and never hides the chip's one row or raises a "choose another" note.
   */
  function cloudSnapshot(): UniworkCloudStatusSnapshot | null {
    if (!cloudPublished) return null
    const { credits } = getUniworkCloudStatus()
    return parseUniworkCloudStatusSnapshot({
      state: 'ready',
      signedIn: true,
      enabled: true,
      credits,
    })
  }

  /**
   * window.uniworkCloudStatus, as a desktop preload exposes it: the model chip reads the credits
   * from it. Nothing to open on the web (no account settings, no sign-in: the viewer is a UniWork
   * user), and no account or organization: the panels keep their own disclosure identity.
   */
  function installCloudStatusBridge(): void {
    ;(window as unknown as Record<string, unknown>)[UNIWORK_CLOUD_STATUS_BRIDGE_KEY] = {
      get: async () => cloudSnapshot(),
      onChange: (handler: (status: UniworkCloudStatusSnapshot | null) => void) =>
        onUniworkCloudStatus(() => handler(cloudSnapshot())),
    }
  }

  /** the grant is there and the server has not turned UniWork AI off since */
  function uniworkEffective(): boolean {
    return uniworkGranted && !uniworkOff && opts.capabilities.uniworkAi !== false
  }

  /** the frame route scope of this document and module; null while UniWork AI is not available */
  function uniworkScope(): { kind: 'frame'; documentId: string; format: UniworkFormat } | null {
    if (!uniworkEffective() || !frameSession) return null
    return {
      kind: 'frame',
      documentId: frameSession.documentId,
      format: FORMAT_OF_MODULE[frameSession.module ?? 'docs'],
    }
  }

  /**
   * The server says UniWork AI is off for this organization or format (a 403 before any run): the
   * entry hides at once, with no error. UniWork AI is the only AI, so the panel hides too.
   */
  function turnUniworkOff(): void {
    if (uniworkOff) return
    uniworkOff = true
    setUniworkAiAvailable(false)
    const caps = opts.capabilities
    caps.uniworkAi = false
    caps.ai = false
    notifyChanged()
  }

  async function settings(): Promise<AiSettings> {
    const base = defaultAiSettings()
    if (!(await activation)) return base
    // a failed status read leaves no answer (null): the row shows the plain name
    await load().catch(() => {})
    const uniworkOn = uniworkEffective()
    const uniworkModel = uniworkOn ? (state.cloud?.uniwork_model ?? '') : ''
    return {
      ...base,
      provider: UNIWORK_PROVIDER_ID,
      // UniWork AI is the one provider. No key: a non-empty slot reads as configured, an empty one
      // (the server turned it off) as unavailable with Send blocked. The server's policy picks the
      // model, so none is named here
      providers: {
        [UNIWORK_PROVIDER_ID]: { apiKey: uniworkOn ? '…' : '', model: '' },
      } as AiSettings['providers'],
      gskToolsEnabled: opts.capabilities.imageGeneration === true,
      // UniAI is the desktop's pool of cloud models: never offered on the web
      uniAiAvailable: false,
      ...(uniworkModel ? { uniworkModel } : {}),
    }
  }

  function fail(err: unknown): string {
    const typed = isAiWebError(err)
      ? err
      : new AiWebError({
          code: (err as { code?: string })?.code === 'unauthorized' ? 'unauthorized' : 'unknown',
          status: 0,
          message: err instanceof Error ? err.message : String(err),
        })
    showAiState(typed)
    return describeAiError(typed)
  }

  const handoff = createAiHandoff({
    ...(opts.aiRun ? { aiRun: opts.aiRun } : {}),
    continueText: () => aiWebText(webLanguage(), 'aiHandoffContinue'),
  })

  async function startHandoff(job: AiStartPayload): Promise<AiStartResult> {
    if (!((await activation) && uniworkEffective())) {
      throw new DocsProtocolError({
        code: 'unsupported',
        message: 'the AI panel does not run UniWork AI',
      })
    }
    handoff.start(job)
    return { queued: true }
  }

  const streams = createWebAiStreams({
    client: {
      uniworkChat: (request) => {
        if (!clientRef) return Promise.reject(new AiWebError({ code: 'unknown', status: 0 }))
        return clientRef.uniworkChat(request)
      },
      uniworkWrite: (body, headers, signal) => {
        if (!clientRef) return Promise.reject(new AiWebError({ code: 'unknown', status: 0 }))
        return clientRef.uniworkWrite(body, headers, signal)
      },
    },
    ...(opts.aiRun ? { aiRun: opts.aiRun } : {}),
    uniwork: {
      scope: uniworkScope,
      cloudTools: () =>
        opts.capabilities.webSearch === true ||
        opts.capabilities.imageSearch === true ||
        opts.capabilities.imageGeneration === true,
      describeFailure: (failure: UniworkFailure) =>
        aiUniworkText(webLanguage(), uniworkFailureKey(failure)),
      onOff: turnUniworkOff,
      // the frame's UI language is the module's (its LocaleProvider follows it)
      lang: webLanguage,
      ...(opts.uniworkStream ? { stream: opts.uniworkStream } : {}),
    },
    handoff,
  })

  return {
    active: () => activation,
    client: () => clientRef,
    state: async (refresh) => ((await activation) ? load(refresh) : null),
    settings,
    choose: () => {},
    onChanged: (handler) => {
      changeListeners.add(handler)
      return () => {
        changeListeners.delete(handler)
      }
    },
    streams,
    fail,
    handoff,
    startHandoff,
    uniworkIdentity: () => {
      if (!frameSession) return null
      // InitPayload (web/docs/protocol/types.ts, frozen X-02) does not define dedicated orgId /
      // orgName fields, so org_id / org_name come from GET .../ai/cloud once it answered, or from
      // optional host session extensions; when neither is available, org scopes to the document
      // and orgName falls back to 'UniWork' (never a raw document UUID).
      const org =
        state.cloud?.org_id?.trim() ||
        frameSession.orgId ||
        frameSession.workspaceId ||
        frameSession.documentId
      const orgName = state.cloud?.org_name?.trim() || frameSession.orgName || 'UniWork'
      const account = frameSession.account || 'web'
      return {
        account,
        org,
        orgName,
        document: frameSession.documentId,
      }
    },
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
  'onAiSettingsChanged',
  'consumeAiPreset',
  'onAiPreset',
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
   * The provider of a turn = UniWork AI: renderers read the settings once at boot, and may still
   * hold another provider from then. Everything else of the renderer's settings (output cap, ...)
   * is kept.
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
    // UniWork AI is the one provider: there is nothing to keep
    setAiSettings: when('setAiSettings', async () => {}),
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
    // sync subscriber like onAiStream: the model chip re-reads after UniWork AI went off
    onAiSettingsChanged: (handler: unknown) => {
      const h = handler as () => void
      const offOwn = own('onAiSettingsChanged')?.(h) as (() => void) | undefined
      const offWeb = ai.onChanged(h)
      return () => {
        offOwn?.()
        offWeb()
      }
    },
    // the job the host handed over (`ai.start`); the module's stub answers while AI is off
    consumeAiPreset: when(
      'consumeAiPreset',
      async () => ai.handoff.consumePreset(),
      async () => null,
    ),
    // sync subscriber like onAiStream: the module's own presets and the handed-over ones
    onAiPreset: (handler: unknown) => {
      const h = handler as (preset: AiPreset) => void
      const offOwn = own('onAiPreset')?.(h) as (() => void) | undefined
      const offWeb = ai.handoff.onPreset(h)
      return () => {
        offOwn?.()
        offWeb()
      }
    },
    // the web viewer is always signed in (aiGskStatus): there is nothing to open
    aiGskLogin: when('aiGskLogin', async () => {}),
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

  return { ...base, ...members }
}
