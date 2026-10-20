/** Shared collab UI (server comments S12, Discussion S13): import styles from `@genoffice/ui/collab.css`. */
export * from './types'
export {
  COLLAB_MAX_ANCHORS,
  createUniworkCommentsSource,
  sendAnchorMap,
  type AnchorSyncOutcome,
  type CollabReply,
  type UniworkCommentsLike,
} from './uniwork-source'
export {
  COMMENTS_REVEAL_WAIT_MS,
  buildCollabThreads,
  collabInsertIndex,
  collabPermissions,
  useCollabThreads,
  type CollabActions,
  type CollabConflict,
  type CollabController,
  type CollabControllerOptions,
  type CollabFocusRequest,
  type CollabLoadState,
  type CollabNetStatus,
  type CollabNewThread,
  type CollabNotice,
  type CollabPermissions,
  type CollabStrings,
  type CollabThreadView,
} from './use-collab-threads'
export { CollabPanel, type CollabInFileSlot, type CollabPanelProps } from './CollabPanel'
export {
  CollabConfirmDialog,
  CollabThread,
  defaultRenderAnchor,
  defaultRenderBody,
  formatCollabTime,
  type CollabAnchorSlot,
  type CollabComposerSlot,
  type CollabRenderAnchor,
  type CollabRenderBody,
  type CollabRenderComposer,
  type CollabThreadProps,
} from './CollabThread'
export { COLLAB_LIVE_REGION_ID, announcePolite, collabLiveRegion } from './live-region'
export { parseBody, serialize, buildMentionToken, type BodyToken } from './body'
export { CollabBody, type CollabBodyProps } from './CollabBody'
export { anchorLabel } from './anchor-label'
export { AnchorLabel, type AnchorLabelProps, type AnchorLabelStrings } from './AnchorLabel'
export {
  CollabComposer,
  type CollabComposerMode,
  type CollabComposerProps,
  type CollabComposerStrings,
} from './CollabComposer'
export {
  AvatarSourceContext,
  AvatarSourceProvider,
  useAvatarSrc,
  useFrameAvatarSource,
  type AvatarSource,
  type FrameAvatars,
} from './avatar-source'
export { MentionPicker, type CollabPickerStrings } from './MentionPicker'
export { clearDraft, loadDraft, saveDraft, type CollabDraftKey } from './draft-store'
export { collabStrings, type CollabAllStrings } from './strings'
export {
  collabPanelStrings,
  collabPanelText,
  type CollabPanelStringKey,
} from '../strings-collab-panel'
export {
  collabMentionStrings,
  collabMentionText,
  type CollabMentionStringKey,
} from '../strings-collab-mention'
