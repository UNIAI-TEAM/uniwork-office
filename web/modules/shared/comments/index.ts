/** The web frame half of the shared comments seam (lane contract G8-12 §3.3). */
export {
  createFrameCommentsApi,
  installFrameComments,
  type FrameCommentsClient,
  type FrameCommentsExtras,
  type FrameCommentsHooks,
  type FrameMentionsSearchInput,
} from './frame-api'
export { frameMentionAccess, type FrameMentionAccess } from './mention-access'
export {
  createFrameViewVersion,
  frameOpenVersionId,
  frameVersionViewProps,
  frameViewVersionAccess,
  type FrameVersionViewProps,
  type FrameViewVersionRequest,
  type FrameViewVersionResult,
} from './version-view'
export {
  createFrameDocVersion,
  frameDocVersion,
  type FrameDocSaved,
  type FrameDocVersion,
  type FrameDocVersionState,
} from './doc-version'
export {
  frameRevealRouter,
  type DiscussionRevealOwner,
  type EditorRevealOwner,
  type FrameRevealRouter,
  type RevealPort,
} from './reveal-router'
export {
  FRAME_SIDE_PANEL_EVENT,
  announceFrameSidePanel,
  onFrameSidePanel,
  type FrameSidePanelDetail,
} from './side-panel'
