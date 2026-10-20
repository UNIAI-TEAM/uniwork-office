export { AiPanelSideButton } from './AiPanelSideButton'
export { useCloudSignedIn } from './use-cloud-signed-in'
export { useImageGenerationOffered } from './use-image-generation-offered'
export { AiComposer } from './AiComposer'
export { AiQueueStrip } from './AiQueueStrip'
export { useChatRunQueue, type ChatRunQueue, type QueuedChatMessage } from './chat-run-queue'
export { AI_QUEUE_LABELS, type AiQueueStripLabels } from './strings-ai-queue'
export { AiUsageChip, addTokenUsage, formatTokenCount, type AiTokenUsageView } from './AiUsageChip'
export { AI_USAGE_LABELS, type AiUsageLabels } from './strings-ai-usage'
export { AiScopeQuote, type AiScopeQuoteData } from './AiScopeQuote'
export {
  AI_CUSTOM_FONT_MAX_PX,
  AI_CUSTOM_FONT_MIN_PX,
  AI_FONT_BASE_PX,
  AI_FONT_SIZES,
  DEFAULT_AI_PANEL_PREFS,
  aiPanelFontPx,
  clampAiCustomFontSize,
  isAiFontSize,
  normalizeAiPanelPrefs,
  type AiFontSize,
  type AiPanelPrefs,
  type AiPanelSide,
} from './ai-panel-prefs'
export {
  applyAiPanelPrefs,
  aiPanelInitiallyOpen,
  rememberAiPanelOpen,
  useAiPanelPrefs,
  useAiSidebarEnabled,
  aiPanelWidthAtPointer,
} from './ai-panel-prefs-store'
export {
  ColorPicker,
  THEME_COLORS,
  THEME_COLOR_SHADES,
  STANDARD_COLORS,
  type ColorPickerProps,
  type ColorPickerStrings,
  type ColorSwatch,
} from './color-picker'
export { installScreenTips } from './screentip'
export {
  installPopoverDismiss,
  useDismissablePopover,
  type PopoverDismissOptions,
} from './popover-dismiss'
export { Dropdown, type DropdownOption } from './dropdown'
export {
  FindPanel,
  type FindFocusRequest,
  type FindPanelStrings,
  type FindTarget,
} from './find-panel'
export { findInText, foldCase, isWordChar, type FindOptions } from './find-text'
export {
  useRibbonCollapse,
  RibbonCollapseButton,
  RibbonExpandButton,
  isRibbonCompactShortcut,
  isRibbonToggleShortcut,
  readRibbonCollapsed,
  readRibbonDensity,
  mountRibbonOverflowCue,
  ribbonOverflowOf,
  RIBBON_COMPACT_SHORTCUT,
  RIBBON_TOGGLE_SHORTCUT,
  type RibbonCollapse,
  type RibbonCollapseLabels,
  type RibbonCollapseOptions,
  type RibbonDensity,
  type RibbonOverflow,
  type RibbonScrollMetrics,
} from './ribbon-collapse'
export { AiTypingIndicator } from './AiTypingIndicator'
export { IconSend, IconStop, type IconProps } from './icons'
export { UniAiMark } from './UniAiMark'
export { Markdown, type MarkdownNav } from './Markdown'
export { isSymbolFontFamily } from './symbol-fonts'
export {
  BUILTIN_FONT_FAMILIES,
  fontFamiliesFor,
  partitionFontFamilies,
  systemFamiliesBesidesCandidates,
} from './font-list'
export {
  WORDART_PRESETS,
  wordArtSolidColor,
  wordArtStrokePx,
  type WordArtPreset,
} from './wordart-presets'
export {
  SHAPE_GALLERY_GROUPS,
  ShapePreview,
  shapeClipCss,
  shapePreviewBox,
  shapePreviewPath,
  type ShapeGalleryGroup,
  type ShapeGalleryShape,
} from './shape-gallery'
export {
  CropDialog,
  CutoutDialog,
  cropEdgeArrowDelta,
  cropEdgeValue,
  cropImagePng,
  DEFAULT_CUTOUT_TOLERANCE,
  nudgeCropEdge,
  CROP_EDGES,
  CROP_EDGE_STEP,
  CROP_EDGE_STEP_COARSE,
  type CropEdge,
  type CropFractions,
  type ImageDialogLabels,
} from './image-dialogs'
export { CROP_EDGE_LABELS } from './strings-crop-edges'
export {
  aiUniworkStrings,
  aiUniworkText,
  isUniworkRefusalErrorKey,
  uniworkErrorForEntry,
  type AiUniworkStringKey,
} from './strings-ai-uniwork'
export { AiErrorAction, type AiErrorActionProps } from './AiErrorAction'
export { AiSaveDraftCard, type AiSaveDraftCardProps } from './AiSaveDraftCard'
export { AI_SAVE_DRAFT_LABELS, type AiSaveDraftLabels } from './strings-ai-save-draft'
export { ImageViewer, type ImageViewerLabels } from './image-viewer'
export { focusableIn, trapTab, useModalKeys } from './modal-keys'
export {
  OVERLAY_DOCK_MAX_PX,
  overlayDockQuery,
  shouldCloseOnEscape,
  shouldFocusComposer,
  useOverlayDock,
  type OverlayDockOptions,
} from './use-overlay-dock'
export {
  removeBackground,
  sampleBackgroundColors,
  type CutoutResult,
  type PixelImage,
  type RGB,
} from './cutout'
export {
  encodeAutoSaveOverride,
  isAutoSaveDefault,
  NO_AUTO_SAVE_DEFAULT,
  resolveAutoSave,
  useAutoSavePref,
  type AutoSaveDefault,
  type AutoSaveDefaultApi,
} from './auto-save-pref'
export {
  createCapabilityReader,
  type CapabilityObject,
  type CapabilityReader,
} from './capabilities'
export {
  NOTCH,
  clampZoom,
  createWheelPager,
  createZoomWheelClassifier,
  notchStep,
  type ZoomWheelIntent,
} from './wheel-zoom'
export { AiModelPicker, type AiModelPickerBridge } from './AiModelPicker'
export { setAiModelNeedHint, useAiModelNeedAction, useAiModelNeedHint } from './ai-model-need'
export {
  aiModelPickerGroups,
  aiModelPickerSelection,
  withAiModelSelection,
  type AiModelPickerGroup,
  type AiModelPickerSelection,
} from './ai-model-picker-options'
export { ProviderLogo } from './provider-logos'
export { useRedactLabelField } from './use-redact-label'
export type { RedactLabelField } from './use-redact-label'
export { type AiComposerProps } from './AiComposer'
export {
  UNIWORK_ACK_STORAGE_KEY,
  UniworkComposerNote,
  UniworkDisclosure,
  UniworkDisclosureShort,
  ack,
  clearUniworkAcks,
  createUniworkSendGate,
  isAcked,
  isComposerPopupOpen,
  resolveComposerNoteText,
  serializeUniworkAckKey,
  subscribeUniworkAck,
  useUniworkDisclosureAck,
  useUniworkSendGate,
  type AiComposerUniworkDisclosureConfig,
  type AiComposerUniworkProps,
  type UniworkAckKey,
  type UniworkComposerNoteProps,
  type UniworkDisclosureProps,
  type UniworkDisclosureShortProps,
  type UniworkDisclosureVariant,
  type UniworkSendGate,
} from './ai-uniwork-composer'
export {
  composerNoteFor,
  type ComposerNote,
  type ComposerNoteAction,
  type ComposerNoteInput,
  type ComposerNoteKey,
  type ComposerNoteKind,
} from '@genoffice/ai-provider/browser'
export type {
  AiModelPickerCloudCredits,
  AiModelPickerCloudState,
  AiModelPickerCloudStatus,
} from './AiModelPicker'
