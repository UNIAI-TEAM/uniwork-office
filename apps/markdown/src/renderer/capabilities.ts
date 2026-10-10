import { createCapabilityReader, type CapabilityObject } from '@genoffice/ui/capabilities'

/**
 * Platform capability gating (web frame, GO-B4). Electron sets no `markdownApi.capabilities`, so
 * every entry stays on; the web bridge (web/modules/markdown) sets one object and assigns the
 * host grants into it:
 *   ai, webSearch, imageSearch, imageGeneration  AI panel, AI ribbon group, ask-AI popover
 *   aiCredentials                                AI panel "AI settings" (web: UniWork-stored keys)
 *   autoSave                                     AutoSave toggle + 30 s / blur autosave timer
 *   openInDocs                                   "export .docx and open in Docs"
 *   imageHost                                    bring-your-own image host settings (Insert ribbon)
 *   saveStatus, viewOnlyChip                     the renderer's own save-state label (status bar) and "view only" chip;
 *                                                false on the web: the host header + one banner announce them
 *   save                                         false = view only (host withheld `save`)
 */
export type MarkdownCapability =
  | 'ai'
  | 'aiCredentials'
  | 'webSearch'
  | 'imageSearch'
  | 'imageGeneration'
  | 'autoSave'
  | 'openInDocs'
  | 'imageHost'
  | 'save'
  | 'saveStatus'
  | 'viewOnlyChip'

export const { cap, platform, resetForTest } = createCapabilityReader<MarkdownCapability>(
  () => (window.markdownApi as { capabilities?: CapabilityObject } | undefined)?.capabilities,
)
