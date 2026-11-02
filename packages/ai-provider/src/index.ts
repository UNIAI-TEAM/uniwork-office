export type {
<<<<<<< ours
=======
  AiCustomCompat,
  AiCustomEndpoint,
  AiCustomModelProfile,
  AiCustomProfile,
  AiCustomProtocol,
  AiChatRequest,
  AiChatResponse,
  AiMediaProviderConfig,
  AiMediaProviderId,
  AiMediaProviderMeta,
  AiMediaSettings,
  AiAnalysisProtocol,
  AiImageProtocol,
  AiSearchProviderId,
  AiSearchProviderMeta,
  AiSearchSettings,
  CodexModelCatalog,
  AiProviderConfig,
>>>>>>> theirs
  AiProviderId,
  AiSettings,
  AiStreamChunk,
  AiStreamRequest,
  AiTokenUsage,
  GenSparkAccountStatus,
} from './types'
export {
  UNIWORK_PROVIDER_META,
  cloudToolsEnabled,
  defaultAiSettings,
  aiSettingsFileOf,
  resolveAiSettings,
  setUniworkAiAvailable,
  uniworkAiAvailable,
} from './providers'
<<<<<<< ours
export { isInsideAiMount, proxyErrorBodyFields } from './proxy-url'
export { imageGenerationAvailable, mediaAnalysisAvailable, videoAnalysisAvailable } from './media'
export * from './uniwork-cloud'
export * from './uniwork/types'
export { setUniworkChatTransport, uniworkChatTransport } from './uniwork/transport'
export { streamUniwork } from './uniwork/protocol'
export type { UniworkTurnRequest } from './uniwork/protocol'
export { UniworkError, uniworkErrorKey } from './uniwork/errors'
export { UniworkConversations, uniworkConversations } from './uniwork/conversation'
export * from './ai-notice'
export * from './ai-test-failure'
export { aiStreamErrorFields } from './ai-chat-error'
export { aiChatFailureText } from './ai-chat-error-text'
export type { AiStreamErrorCode, AiStreamErrorFields } from './ai-chat-error'
export { isAiNetworkError } from './network-error'
export { isAiOverloadedError } from './overload-error'
export { sseLines } from './protocols/shared'
export type { StreamCallbacks } from './protocols/shared'
=======
export {
  activeCustomEndpoint,
  customEndpointLabel,
  newCustomEndpointId,
  removeCustomEndpoint,
  resolveCustomEndpoints,
  selectCustomEndpoint,
  upsertCustomEndpoint,
} from './custom-endpoints'
export {
  AI_CUSTOM_PROTOCOLS,
  declaredModelProfile,
  normalizeCustomProfile,
  resolveCustomProfile,
} from './custom-profile'
export type { ResolvedCustomProfile } from './custom-profile'
export { resolveProfileCredential } from './credential-env'
export type { EnvLookup } from './credential-env'
export {
  AI_MEDIA_PROVIDERS,
  GEMINI_MEDIA_BASE_URL,
  OPENAI_IMAGES_BASE_URL,
  activeMediaConfig,
  activeMediaProvider,
  defaultAiMediaSettings,
  getMediaProviderMeta,
  imageGenerationAvailable,
  mediaAnalysisAvailable,
  mediaConfigUsable,
  providerHasCapability,
  resolveAiMediaSettings,
  videoAnalysisAvailable,
} from './media'
export type { MediaCapability } from './media'
export {
  AI_SEARCH_PROVIDERS,
  activeSearchProvider,
  defaultAiSearchSettings,
  resolveAiSearchSettings,
} from './search-settings'
export {
  analyzeMediaWithProvider,
  generateImageWithProvider,
  sniffImageMime,
  testMediaProvider,
} from './media-protocols'
export type {
  AnalyzeMediaInput,
  ByokMediaProviderId,
  GenerateImageInput,
  MediaBlob,
} from './media-protocols'
export {
  AI_PROVIDER_ADAPTERS,
  getProviderAdapter,
  modelLacksVision,
  normalizeBaseUrl,
} from './registry'
export type {
  AiProtocol,
  ProviderAdapter,
  ProviderCapabilities,
  ResolvedEndpoint,
} from './registry'
export { sanitizeAiSettings, sanitizeCliPath, validCliPath } from './ai-settings-guard'
export { chatForProvider } from './chat'
export { setAiUserAgent, setRescueFetch } from './fetch'
export { isAiNetworkError } from './network-error'
export { isAiOverloadedError } from './overload-error'
export { isAiRegionBlockedError } from './region-error'
export { parseOutputCapRejection } from './output-cap'
export { AiCreditsError, sseLines, streamForProvider } from './stream'
export type { StreamCallbacks } from './stream'
>>>>>>> theirs
export {
  AI_CHAT_RESPONSE_TIMEOUT_MS,
  AI_CONNECT_TIMEOUT_MS,
  AI_IDLE_TIMEOUT_MS,
  AiTimeoutError,
  createStreamWatchdog,
} from './watchdog'
export type { StreamWatchdog } from './watchdog'
