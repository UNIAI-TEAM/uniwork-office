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
import { aiNoticeTagged } from '../../../../packages/ai-provider/src/ai-notice'
import { AI_PROVIDERS, defaultAiSettings } from '../../../../packages/ai-provider/src/providers'
import type {
  AiProviderId,
  AiSettings,
  AiStreamChunk,
} from '../../../../packages/ai-provider/src/types'
import { setUniworkCloudStatus } from '../../../../packages/ai-provider/src/uniwork-cloud'
import { setUniworkAiAvailable } from '../../../../packages/ai-provider/src/providers'
import type { streamUniwork } from '../../../../packages/ai-provider/src/uniwork/protocol'
import {
  UNIWORK_PROVIDER_ID,
  type UniworkFormat,
} from '../../../../packages/ai-provider/src/uniwork/types'
import { aiUniworkText } from '../../../../packages/ui/src/strings-ai-uniwork'
import type { Capabilities, OfficeModule } from '../../../docs/protocol/types'
import type { BridgeObject } from '../../../docs/bridge/safe-api'
import type { FramePort } from '../../../docs/bridge/frame-port'
import { webLanguage } from '../../../docs/bridge/browser'
import {
  createAiWebClient,
  type AiCloudStatus,
  type AiCredentialList,
  type AiMedia,
  type AiWebClient,
} from './client'
import type { AiRunTracker } from '../ai-run'
import { AiWebError, isAiWebError, uniworkFailureKey, type UniworkFailure } from './errors'
import { createWebAiStreams, type WireProtocol, type WebAiStreams } from './stream'
import { describeAiError, openAiSettingsDialog, showAiState } from './ui'

/** what the frame supports (sent in `ready`; effective = frame ∩ host grant) */
export const AI_FRAME_CAPABILITIES: Capabilities = Object.freeze({
  ai: true,
  webSearch: true,
  imageSearch: true,
  imageGeneration: true,
  // UniWork AI (X-02 key): the frame runs the `uniwork` adapter over its frame-token route
  uniworkAi: true,
})

/**
 * Host grants -> renderer capability keys (the Grant formula of the UniWork AI design, one source
 * for every module):
 *   - `ai` (the panel opens) = the BYOK grant OR the UniWork AI grant,
 *   - `aiCredentials` (the BYOK key settings entry, the lock) = the BYOK grant only,
 *   - `uniworkAi` = the UniWork AI grant,
 *   - each cloud tool needs one of the two AI grants plus its own.
 * Without either AI grant everything stays false.
 */
export function aiHostGrants(granted: Capabilities | undefined): Record<string, boolean> {
  const byok = granted?.ai === true
  const uniworkAi = granted?.uniworkAi === true
  const ai = byok || uniworkAi
  return {
    ai,
    aiCredentials: byok,
    uniworkAi,
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

/** genoffice providers the web can run: the server's table ∩ genoffice ids, no CLI / UniAI pool */
const WEB_PROVIDER_IDS = new Set<string>(
  AI_PROVIDERS.map((p) => p.id).filter((id) => id !== 'genspark' && id !== 'codex'),
)

export function providerLabel(id: string): string {
  return AI_PROVIDERS.find((p) => p.id === id)?.label ?? id
}

/**
 * This browser's provider/model choice (not a secret). The model is saved with the person's
 * credential on the server; this is the cache that keeps working when the server is older or a save
 * failed. Every entry carries the time it was made (epoch ms, `at` per provider and `providerAt`):
 * against the server's `model_updated_at` the newer one wins, and an entry without a time (written by
 * an older build) counts as older than any server stamp.
 */
interface AiChoice {
  provider?: string
  providerAt: number
  models: Record<string, string>
  at: Record<string, number>
}

const CHOICE_KEY = 'uniwork.office.web.ai.choice'

/** the storage key of one viewer; a frame that does not know the user id keeps the shared key */
function choiceKeyOf(userId: string | undefined): string {
  return userId ? `${CHOICE_KEY}:${userId}` : CHOICE_KEY
}

const emptyChoice = (): AiChoice => ({ providerAt: 0, models: {}, at: {} })

function readChoice(key: string): AiChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<AiChoice> | null
    if (raw && typeof raw === 'object') {
      const at: Record<string, number> = {}
      if (raw.at && typeof raw.at === 'object') {
        for (const [id, when] of Object.entries(raw.at)) {
          if (typeof when === 'number' && Number.isFinite(when)) at[id] = when
        }
      }
      return {
        // only a provider the web can run: the value comes from localStorage and ends up in a URL
        // (`uniwork` has a fixed route; settings() still drops it while the grant is off)
        ...(typeof raw.provider === 'string' &&
        (WEB_PROVIDER_IDS.has(raw.provider) || raw.provider === UNIWORK_PROVIDER_ID)
          ? { provider: raw.provider }
          : {}),
        providerAt:
          typeof raw.providerAt === 'number' && Number.isFinite(raw.providerAt)
            ? raw.providerAt
            : 0,
        models: raw.models && typeof raw.models === 'object' ? raw.models : {},
        at,
      }
    }
  } catch {
    // storage blocked or unreadable: defaults
  }
  return emptyChoice()
}

function writeChoice(key: string, choice: AiChoice): void {
  try {
    localStorage.setItem(key, JSON.stringify(choice))
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

/** the model ids of a provider's own `/models` answer (OpenAI/Anthropic `data[].id`, Gemini `models[].name`) */
export function modelIdsOf(body: unknown): string[] {
  const b = (body ?? {}) as { data?: unknown; models?: unknown }
  const rows = Array.isArray(b.data) ? b.data : Array.isArray(b.models) ? b.models : []
  const ids = rows.map((row) => {
    const r = (row ?? {}) as { id?: unknown; name?: unknown }
    const raw = typeof r.id === 'string' ? r.id : typeof r.name === 'string' ? r.name : ''
    return raw.replace(/^models\//, '').trim()
  })
  return [...new Set(ids.filter(Boolean))]
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

/** how long a provider's live model list is trusted before the next settings read lists it again */
export const MODEL_LIST_TTL_MS = 10 * 60 * 1000

/** a failed listing is tried again after this pause, never on every chip open */
const MODEL_LIST_RETRY_MS = 60 * 1000

/** what a change of the credential list looks like to a subscriber (never a key) */
function credentialSignature(list: AiCredentialList): string {
  return list.items
    .map(
      (c) =>
        `${c.provider}:${c.key_hint}:${c.base_url}:${c.updated_at}:${c.model}:${c.model_updated_at}`,
    )
    .sort()
    .join('|')
}

/** typed failures that only mean "nothing to chat with yet" */
const SETUP_STATES: ReadonlySet<string> = new Set(['credential_missing', 'model_required'])

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
  /** the window whose focus / visibility refresh the credentials (default: the frame's) */
  win?: Pick<Window, 'addEventListener'> & { document?: Pick<Document, 'addEventListener'> }
}): WebAi {
  let clientRef: AiWebClient | null = null
  let state: WebAiState = EMPTY
  let loading: Promise<WebAiState> | null = null
  let loadedAt = 0
  let everLoaded = false
  // the choice is read once the viewer is known (the key is per user); a pick made before that is
  // kept in memory and written with the rest
  let choiceKey = CHOICE_KEY
  let choiceReady = false
  let choice = emptyChoice()
  // what the host granted this frame (set at activation): BYOK, UniWork AI, and which cloud tools
  let byokGranted = false
  let uniworkGranted = false
  let cloudWanted = false
  /** the cloud status is read: for the tool switches (`cloudWanted`) or for the UniWork AI model name */
  let cloudRead = false
  /** UniWork AI turned off by the server after the grant was minted (capability / format off) */
  let uniworkOff = false
  let frameSession: { documentId: string; module?: OfficeModule } | null = null
  /**
   * provider -> what its own `/models` route listed: the ids (kept while a refresh runs or fails), the
   * key stamp and time of the last good answer, and the time of the last failure (the list is never
   * stored outside this instance)
   */
  interface ListEntry {
    ids: string[]
    stamp: string
    at: number
    failedAt: number
    failedStamp: string
  }
  const lists = new Map<string, ListEntry>()
  /** provider -> the key stamp of the listing that is in flight (one per provider) */
  const listing = new Map<string, string>()
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
      choiceKey = choiceKeyOf(
        typeof session.user?.id === 'string' && session.user.id ? session.user.id : undefined,
      )
      adoptStoredChoice()
      choiceReady = true
      byokGranted = session.capabilities?.ai === true
      uniworkGranted = session.capabilities?.uniworkAi === true
      if (
        !(byokGranted || uniworkGranted) ||
        !session.apiBase ||
        !tokens.getToken ||
        !tokens.refreshToken
      ) {
        return false
      }
      const granted = session.capabilities
      // the availability flag adds the `uniwork` entry to AI_PROVIDERS (every list built from it)
      setUniworkAiAvailable(uniworkGranted)
      // BYOK always reads the cloud switches (as before); a UniWork-only frame applies them only
      // when it was granted a cloud tool. The status is also read for the UniWork AI grant (it names
      // the model of that row); nothing is asked of the server when neither grant is there
      cloudWanted =
        byokGranted ||
        granted?.webSearch === true ||
        granted?.imageSearch === true ||
        granted?.imageGeneration === true
      cloudRead = cloudWanted || uniworkGranted
      const sessionModule = (session as { module?: OfficeModule }).module
      const module = opts.module ?? sessionModule
      frameSession = { documentId: session.documentId, ...(module ? { module } : {}) }
      clientRef = createAiWebClient({
        documentId: session.documentId,
        apiBase: session.apiBase,
        tokens: { getToken: tokens.getToken, refreshToken: tokens.refreshToken },
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(opts.origin ? { origin: opts.origin } : {}),
      })
      // early: the cloud tool switches land before the first AI run; a failure is retried on use
      void load(true).catch(() => {})
      // keys may change in another tab: only a BYOK frame has a credential list to refresh
      if (byokGranted) watchForeground()
      return true
    })
    .catch(() => false)

  async function load(refresh = false): Promise<WebAiState> {
    const client = clientRef
    if (!client) return EMPTY
    // a UniWork-only frame has no credential list, and no cloud status unless a grant reads it
    if (!byokGranted && !cloudRead) return state
    if (loading && !refresh && now() - loadedAt < CREDENTIALS_TTL_MS) return loading
    const run = (async () => {
      const [credentials, cloud] = await Promise.all([
        byokGranted ? client.listCredentials() : Promise.resolve(EMPTY.credentials),
        cloudRead ? client.cloudStatus().catch(() => null) : Promise.resolve(null),
      ])
      const changed =
        everLoaded && credentialSignature(credentials) !== credentialSignature(state.credentials)
      state = { credentials, cloud }
      loadedAt = now()
      everLoaded = true
      // the tool switches and the process-wide status follow a granted tool only
      if (cloudWanted) applyCloud(cloud)
      void refreshLists(true)
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

  /** this browser's stored picks join the ones made before the viewer was known (the newer wins) */
  function adoptStoredChoice(): void {
    const stored = readChoice(choiceKey)
    const early = choice
    const models = { ...stored.models, ...early.models }
    const at = { ...stored.at, ...early.at }
    const providerAt = Math.max(stored.providerAt, early.providerAt)
    const provider =
      early.provider && early.providerAt >= stored.providerAt ? early.provider : stored.provider
    choice = { ...(provider ? { provider } : {}), providerAt, models, at }
    if (early.provider || Object.keys(early.models).length) writeChoice(choiceKey, choice)
  }

  function stampOf(credential: { key_hint: string; base_url: string; updated_at: string }): string {
    return `${credential.key_hint}:${credential.base_url}:${credential.updated_at}`
  }

  /** what the chip is told about one provider's live list (never a key) */
  function listedOf(id: string): { listed?: string[]; listState?: 'loading' | 'error' } {
    const entry = lists.get(id)
    const have = entry && entry.at > 0
    if (have && entry.ids.length > 0) return { listed: entry.ids }
    // 'loading' only while nothing was listed yet; 'error' only when the last listing failed and no
    // list is kept (an empty answer is an answer: the catalog shows, nothing to say)
    if (have) return {}
    if (listing.has(id)) return { listState: 'loading' }
    return entry && entry.failedAt > 0 ? { listState: 'error' } : {}
  }

  const listSignature = (id: string): string => JSON.stringify(listedOf(id))

  /**
   * Lists each usable provider's own `/models` route in the background: when it has no list yet, the
   * list is older than the TTL or the key changed, one request in flight per provider. A failure is
   * remembered (the catalog shows, the chip may say so) and retried after a pause; a 404
   * `credential_missing` means the key was deleted elsewhere, so the credentials reload. The answer
   * reaches the chips through the change signal; the read that started it never waits.
   * `onlyModelless` = the discovery of a custom endpoint that has no default model to name.
   */
  async function refreshLists(onlyModelless = false): Promise<void> {
    const client = clientRef
    if (!client) return
    const usable = new Set(usableProviders())
    for (const id of [...lists.keys()]) if (!usable.has(id)) lists.delete(id)
    await Promise.all(
      state.credentials.items.map(async (credential) => {
        const id = credential.provider
        if (!usable.has(id) || listing.has(id)) return
        if (onlyModelless && defaultModelOf(id)) return
        const stamp = stampOf(credential)
        const entry = lists.get(id)
        const t = now()
        const fresh =
          entry !== undefined &&
          entry.at > 0 &&
          entry.stamp === stamp &&
          t - entry.at < MODEL_LIST_TTL_MS
        // a failure of this very key is not asked again before the pause
        const paused =
          entry !== undefined &&
          entry.failedAt > 0 &&
          entry.failedStamp === stamp &&
          t - entry.failedAt < MODEL_LIST_RETRY_MS
        if (fresh || paused) return
        listing.set(id, stamp)
        const before = listSignature(id)
        let missing = false
        try {
          const ids = modelIdsOf(await client.json(`byok/${encodeURIComponent(id)}/models`))
          lists.set(id, { ids, stamp, at: Math.max(now(), 1), failedAt: 0, failedStamp: '' })
        } catch (err) {
          missing = isAiWebError(err) && err.code === 'credential_missing'
          // the old list belongs to the old key: only a failed refresh of the same key keeps it
          const prior = lists.get(id)
          const kept = prior?.stamp === stamp ? prior : undefined
          lists.set(id, {
            ids: kept?.ids ?? [],
            stamp: kept?.stamp ?? '',
            at: kept?.at ?? 0,
            failedAt: Math.max(now(), 1),
            failedStamp: stamp,
          })
        } finally {
          listing.delete(id)
        }
        if (missing) void load(true).catch(() => {})
        if (listSignature(id) !== before) notifyChanged()
      }),
    )
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

  function defaultModelOf(provider: string): string {
    return AI_PROVIDERS.find((p) => p.id === provider)?.defaultModel ?? ''
  }

  /** usable = has a stored key, the server knows its protocol, genoffice can drive it */
  function usableProviders(): string[] {
    return state.credentials.items
      .map((c) => c.provider)
      .filter((id) => WEB_PROVIDER_IDS.has(id) && protocolOf(id))
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
   * entry hides at once, with no error. A frame that has no BYOK grant has nothing left to chat
   * with, so its panel hides too.
   */
  function turnUniworkOff(): void {
    if (uniworkOff) return
    uniworkOff = true
    setUniworkAiAvailable(false)
    const caps = opts.capabilities
    caps.uniworkAi = false
    if (!byokGranted) caps.ai = false
    notifyChanged()
  }

  async function settings(): Promise<AiSettings> {
    const base = defaultAiSettings()
    if (!(await activation)) return base
    // a list that never loaded says nothing about the keys; after one good load a failed refresh
    // keeps the last answer instead
    const listFailed = await load().then(
      () => false,
      () => !everLoaded,
    )
    // the live lists start in the background; this read never waits for them
    void refreshLists()
    const usable = usableProviders()
    const fallback = state.credentials.providers.find((p) => WEB_PROVIDER_IDS.has(p.id))?.id
    const uniworkOn = uniworkEffective()
    // the newer of this browser's pick and the server's default (the provider whose model was set
    // last) decides the provider: a model changed in UniWork Settings after the pick reaches this
    // browser too. Without a server stamp (an older server, nothing saved) the pick stands. The
    // winner is this browser's pick when its provider still has a key, else the server's default,
    // else the first usable one; UniWork AI when the viewer picked it (and it won), or when it is
    // all there is (no key of their own)
    const serverDefault = serverDefaultProvider(usable)
    const localWins =
      choice.provider !== undefined && (!serverDefault || choice.providerAt > serverDefault.at)
    const picked = choice.provider === UNIWORK_PROVIDER_ID ? undefined : choice.provider
    const winner = localWins ? picked : undefined
    const keyed =
      winner && usable.includes(winner)
        ? winner
        : (serverDefault?.provider ?? usable[0] ?? undefined)
    const provider = (
      choice.provider === UNIWORK_PROVIDER_ID && uniworkOn && localWins
        ? UNIWORK_PROVIDER_ID
        : (keyed ?? (uniworkOn ? UNIWORK_PROVIDER_ID : (picked ?? fallback ?? 'openai')))
    ) as AiProviderId
    const providers = { ...base.providers }
    const modelSources: NonNullable<AiSettings['modelSources']> = {}
    for (const id of Object.keys(providers) as AiProviderId[]) {
      // the newer of this browser's pick and the model saved on the server, else the provider's
      // default; a model-less provider that lists exactly one model runs on it (the chip shows it),
      // otherwise it stays empty: the panel asks for a pick
      const live = lists.get(id)?.ids ?? []
      const only = live.length === 1 ? live[0]! : ''
      const stored = state.credentials.items.find((c) => c.provider === id)
      const chosen = stored?.model ?? ''
      const mine = choice.models[id] ?? ''
      const savedAt = chosen ? Date.parse(stored?.model_updated_at ?? '') : Number.NaN
      const model =
        mine && chosen
          ? Number.isFinite(savedAt) && (choice.at[id] ?? 0) <= savedAt
            ? chosen
            : mine
          : mine || chosen || (defaultModelOf(id) ? '' : only)
      const usableHere = usable.includes(id)
      if (usableHere) modelSources[id] = { chosen, ...listedOf(id) }
      providers[id] = {
        ...providers[id],
        // The real key never reaches the frame. A provider with a key stored in UniWork carries
        // its masked hint (non-empty, never sent: ./stream.ts drops it) so the shared picker and
        // `isProviderUsable` see it as configured; one without stays empty and is not listed.
        apiKey: usableHere ? stored?.key_hint || '…' : '',
        ...(usableHere && providers[id].baseUrl !== undefined
          ? { baseUrl: stored?.base_url || protocolBaseOf(id) || providerLabel(id) }
          : {}),
        ...(model ? { model } : {}),
      }
    }
    // UniWork AI: no key, never locked (a non-empty slot reads as configured); the server's policy
    // picks the model, so none is named here
    if (uniworkOn) providers[UNIWORK_PROVIDER_ID] = { apiKey: '…', model: '' }
    const uniworkModel = uniworkOn ? (state.cloud?.uniwork_model ?? '') : ''
    const cloudOn = opts.capabilities.imageGeneration === true
    // UniAI is the desktop's pool of cloud models: the web runs only the viewer's own providers
    return {
      ...base,
      provider,
      providers,
      gskToolsEnabled: cloudOn,
      uniAiAvailable: false,
      modelSources,
      ...(uniworkModel ? { uniworkModel } : {}),
      ...(listFailed ? { credentialsUnavailable: true } : {}),
    }
  }

  /**
   * The provider whose model was set last (the contract's default provider for a browser with no
   * choice): a usable item with a model and the latest `model_updated_at`; ties go to the provider id
   * order. Null while no usable provider has a model saved (older server, nothing chosen yet).
   */
  function serverDefaultProvider(usable: string[]): { provider: string; at: number } | null {
    let best: { provider: string; at: number } | null = null
    for (const c of state.credentials.items) {
      if (!c.model || !usable.includes(c.provider)) continue
      const at = Date.parse(c.model_updated_at)
      const when = Number.isFinite(at) ? at : 0
      if (!best || when > best.at || (when === best.at && c.provider < best.provider)) {
        best = { provider: c.provider, at: when }
      }
    }
    return best
  }

  // One PUT in flight per provider and only the latest pick waiting behind it, so two quick picks
  // reach the server in order and the last one wins; each answer is the server's truth at that point.
  const modelSaves = new Map<string, { latest: string; running: boolean }>()

  /**
   * Saves a chosen model with the person's credential, so another browser opens on it. Quiet by
   * design: a failed save (offline, an older server, a stale token) keeps this browser's choice and
   * never blocks chatting; the next pick tries again. Nothing is sent for a provider without a stored
   * key (the server would refuse a model-only body) or when the server already holds that model.
   */
  async function saveModel(provider: string, model: string): Promise<void> {
    const slot = modelSaves.get(provider) ?? { latest: model, running: false }
    slot.latest = model
    modelSaves.set(provider, slot)
    if (slot.running) return
    slot.running = true
    try {
      for (;;) {
        const want = slot.latest
        const client = clientRef
        const stored = state.credentials.items.find((c) => c.provider === provider)
        if (!client || !stored || stored.model === want) return
        try {
          const saved = await client.saveCredential(provider, { model: want })
          state = {
            ...state,
            credentials: {
              ...state.credentials,
              items: state.credentials.items.map((c) => (c.provider === provider ? saved : c)),
            },
          }
          // the pick now carries the server's clock, so a later change in Settings (also stamped by
          // the server) is compared on one clock, whatever this browser's own is
          const stamp = Date.parse(saved.model_updated_at)
          if (Number.isFinite(stamp) && choice.models[provider] === want) {
            choice = {
              ...choice,
              ...(choice.provider === provider ? { providerAt: stamp } : {}),
              at: { ...choice.at, [provider]: stamp },
            }
            writeChoice(choiceKey, choice)
          }
          notifyChanged()
        } catch {
          // kept in this browser's cache only
        }
        if (slot.latest === want) return
      }
    } finally {
      slot.running = false
    }
  }

  function choose(provider: string, model?: string): void {
    const at = now()
    choice = {
      provider,
      providerAt: at,
      models: { ...choice.models, ...(model ? { [provider]: model } : {}) },
      at: { ...choice.at, ...(model ? { [provider]: at } : {}) },
    }
    if (choiceReady) writeChoice(choiceKey, choice)
    notifyChanged()
    if (model) void saveModel(provider, model)
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
      models: (id) => [
        ...new Set([
          ...(AI_PROVIDERS.find((p) => p.id === id)?.models ?? []),
          ...(lists.get(id)?.ids ?? []),
        ]),
      ],
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
      uniworkChat: (request) => {
        if (!clientRef) return Promise.reject(new AiWebError({ code: 'unknown', status: 0 }))
        return clientRef.uniworkChat(request)
      },
    },
    protocolOf,
    // a failed chat turn is announced once, by the panel's inline error (the typed text below);
    // only the calls with no transcript (one-shot chat here, the tool members below) raise the card
    // "no key yet" and "pick a model" are setup states, not failures: the code marks them so the
    // panels draw a notice in every language (the same tag as the desktop no-key notice), not a red
    // error line with a retry
    describe: (err, provider) => {
      const text = describeAiError(err, providerLabel(provider))
      return SETUP_STATES.has(err.code) ? aiNoticeTagged('no_model', text) : text
    },
    onChatFailure: (err, provider) => showAiState(err, providerLabel(provider), { openSettings }),
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
      ...(opts.uniworkStream ? { stream: opts.uniworkStream } : {}),
    },
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
