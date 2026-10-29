import { createCapabilityReader, type CapabilityObject } from '@genoffice/ui/capabilities'

/**
 * Platform capability gating (web frame, GO-B4). Electron sets no `markdownApi.capabilities`, so
 * every entry stays on; the web bridge (web/modules/markdown) sets one object and assigns the
 * host grants into it:
 *   ai, webSearch, imageSearch, imageGeneration  AI panel, AI ribbon group, ask-AI popover
 *   autoSave                                     AutoSave toggle + 30 s / blur autosave timer
 *   openInDocs                                   "export .docx and open in Docs"
 *   imageHost                                    bring-your-own image host settings (Insert ribbon)
 *   aiImageFetch                                 AI insert_image: download a picture URL beside the document
 *                                                (desktop main process; the web frame has no such route)
 *   mdTheme                                      the paper theme picker (the choice persists in the desktop's
 *                                                image-host config file; no web store to remember it)
 *   wikiVault                                    the note vault: backlinks panel, graph view, tags sidebar, the `[[`
 *                                                suggester, create-note on click, block ids and `![[embed]]` paste
 *                                                conversion (they read the desktop's notes folder; a web frame
 *                                                holds one document and no file tree)
 *   saveStatus, viewOnlyChip                     the renderer's own save-state label (status bar) and "view only" chip;
 *                                                false on the web: the host header + one banner announce them
 *   save                                         false = view only (host withheld `save`)
 */
export type MarkdownCapability =
  | 'ai'
  | 'webSearch'
  | 'imageSearch'
  | 'imageGeneration'
  | 'autoSave'
  | 'openInDocs'
  | 'imageHost'
  | 'aiImageFetch'
  | 'mdTheme'
  | 'wikiVault'
  | 'save'
  | 'saveAs'
  | 'print'
  | 'exportPdf'
  | 'exportHtml'
  | 'saveStatus'
  | 'viewOnlyChip'

export const { cap, platform, resetForTest } = createCapabilityReader<MarkdownCapability>(
  () => (window.markdownApi as { capabilities?: CapabilityObject } | undefined)?.capabilities,
)
