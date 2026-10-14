/** Browser-safe settings surface. Keep Node-backed transports out of renderer bundles. */
export type {
  AiProviderConfig,
  AiProviderId,
  AiProviderMeta,
  AiSettings,
  CodexModelCatalog,
} from './types'
export {
  AI_PROVIDERS,
  UNIWORK_PROVIDER_META,
  cloudToolsEnabled,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_MAX_OUTPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS,
  clampMaxOutputTokens,
  isProviderUsable,
  providerNeed,
  selectedProvider,
  uniAiOpenRouterKey,
} from './providers'
export { getProviderAdapter, modelLacksVision } from './registry'
export {
  AI_MEDIA_PROVIDERS,
  imageGenerationAvailable,
  mediaAnalysisAvailable,
  offeredMediaProviders,
  setMediaProviderChoice,
  shownMediaProvider,
  updateMediaProviderConfig,
  visibleMediaProviders,
} from './media'
export { aiChatFailureText } from './ai-chat-error-text'
export {
  UNIWORK_CLOUD_SIGNED_OUT,
  UNIWORK_CLOUD_TOOLS,
  getUniworkCloudStatus,
  normalizeUniworkCloudStatus,
  onUniworkCloudStatus,
  setUniworkCloudStatus,
  uniworkCloudEnabled,
  uniworkCloudToolAvailable,
} from './uniwork-cloud'
export type {
  UniworkCloudCredits,
  UniworkCloudState,
  UniworkCloudStatus,
  UniworkCloudTool,
} from './uniwork-cloud'
export {
  UNIWORK_CONVERSATION_HEADER,
  UNIWORK_MAX_RATE_LIMIT_WAITS,
  UNIWORK_PROVIDER_ID,
  UNIWORK_RETRY_AFTER_CAP_SECONDS,
  UNIWORK_RUN_HEADER,
} from './uniwork/types'
export type {
  UniworkChatRequest,
  UniworkChatTransport,
  UniworkDroppedToolCall,
  UniworkExtension,
  UniworkFormat,
  UniworkNotice,
  UniworkScope,
  UniworkTerminal,
  UniworkToolPolicy,
  UniworkTurnIds,
  UniworkWireCode,
} from './uniwork/types'
export { streamUniwork } from './uniwork/protocol'
export { UniworkError, isUniworkError, uniworkErrorKey } from './uniwork/errors'
export { uniworkConversations } from './uniwork/conversation'
export { setUniworkAiAvailable, uniworkAiAvailable } from './providers'
export { mirrorUniworkAiFlag } from './uniwork/flag-mirror'
export type { UniworkAiFlagBridge } from './uniwork/flag-mirror'
export {
  aiNoticeBody,
  aiNoticeKind,
  aiNoticeKindForCloud,
  aiNoticeText,
  composerNoteFor,
} from './ai-notice'
export type {
  AiNoticeKind,
  AiNoticeLang,
  ComposerNote,
  ComposerNoteAction,
  ComposerNoteInput,
  ComposerNoteKey,
  ComposerNoteKind,
} from './ai-notice'
export { normalizeAiTestFailureKind } from './ai-test-failure'
export type { AiTestFailureKind } from './ai-test-failure'
export { AI_SEARCH_PROVIDERS } from './search-settings'
