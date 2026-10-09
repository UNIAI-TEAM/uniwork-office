import type {
  AiMediaProviderConfig,
  AiMediaProviderId,
  AiMediaProviderMeta,
  AiMediaSettings,
  AiSettings,
} from './types'
import {
  uniworkCloudEnabled,
  uniworkCloudToolAvailable,
  type UniworkCloudTool,
} from './uniwork-cloud'

export const OPENAI_IMAGES_BASE_URL = 'https://api.openai.com/v1'
export const GEMINI_MEDIA_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
export const XAI_BASE_URL = 'https://api.x.ai/v1'
/** DashScope root: images ride /api/v1/services/aigc/..., understanding rides /compatible-mode/v1 */
export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com'
export const MINIMAX_BASE_URL = 'https://api.minimax.io/v1'
/** DeepSeek's OpenAI-compatible root; the Vision + Files API live at https://api.deepseek.com */
export const DEEPSEEK_MEDIA_BASE_URL = 'https://api.deepseek.com/v1'

// Model ids verified against vendor docs 2026-09; keep chat-capable analysis
// models in step with the chat catalog in providers.ts. The `genspark` entry
// is the UniWork cloud route, kept so stored settings still resolve; pickers
// list visibleMediaProviders() instead.
export const AI_MEDIA_PROVIDERS: AiMediaProviderMeta[] = [
  {
    id: 'genspark',
    label: 'UniWork cloud',
    description: "Image generation and media analysis with your organization's UniWork AI credits",
    keyPlaceholder: 'Not required - uses your UniWork sign-in',
    defaultBaseUrl: '',
    imageProtocol: 'openai-images',
    imageModels: [],
    defaultImageModel: '',
    analysisProtocol: 'openai-chat',
    analysisModels: [],
    defaultAnalysisModel: '',
    videoAnalysis: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT Image for generation and editing; GPT chat models for image analysis',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: OPENAI_IMAGES_BASE_URL,
    imageProtocol: 'openai-images',
    // GPT Image 2.5 (sunburst = quality, flare = fast) per the OpenAI models page
    // 2026-09-24, same token rates as GPT Image 2, both on generations and edits.
    // GPT-6 reads images over Chat Completions; the tool-call caveat that keeps
    // it off the chat provider does not apply to analysis.
    imageModels: [
      'gpt-image-2.5-sunburst',
      'gpt-image-2.5-flare',
      'gpt-image-2',
      'gpt-image-1.5',
      'gpt-image-1',
      'gpt-image-1-mini',
    ],
    defaultImageModel: 'gpt-image-2',
    analysisProtocol: 'openai-chat',
    analysisModels: [
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4-mini',
    ],
    defaultAnalysisModel: 'gpt-5.6-luna',
    videoAnalysis: false,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    description:
      'Gemini native image output (Nano Banana) and Imagen; Gemini reads images, video and audio',
    keyPlaceholder: 'AIza...',
    defaultBaseUrl: GEMINI_MEDIA_BASE_URL,
    imageProtocol: 'gemini',
    imageModels: [
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
      'gemini-3.1-flash-lite-image',
      'gemini-2.5-flash-image',
    ],
    defaultImageModel: 'gemini-3.1-flash-image',
    analysisProtocol: 'gemini',
    analysisModels: [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.6-flash',
    ],
    defaultAnalysisModel: 'gemini-3.8-flash',
    videoAnalysis: true,
  },
  {
    id: 'doubao',
    label: 'Doubao (Volcengine Ark)',
    description: 'Seedream image generation and editing; Doubao Seed reads images and video',
    keyPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    defaultBaseUrl: ARK_BASE_URL,
    imageProtocol: 'openai-images',
    imageModels: [
      'doubao-seedream-5-0-260128',
      'doubao-seedream-4-5-251128',
      'doubao-seedream-4-0-250828',
    ],
    defaultImageModel: 'doubao-seedream-5-0-260128',
    analysisProtocol: 'openai-chat',
    analysisModels: ['doubao-seed-2-1-pro-260628', 'doubao-seed-2-1-turbo-260628'],
    defaultAnalysisModel: 'doubao-seed-2-1-pro-260628',
    videoAnalysis: true,
  },
  {
    id: 'glm',
    label: 'GLM (Zhipu)',
    description: 'CogView image generation; GLM-V reads images and video',
    keyPlaceholder: 'xxxxxxxx.xxxxxxxx',
    defaultBaseUrl: ZHIPU_BASE_URL,
    imageProtocol: 'openai-images',
    imageModels: ['cogview-4-250304', 'cogview-3-flash'],
    defaultImageModel: 'cogview-4-250304',
    analysisProtocol: 'openai-chat',
    analysisModels: ['glm-4.6v', 'glm-4.6v-flash'],
    defaultAnalysisModel: 'glm-4.6v',
    videoAnalysis: true,
  },
  {
    id: 'xai',
    label: 'Grok (xAI)',
    description: 'Grok Imagine image generation; Grok reads images',
    keyPlaceholder: 'xai-...',
    defaultBaseUrl: XAI_BASE_URL,
    imageProtocol: 'openai-images',
    imageModels: ['grok-imagine-image-2.0', 'grok-2-image-1212'],
    defaultImageModel: 'grok-imagine-image-2.0',
    analysisProtocol: 'openai-chat',
    analysisModels: ['grok-4.6', 'grok-4.5'],
    defaultAnalysisModel: 'grok-4.6',
    videoAnalysis: false,
  },
  {
    id: 'qwen',
    label: 'Qwen (Alibaba Cloud)',
    description: 'Qwen-Image generation; Qwen-VL reads images and video (DashScope)',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: DASHSCOPE_BASE_URL,
    imageProtocol: 'dashscope',
    imageModels: ['qwen-image-plus', 'qwen-image'],
    defaultImageModel: 'qwen-image-plus',
    analysisProtocol: 'openai-chat',
    analysisModels: ['qwen3-vl-plus', 'qwen3-vl-flash', 'qwen3.8-max', 'qwen3.7-plus'],
    defaultAnalysisModel: 'qwen3-vl-plus',
    videoAnalysis: true,
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    description:
      'Image generation; MiniMax-M3 reads images and video (use api.minimaxi.com/v1 for CN)',
    keyPlaceholder: 'eyJ...',
    defaultBaseUrl: MINIMAX_BASE_URL,
    imageProtocol: 'minimax',
    imageModels: ['image-01'],
    defaultImageModel: 'image-01',
    analysisProtocol: 'openai-chat',
    analysisModels: ['MiniMax-M3'],
    defaultAnalysisModel: 'MiniMax-M3',
    videoAnalysis: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    // native multimodal (V4.1 Flash = wire id deepseek-flash): reads JPEG/PNG/GIF/WebP,
    // no image generation and no video/audio, so it only appears for image analysis
    description: 'DeepSeek V4.1 Flash reads images (native multimodal); no image generation',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: DEEPSEEK_MEDIA_BASE_URL,
    imageModels: [],
    defaultImageModel: '',
    analysisProtocol: 'openai-chat',
    analysisModels: ['deepseek-flash'],
    defaultAnalysisModel: 'deepseek-flash',
    videoAnalysis: false,
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Any OpenAI-compatible endpoint: /images/generations and /chat/completions',
    keyPlaceholder: 'API Key',
    needsBaseUrl: true,
    defaultBaseUrl: '',
    imageProtocol: 'openai-images',
    imageModels: [],
    defaultImageModel: '',
    analysisProtocol: 'openai-chat',
    analysisModels: [],
    defaultAnalysisModel: '',
    videoAnalysis: false,
  },
]

export type MediaCapability = 'image' | 'analysis' | 'video'

export function getMediaProviderMeta(id: AiMediaProviderId): AiMediaProviderMeta | undefined {
  return AI_MEDIA_PROVIDERS.find((m) => m.id === id)
}

export function providerHasCapability(
  meta: AiMediaProviderMeta,
  capability: MediaCapability,
): boolean {
  if (capability === 'image') return !!meta.imageProtocol
  if (capability === 'video') return !!meta.analysisProtocol && meta.videoAnalysis
  return !!meta.analysisProtocol
}

export function defaultAiMediaSettings(): AiMediaSettings {
  const providers = {} as AiMediaSettings['providers']
  for (const meta of AI_MEDIA_PROVIDERS) {
    providers[meta.id] = {
      apiKey: '',
      imageModel: meta.defaultImageModel,
      analysisModel: meta.defaultAnalysisModel,
      baseUrl: meta.needsBaseUrl ? '' : undefined,
    }
  }
  return {
    imageProvider: 'genspark',
    analysisProvider: 'genspark',
    videoAnalysisProvider: 'genspark',
    providers,
  }
}

/**
 * Merge a stored media block over defaults, trimming pasted whitespace. The
 * pre-catalog `provider` field (one choice for both tools) seeds both
 * per-capability choices. Unknown provider ids are kept and simply never activate.
 */
export function resolveAiMediaSettings(
  stored: Partial<AiMediaSettings> | undefined,
): AiMediaSettings {
  const defaults = defaultAiMediaSettings()
  if (!stored) return defaults
  const providers = { ...defaults.providers }
  for (const [id, config] of Object.entries(stored.providers ?? {})) {
    if (!config || typeof config !== 'object') continue
    // Hand-edited settings files can carry non-string values: trim only
    // strings (like the search-settings guard) instead of crashing.
    const str = (v: unknown, fallback: string): string =>
      typeof v === 'string' ? v.trim() : fallback
    const base = providers[id as AiMediaProviderId]
    providers[id as AiMediaProviderId] = {
      apiKey: str(config.apiKey, base?.apiKey ?? ''),
      imageModel: str(config.imageModel, base?.imageModel ?? ''),
      analysisModel: str(config.analysisModel, base?.analysisModel ?? ''),
      ...(config.baseUrl !== undefined
        ? { baseUrl: str(config.baseUrl, base?.baseUrl ?? '') }
        : base?.baseUrl !== undefined
          ? { baseUrl: base.baseUrl }
          : {}),
    }
  }
  const legacy = stored.provider
  const analysisProvider = stored.analysisProvider ?? legacy ?? defaults.analysisProvider
  const cloudPicked = resolveCloudPicked(stored.cloudPicked)
  return {
    imageProvider: stored.imageProvider ?? legacy ?? defaults.imageProvider,
    analysisProvider,
    // a pre-split file used one vendor for all media analysis
    videoAnalysisProvider: stored.videoAnalysisProvider ?? analysisProvider,
    providers,
    ...(cloudPicked ? { cloudPicked } : {}),
  }
}

/** the explicit-cloud marks of a stored block; hand-edited junk reads as none */
function resolveCloudPicked(raw: unknown): AiMediaSettings['cloudPicked'] {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const picked: NonNullable<AiMediaSettings['cloudPicked']> = {}
  for (const cap of ['image', 'analysis', 'video'] as const) if (r[cap] === true) picked[cap] = true
  return Object.keys(picked).length ? picked : undefined
}

/** Key (or base URL for custom) present — the minimum for a BYOK media provider to be honored */
export function mediaConfigUsable(
  meta: AiMediaProviderMeta,
  config: AiMediaProviderConfig | undefined,
): boolean {
  if (!config) return false
  // Trim-aware like activeProvider: whitespace-only survivors of in-memory
  // settings are not usable configs.
  if (meta.needsBaseUrl) return !!config.baseUrl?.trim()
  return !!config.apiKey?.trim()
}

/** the UniWork cloud tool that serves one media capability */
export function cloudToolFor(capability: MediaCapability): UniworkCloudTool {
  return capability === 'image' ? 'image_generate' : 'media_analyze'
}

function storedMediaProvider(
  media: AiMediaSettings,
  capability: MediaCapability,
): AiMediaProviderId | undefined {
  return capability === 'image'
    ? media.imageProvider
    : capability === 'video'
      ? media.videoAnalysisProvider
      : media.analysisProvider
}

/** the first BYOK vendor (catalog order) that has this capability and a usable config */
function firstUsableByok(
  media: AiMediaSettings,
  capability: MediaCapability,
  offered: readonly AiMediaProviderMeta[] = AI_MEDIA_PROVIDERS,
): AiMediaProviderMeta | undefined {
  return offered.find(
    (m) =>
      m.id !== 'genspark' &&
      providerHasCapability(m, capability) &&
      mediaConfigUsable(m, media.providers?.[m.id]),
  )
}

/**
 * The stored provider for one capability, honored only when it exists, has
 * that capability and is usable; anything else resolves to `genspark` (the
 * UniWork cloud route, no BYOK config). A stored `genspark` is only the
 * default unless the user picked the cloud entry themselves
 * (`media.cloudPicked`): the default yields to the first BYOK provider with a
 * usable config, so a user's own key is never silently replaced by paid cloud
 * credits after sign-in. An explicit cloud pick stays on the cloud while the
 * capability's tool is offered (signed out, not entitled or not configured
 * fall back to BYOK).
 */
export function activeMediaProvider(
  settings: Pick<AiSettings, 'media'> & Partial<Pick<AiSettings, 'gskToolsEnabled'>>,
  capability: MediaCapability,
): AiMediaProviderId {
  const media = settings.media
  if (!media) return 'genspark'
  const id = storedMediaProvider(media, capability)
  if (!id || id === 'genspark') {
    // the AI model switch turns the cloud off even for an explicit pick
    const picked = media.cloudPicked?.[capability] === true && settings.gskToolsEnabled !== false
    if (picked && uniworkCloudToolAvailable(cloudToolFor(capability))) return 'genspark'
    return firstUsableByok(media, capability)?.id ?? 'genspark'
  }
  const meta = getMediaProviderMeta(id)
  if (!meta || !providerHasCapability(meta, capability)) return 'genspark'
  if (!mediaConfigUsable(meta, media.providers?.[id])) return 'genspark'
  return id
}

/** the active BYOK config for one capability, or null when it falls back to the UniWork cloud route */
export function activeMediaConfig(
  settings: Pick<AiSettings, 'media'> & Partial<Pick<AiSettings, 'gskToolsEnabled'>>,
  capability: MediaCapability,
): { provider: Exclude<AiMediaProviderId, 'genspark'>; config: AiMediaProviderConfig } | null {
  const provider = activeMediaProvider(settings, capability)
  if (provider === 'genspark') return null
  return { provider, config: settings.media!.providers[provider] }
}

/**
 * The providers one media block offers from the catalog the shell published.
 * The UniWork cloud entry is offered only while its tools are in use: signed in,
 * entitled and the "Use UniWork cloud tools" switch on.
 */
export function offeredMediaProviders(
  catalog: readonly AiMediaProviderMeta[],
  capability: MediaCapability,
  cloudToolsOn: boolean,
): AiMediaProviderMeta[] {
  return catalog.filter(
    (m) => (m.id !== 'genspark' || cloudToolsOn) && providerHasCapability(m, capability),
  )
}

/**
 * The provider a picker shows for one capability among `offered` (the entries
 * that block lists): the stored choice when the block offers it, except that a
 * default `genspark` shows the BYOK vendor that actually serves the capability
 * (see activeMediaProvider), and a stored choice the block does not offer
 * shows as its first entry.
 */
export function shownMediaProvider(
  media: AiMediaSettings,
  capability: MediaCapability,
  offered: readonly AiMediaProviderMeta[],
): AiMediaProviderId {
  const stored = storedMediaProvider(media, capability)
  if ((!stored || stored === 'genspark') && media.cloudPicked?.[capability] !== true) {
    const byok = firstUsableByok(media, capability, offered)
    if (byok) return byok.id
  }
  return (offered.find((m) => m.id === stored) ?? offered[0])?.id ?? stored ?? 'genspark'
}

function mediaProviderField(capability: MediaCapability) {
  return capability === 'image'
    ? 'imageProvider'
    : capability === 'video'
      ? 'videoAnalysisProvider'
      : 'analysisProvider'
}

/** Stores the provider the user picked for one capability; picking the cloud entry is remembered as explicit. */
export function setMediaProviderChoice(
  media: AiMediaSettings,
  capability: MediaCapability,
  id: AiMediaProviderId,
): AiMediaSettings {
  const { [capability]: _previous, ...rest } = media.cloudPicked ?? {}
  const cloudPicked = id === 'genspark' ? { ...rest, [capability]: true } : rest
  const { cloudPicked: _old, ...base } = media
  return {
    ...base,
    [mediaProviderField(capability)]: id,
    ...(Object.keys(cloudPicked).length ? { cloudPicked } : {}),
  }
}

function byokModel(
  settings: Pick<AiSettings, 'media'> & Partial<Pick<AiSettings, 'gskToolsEnabled'>>,
  capability: MediaCapability,
): string | null {
  const active = activeMediaConfig(settings, capability)
  if (!active) return null
  const meta = getMediaProviderMeta(active.provider)!
  return capability === 'image'
    ? active.config.imageModel || meta.defaultImageModel
    : active.config.analysisModel || meta.defaultAnalysisModel
}

/**
 * Media providers a picker may offer: the UniWork cloud entry only while this
 * process's cloud status says signed in + entitled, so a stored `genspark`
 * choice stays readable but hidden otherwise.
 */
export function visibleMediaProviders(): AiMediaProviderMeta[] {
  return uniworkCloudEnabled()
    ? AI_MEDIA_PROVIDERS
    : AI_MEDIA_PROVIDERS.filter((m) => m.id !== 'genspark')
}

/**
 * Settings after editing one vendor's config in a media block. The block shows
 * the first offered provider when the stored choice is not offered, so the shown
 * vendor is written into the capability's provider field only then, and only once
 * its resulting config is usable; a keyless edit must not pin a vendor that would
 * switch off a capability another vendor currently serves.
 */
export function updateMediaProviderConfig(
  media: AiMediaSettings,
  capability: MediaCapability,
  id: AiMediaProviderId,
  patch: Partial<AiMediaProviderConfig>,
): AiMediaSettings {
  const meta = getMediaProviderMeta(id)
  const config: AiMediaProviderConfig = {
    ...(media.providers[id] ?? {
      apiKey: '',
      imageModel: meta?.defaultImageModel ?? '',
      analysisModel: meta?.defaultAnalysisModel ?? '',
    }),
    ...patch,
  }
  const stored = storedMediaProvider(media, capability)
  // a stored cloud default shows (and serves) the first usable BYOK vendor instead, so
  // it only counts as a shown choice when the user picked the cloud entry
  const shown = visibleMediaProviders().some(
    (m) =>
      m.id === stored &&
      providerHasCapability(m, capability) &&
      (m.id !== 'genspark' || media.cloudPicked?.[capability] === true),
  )
  // an edit to the vendor that already serves the capability (it was usable) keeps it
  const wasUsable = !!meta && mediaConfigUsable(meta, media.providers[id])
  const pin = !shown && !!meta && (mediaConfigUsable(meta, config) || wasUsable)
  const updated = { ...media, providers: { ...media.providers, [id]: config } }
  return pin ? setMediaProviderChoice(updated, capability, id) : updated
}

/**
 * BYOK first; the cloud fallback needs the cloud toggle and `gskLoggedIn`,
 * which callers take from the shell main process (`ai:gsk-status` /
 * hasGskAuth(): signed in to UniWork and entitled), since a renderer holds
 * no cloud status of its own.
 */
function capabilityAvailable(
  settings: Pick<AiSettings, 'media' | 'gskToolsEnabled'> | null | undefined,
  gskLoggedIn: boolean,
  capability: MediaCapability,
): boolean {
  const cloud = gskLoggedIn
  if (!settings) return cloud
  const model = byokModel(settings, capability)
  if (model !== null) return model !== ''
  return cloud && settings.gskToolsEnabled !== false
}

/** live predicate for the generate_image tool: BYOK image model configured, or cloud sign-in + cloud tools on */
export function imageGenerationAvailable(
  settings: Pick<AiSettings, 'media' | 'gskToolsEnabled'> | null | undefined,
  gskLoggedIn: boolean,
): boolean {
  return capabilityAvailable(settings, gskLoggedIn, 'image')
}

/** live predicate for the analyze_media tool: image analysis or video analysis reachable */
export function mediaAnalysisAvailable(
  settings: Pick<AiSettings, 'media' | 'gskToolsEnabled'> | null | undefined,
  gskLoggedIn: boolean,
): boolean {
  return (
    capabilityAvailable(settings, gskLoggedIn, 'analysis') ||
    capabilityAvailable(settings, gskLoggedIn, 'video')
  )
}

export function videoAnalysisAvailable(
  settings: Pick<AiSettings, 'media' | 'gskToolsEnabled'> | null | undefined,
  gskLoggedIn: boolean,
): boolean {
  return capabilityAvailable(settings, gskLoggedIn, 'video')
}
