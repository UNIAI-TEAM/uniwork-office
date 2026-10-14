export type {
  AgentDroppedToolCall,
  AgentImage,
  AgentMessage,
  AgentStreamCallbacks,
  AgentStreamHandle,
  AgentStreamNotice,
  AgentStreamRequest,
  AgentRequestPurpose,
  AgentToolCall,
  AgentToolDef,
  AgentToolResult,
  AgentTransport,
  ToolDisplay,
  ToolExecution,
} from './types'
export { AI_RUN_IDLE_GRACE_MS, createAiRunTracker } from './ai-run-tracker'
export type { AiRunPayload, AiRunState, AiRunTracker, AiRunTrackerOptions } from './ai-run-tracker'
export {
  classifyDroppedToolReason,
  createTextNoticeSurface,
  endsQuietly,
  noticePatch,
  noticeToPanelNote,
} from './notice-surface'
export type {
  DroppedToolReason,
  LegacyDroppedNoticeNote,
  NoticeKey,
  NoticeSurface,
  NoticeTranslate,
  PanelNote,
  TextNoticeSurface,
} from './notice-surface'
export { classifyS9Error, extractSheetsCellsMeta, resultChip } from './result-chip'
export type {
  ResultChipCellsMetaInput,
  ResultChipDroppedToolCall,
  ResultChipErrorAction,
  ResultChipErrorActionKey,
  ResultChipErrorInput,
  ResultChipErrorKey,
  ResultChipErrorLine,
  ResultChipInput,
  ResultChipKind,
  ResultChipLabelKey,
  ResultChipMeta,
  ResultChipOutput,
  ResultChipReasonKey,
  ResultChipTone,
  ResultChipToolExecution,
} from './result-chip'
export { composeSkills } from './skill'
export type { AgentSkill, ExecutedToolCall } from './skill'
export {
  AgentLoop,
  COMPLETED_VIA_TOOLS_TEXT,
  DEFAULT_MAX_TURNS,
  TOOL_ABORTED_OUTPUT,
  coerceArgumentFields,
  invalidArgumentFields,
  missingRequiredFields,
  runtimePreamble,
  sanitizeAgentPayload,
} from './loop'
export type {
  AgentLoopEvents,
  AgentLoopOptions,
  AgentRunResult,
  CompactionOptions,
  ToolExecutedEvent,
} from './loop'
export {
  createIpcTransport,
  desktopAiRun,
  IPC_STREAM_SILENCE_TIMEOUT_MS,
} from './electron-transport'
export { streamText } from './stream-text'
export type { StreamTextOptions, StreamTextOutcome } from './stream-text'
export type { IpcStreamChunk, IpcStreamStart, IpcTransportOptions } from './electron-transport'
