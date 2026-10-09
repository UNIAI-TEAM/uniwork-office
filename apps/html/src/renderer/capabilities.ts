import { createCapabilityReader, type CapabilityObject } from '@genoffice/ui/capabilities'

/**
 * Platform capability gating (web frame, GO-B4). Electron sets no `htmlApi.capabilities`, so
 * every entry stays on; the web bridge (web/modules/html) sets one object and assigns the host
 * grants into it:
 *   ai, webSearch, imageSearch, imageGeneration  AI panel, AI ribbon group, ask-AI popover
 *   autoSave                                     AutoSave toggle + autosave timer
 *   htmlPreviewScripts   false = static preview: srcdoc, sandbox="" (no scripts, no network)
 *   htmlVisualEdit       inspector click-to-select, float toolbar, style panel, picture dialogs
 *   presentNewTab        Present > New tab
 *   exportDocx           Word export (needs a headless browser)
 *   save                 false = view only (host withheld `save`)
 */
export type HtmlCapability =
  | 'ai'
  | 'webSearch'
  | 'imageSearch'
  | 'imageGeneration'
  | 'autoSave'
  | 'htmlPreviewScripts'
  | 'htmlVisualEdit'
  | 'presentNewTab'
  | 'exportDocx'
  | 'save'

export const { cap, platform, resetForTest } = createCapabilityReader<HtmlCapability>(
  () => (window.htmlApi as { capabilities?: CapabilityObject } | undefined)?.capabilities,
)
