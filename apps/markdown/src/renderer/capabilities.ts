import { createCapabilityReader, type CapabilityObject } from '@genoffice/ui/capabilities'

/**
 * Platform capability gating (web frame, GO-B4). Electron sets no `markdownApi.capabilities`, so
 * every entry stays on; the web bridge (web/modules/markdown) sets one object and assigns the
 * host grants into it:
 *   ai, webSearch, imageSearch, imageGeneration  AI panel, AI ribbon group, ask-AI popover
 *   autoSave                                     AutoSave toggle + 30 s / blur autosave timer
 *   openInDocs                                   "export .docx and open in Docs"
 *   save                                         false = view only (host withheld `save`)
 */
export type MarkdownCapability =
  'ai' | 'webSearch' | 'imageSearch' | 'imageGeneration' | 'autoSave' | 'openInDocs' | 'save'

export const { cap, platform, resetForTest } = createCapabilityReader<MarkdownCapability>(
  () => (window.markdownApi as { capabilities?: CapabilityObject } | undefined)?.capabilities,
)
